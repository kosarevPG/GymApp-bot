"""Yandex Cloud Function entrypoint for GymApp v2."""

from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any, Dict
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from sheets_store import (
    create_exercise,
    delete_set,
    get_analytics,
    get_exercise_history,
    get_global_history,
    get_init,
    save_set,
    update_exercise,
    update_set,
)


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

CORS_HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Auth-Token",
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


def _route(event: Dict[str, Any]) -> tuple[str, Dict[str, str]]:
    event_query = event.get("queryStringParameters") or {}
    if not isinstance(event_query, dict):
        event_query = {}

    routed_url = str(event_query.get("url") or "").strip()
    if not routed_url:
        routed_url = str(event.get("url") or event.get("path") or "/api/ping")
    parsed = urlparse(routed_url if "://" in routed_url else f"https://local{routed_url}")
    path = parsed.path or "/api/ping"
    endpoint = path.split("/api/", 1)[-1].strip("/") if "/api/" in path else path.strip("/")
    endpoint = endpoint or "ping"

    params = {
        key: values[-1]
        for key, values in parse_qs(parsed.query, keep_blank_values=True).items()
    }
    for key, value in event_query.items():
        if key != "url" and value is not None:
            params[str(key)] = str(value[-1] if isinstance(value, list) else value)
    return endpoint, params


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


def _authorized(headers: Dict[str, str]) -> bool:
    expected = os.getenv("AUTH_TOKEN", "").strip()
    if not expected:
        return True
    actual = (headers.get("x-auth-token") or headers.get("authorization") or "").strip()
    if actual.lower().startswith("bearer "):
        actual = actual[7:].strip()
    return actual == expected


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
    if expected_secret and actual_secret != expected_secret:
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

    endpoint, params = _route(event)
    headers = _headers(event)
    try:
        if endpoint == "telegram":
            if method != "POST":
                return response({"error": "Method not allowed"}, 405)
            return _telegram_webhook(_body(event), headers)

        if not _authorized(headers):
            return response({"error": "Forbidden"}, 403)

        if endpoint == "ping" and method == "GET":
            return response({"status": "ok", "storage": "google-sheets"})
        if endpoint == "init" and method == "GET":
            return response(get_init())
        if endpoint == "history" and method == "GET":
            exercise_id = params.get("exercise_id", "")
            if not exercise_id:
                return response({"error": "exercise_id is required"}, 400)
            return response(get_exercise_history(exercise_id))
        if endpoint == "global_history" and method == "GET":
            return response(get_global_history())
        if endpoint == "analytics" and method == "GET":
            return response(get_analytics(int(params.get("period", "14"))))
        if endpoint == "save_set" and method == "POST":
            result = save_set(_body(event))
            return response(result, 200 if result.get("status") == "success" else 400)
        if endpoint == "update_set" and method == "POST":
            return response({"status": "success" if update_set(_body(event)) else "error"})
        if endpoint == "delete_set" and method == "POST":
            return response({"status": "success" if delete_set(_body(event)) else "error"})
        if endpoint == "create_exercise" and method == "POST":
            data = _body(event)
            name = str(data.get("name", "")).strip()
            group = str(data.get("group", "")).strip()
            if not name or not group:
                return response({"error": "name and group are required"}, 400)
            return response(create_exercise(name, group))
        if endpoint == "update_exercise" and method == "POST":
            data = _body(event)
            exercise_id = str(data.get("id", "")).strip()
            if not exercise_id:
                return response({"error": "id is required"}, 400)
            ok = update_exercise(exercise_id, data.get("updates") or {})
            return response({"status": "success" if ok else "error"})
        if endpoint == "confirm_baseline" and method == "POST":
            return response({"status": "ok"})
        if endpoint == "upload_image" and method == "POST":
            return response({"error": "Image upload is not implemented"}, 501)
        return response({"error": f"Route not found: {endpoint}"}, 404)
    except Exception as error:
        logger.exception("Request failed: %s", error)
        return response({"error": "Internal server error"}, 500)
