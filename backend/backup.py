"""Ночной бэкап gym-таблиц в закрытый бакет Object Storage.

Запускается таймером Yandex Cloud (триггер вызывает ту же функцию, что и API).
Для каждого владельца из TELEGRAM_USER_MAP читает строки всех gym-таблиц как есть,
без перевода в формат экспорта, и кладёт gzip JSON в BACKUP_BUCKET:
`gymapp/<user_id>/<YYYY-MM-DD>.json.gz` (дата по Москве). Повторный запуск в тот
же день перезаписывает файл этого дня. Чтение базы — только GET.
"""

from __future__ import annotations

import gzip
import json
import os
from datetime import datetime
from typing import Any, Callable, Dict, List

from object_storage import put_object
from telegram_auth import _user_map

FORMAT = "gymapp-raw-backup-v1"
# Журнал удалений появляется отдельной миграцией: пока его нет, бэкап без него.
OPTIONAL_TABLES = ("gym_deleted_rows",)
TABLES = (
    "gym_exercises",
    "gym_exercise_aliases",
    "gym_workout_sessions",
    "gym_set_groups",
    "gym_sets",
    "gym_cardio_segments",
) + OPTIONAL_TABLES


def is_backup_event(event: Dict[str, Any]) -> bool:
    """Событие таймера Yandex Cloud. HTTP-запрос не может подставить поле messages:
    его кладёт в событие сама платформа, тело запроса туда не попадает."""
    messages = event.get("messages") if isinstance(event, dict) else None
    if not isinstance(messages, list) or not messages or not isinstance(messages[0], dict):
        return False
    metadata = messages[0].get("event_metadata") or {}
    return str(metadata.get("event_type", "")).endswith("TimerMessage")


def snapshot(store: Any, user_id: str, now: datetime) -> Dict[str, Any]:
    tables: Dict[str, List[Dict[str, Any]]] = {}
    missing: List[str] = []
    for table in TABLES:
        try:
            tables[table] = store._select(table, filters={"user_id": user_id}, order="id.asc")
        except RuntimeError as error:
            # PGRST205: таблицы ещё нет (журнал до миграции).
            if table in OPTIONAL_TABLES and "PGRST205" in str(error):
                missing.append(table)
                continue
            raise
    return {
        "format": FORMAT,
        "created_at": now.isoformat(),
        "user_id": user_id,
        "counts": {table: len(rows) for table, rows in tables.items()},
        "missing_tables": missing,
        "tables": tables,
    }


def run_backup(store: Any, now: datetime, put: Callable[[str, str, bytes, str], None] = put_object) -> Dict[str, Any]:
    bucket = os.getenv("BACKUP_BUCKET", "").strip()
    if not bucket:
        raise RuntimeError("BACKUP_BUCKET is not configured")
    results = {}
    for user_id in sorted(set(_user_map().values())):
        data = snapshot(store, user_id, now)
        body = gzip.compress(json.dumps(data, ensure_ascii=False, default=str).encode("utf-8"))
        key = f"gymapp/{user_id}/{now.date().isoformat()}.json.gz"
        put(bucket, key, body, "application/gzip")
        results[key] = {"bytes": len(body), "counts": data["counts"], "missing_tables": data["missing_tables"]}
    return results
