"""Загрузка картинок в Yandex Object Storage (S3-совместимый API).

Подпись AWS Signature V4 считается вручную: boto3 весит десятки мегабайт и
заметно удлиняет холодный старт функции, а нам нужен ровно один PUT.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import os
import uuid
from datetime import datetime, timezone
from typing import Dict, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


REGION = "ru-central1"
SERVICE = "s3"
DEFAULT_ENDPOINT = "https://storage.yandexcloud.net"

# Разрешаем только то, что браузер гарантированно покажет в <img>.
ALLOWED_TYPES: Dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
MAX_BYTES = 6 * 1024 * 1024


class UploadError(Exception):
    """Загрузка невозможна: ошибка конфигурации, данных или хранилища."""


def _config() -> Tuple[str, str, str, str]:
    bucket = os.getenv("S3_BUCKET", "").strip()
    key_id = os.getenv("S3_ACCESS_KEY_ID", "").strip()
    secret = os.getenv("S3_SECRET_ACCESS_KEY", "").strip()
    endpoint = os.getenv("S3_ENDPOINT", DEFAULT_ENDPOINT).strip().rstrip("/")
    if not (bucket and key_id and secret):
        raise UploadError("Object Storage is not configured")
    return bucket, key_id, secret, endpoint


def _sign(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()


def _signing_key(secret: str, datestamp: str) -> bytes:
    key = _sign(f"AWS4{secret}".encode("utf-8"), datestamp)
    key = _sign(key, REGION)
    key = _sign(key, SERVICE)
    return _sign(key, "aws4_request")


def _authorization(
    key_id: str,
    secret: str,
    host: str,
    canonical_uri: str,
    content_type: str,
    payload_hash: str,
    amz_date: str,
    datestamp: str,
) -> str:
    signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date"
    canonical_headers = (
        f"content-type:{content_type}\n"
        f"host:{host}\n"
        f"x-amz-content-sha256:{payload_hash}\n"
        f"x-amz-date:{amz_date}\n"
    )
    canonical_request = "\n".join(
        ["PUT", canonical_uri, "", canonical_headers, signed_headers, payload_hash]
    )
    scope = f"{datestamp}/{REGION}/{SERVICE}/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signature = hmac.new(
        _signing_key(secret, datestamp), string_to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return (
        f"AWS4-HMAC-SHA256 Credential={key_id}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )


def upload_image(data_base64: str, content_type: str) -> str:
    """Кладёт картинку в бакет и возвращает публичный URL."""
    content_type = (content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_TYPES:
        raise UploadError(f"Unsupported content type: {content_type or 'unknown'}")

    try:
        payload = base64.b64decode(data_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise UploadError("Body is not valid base64") from error
    if not payload:
        raise UploadError("Empty image")
    if len(payload) > MAX_BYTES:
        raise UploadError(f"Image is larger than {MAX_BYTES // (1024 * 1024)} MB")

    bucket, key_id, secret, endpoint = _config()
    key = f"exercises/{uuid.uuid4()}.{ALLOWED_TYPES[content_type]}"
    host = endpoint.split("://", 1)[-1]
    canonical_uri = f"/{bucket}/{key}"

    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    datestamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(payload).hexdigest()

    request = Request(
        f"{endpoint}{canonical_uri}",
        data=payload,
        method="PUT",
        headers={
            "Content-Type": content_type,
            "Host": host,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
            "Authorization": _authorization(
                key_id, secret, host, canonical_uri, content_type, payload_hash, amz_date, datestamp
            ),
        },
    )
    try:
        with urlopen(request, timeout=20) as response:
            if response.status not in (200, 201):
                raise UploadError(f"Storage returned HTTP {response.status}")
    except HTTPError as error:
        # Тело ответа S3 — XML с кодом ошибки, он и нужен при разборе проблем.
        detail = error.read().decode("utf-8", "replace")[:300]
        raise UploadError(f"Storage rejected upload (HTTP {error.code}): {detail}") from error
    except URLError as error:
        raise UploadError(f"Storage is unreachable: {error.reason}") from error

    return f"{endpoint}/{bucket}/{key}"
