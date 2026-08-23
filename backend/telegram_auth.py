"""Fail-closed authentication for Telegram Mini App requests."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import uuid
from dataclasses import dataclass
from typing import Dict, Optional
from urllib.parse import parse_qsl


class AuthenticationError(Exception):
    def __init__(self, message: str, status: int = 401):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class AuthenticatedUser:
    telegram_user_id: str
    user_id: str


def _user_map() -> Dict[str, str]:
    raw = os.getenv("TELEGRAM_USER_MAP", "").strip()
    if not raw:
        raise AuthenticationError("Telegram user allowlist is not configured", 503)
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise AuthenticationError("Telegram user allowlist is invalid", 503) from error
    if not isinstance(value, dict) or not value:
        raise AuthenticationError("Telegram user allowlist is empty", 503)

    result: Dict[str, str] = {}
    for telegram_id, user_id in value.items():
        try:
            result[str(int(str(telegram_id).strip()))] = str(uuid.UUID(str(user_id)))
        except (TypeError, ValueError, AttributeError) as error:
            raise AuthenticationError("Telegram user allowlist is invalid", 503) from error
    return result


def authenticate_init_data(
    headers: Dict[str, str],
    *,
    now: Optional[int] = None,
) -> AuthenticatedUser:
    """Validate raw Telegram.WebApp.initData and resolve its server-side owner."""
    bot_token = os.getenv("BOT_TOKEN", "").strip()
    if not bot_token:
        raise AuthenticationError("BOT_TOKEN is not configured", 503)

    raw = (headers.get("x-telegram-init-data") or "").strip()
    if not raw:
        raise AuthenticationError("Telegram initData is required")

    try:
        pairs = parse_qsl(raw, keep_blank_values=True, strict_parsing=True)
    except ValueError as error:
        raise AuthenticationError("Telegram initData is malformed") from error
    if len({key for key, _ in pairs}) != len(pairs):
        raise AuthenticationError("Telegram initData contains duplicate fields")
    values = dict(pairs)
    received_hash = values.pop("hash", "")
    if not received_hash or len(received_hash) != 64:
        raise AuthenticationError("Telegram initData signature is missing")

    data_check_string = "\n".join(
        f"{key}={value}" for key, value in sorted(values.items())
    )
    secret_key = hmac.new(
        b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256
    ).digest()
    calculated_hash = hmac.new(
        secret_key, data_check_string.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(calculated_hash, received_hash):
        raise AuthenticationError("Telegram initData signature is invalid")

    try:
        auth_date = int(values["auth_date"])
    except (KeyError, TypeError, ValueError) as error:
        raise AuthenticationError("Telegram initData auth_date is invalid") from error

    current = int(time.time() if now is None else now)
    try:
        max_age = int(os.getenv("TELEGRAM_INIT_DATA_MAX_AGE_SECONDS", "86400"))
    except ValueError as error:
        raise AuthenticationError("Telegram initData max age is invalid", 503) from error
    if max_age <= 0:
        raise AuthenticationError("Telegram initData max age is invalid", 503)
    if auth_date > current + 30 or current - auth_date > max_age:
        raise AuthenticationError("Telegram initData has expired")

    try:
        telegram_user = json.loads(values["user"])
        telegram_user_id = str(int(telegram_user["id"]))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise AuthenticationError("Telegram initData user is invalid") from error

    user_id = _user_map().get(telegram_user_id)
    if not user_id:
        raise AuthenticationError("Telegram user is not allowed", 403)
    return AuthenticatedUser(telegram_user_id=telegram_user_id, user_id=user_id)
