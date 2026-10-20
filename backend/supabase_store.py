"""Supabase storage adapter preserving the GymApp v2 backend API.

All public functions require a server-resolved ``user_id``. The browser never
chooses the owner, and every Data API request is scoped to that owner even
though the backend secret bypasses RLS.
"""

from __future__ import annotations

import json
import math
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request
from zoneinfo import ZoneInfo

from fast_connect import urlopen
from workload_trend import (
    compute_workload_trend,
    format_workload_trend,
    sets_to_trend_sessions,
)


MOSCOW_TZ = ZoneInfo("Europe/Moscow")
LIVE_NAMESPACE = uuid.UUID("7bd184da-f675-4d11-b7c9-cc795ab7975c")
# Чтение останавливается только на пустой странице. Обрывать его на неполной
# нельзя: сервер вправе вернуть меньше запрошенного (у хостинга свой предел
# строк на ответ), и короткая страница не означает, что данные кончились.
READ_PAGE_SIZE = 500
EXERCISE_SELECT = (
    "id,user_id,source,source_key,name_ru,name_en,muscle_group,description,"
    "image_url,image_url_2,weight_type,base_weight_kg,multiplier,tonnage_mode,"
    "technique_note,is_active,source_payload,measure,"
    # Release B progression targets. All nullable: absent means "not configured",
    # and the app offers a setup button rather than inventing a range.
    "rep_range_low,rep_range_high,input_weight_step,target_working_sets,rir_target_max"
)


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        text = str(value if value is not None else "").replace(",", ".").strip()
        return float(text) if text else default
    except (TypeError, ValueError):
        return default


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(_to_float(value, default))
    except (TypeError, ValueError):
        return default


def _optional_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    return _to_float(value)


def _optional_int(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    return _to_int(value)


def _stable_uuid(*parts: Any) -> str:
    return str(uuid.uuid5(LIVE_NAMESPACE, ":".join(str(part) for part in parts)))


CARDIO_TABLE = "gym_cardio_segments"
MAX_CARDIO_SECONDS = 6 * 3600

WEIGHT_TYPES = {"Machine", "Plate_Loaded", "Dumbbell", "Barbell", "Bodyweight", "Assisted", "Other"}


def _load_rules(value: Any) -> Optional[Dict[str, Any]]:
    """The client's snapshot of how a set's input became its total weight.

    Kept in source_payload so a later change of the exercise's settings does not
    reinterpret old numbers. Anything that does not look like a snapshot is
    dropped rather than stored half-understood.
    """
    if not isinstance(value, dict) or str(value.get("type") or "") not in WEIGHT_TYPES:
        return None
    rules: Dict[str, Any] = {
        "v": _to_int(value.get("v"), 1),
        "type": str(value["type"]),
        "mult": _to_float(value.get("mult"), 1.0),
        "base": _to_float(value.get("base")),
    }
    body_weight = _optional_float(value.get("bw"))
    if body_weight is not None and body_weight > 0:
        rules["bw"] = body_weight
    if value.get("perSide") is True:
        rules["perSide"] = True
    mode = value.get("inputMode")
    if mode is not None:
        if mode not in ("total", "plates_total") or value.get("type") != ("Barbell" if mode == "total" else "Plate_Loaded"):
            raise ValueError("invalid load inputMode")
        if not math.isfinite(rules["mult"]) or not math.isfinite(rules["base"]) or rules["base"] < 0:
            raise ValueError("invalid load coefficients")
        rules["inputMode"] = mode
        rules["v"] = 2
        equipment_base = value.get("equipmentBase")
        if equipment_base is not None:
            if isinstance(equipment_base, bool) or not isinstance(equipment_base, (int, float)) or not math.isfinite(equipment_base) or equipment_base < 0:
                raise ValueError("invalid load equipmentBase")
            rules["equipmentBase"] = equipment_base
        if mode == "total":
            rules.setdefault("equipmentBase", rules["base"])
            rules.update(mult=1, base=0)
        else:
            rules["mult"] = 1
    return rules


def _set_timing(value: Any, now: datetime) -> Optional[Dict[str, Any]]:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("timing must be an object")
    end = _aware_datetime(value.get("ended_at"), "timing.ended_at")
    if end > now + timedelta(minutes=5):
        raise ValueError("timing is in the future")
    result: Dict[str, Any] = {"ended_at": end.isoformat()}
    if value.get("started_at") is not None:
        start = _aware_datetime(value["started_at"], "timing.started_at")
        duration = (end - start).total_seconds()
        if not 0 <= duration <= 86400:
            raise ValueError("invalid set timing interval")
        result.update(started_at=start.isoformat(), duration_seconds=math.floor(duration + 0.5))
        if "rest_before_seconds" in value:
            rest = value["rest_before_seconds"]
            if isinstance(rest, bool) or not isinstance(rest, (int, float)) or not math.isfinite(rest) or not 0 <= rest <= 604800:
                raise ValueError("invalid rest_before_seconds")
            result["rest_before_seconds"] = round(rest)
    elif "duration_seconds" in value or "rest_before_seconds" in value:
        raise ValueError("timing.started_at is required for measured duration or rest")
    return result


def _valid_client_request_id(value: Any) -> str:
    try:
        return str(uuid.UUID(str(value or "").strip()))
    except (ValueError, AttributeError) as error:
        raise ValueError("client_request_id must be a UUID") from error


def _api_date(value: Any) -> str:
    return str(value or "").split("T", 1)[0].replace("-", ".")


def _iso_date(value: Any) -> str:
    """YYYY-MM-DD, the shape workload-trend-v1 expects (``_api_date`` dots it)."""
    return str(value or "").split("T", 1)[0]


def _aware_datetime(value: Any, field: str) -> datetime:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field} is required")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{field} must be an ISO 8601 timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field} must include a timezone offset")
    return parsed.astimezone(MOSCOW_TZ)


class ConflictError(Exception):
    pass


class SupabaseRestClient:
    def __init__(self, url: str, secret_key: str):
        self.url = url.rstrip("/")
        self.secret_key = secret_key

    @classmethod
    def from_env(cls) -> "SupabaseRestClient":
        url = os.getenv("SUPABASE_URL", "").strip()
        key = (
            os.getenv("SUPABASE_SECRET_KEY", "").strip()
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        )
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY are required")
        return cls(url, key)

    def _request(
        self,
        method: str,
        table: str,
        *,
        query: Optional[Dict[str, str]] = None,
        body: Any = None,
        prefer: str = "",
        with_headers: bool = False,
        read_only: bool = False,
    ) -> Any:
        suffix = f"?{urlencode(query or {})}" if query else ""
        headers = {"apikey": self.secret_key, "Accept": "application/json"}
        if self.secret_key.count(".") == 2:
            headers["Authorization"] = f"Bearer {self.secret_key}"
        if body is not None:
            headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = prefer
        request = Request(
            f"{self.url}/rest/v1/{table}{suffix}",
            data=None if body is None else json.dumps(body).encode("utf-8"),
            headers=headers,
            method=method,
        )
        # A stalled read must not consume most of the 30s function budget.
        # Retry GET and the explicitly read-only snapshot RPC; repeating writes could
        # overwrite a newer edit. Writes retain their existing queue semantics.
        safe_read = method == "GET" or read_only
        attempts = 2 if safe_read else 1
        for attempt in range(attempts):
            try:
                with urlopen(request, timeout=4 if safe_read else 20) as result:
                    raw = result.read().decode("utf-8")
                    # Headers are optional for older test clients.
                    response_headers = dict(result.headers) if with_headers else {}
                break
            except HTTPError as error:
                if attempt + 1 < attempts and error.code in (502, 503, 504):
                    error.close()
                    continue
                detail = error.read().decode("utf-8", errors="replace")
                error.close()
                raise RuntimeError(f"Supabase Data API returned {error.code}: {detail}") from error
            except (URLError, TimeoutError):
                if attempt + 1 == attempts:
                    raise
        payload = json.loads(raw) if raw else []
        return (payload, response_headers) if with_headers else payload

    @staticmethod
    def _total_from_content_range(headers: Dict[str, str]) -> Optional[int]:
        """PostgREST кладёт в Content-Range «0-499/1224»; без count=exact — «*»."""
        tail = str(headers.get("Content-Range", "")).split("/")[-1].strip()
        return int(tail) if tail.isdigit() else None

    def select_page(
        self,
        table: str,
        *,
        columns: str = "*",
        filters: Optional[Dict[str, Any]] = None,
        order: str = "",
        limit: Optional[int] = None,
        offset: int = 0,
    ) -> Tuple[List[Dict[str, Any]], Optional[int]]:
        """Страница вместе с общим числом строк, если сервер его сообщил.

        Знание общего числа строк избавляет от запроса за пустой страницей: обзорные
        эндпоинты читают четыре таблицы, и такой запрос стоил четверти всех
        обращений к Data API.
        """
        query = self._select_query(columns, filters, order, limit, offset)
        rows, headers = self._request(
            "GET", table, query=query, prefer="count=exact", with_headers=True
        )
        return rows, self._total_from_content_range(headers)

    @staticmethod
    def _select_query(
        columns: str,
        filters: Optional[Dict[str, Any]],
        order: str,
        limit: Optional[int],
        offset: int,
    ) -> Dict[str, str]:
        query: Dict[str, str] = {"select": columns}
        for key, value in (filters or {}).items():
            query[key] = str(value) if str(value).startswith(("eq.", "gte.", "in.")) else f"eq.{value}"
        if order:
            query["order"] = order
        if limit is not None:
            query["limit"] = str(limit)
        if offset:
            query["offset"] = str(offset)
        return query

    def select(
        self,
        table: str,
        *,
        columns: str = "*",
        filters: Optional[Dict[str, Any]] = None,
        order: str = "",
        limit: Optional[int] = None,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        return self._request(
            "GET", table, query=self._select_query(columns, filters, order, limit, offset)
        )

    def upsert(
        self, table: str, row: Dict[str, Any], *, on_conflict: str
    ) -> List[Dict[str, Any]]:
        return self._request(
            "POST",
            table,
            query={"on_conflict": on_conflict},
            body=row,
            prefer="resolution=merge-duplicates,return=representation",
        )

    def rpc_read(self, function: str, arguments: Dict[str, Any]) -> Any:
        return self._request('POST', f'rpc/{function}', body=arguments, read_only=True)

    def update(
        self, table: str, values: Dict[str, Any], *, filters: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        query = {key: f"eq.{value}" for key, value in filters.items()}
        return self._request(
            "PATCH", table, query=query, body=values, prefer="return=representation"
        )

    def delete(self, table: str, *, filters: Dict[str, Any]) -> List[Dict[str, Any]]:
        query = {key: f"eq.{value}" for key, value in filters.items()}
        return self._request(
            "DELETE", table, query=query, prefer="return=representation"
        )


class SupabaseStore:
    def __init__(self, client: Any, *, now=None):
        self.client = client
        self._clock = now or (lambda: datetime.now(MOSCOW_TZ))

    def _now(self) -> datetime:
        value = self._clock()
        return value if value.tzinfo else value.replace(tzinfo=MOSCOW_TZ)

    def _select(
        self,
        table: str,
        *,
        columns: str = "*",
        filters: Optional[Dict[str, Any]] = None,
        order: str = "id.asc",
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Read every page; hosted Data API projects commonly cap pages at 1000."""
        rows: List[Dict[str, Any]] = []
        offset = 0
        total: Optional[int] = None
        # Клиент, умеющий сообщать общее число строк, экономит по запросу на
        # таблицу. Старые заглушки в тестах его не имеют — для них остаётся
        # прежний путь с остановкой на пустой странице.
        read_page = getattr(self.client, "select_page", None)
        while limit is None or len(rows) < limit:
            requested = min(READ_PAGE_SIZE, limit - len(rows)) if limit is not None else READ_PAGE_SIZE
            if read_page is not None:
                page, reported = read_page(
                    table,
                    columns=columns,
                    filters=filters,
                    order=order,
                    limit=requested,
                    offset=offset,
                )
                if reported is not None:
                    total = reported
            else:
                page = self.client.select(
                    table,
                    columns=columns,
                    filters=filters,
                    order=order,
                    limit=requested,
                    offset=offset,
                )
            if not page:
                break
            rows.extend(page)
            offset += len(page)
            if total is not None and offset >= total:
                break
        return rows[:limit] if limit is not None else rows

    def _exercises(self, user_id: str, *, active_only: bool = False) -> List[Dict[str, Any]]:
        filters: Dict[str, Any] = {"user_id": user_id}
        if active_only:
            filters["is_active"] = "true"
        return self._select(
            "gym_exercises", columns=EXERCISE_SELECT, filters=filters
        )

    def _resolve_exercise(self, user_id: str, exercise_id: str) -> Optional[Dict[str, Any]]:
        wanted = str(exercise_id or "").strip()
        if not wanted:
            return None
        rows = self._select(
            "gym_exercises",
            columns=EXERCISE_SELECT,
            filters={"user_id": user_id, "source_key": wanted},
            limit=1,
        )
        if rows:
            return rows[0]
        try:
            canonical = str(uuid.UUID(wanted))
        except ValueError:
            return None
        rows = self._select(
            "gym_exercises",
            columns=EXERCISE_SELECT,
            filters={"user_id": user_id, "id": canonical},
            limit=1,
        )
        return rows[0] if rows else None

    @staticmethod
    def _exercise_to_api(record: Dict[str, Any]) -> Dict[str, Any]:
        source_payload = record.get("source_payload") or {}
        return {
            "id": str(record.get("source_key") or record.get("id") or ""),
            "name": str(record.get("name_ru") or ""),
            "muscleGroup": str(record.get("muscle_group") or ""),
            "tonnageMode": str(record.get("tonnage_mode") or "external_load"),
            "description": str(record.get("description") or ""),
            "imageUrl": str(record.get("image_url") or ""),
            "imageUrl2": str(record.get("image_url_2") or ""),
            "weightType": str(record.get("weight_type") or "Other"),
            # strength = sets of reps and load; cardio = timed segments.
            "measure": "cardio" if record.get("measure") == "cardio" else "strength",
            "baseWeight": _to_float(record.get("base_weight_kg")),
            "weightMultiplier": _to_float(record.get("multiplier"), 1.0),
            "unilateral": source_payload.get("reps_per_side") is True,
            "secondaryMuscles": str(source_payload.get("secondary_muscles") or ""),
            # None rather than 0 — the difference between "no target" and "a
            # target of zero" is the whole point of these being nullable.
            "repRangeLow": _optional_int(record.get("rep_range_low")),
            "repRangeHigh": _optional_int(record.get("rep_range_high")),
            "inputWeightStep": _optional_float(record.get("input_weight_step")),
            "targetWorkingSets": _optional_int(record.get("target_working_sets")),
            "rirTargetMax": _optional_float(record.get("rir_target_max")),
        }

    def get_init(self, user_id: str, force: bool = False) -> Dict[str, Any]:
        del force
        exercises = [self._exercise_to_api(row) for row in self._exercises(user_id, active_only=True)]
        exercises = [row for row in exercises if row["id"] and row["name"]]
        exercises.sort(key=lambda row: row["name"].casefold())
        groups = sorted({row["muscleGroup"] for row in exercises if row["muscleGroup"]}, key=str.casefold)
        return {"groups": groups, "exercises": exercises, "capabilities": {"journalSync": 1}}

    def _ensure_session(self, user_id: str, session_ref: str, performed_at: datetime, location: Any = None) -> Dict[str, Any]:
        if not session_ref:
            raise ValueError("session_id is required")
        if location is not None and location not in ("gym", "home", "other"):
            raise ValueError("location must be gym, home or other")
        source_record_id = f"live:{session_ref}"
        existing = self._select(
            "gym_workout_sessions",
            filters={"user_id": user_id, "source": "gymapp", "source_record_id": source_record_id},
            limit=1,
        )
        actual_times = [performed_at]
        if existing:
            for field in ("started_at", "ended_at"):
                if existing[0].get(field):
                    actual_times.append(_aware_datetime(existing[0][field], field))
        started_at = min(actual_times)
        ended_at = max(actual_times)
        row = {
            "id": existing[0]["id"] if existing else _stable_uuid(user_id, "session", session_ref),
            "user_id": user_id,
            "workout_date": started_at.date().isoformat(),
            "started_at": started_at.isoformat(),
            "ended_at": ended_at.isoformat(),
            "source": "gymapp",
            "source_record_id": source_record_id,
            "source_payload": {**(existing[0].get("source_payload") or {}), "client_session_id": session_ref} if existing else {"client_session_id": session_ref},
        }
        # Never put metadata in a repeated set upsert: a saved-session edit wins
        # over stale offline set payloads. Old clients leave location unknown.
        if not existing and location is not None:
            row["location"] = location
        result = self.client.upsert(
            "gym_workout_sessions", row, on_conflict="user_id,source,source_record_id"
        )
        return result[0] if result else row

    def update_session(self, user_id: str, data: Dict[str, Any]) -> bool:
        session_id = str(uuid.UUID(str(data.get("session_id") or "")))
        values: Dict[str, Any] = {}
        if "location" in data:
            if data["location"] is not None and data["location"] not in ("gym", "home", "other"):
                raise ValueError("location must be gym, home, other or null")
            values["location"] = data["location"]
        if "duration_minutes" in data:
            duration = data["duration_minutes"]
            if duration is not None:
                if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 0 < duration <= 1440:
                    raise ValueError("duration_minutes must be between 0 and 1440")
            values["duration_minutes"] = duration
        if "duration_is_approximate" in data:
            if not isinstance(data["duration_is_approximate"], bool):
                raise ValueError("duration_is_approximate must be boolean")
            values["duration_is_approximate"] = data["duration_is_approximate"]
        if not values:
            raise ValueError("session metadata is required")
        return bool(self.client.update("gym_workout_sessions", values, filters={"user_id": user_id, "id": session_id}))

    def save_session(self, user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Owned, repeatable start/finish command; no new tables or grants."""
        ref = _valid_client_request_id(data.get("session_id"))
        start = _aware_datetime(data.get("started_at"), "started_at")
        end = _aware_datetime(data["ended_at"], "ended_at") if data.get("ended_at") else None
        if start > self._now() + timedelta(minutes=5) or (end and (end < start or end > self._now() + timedelta(minutes=5))):
            raise ValueError("invalid session interval")
        location = data.get("location")
        if location is not None and location not in ("gym", "home", "other"):
            raise ValueError("invalid location")
        source = data.get("repeated_from_session_id")
        if source:
            source = _valid_client_request_id(source)
            owned = self._select("gym_workout_sessions", columns="id", filters={"user_id": user_id, "id": source}, limit=1)
            if not owned:
                owned = self._select("gym_workout_sessions", columns="id", filters={"user_id": user_id, "source": "gymapp", "source_record_id": f"live:{source}"}, limit=1)
            if not owned:
                raise ValueError("source session not found")
            source = owned[0]["id"]
        existing = self._select("gym_workout_sessions", filters={"user_id": user_id, "source": "gymapp", "source_record_id": f"live:{ref}"}, limit=1)
        if existing:
            session = existing[0]
        else:
            session = self._ensure_session(user_id, ref, start, location)
        payload = dict(session.get("source_payload") or {})
        if payload.get("workout_started_at") and _aware_datetime(payload["workout_started_at"], "workout_started_at") != start:
            raise ValueError("session start cannot change")
        if source:
            if payload.get("repeated_from_session_id") not in (None, source):
                raise ValueError("source session cannot change")
            payload["repeated_from_session_id"] = source
        # A late/retried start must never erase a previously recorded finish.
        finished = payload.get("workout_finished_at")
        if end:
            if finished and _aware_datetime(finished, "workout_finished_at") != end:
                raise ValueError("session finish cannot change")
            payload["workout_finished_at"] = end.isoformat()
        payload.setdefault("workout_started_at", start.isoformat())
        values = {"source_payload": payload, "started_at": payload["workout_started_at"],
                  "workout_date": _aware_datetime(payload["workout_started_at"], "workout_started_at").date().isoformat()}
        if data.get("location_update") is True:
            values["location"] = location
        if payload.get("workout_finished_at"):
            actual_end = _aware_datetime(payload["workout_finished_at"], "workout_finished_at")
            minutes = (actual_end - _aware_datetime(payload["workout_started_at"], "workout_started_at")).total_seconds() / 60
            # Keep a long resumed session's actual span without clipping it to
            # the existing duration_minutes column's one-day constraint.
            payload["elapsed_seconds"] = round(minutes * 60)
            rounded_minutes = round(minutes, 2)
            values.update(ended_at=actual_end.isoformat(), duration_minutes=rounded_minutes if 0 < rounded_minutes <= 1440 else None, duration_is_approximate=False)
        self.client.update("gym_workout_sessions", values, filters={"user_id": user_id, "id": session["id"]})
        return {"status": "success", "session_id": session["id"]}

    def _ensure_group(
        self, user_id: str, session: Dict[str, Any], session_ref: str, group_ref: str, position: int
    ) -> Dict[str, Any]:
        group_ref = group_ref or session_ref
        source_record_id = f"live:{session_ref}:{group_ref}"
        existing = self._select(
            "gym_set_groups",
            filters={"user_id": user_id, "source": "gymapp", "source_record_id": source_record_id},
            limit=1,
        )
        row = {
            "id": existing[0]["id"] if existing else _stable_uuid(user_id, "group", session_ref, group_ref),
            "user_id": user_id,
            "session_id": session["id"],
            "position": min(_to_int(existing[0].get("position"), position), position) if existing else position,
            "group_type": existing[0].get("group_type", "single") if existing else "single",
            "source": "gymapp",
            "source_record_id": source_record_id,
            "legacy_group_id": group_ref,
            "source_payload": {"client_group_id": group_ref},
        }
        result = self.client.upsert(
            "gym_set_groups", row, on_conflict="user_id,source,source_record_id"
        )
        return result[0] if result else row

    @staticmethod
    def _set_values(data: Dict[str, Any]) -> Dict[str, Any]:
        """Editable columns of a set, normalised exactly as save_set writes them."""
        set_type = str(data.get("set_type") or "working").lower()
        if set_type not in {"warmup", "working", "drop", "failure", "other"}:
            set_type = "other"
        return {
            "input_weight_kg": max(0, _to_float(data.get("input_weight", data.get("weight")))),
            "total_weight_kg": max(0, _to_float(data.get("weight", data.get("input_weight")))),
            "reps": _to_int(data.get("reps")),
            "rest_seconds": max(0, round(_to_float(data.get("rest")) * 60)),
            "set_type": set_type,
            "rpe": _optional_float(data.get("rpe")),
            "rir": _optional_float(data.get("rir")),
            "note": str(data.get("note") or "") or None,
        }

    def save_set(self, user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        try:
            request_id = _valid_client_request_id(data.get("client_request_id") or data.get("request_id"))
            performed_at = _aware_datetime(data.get("performed_at"), "performed_at")
            load = _load_rules(data.get("load"))
            timing = _set_timing(data.get("timing"), self._now())
        except ValueError as error:
            return {"status": "error", "error": str(error)}
        if performed_at > self._now() + timedelta(minutes=5):
            return {"status": "error", "error": "performed_at is in the future"}
        values = self._set_values(data)
        if load and load.get("inputMode"):
            values["total_weight_kg"] = values["input_weight_kg"] + (load["base"] if load["inputMode"] == "plates_total" else 0)
        if values["reps"] <= 0:
            return {"status": "error", "error": "reps must be greater than zero"}
        existing = self._select(
            "gym_sets",
            filters={"user_id": user_id, "client_request_id": request_id},
            limit=1,
        )
        if existing:
            try:
                stored_at = _aware_datetime(existing[0].get("performed_at"), "stored performed_at")
            except ValueError as error:
                return {"status": "error", "error": str(error)}
            if stored_at != performed_at:
                return {
                    "status": "error",
                    "error": "performed_at does not match the existing client_request_id",
                }
            result = {"status": "success", "request_id": request_id, "deduplicated": True}
            # A retry after a lost response may carry an edit made while the
            # first request was in flight: the row exists but holds the old
            # numbers. Answering "already saved" would silently drop the edit.
            changes = {
                column: value for column, value in values.items()
                if existing[0].get(column) != value
            }
            payload = dict(existing[0].get("source_payload") or {})
            if load:
                payload["load"] = load
            if timing:
                payload["timing"] = timing
            if payload != (existing[0].get("source_payload") or {}):
                changes["source_payload"] = payload
            if changes:
                changes["updated_at"] = self._now().isoformat()
                self.client.update(
                    "gym_sets", changes, filters={"user_id": user_id, "id": existing[0]["id"]}
                )
                result["updated"] = True
            return result

        exercise = self._resolve_exercise(user_id, str(data.get("exercise_id") or ""))
        if not exercise:
            return {"status": "error", "error": "Unknown exercise_id"}
        position = _to_int(data.get("order"))
        if position <= 0:
            return {"status": "error", "error": "order must be greater than zero"}
        session_ref = str(data.get("session_id") or "").strip()
        group_ref = str(data.get("set_group_id") or session_ref).strip()
        try:
            session = self._ensure_session(user_id, session_ref, performed_at, data.get("location"))
            group = self._ensure_group(user_id, session, session_ref, group_ref, position)
            row = {
                "id": _stable_uuid(user_id, "set", request_id),
                "user_id": user_id,
                "session_id": session["id"],
                "set_group_id": group["id"],
                "exercise_id": exercise["id"],
                "performed_at": performed_at.isoformat(),
                "position": position,
                **values,
                "include_in_tonnage": exercise.get("tonnage_mode") != "excluded",
                "source": "gymapp",
                "source_record_id": f"live:{request_id}",
                "client_request_id": request_id,
                "legacy_session_id": session_ref,
                "source_payload": {"client_group_id": group_ref, **({"load": load} if load else {}), **({"timing": timing} if timing else {})},
            }
            written = self.client.upsert(
                "gym_sets", row, on_conflict="user_id,client_request_id"
            )
            group_sets = self._select(
                "gym_sets",
                columns="exercise_id",
                filters={"user_id": user_id, "set_group_id": group["id"]},
            )
            if len({item.get("exercise_id") for item in group_sets}) > 1:
                self.client.update(
                    "gym_set_groups", {"group_type": "superset"},
                    filters={"user_id": user_id, "id": group["id"]},
                )
        except ValueError as error:
            return {"status": "error", "error": str(error)}
        return {
            "status": "success",
            "row_number": None,
            "request_id": request_id,
            **({"deduplicated": True} if written and written[0].get("created_at") != row.get("created_at") else {}),
        }

    def _locate_set(self, user_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        request_id = data.get("client_request_id") or data.get("request_id")
        try:
            request_id = _valid_client_request_id(request_id)
        except ValueError:
            return None
        rows = self._select(
            "gym_sets", filters={"user_id": user_id, "client_request_id": request_id}, limit=1
        )
        if not rows:
            # Imported rows may predate client_request_id. Their API id is the row UUID.
            rows = self._select("gym_sets", filters={"user_id": user_id, "id": request_id}, limit=1)
        return rows[0] if rows else None

    def update_set(self, user_id: str, data: Dict[str, Any]) -> bool:
        existing = self._locate_set(user_id, data)
        if not existing:
            return False
        updates: Dict[str, Any] = {}
        mapping = {
            "input_weight": ("input_weight_kg", _to_float),
            "weight": ("total_weight_kg", _to_float),
            "reps": ("reps", _to_int),
            "rest": ("rest_seconds", lambda value: round(_to_float(value) * 60)),
            "note": ("note", str),
            "set_type": ("set_type", str),
            "rpe": ("rpe", _optional_float),
            "rir": ("rir", _optional_float),
        }
        for api_name, (column, convert) in mapping.items():
            if api_name in data:
                updates[column] = convert(data[api_name])
        if updates.get("reps", 1) <= 0 or updates.get("rest_seconds", 0) < 0:
            return False
        load = _load_rules(data.get("load"))
        stored_rules = load or (existing.get("source_payload") or {}).get("load") or {}
        if "input_weight" in data and stored_rules.get("inputMode") in ("total", "plates_total"):
            updates["total_weight_kg"] = updates["input_weight_kg"] + (stored_rules.get("base", 0) if stored_rules["inputMode"] == "plates_total" else 0)
        if load:
            # A weight edit brings the rules it was computed with; the rest of
            # the payload (client group, import provenance) stays as it was.
            updates["source_payload"] = {**(existing.get("source_payload") or {}), "load": load}
        if "timing" in data:
            timing = _set_timing(data["timing"], self._now())
            payload = dict(updates.get("source_payload", existing.get("source_payload") or {}))
            if timing is None:
                payload.pop("timing", None)
            else:
                payload["timing"] = timing
            updates["source_payload"] = payload
        updates["updated_at"] = self._now().isoformat()
        return bool(self.client.update(
            "gym_sets", updates, filters={"user_id": user_id, "id": existing["id"]}
        ))

    def delete_set(self, user_id: str, data: Dict[str, Any]) -> bool:
        # The offline queue deletes sets that may never have reached the server
        # and retries a delete whose answer was lost. For it a missing row is
        # the desired end state; the history screen still gets False.
        missing_ok = bool(data.get("missing_ok"))
        existing = self._locate_set(user_id, data)
        if not existing:
            return missing_ok
        deleted = bool(self.client.delete(
            "gym_sets", filters={"user_id": user_id, "id": existing["id"]}
        ))
        if not deleted:
            return missing_ok
        group_id = existing.get("set_group_id")
        if group_id:
            remaining = self._select(
                "gym_sets", columns="exercise_id",
                filters={"user_id": user_id, "set_group_id": group_id},
            )
            if not remaining:
                self.client.delete("gym_set_groups", filters={"user_id": user_id, "id": group_id})
            elif len({row.get("exercise_id") for row in remaining}) == 1:
                # A superset that lost all but one exercise is a single block
                # again; save_set promotes it back if a second one returns.
                self.client.update(
                    "gym_set_groups", {"group_type": "single"},
                    filters={"user_id": user_id, "id": group_id, "group_type": "superset"},
                )
        self._drop_session_if_empty(user_id, existing["session_id"])
        return True

    def _drop_session_if_empty(self, user_id: str, session_id: str) -> None:
        """A session goes when its last set or cardio segment does, not before:
        a warm-up on its own is still a workout."""
        for table in ("gym_sets", CARDIO_TABLE):
            if self._select(table, filters={"user_id": user_id, "session_id": session_id}, limit=1):
                return
        self.client.delete("gym_workout_sessions", filters={"user_id": user_id, "id": session_id})

    @staticmethod
    def _cardio_values(data: Dict[str, Any]) -> Dict[str, Any]:
        """Editable columns of a cardio segment, for the keys the request carries."""
        values: Dict[str, Any] = {}
        if "duration_seconds" in data:
            values["duration_seconds"] = _to_int(data.get("duration_seconds"))
        if "speed_kmh" in data:
            values["speed_kmh"] = _optional_float(data.get("speed_kmh"))
        if "incline_pct" in data:
            values["incline_pct"] = _optional_float(data.get("incline_pct"))
        if "note" in data:
            values["note"] = str(data.get("note") or "") or None
        return values

    @staticmethod
    def _cardio_error(values: Dict[str, Any]) -> Optional[str]:
        duration = values.get("duration_seconds")
        if duration is not None and not 0 < duration <= MAX_CARDIO_SECONDS:
            return "duration_seconds must be between 1 second and 6 hours"
        speed = values.get("speed_kmh")
        if speed is not None and not 0 <= speed <= 40:
            return "speed_kmh must be between 0 and 40"
        incline = values.get("incline_pct")
        if incline is not None and not -15 <= incline <= 40:
            return "incline_pct must be between -15 and 40"
        return None

    def _locate_cardio(self, user_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        try:
            request_id = _valid_client_request_id(data.get("client_request_id"))
        except ValueError:
            return None
        rows = self._select(
            CARDIO_TABLE, filters={"user_id": user_id, "client_request_id": request_id}, limit=1
        )
        return rows[0] if rows else None

    def save_cardio(self, user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """One segment of steady cardio. Idempotent by client_request_id, like
        save_set: a retry carrying an edit applies it instead of dropping it."""
        try:
            request_id = _valid_client_request_id(data.get("client_request_id"))
            performed_at = _aware_datetime(data.get("performed_at"), "performed_at")
        except ValueError as error:
            return {"status": "error", "error": str(error)}
        if performed_at > self._now() + timedelta(minutes=5):
            return {"status": "error", "error": "performed_at is in the future"}
        values = self._cardio_values({"duration_seconds": data.get("duration_seconds"), **data})
        error = self._cardio_error(values)
        if error:
            return {"status": "error", "error": error}
        existing = self._locate_cardio(user_id, {"client_request_id": request_id})
        if existing:
            try:
                stored_at = _aware_datetime(existing.get("performed_at"), "stored performed_at")
            except ValueError as error:
                return {"status": "error", "error": str(error)}
            if stored_at != performed_at:
                return {
                    "status": "error",
                    "error": "performed_at does not match the existing client_request_id",
                }
            result = {"status": "success", "request_id": request_id, "deduplicated": True}
            changes = {k: v for k, v in values.items() if existing.get(k) != v}
            if changes:
                self.client.update(
                    CARDIO_TABLE, changes, filters={"user_id": user_id, "id": existing["id"]}
                )
                result["updated"] = True
            return result

        exercise = self._resolve_exercise(user_id, str(data.get("exercise_id") or ""))
        if not exercise:
            return {"status": "error", "error": "Unknown exercise_id"}
        position = _to_int(data.get("order"))
        if position <= 0:
            return {"status": "error", "error": "order must be greater than zero"}
        try:
            session = self._ensure_session(
                user_id, str(data.get("session_id") or "").strip(), performed_at, data.get("location")
            )
        except ValueError as error:
            return {"status": "error", "error": str(error)}
        row = {
            "id": _stable_uuid(user_id, "cardio", request_id),
            "user_id": user_id,
            "session_id": session["id"],
            "exercise_id": exercise["id"],
            "performed_at": performed_at.isoformat(),
            "position": position,
            **values,
            "source": "gymapp",
            "client_request_id": request_id,
            "source_payload": {},
        }
        self.client.upsert(CARDIO_TABLE, row, on_conflict="user_id,client_request_id")
        return {"status": "success", "request_id": request_id}

    def update_cardio(self, user_id: str, data: Dict[str, Any]) -> bool:
        existing = self._locate_cardio(user_id, data)
        if not existing:
            return False
        values = self._cardio_values(data)
        if self._cardio_error(values):
            return False
        if not values:
            return True
        return bool(self.client.update(
            CARDIO_TABLE, values, filters={"user_id": user_id, "id": existing["id"]}
        ))

    def delete_cardio(self, user_id: str, data: Dict[str, Any]) -> bool:
        # Same contract as delete_set: the offline queue asks for missing_ok.
        missing_ok = bool(data.get("missing_ok"))
        existing = self._locate_cardio(user_id, data)
        if not existing:
            return missing_ok
        if not self.client.delete(CARDIO_TABLE, filters={"user_id": user_id, "id": existing["id"]}):
            return missing_ok
        self._drop_session_if_empty(user_id, existing["session_id"])
        return True

    @staticmethod
    def _cardio_to_api(row: Dict[str, Any]) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "id": str(row.get("client_request_id") or row.get("id") or ""),
            "minutes": round(_to_float(row.get("duration_seconds")) / 60, 2),
            "order": _to_int(row.get("position")),
        }
        if row.get("speed_kmh") is not None:
            result["speed"] = _to_float(row["speed_kmh"])
        if row.get("incline_pct") is not None:
            result["incline"] = _to_float(row["incline_pct"])
        return result

    def delete_workout(self, user_id: str, date_text: str, session_id: str = "") -> int:
        if session_id:
            deleted = self.client.delete(
                "gym_workout_sessions", filters={"user_id": user_id, "id": session_id}
            )
            return len(deleted)

        iso_date = str(date_text or "").strip().replace(".", "-")
        sessions = self._select(
            "gym_workout_sessions",
            filters={"user_id": user_id, "workout_date": iso_date},
        )
        if len(sessions) > 1:
            raise ConflictError("Multiple workout sessions exist for this date; session_id is required")
        if not sessions:
            return 0
        deleted = self.client.delete(
            "gym_workout_sessions", filters={"user_id": user_id, "id": sessions[0]["id"]}
        )
        return len(deleted)

    def _data(self, user_id: str):
        sessions = self._select("gym_workout_sessions", filters={"user_id": user_id})
        groups = self._select("gym_set_groups", filters={"user_id": user_id})
        sets = self._select("gym_sets", filters={"user_id": user_id})
        exercises = self._exercises(user_id)
        return sessions, groups, sets, exercises

    @staticmethod
    def _set_to_api(row: Dict[str, Any], group: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        result = {
            "id": str(row.get("client_request_id") or row.get("id") or ""),
            "weight": _to_float(row.get("total_weight_kg")),
            "input_weight": _to_float(row.get("input_weight_kg")),
            "reps": _to_int(row.get("reps")),
            "rest": round(_to_float(row.get("rest_seconds")) / 60, 2),
            "order": _to_int(row.get("position")),
            "setGroupId": str((group or {}).get("legacy_group_id") or row.get("set_group_id") or ""),
            "set_type": str(row.get("set_type") or "working"),
            "include_in_tonnage": bool(row.get("include_in_tonnage", True)),
        }
        if row.get("rpe") is not None:
            result["rpe"] = _to_float(row["rpe"])
        if row.get("rir") is not None:
            result["rir"] = _to_float(row["rir"])
        load = (row.get("source_payload") or {}).get("load")
        if isinstance(load, dict):
            result["load"] = load
        timing = (row.get("source_payload") or {}).get("timing")
        if isinstance(timing, dict):
            result["timing"] = timing
        return result

    def get_exercise_history(self, user_id: str, exercise_id: str, limit: int = 50) -> Dict[str, Any]:
        exercise = self._resolve_exercise(user_id, exercise_id)
        if not exercise:
            return {"history": [], "note": ""}
        # Opening one exercise must not download every set and the catalogue.
        # The extra pages made this route exceed the function's 30s limit on
        # a slow Data API response, even when global history was still readable.
        sessions = self._select("gym_workout_sessions", filters={"user_id": user_id})
        groups = self._select("gym_set_groups", filters={"user_id": user_id})
        matching = self._select(
            "gym_sets", filters={"user_id": user_id, "exercise_id": exercise["id"]}
        )
        session_by_id = {row["id"]: row for row in sessions}
        group_by_id = {row["id"]: row for row in groups}
        cardio = [
            row for row in self._select(
                CARDIO_TABLE, filters={"user_id": user_id, "exercise_id": exercise["id"]}
            )
        ]
        matching.sort(key=lambda row: (str(row.get("performed_at") or ""), _to_int(row.get("position"))), reverse=True)
        grouped: Dict[str, Dict[str, Any]] = {}
        for row in matching:
            session = session_by_id.get(row.get("session_id"), {})
            session_id = str(session.get("id") or row.get("session_id") or "")
            date = _api_date(session.get("workout_date"))
            if date and session_id:
                group = grouped.setdefault(
                    session_id,
                    {"session_id": session_id, "date": date, "sets": [], "cardio": [], "latest": ""},
                )
                group["sets"].append(
                    self._set_to_api(row, group_by_id.get(row.get("set_group_id")))
                )
                group["latest"] = max(group["latest"], str(row.get("performed_at") or ""))
        for row in cardio:
            session = session_by_id.get(row.get("session_id"), {})
            session_id = str(session.get("id") or row.get("session_id") or "")
            date = _api_date(session.get("workout_date"))
            if date and session_id:
                group = grouped.setdefault(
                    session_id,
                    {"session_id": session_id, "date": date, "sets": [], "cardio": [], "latest": ""},
                )
                group["cardio"].append(self._cardio_to_api(row))
                group["latest"] = max(group["latest"], str(row.get("performed_at") or ""))
        # Date-only restorations intentionally have no performed_at. They still
        # belong in chronological history rather than after every timed session.
        history = sorted(grouped.values(), key=lambda group: (group["date"], group["latest"]), reverse=True)
        history = history[: max(1, min(limit, 100))]
        return {
            "history": [
                {
                    "session_id": group["session_id"],
                    "date": group["date"],
                    "sets": sorted(group["sets"], key=lambda item: item["order"]),
                    **({"cardio": sorted(group["cardio"], key=lambda item: item["order"])}
                       if group["cardio"] else {}),
                }
                for group in history
            ],
            "note": str(exercise.get("technique_note") or ""),
        }

    def get_global_history(self, user_id: str, limit_rows: Optional[int] = None) -> List[Dict[str, Any]]:
        sessions, groups, sets, exercises = self._data(user_id)
        cardio = self._select(CARDIO_TABLE, filters={"user_id": user_id})
        return self._history_from_rows(sessions, groups, sets, exercises, cardio, limit_rows)

    def get_journal_delta(self, user_id: str, known: Dict[str, str]) -> Dict[str, Any]:
        if (not isinstance(known, dict) or len(known) > 10000
                or any(not isinstance(k, str) or not isinstance(v, str) or len(k) > 64 or len(v) > 64 for k, v in known.items())):
            raise ValueError('known must be a journal version map')
        read = getattr(self.client, 'rpc_read', None)
        if read is None:
            return {'mode': 'full', 'history': self.get_global_history(user_id)}
        try:
            snapshot = read('gym_journal_snapshot_v1', {'p_user_id': user_id, 'p_known': known})
        except RuntimeError as error:
            # Backwards-compatible rollout before the additive read function exists.
            if 'PGRST202' not in str(error):
                raise
            return {'mode': 'full', 'history': self.get_global_history(user_id)}
        if not isinstance(snapshot, dict) or not isinstance(snapshot.get('manifest'), dict) or not isinstance(snapshot.get('changed'), list):
            raise ValueError('Invalid journal snapshot')
        upserts, changed_ids = [], []
        for row in snapshot['changed']:
            session = row['session']
            if str(session.get('user_id')) != str(user_id):
                raise ValueError('Journal snapshot owner mismatch')
            changed_ids.append(str(session['id']))
            history = self._history_from_rows([session], row['groups'], row['sets'], row['exercises'], row['cardio'], None)
            upserts.extend({**item, 'syncVersion': row['revision']} for item in history)
        return {'mode': 'delta', 'manifest': snapshot['manifest'], 'changedIds': changed_ids, 'upserts': upserts}

    def _history_from_rows(self, sessions, groups, sets, exercises, cardio, limit_rows=3000):
        """Shared history shape for the full journal and an owned session."""
        exercise_by_id = {row["id"]: row for row in exercises}
        group_by_id = {row["id"]: row for row in groups}
        session_by_id = {row["id"]: row for row in sessions}
        analytics_complete = limit_rows is None or len(sets) <= limit_rows
        sets = sorted(sets, key=lambda row: (
            str(session_by_id.get(row.get("session_id"), {}).get("workout_date") or ""),
            str(row.get("performed_at") or ""), _to_int(row.get("position")),
        ), reverse=True)[:limit_rows]
        sets_by_session: Dict[str, List[Dict[str, Any]]] = {}
        for row in sets:
            sets_by_session.setdefault(row["session_id"], []).append(row)
        cardio_by_session: Dict[str, List[Dict[str, Any]]] = {}
        for row in cardio:
            cardio_by_session.setdefault(row["session_id"], []).append(row)
        result: List[Dict[str, Any]] = []
        for session in sorted(sessions, key=lambda row: (str(row.get("workout_date")), str(row.get("started_at") or "")), reverse=True):
            session_sets = sets_by_session.get(session["id"], [])
            session_cardio = cardio_by_session.get(session["id"], [])
            if not session_sets and not session_cardio:
                continue
            blocks: Dict[tuple, Dict[str, Any]] = {}
            muscles = set()
            for row in session_sets:
                exercise = exercise_by_id.get(row["exercise_id"], {})
                group = group_by_id.get(row.get("set_group_id"), {})
                source_key = str(exercise.get("source_key") or exercise.get("id") or "")
                key = (row["exercise_id"], row.get("set_group_id"))
                block = blocks.setdefault(key, {
                    "name": str(exercise.get("name_ru") or ""),
                    "exerciseId": source_key,
                    "muscleGroup": str(exercise.get("muscle_group") or ""),
                    "supersetId": group.get("legacy_group_id") if group.get("group_type") != "single" else None,
                    "sets": [],
                })
                block["sets"].append(self._set_to_api(row, group))
                if exercise.get("muscle_group"):
                    muscles.add(exercise["muscle_group"])
            for row in session_cardio:
                exercise = exercise_by_id.get(row["exercise_id"], {})
                block = blocks.setdefault((row["exercise_id"], "cardio"), {
                    "name": str(exercise.get("name_ru") or ""),
                    "exerciseId": str(exercise.get("source_key") or exercise.get("id") or ""),
                    "supersetId": None,
                    "sets": [],
                    "cardio": [],
                })
                block["cardio"].append(self._cardio_to_api(row))
            exercises_api = list(blocks.values())
            for block in exercises_api:
                block["sets"].sort(key=lambda item: item["order"])
                if "cardio" in block:
                    block["cardio"].sort(key=lambda item: item["order"])
            exercises_api.sort(key=lambda block: min(
                item["order"] for item in block["sets"] + block.get("cardio", [])
            ))
            result.append({
                "id": session["id"],
                "analyticsComplete": analytics_complete,
                "clientSessionId": (session.get("source_payload") or {}).get("client_session_id"),
                "repeatedFromSessionId": (session.get("source_payload") or {}).get("repeated_from_session_id"),
                "date": _api_date(session.get("workout_date")),
                "started_at": session.get("started_at"),
                "muscleGroups": sorted(muscles, key=str.casefold),
                "location": session.get("location"),
                "duration_minutes": session.get("duration_minutes"),
                "duration_source": ("reported" if session.get("duration_minutes") is not None else
                                    "elapsed" if 'elapsed_seconds' in (session.get("source_payload") or {}) else "estimated"),
                "duration_is_approximate": session.get("duration_is_approximate", False),
                "duration": (f"{'≈' if session.get('duration_is_approximate') else ''}{_to_float(session['duration_minutes']):g}м"
                             if session.get("duration_minutes") is not None else
                             f"{round(_to_float((session.get('source_payload') or {})['elapsed_seconds']) / 60)}м"
                             if 'elapsed_seconds' in (session.get('source_payload') or {}) else
                             f"{len(session_sets) * 2 + round(sum(_to_float(r.get('duration_seconds')) for r in session_cardio) / 60)}м"),
                "exercises": exercises_api,
            })
        return result

    def get_workout_session(self, user_id: str, session_id: str) -> Optional[Dict[str, Any]]:
        """One session in global-history shape, or None when it is not this user's.

        Backs the ``?session=<uuid>`` deep link from HealthOS. The client never
        chooses the owner: the lookup is filtered by the server-resolved
        ``user_id``, so a session belonging to somebody else is indistinguishable
        from one that does not exist, and the caller answers 404 for both.
        """
        session_id = str(session_id or "").strip()
        if not session_id:
            return None
        try:
            session_id = str(uuid.UUID(session_id))
        except (ValueError, AttributeError):
            return None
        owned = self._select(
            "gym_workout_sessions",
            filters={"user_id": user_id, "id": session_id},
            limit=1,
        )
        if not owned:
            return None
        filters = {"user_id": user_id, "session_id": session_id}
        groups = self._select("gym_set_groups", filters=filters)
        sets = self._select("gym_sets", filters=filters)
        cardio = self._select(CARDIO_TABLE, filters=filters)
        history = self._history_from_rows(owned, groups, sets, self._exercises(user_id), cardio)
        if history:
            return history[0]
        # Owned, but it carries no sets — real, and legitimately empty.
        return {"id": session_id, "date": "", "muscleGroups": [], "duration": "", "exercises": []}

    def get_analytics(self, user_id: str, days: int = 14) -> Dict[str, Any]:
        sessions, _, sets, exercises = self._data(user_id)
        exercise_by_id = {row["id"]: row for row in exercises}
        session_by_id = {row["id"]: row for row in sessions}
        now = self._now()

        def recent(row: Dict[str, Any], period: int) -> bool:
            session = session_by_id.get(row.get("session_id"), {})
            try:
                day = datetime.fromisoformat(str(session.get("workout_date"))).date()
            except (TypeError, ValueError):
                return False
            return now.date() - timedelta(days=period - 1) <= day <= now.date()

        working = [row for row in sets if str(row.get("set_type") or "working") == "working" and row.get("include_in_tonnage", True)]
        selected = [row for row in working if recent(row, max(1, min(days, 365)))]
        muscle_volume: Dict[str, float] = {}
        muscle_sets: Dict[str, int] = {}
        for row in selected:
            load = _to_float(row.get("total_weight_kg")) * _to_int(row.get("reps"))
            muscle = str(exercise_by_id.get(row.get("exercise_id"), {}).get("muscle_group") or "Другое")
            muscle_volume[muscle] = muscle_volume.get(muscle, 0) + load
            muscle_sets[muscle] = muscle_sets.get(muscle, 0) + 1
        # workload-trend-v1 replaces the ACWR readout that used to live here.
        # See docs/WORKLOAD_TREND_V1.md: the old chronic window included the
        # acute one, and the ratio was rendered as a risk judgement neither the
        # metric nor tonnage-across-exercises can support.
        trend_sessions = sets_to_trend_sessions(
            working,
            {
                str(row["id"]): _iso_date(row.get("workout_date"))
                for row in sessions
                if row.get("id")
            },
            lambda row: _to_float(row.get("total_weight_kg")) * _to_int(row.get("reps")),
        )
        trend = compute_workload_trend(trend_sessions, now.date().isoformat())
        return {
            "proposals": [], "baseline": {},
            "volume": round(sum(muscle_volume.values()), 1),
            "workloadTrend": {**trend, "text": format_workload_trend(trend)},
            "muscleVolume": {key: round(value, 1) for key, value in muscle_volume.items()},
            "muscleSets": muscle_sets,
        }

    def create_exercise(self, user_id: str, name: str, group: str, measure: str = "strength") -> Dict[str, Any]:
        wanted = name.strip().casefold()
        for row in self._exercises(user_id):
            if str(row.get("name_ru") or "").strip().casefold() == wanted:
                result = self._exercise_to_api(row)
                result["deduplicated"] = True
                return result
        exercise_id = str(uuid.uuid4())
        cardio = measure == "cardio"
        row = {
            "id": exercise_id, "user_id": user_id, "source": "gymapp", "source_key": exercise_id,
            "name_ru": name.strip(), "muscle_group": group.strip(),
            # Cardio has no load: its segments live apart from sets, and should a
            # set ever be logged against it, it stays out of tonnage.
            "weight_type": "Other" if cardio else "Machine",
            "base_weight_kg": 0, "multiplier": 1,
            "tonnage_mode": "excluded" if cardio else "external_load",
            "measure": "cardio" if cardio else "strength",
            "source_payload": {"created_by": "gymapp-live"},
        }
        written = self.client.upsert("gym_exercises", row, on_conflict="user_id,source,source_key")
        return self._exercise_to_api(written[0] if written else row)

    def update_exercise(self, user_id: str, exercise_id: str, updates: Dict[str, Any]) -> bool:
        exercise = self._resolve_exercise(user_id, exercise_id)
        if not exercise:
            return False
        mapping = {
            "name": "name_ru", "muscleGroup": "muscle_group", "description": "description",
            "imageUrl": "image_url", "imageUrl2": "image_url_2", "weightType": "weight_type",
            "baseWeight": "base_weight_kg", "weightMultiplier": "multiplier",
        }
        values = {column: updates[key] for key, column in mapping.items() if key in updates}
        if "measure" in updates:
            if updates["measure"] not in ("strength", "cardio"):
                raise ValueError("measure must be strength or cardio")
            values["measure"] = updates["measure"]

        # Progression targets. Sent explicitly or not at all: a key that is
        # absent leaves the stored value alone, and an explicit null clears it.
        # Nothing here is derived from history — suggestions are made in the UI
        # and only reach this call once the user has confirmed them.
        target_ints = {"repRangeLow": "rep_range_low", "repRangeHigh": "rep_range_high",
                       "targetWorkingSets": "target_working_sets"}
        target_floats = {"inputWeightStep": "input_weight_step", "rirTargetMax": "rir_target_max"}
        for key, column in target_ints.items():
            if key in updates:
                values[column] = _optional_int(updates[key])
        for key, column in target_floats.items():
            if key in updates:
                values[column] = _optional_float(updates[key])

        # A range is stored whole or not at all; the CHECK enforces it too, but
        # failing here gives the client a usable message instead of a 500.
        low = values.get("rep_range_low", exercise.get("rep_range_low"))
        high = values.get("rep_range_high", exercise.get("rep_range_high"))
        if (low is None) != (high is None):
            raise ValueError("rep_range_low and rep_range_high must be set together")
        if low is not None and high is not None and low > high:
            raise ValueError("rep_range_low must not exceed rep_range_high")
        if "secondaryMuscles" in updates:
            payload = dict(exercise.get("source_payload") or {})
            payload["secondary_muscles"] = str(updates["secondaryMuscles"] or "")
            values["source_payload"] = payload
        if not values:
            return True
        return bool(self.client.update("gym_exercises", values, filters={"user_id": user_id, "id": exercise["id"]}))

    def export_data(self, user_id: str) -> Dict[str, Any]:
        sessions, groups, sets, exercises = self._data(user_id)
        session_by_id = {row["id"]: row for row in sessions}
        group_by_id = {row["id"]: row for row in groups}
        exercise_by_id = {row["id"]: row for row in exercises}
        ex_headers = ["ID", "Name", "Muscle Group", "Description", "Image_URL", "Image_URL2", "Weight_Type", "Base_Wt", "Multiplier", "Secondary_Muscles"]
        log_headers = ["Date", "Exercise_ID", "Exercise_Name_Calc", "Input_Weight", "Total_Weight", "Reps", "Rest", "Set_Group_ID", "Note", "Order", "Set_Type", "RPE", "RIR", "Session_ID", "Client_Request_ID"]
        ex_rows = [ex_headers]
        for row in exercises:
            api = self._exercise_to_api(row)
            ex_rows.append([api["id"], api["name"], api["muscleGroup"], api["description"], api["imageUrl"], api["imageUrl2"], api["weightType"], api["baseWeight"], api["weightMultiplier"], api["secondaryMuscles"]])
        log_rows = [log_headers]
        for row in sets:
            session = session_by_id.get(row["session_id"], {})
            group = group_by_id.get(row.get("set_group_id"), {})
            exercise = exercise_by_id.get(row["exercise_id"], {})
            log_rows.append([_api_date(session.get("workout_date")), exercise.get("source_key"), exercise.get("name_ru"), row.get("input_weight_kg"), row.get("total_weight_kg"), row.get("reps"), round(_to_float(row.get("rest_seconds")) / 60, 2), group.get("legacy_group_id"), row.get("note") or "", row.get("position"), row.get("set_type"), row.get("rpe") or "", row.get("rir") or "", (session.get("source_payload") or {}).get("client_session_id", ""), row.get("client_request_id")])
        return {"format": "gymapp-backup-v1", "exported_at": self._now().isoformat(), "exercises": ex_rows, "log": log_rows}

    @staticmethod
    def import_data(user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        del user_id, data
        return {
            "status": "error",
            "error": "Direct backup import is disabled; use the reviewed HealthOS importer",
            "exercises_added": 0, "exercises_updated": 0, "log_added": 0, "log_skipped": 0,
        }


_default_store: Optional[SupabaseStore] = None


def _store() -> SupabaseStore:
    global _default_store
    if _default_store is None:
        _default_store = SupabaseStore(SupabaseRestClient.from_env())
    return _default_store


def get_init(user_id: str, force: bool = False): return _store().get_init(user_id, force)
def get_exercise_history(user_id: str, exercise_id: str, limit: int = 50): return _store().get_exercise_history(user_id, exercise_id, limit)
def save_set(user_id: str, data: Dict[str, Any]): return _store().save_set(user_id, data)
def update_set(user_id: str, data: Dict[str, Any]): return _store().update_set(user_id, data)
def delete_set(user_id: str, data: Dict[str, Any]): return _store().delete_set(user_id, data)
def save_cardio(user_id: str, data: Dict[str, Any]): return _store().save_cardio(user_id, data)
def update_cardio(user_id: str, data: Dict[str, Any]): return _store().update_cardio(user_id, data)
def delete_cardio(user_id: str, data: Dict[str, Any]): return _store().delete_cardio(user_id, data)
def delete_workout(user_id: str, date_text: str, session_id: str = ""): return _store().delete_workout(user_id, date_text, session_id)
def export_data(user_id: str): return _store().export_data(user_id)
def import_data(user_id: str, data: Dict[str, Any]): return _store().import_data(user_id, data)
def create_exercise(user_id: str, name: str, group: str, measure: str = "strength"): return _store().create_exercise(user_id, name, group, measure)
def update_exercise(user_id: str, exercise_id: str, updates: Dict[str, Any]): return _store().update_exercise(user_id, exercise_id, updates)
def get_global_history(user_id: str, limit_rows: Optional[int] = None): return _store().get_global_history(user_id, limit_rows)
def get_journal_delta(user_id: str, known: Dict[str, str]): return _store().get_journal_delta(user_id, known)
def get_workout_session(user_id: str, session_id: str): return _store().get_workout_session(user_id, session_id)
def update_session(user_id: str, data: Dict[str, Any]): return _store().update_session(user_id, data)

def save_session(user_id: str, data: Dict[str, Any]): return _store().save_session(user_id, data)
def get_analytics(user_id: str, days: int = 14): return _store().get_analytics(user_id, days)
