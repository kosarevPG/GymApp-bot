"""Yandex Cloud Function entrypoint for GymApp v2."""

from __future__ import annotations

import base64
import json
import logging
import mimetypes
import os
import re
from pathlib import Path
from typing import Any, Dict
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from object_storage import UploadError, upload_image
from request_auth import authenticate_request
from supabase_store import (
    ConflictError,
    create_exercise,
    delete_set,
    delete_workout,
    export_data,
    get_analytics,
    get_exercise_history,
    get_global_history,
    get_init,
    get_workout_session,
    import_data,
    save_set,
    update_exercise,
    update_set,
)
from telegram_auth import AuthenticationError


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

STATIC_ROOT = Path(__file__).with_name("static")

CORS_HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data, Authorization",
    "Access-Control-Max-Age": "86400",
}


def response(data: Any, status: int = 200) -> Dict[str, Any]:
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps(data, ensure_ascii=False),
    }


def _method(event: Dict[str, Any]) -> str:
    value = (
        event.get("httpMethod")
        or event.get("http_method")
        or (event.get("requestContext") or {}).get("http", {}).get("method")
        or "GET"
    )
    return str(value).upper()


def _headers(event: Dict[str, Any]) -> Dict[str, str]:
    raw = event.get("headers") or {}
    if not raw:
        raw = (event.get("requestContext") or {}).get("request", {}).get("headers") or {}
    return {str(key).lower(): str(value) for key, value in raw.items()}


def _route(event: Dict[str, Any]) -> tuple[str, Dict[str, str], str, bool]:
    event_query = event.get("queryStringParameters") or {}
    if not isinstance(event_query, dict):
        event_query = {}

    routed_url = str(event_query.get("url") or "").strip()
    if not routed_url:
        # Yandex's public function gateway omits both fields for a bare GET to
        # the function URL. Treat that request as the static application root;
        # API calls always provide their explicit route through ?url=/api/....
        routed_url = str(event.get("url") or event.get("path") or "/")
    parsed = urlparse(routed_url if "://" in routed_url else f"https://local{routed_url}")
    path = parsed.path or "/api/ping"
    is_api = path == "/api" or path.startswith("/api/")
    endpoint = path.removeprefix("/api/").strip("/") if is_api else path.strip("/")
    endpoint = endpoint or "ping"

    params = {
        key: values[-1]
        for key, values in parse_qs(parsed.query, keep_blank_values=True).items()
    }
    for key, value in event_query.items():
        if key != "url" and value is not None:
            params[str(key)] = str(value[-1] if isinstance(value, list) else value)
    return endpoint, params, path, is_api


def _static_response(path: str) -> Dict[str, Any]:
    relative = path.lstrip("/") or "index.html"
    candidate = (STATIC_ROOT / relative).resolve()
    static_root = STATIC_ROOT.resolve()
    if static_root not in candidate.parents and candidate != static_root:
        return response({"error": "Route not found"}, 404)
    if not candidate.is_file():
        candidate = STATIC_ROOT / "index.html"
    if not candidate.is_file():
        # Ссылки на корень функции вшиты в старые сообщения Telegram навсегда:
        # адрес запекается в кнопку при отправке. Пока статика здесь не
        # развёрнута, уводим такие переходы на рабочий фронт, а не в 404.
        fallback = os.getenv("FRONTEND_URL", "").strip()
        if fallback.startswith("https://") and "functions.yandexcloud.net" not in fallback:
            return {
                "statusCode": 302,
                "headers": {**CORS_HEADERS, "Location": fallback, "Cache-Control": "no-cache"},
                "body": "",
            }
        return response({"error": "Static frontend is not deployed"}, 404)

    content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
    content = candidate.read_bytes()
    headers = {
        "Content-Type": f"{content_type}; charset=utf-8" if content_type.startswith("text/") or content_type in {"application/javascript", "application/json"} else content_type,
        "Cache-Control": "no-cache" if candidate.name == "index.html" else "public, max-age=31536000, immutable",
    }
    if content_type.startswith("text/") or content_type in {"application/javascript", "application/json", "image/svg+xml"}:
        text = content.decode("utf-8")
        if candidate.name == "index.html":
            # Yandex's public function URL cannot serve /assets/... as a path:
            # it treats the first path component as another function ID. Route
            # local HTML assets through the same explicit query router as API
            # requests so the installed Telegram UI never renders blank.
            text = re.sub(
                r'((?:src|href)=["\'])(?:\./|/)(?!/)',
                r'\1?url=/',
                text,
            )
        return {"statusCode": 200, "headers": headers, "body": text}
    return {
        "statusCode": 200,
        "headers": headers,
        "body": base64.b64encode(content).decode("ascii"),
        "isBase64Encoded": True,
    }


def _body(event: Dict[str, Any]) -> Dict[str, Any]:
    body = event.get("body") or ""
    if not body:
        body = (event.get("requestContext") or {}).get("request", {}).get("body") or ""
    if event.get("isBase64Encoded") and isinstance(body, str):
        body = base64.b64decode(body).decode("utf-8")
    if isinstance(body, dict):
        return body
    if not body:
        return {}
    return json.loads(body)


def _telegram_request(method: str, payload: Dict[str, Any]) -> None:
    token = os.getenv("BOT_TOKEN", "").strip()
    if not token:
        return
    request = Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=10):
        pass


def _telegram_webhook(data: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
    expected_secret = os.getenv("TELEGRAM_WEBHOOK_SECRET", "").strip()
    actual_secret = headers.get("x-telegram-bot-api-secret-token", "")
    if not expected_secret:
        return response({"error": "Telegram webhook secret is not configured"}, 503)
    if not actual_secret or actual_secret != expected_secret:
        return response({"error": "Forbidden"}, 403)

    message = data.get("message") or {}
    text = str(message.get("text") or "")
    chat_id = (message.get("chat") or {}).get("id")
    if chat_id and text.startswith("/start"):
        frontend_url = os.getenv("FRONTEND_URL", "").strip()
        _telegram_request(
            "sendMessage",
            {
                "chat_id": chat_id,
                "text": "🏋️ GymApp\nОткрывай приложение — тренировка сохранится даже при временных проблемах с сетью.",
                "reply_markup": {
                    "inline_keyboard": [
                        [
                            {
                                "text": "🏋️ Открыть приложение",
                                "web_app": {"url": frontend_url},
                            }
                        ]
                    ]
                },
            },
        )
    return response({"ok": True})


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    del context
    event = event or {}
    method = _method(event)
    if method == "OPTIONS":
        return {"statusCode": 204, "headers": CORS_HEADERS, "body": ""}

    endpoint, params, path, is_api = _route(event)
    headers = _headers(event)
    try:
        if method == "GET" and not is_api:
            return _static_response(path)
        if endpoint == "telegram":
            if method != "POST":
                return response({"error": "Method not allowed"}, 405)
            return _telegram_webhook(_body(event), headers)

        authenticated = authenticate_request(headers)
        user_id = authenticated.user_id

        if endpoint == "ping" and method == "GET":
            return response({"status": "ok", "storage": "supabase"})
        if endpoint == "init" and method == "GET":
            refresh = str(params.get("refresh", "")).strip().lower() in {"1", "true", "yes"}
            return response(get_init(user_id, force=refresh))
        if endpoint == "history" and method == "GET":
            exercise_id = params.get("exercise_id", "")
            if not exercise_id:
                return response({"error": "exercise_id is required"}, 400)
            return response(get_exercise_history(user_id, exercise_id))
        if endpoint == "global_history" and method == "GET":
            return response(get_global_history(user_id))
        if endpoint == "session" and method == "GET":
            session_id = params.get("session_id", "")
            if not session_id:
                return response({"error": "session_id is required"}, 400)
            found = get_workout_session(user_id, session_id)
            # 404 for "not yours" as well as "not there": the deep link must not
            # confirm that somebody else's session exists.
            if not found:
                return response({"error": "Not found"}, 404)
            return response(found)
        if endpoint == "analytics" and method == "GET":
            return response(get_analytics(user_id, int(params.get("period", "14"))))
        if endpoint == "save_set" and method == "POST":
            result = save_set(user_id, _body(event))
            return response(result, 200 if result.get("status") == "success" else 400)
        if endpoint == "update_set" and method == "POST":
            return response({"status": "success" if update_set(user_id, _body(event)) else "error"})
        if endpoint == "delete_set" and method == "POST":
            return response({"status": "success" if delete_set(user_id, _body(event)) else "error"})
        if endpoint == "delete_workout" and method == "POST":
            data = _body(event)
            date_text = str(data.get("date", "")).strip()
            session_id = str(data.get("session_id", "")).strip()
            if not date_text and not session_id:
                return response({"error": "session_id or date is required"}, 400)
            deleted = delete_workout(user_id, date_text, session_id=session_id)
            return response({"status": "success" if deleted else "error", "deleted": deleted})
        if endpoint == "export" and method == "GET":
            return response(export_data(user_id))
        if endpoint == "import" and method == "POST":
            result = import_data(user_id, _body(event))
            return response(result, 200 if result.get("status") != "error" else 400)
        if endpoint == "create_exercise" and method == "POST":
            data = _body(event)
            name = str(data.get("name", "")).strip()
            group = str(data.get("group", "")).strip()
            if not name or not group:
                return response({"error": "name and group are required"}, 400)
            return response(create_exercise(user_id, name, group))
        if endpoint == "update_exercise" and method == "POST":
            data = _body(event)
            exercise_id = str(data.get("id", "")).strip()
            if not exercise_id:
                return response({"error": "id is required"}, 400)
            try:
                ok = update_exercise(user_id, exercise_id, data.get("updates") or {})
            except ValueError as error:
                # A malformed progression target is the client's mistake, not a
                # server fault — say what is wrong instead of returning a 500.
                return response({"error": str(error)}, 400)
            return response({"status": "success" if ok else "error"})
        if endpoint == "confirm_baseline" and method == "POST":
            return response({"status": "ok"})
        if endpoint == "upload_image" and method == "POST":
            data = _body(event)
            try:
                url = upload_image(
                    str(data.get("data_base64", "")),
                    str(data.get("content_type", "")),
                )
            except UploadError as error:
                logger.warning("Image upload rejected: %s", error)
                return response({"error": str(error)}, 400)
            return response({"status": "success", "url": url})
        return response({"error": f"Route not found: {endpoint}"}, 404)
    except AuthenticationError as error:
        logger.warning("Authentication rejected: %s", error)
        return response({"error": str(error)}, error.status)
    except ConflictError as error:
        logger.warning("Ambiguous workout deletion rejected: %s", error)
        return response({"error": str(error), "code": "ambiguous_workout_date"}, 409)
    except Exception as error:
        logger.exception("Request failed: %s", error)
        return response({"error": "Internal server error"}, 500)
