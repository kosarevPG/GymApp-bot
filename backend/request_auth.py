"""Dual authentication for GymApp API requests.

Telegram Mini App requests keep using signed ``initData``. Standalone clients
use a Supabase access token, which is resolved to its owner by Supabase Auth on
every backend request. No owner supplied in a request body is trusted.
"""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass
from typing import Dict
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from telegram_auth import AuthenticationError, authenticate_init_data


@dataclass(frozen=True)
class AuthenticatedRequestUser:
    user_id: str
    source: str


def _bearer_token(headers: Dict[str, str]) -> str:
    proxied = (headers.get("x-supabase-access-token") or "").strip()
    if proxied:
        return proxied
    value = (headers.get("authorization") or "").strip()
    parts = value.split()
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1]:
        raise AuthenticationError("Supabase access token is required")
    return parts[1]


def authenticate_supabase_access_token(
    headers: Dict[str, str],
) -> AuthenticatedRequestUser:
    """Resolve a standalone request owner through the Supabase Auth API."""
    token = _bearer_token(headers)
    supabase_url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    api_key = (
        os.getenv("SUPABASE_AUTH_API_KEY", "").strip()
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    )
    if not supabase_url or not api_key:
        raise AuthenticationError("Supabase Auth is not configured", 503)

    request = Request(
        f"{supabase_url}/auth/v1/user",
        headers={
            "Accept": "application/json",
            "apikey": api_key,
            "Authorization": f"Bearer {token}",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=10) as result:
            payload = json.loads(result.read().decode("utf-8"))
    except HTTPError as error:
        if error.code in {401, 403}:
            raise AuthenticationError(
                "Supabase session is invalid or expired"
            ) from error
        raise AuthenticationError("Supabase Auth is unavailable", 503) from error
    except (URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as error:
        raise AuthenticationError("Supabase Auth is unavailable", 503) from error

    try:
        user_id = str(uuid.UUID(str(payload["id"])))
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        raise AuthenticationError("Supabase Auth returned an invalid user", 503) from error
    return AuthenticatedRequestUser(user_id=user_id, source="supabase")


def authenticate_request(headers: Dict[str, str]) -> AuthenticatedRequestUser:
    """Authenticate Telegram first; otherwise require a Supabase bearer token."""
    if (headers.get("x-telegram-init-data") or "").strip():
        telegram_user = authenticate_init_data(headers)
        return AuthenticatedRequestUser(
            user_id=telegram_user.user_id,
            source="telegram",
        )
    return authenticate_supabase_access_token(headers)
