"""Supabase storage adapter preserving the GymApp v2 backend API.

All public functions require a server-resolved ``user_id``. The browser never
chooses the owner, and every Data API request is scoped to that owner even
though the backend secret bypasses RLS.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


MOSCOW_TZ = ZoneInfo("Europe/Moscow")
LIVE_NAMESPACE = uuid.UUID("7bd184da-f675-4d11-b7c9-cc795ab7975c")
READ_PAGE_SIZE = 500
EXERCISE_SELECT = (
    "id,user_id,source,source_key,name_ru,name_en,muscle_group,description,"
    "image_url,image_url_2,weight_type,base_weight_kg,multiplier,tonnage_mode,"
    "technique_note,is_active,source_payload"
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


def _stable_uuid(*parts: Any) -> str:
    return str(uuid.uuid5(LIVE_NAMESPACE, ":".join(str(part) for part in parts)))


def _valid_client_request_id(value: Any) -> str:
    try:
        return str(uuid.UUID(str(value or "").strip()))
    except (ValueError, AttributeError) as error:
        raise ValueError("client_request_id must be a UUID") from error


def _api_date(value: Any) -> str:
    return str(value or "").split("T", 1)[0].replace("-", ".")


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
        try:
            with urlopen(request, timeout=20) as result:
                raw = result.read().decode("utf-8")
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase Data API returned {error.code}: {detail}") from error
        return json.loads(raw) if raw else []

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
        query: Dict[str, str] = {"select": columns}
        for key, value in (filters or {}).items():
            query[key] = str(value) if str(value).startswith(("eq.", "gte.", "in.")) else f"eq.{value}"
        if order:
            query["order"] = order
        if limit is not None:
            query["limit"] = str(limit)
        if offset:
            query["offset"] = str(offset)
        return self._request("GET", table, query=query)

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
        while limit is None or len(rows) < limit:
            requested = min(READ_PAGE_SIZE, limit - len(rows)) if limit is not None else READ_PAGE_SIZE
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
            "description": str(record.get("description") or ""),
            "imageUrl": str(record.get("image_url") or ""),
            "imageUrl2": str(record.get("image_url_2") or ""),
            "weightType": str(record.get("weight_type") or "Other"),
            "baseWeight": _to_float(record.get("base_weight_kg")),
            "weightMultiplier": _to_float(record.get("multiplier"), 1.0),
            "secondaryMuscles": str(source_payload.get("secondary_muscles") or ""),
        }

    def get_init(self, user_id: str, force: bool = False) -> Dict[str, Any]:
        del force
        exercises = [self._exercise_to_api(row) for row in self._exercises(user_id, active_only=True)]
        exercises = [row for row in exercises if row["id"] and row["name"]]
        exercises.sort(key=lambda row: row["name"].casefold())
        groups = sorted({row["muscleGroup"] for row in exercises if row["muscleGroup"]}, key=str.casefold)
        return {"groups": groups, "exercises": exercises}

    def _ensure_session(self, user_id: str, session_ref: str, performed_at: datetime) -> Dict[str, Any]:
        if not session_ref:
            raise ValueError("session_id is required")
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
            "source_payload": {"client_session_id": session_ref},
        }
        result = self.client.upsert(
            "gym_workout_sessions", row, on_conflict="user_id,source,source_record_id"
        )
        return result[0] if result else row

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

    def save_set(self, user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        try:
            request_id = _valid_client_request_id(data.get("client_request_id") or data.get("request_id"))
            performed_at = _aware_datetime(data.get("performed_at"), "performed_at")
        except ValueError as error:
            return {"status": "error", "error": str(error)}
        if performed_at > self._now() + timedelta(minutes=5):
            return {"status": "error", "error": "performed_at is in the future"}
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
            return {"status": "success", "request_id": request_id, "deduplicated": True}

        exercise = self._resolve_exercise(user_id, str(data.get("exercise_id") or ""))
        if not exercise:
            return {"status": "error", "error": "Unknown exercise_id"}
        reps = _to_int(data.get("reps"))
        if reps <= 0:
            return {"status": "error", "error": "reps must be greater than zero"}
        position = _to_int(data.get("order"))
        if position <= 0:
            return {"status": "error", "error": "order must be greater than zero"}
        session_ref = str(data.get("session_id") or "").strip()
        group_ref = str(data.get("set_group_id") or session_ref).strip()
        try:
            session = self._ensure_session(user_id, session_ref, performed_at)
            group = self._ensure_group(user_id, session, session_ref, group_ref, position)
            set_type = str(data.get("set_type") or "working").lower()
            if set_type not in {"warmup", "working", "drop", "failure", "other"}:
                set_type = "other"
            row = {
                "id": _stable_uuid(user_id, "set", request_id),
                "user_id": user_id,
                "session_id": session["id"],
                "set_group_id": group["id"],
                "exercise_id": exercise["id"],
                "performed_at": performed_at.isoformat(),
                "position": position,
                "input_weight_kg": max(0, _to_float(data.get("input_weight", data.get("weight")))),
                "total_weight_kg": max(0, _to_float(data.get("weight", data.get("input_weight")))),
                "reps": reps,
                "rest_seconds": max(0, round(_to_float(data.get("rest")) * 60)),
                "set_type": set_type,
                "rpe": _optional_float(data.get("rpe")),
                "rir": _optional_float(data.get("rir")),
                "include_in_tonnage": exercise.get("tonnage_mode") != "excluded",
                "note": str(data.get("note") or "") or None,
                "source": "gymapp",
                "source_record_id": f"live:{request_id}",
                "client_request_id": request_id,
                "legacy_session_id": session_ref,
                "source_payload": {"client_group_id": group_ref},
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
        updates["updated_at"] = self._now().isoformat()
        return bool(self.client.update(
            "gym_sets", updates, filters={"user_id": user_id, "id": existing["id"]}
        ))

    def delete_set(self, user_id: str, data: Dict[str, Any]) -> bool:
        existing = self._locate_set(user_id, data)
        if not existing:
            return False
        deleted = bool(self.client.delete(
            "gym_sets", filters={"user_id": user_id, "id": existing["id"]}
        ))
        if not deleted:
            return False
        if existing.get("set_group_id") and not self._select(
            "gym_sets", filters={"user_id": user_id, "set_group_id": existing["set_group_id"]}, limit=1
        ):
            self.client.delete(
                "gym_set_groups", filters={"user_id": user_id, "id": existing["set_group_id"]}
            )
        if not self._select(
            "gym_sets", filters={"user_id": user_id, "session_id": existing["session_id"]}, limit=1
        ):
            self.client.delete(
                "gym_workout_sessions", filters={"user_id": user_id, "id": existing["session_id"]}
            )
        return True

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
        }
        if row.get("rpe") is not None:
            result["rpe"] = _to_float(row["rpe"])
        if row.get("rir") is not None:
            result["rir"] = _to_float(row["rir"])
        return result

    def get_exercise_history(self, user_id: str, exercise_id: str, limit: int = 50) -> Dict[str, Any]:
        exercise = self._resolve_exercise(user_id, exercise_id)
        if not exercise:
            return {"history": [], "note": ""}
        sessions, groups, sets, _ = self._data(user_id)
        session_by_id = {row["id"]: row for row in sessions}
        group_by_id = {row["id"]: row for row in groups}
        matching = [row for row in sets if row.get("exercise_id") == exercise["id"]]
        matching.sort(key=lambda row: (str(row.get("performed_at") or ""), _to_int(row.get("position"))), reverse=True)
        grouped: Dict[str, Dict[str, Any]] = {}
        for row in matching:
            session = session_by_id.get(row.get("session_id"), {})
            session_id = str(session.get("id") or row.get("session_id") or "")
            date = _api_date(session.get("workout_date"))
            if date and session_id:
                group = grouped.setdefault(
                    session_id,
                    {"session_id": session_id, "date": date, "sets": [], "latest": ""},
                )
                group["sets"].append(
                    self._set_to_api(row, group_by_id.get(row.get("set_group_id")))
                )
                group["latest"] = max(group["latest"], str(row.get("performed_at") or ""))
        history = sorted(grouped.values(), key=lambda group: group["latest"], reverse=True)
        history = history[: max(1, min(limit, 100))]
        return {
            "history": [
                {
                    "session_id": group["session_id"],
                    "date": group["date"],
                    "sets": sorted(group["sets"], key=lambda item: item["order"]),
                }
                for group in history
            ],
            "note": str(exercise.get("technique_note") or ""),
        }

    def get_global_history(self, user_id: str, limit_rows: int = 3000) -> List[Dict[str, Any]]:
        sessions, groups, sets, exercises = self._data(user_id)
        exercise_by_id = {row["id"]: row for row in exercises}
        group_by_id = {row["id"]: row for row in groups}
        sets = sorted(sets, key=lambda row: str(row.get("performed_at") or ""), reverse=True)[:limit_rows]
        sets_by_session: Dict[str, List[Dict[str, Any]]] = {}
        for row in sets:
            sets_by_session.setdefault(row["session_id"], []).append(row)
        result: List[Dict[str, Any]] = []
        for session in sorted(sessions, key=lambda row: (str(row.get("workout_date")), str(row.get("started_at") or "")), reverse=True):
            session_sets = sets_by_session.get(session["id"], [])
            if not session_sets:
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
                    "supersetId": group.get("legacy_group_id") if group.get("group_type") != "single" else None,
                    "sets": [],
                })
                block["sets"].append(self._set_to_api(row, group))
                if exercise.get("muscle_group"):
                    muscles.add(exercise["muscle_group"])
            exercises_api = list(blocks.values())
            for block in exercises_api:
                block["sets"].sort(key=lambda item: item["order"])
            exercises_api.sort(key=lambda block: min(item["order"] for item in block["sets"]))
            result.append({
                "id": session["id"],
                "date": _api_date(session.get("workout_date")),
                "muscleGroups": sorted(muscles, key=str.casefold),
                "duration": f"{len(session_sets) * 2}м",
                "exercises": exercises_api,
            })
        return result

    def get_analytics(self, user_id: str, days: int = 14) -> Dict[str, Any]:
        sessions, _, sets, exercises = self._data(user_id)
        exercise_by_id = {row["id"]: row for row in exercises}
        session_by_id = {row["id"]: row for row in sessions}
        now = self._now()

        def recent(row: Dict[str, Any], period: int) -> bool:
            session = session_by_id.get(row.get("session_id"), {})
            try:
                date = datetime.fromisoformat(str(session.get("workout_date"))).replace(tzinfo=MOSCOW_TZ)
            except (TypeError, ValueError):
                return False
            return date >= now - timedelta(days=period)

        working = [row for row in sets if str(row.get("set_type") or "working") == "working" and row.get("include_in_tonnage", True)]
        selected = [row for row in working if recent(row, max(1, min(days, 365)))]
        muscle_volume: Dict[str, float] = {}
        muscle_sets: Dict[str, int] = {}
        for row in selected:
            load = _to_float(row.get("total_weight_kg")) * _to_int(row.get("reps"))
            muscle = str(exercise_by_id.get(row.get("exercise_id"), {}).get("muscle_group") or "Другое")
            muscle_volume[muscle] = muscle_volume.get(muscle, 0) + load
            muscle_sets[muscle] = muscle_sets.get(muscle, 0) + 1
        acute = sum(_to_float(row.get("total_weight_kg")) * _to_int(row.get("reps")) for row in working if recent(row, 7))
        chronic = sum(_to_float(row.get("total_weight_kg")) * _to_int(row.get("reps")) for row in working if recent(row, 28)) / 4
        training_days = len({session_by_id[row["session_id"]].get("workout_date") for row in working if recent(row, 28)})
        ratio = acute / chronic if chronic else 0
        status = "building" if training_days < 8 else "under" if ratio < 0.8 else "danger" if ratio > 1.5 else "optimal"
        return {
            "proposals": [], "baseline": {},
            "volume": round(sum(muscle_volume.values()), 1),
            "acwr": {"acute": round(acute, 1), "chronic": round(chronic, 1), "ratio": round(ratio, 2), "status": status, "trainingDays": training_days},
            "muscleVolume": {key: round(value, 1) for key, value in muscle_volume.items()},
            "muscleSets": muscle_sets,
        }

    def create_exercise(self, user_id: str, name: str, group: str) -> Dict[str, Any]:
        wanted = name.strip().casefold()
        for row in self._exercises(user_id):
            if str(row.get("name_ru") or "").strip().casefold() == wanted:
                result = self._exercise_to_api(row)
                result["deduplicated"] = True
                return result
        exercise_id = str(uuid.uuid4())
        row = {
            "id": exercise_id, "user_id": user_id, "source": "gymapp", "source_key": exercise_id,
            "name_ru": name.strip(), "muscle_group": group.strip(), "weight_type": "Machine",
            "base_weight_kg": 0, "multiplier": 1, "tonnage_mode": "external_load",
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
def delete_workout(user_id: str, date_text: str, session_id: str = ""): return _store().delete_workout(user_id, date_text, session_id)
def export_data(user_id: str): return _store().export_data(user_id)
def import_data(user_id: str, data: Dict[str, Any]): return _store().import_data(user_id, data)
def create_exercise(user_id: str, name: str, group: str): return _store().create_exercise(user_id, name, group)
def update_exercise(user_id: str, exercise_id: str, updates: Dict[str, Any]): return _store().update_exercise(user_id, exercise_id, updates)
def get_global_history(user_id: str, limit_rows: int = 3000): return _store().get_global_history(user_id, limit_rows)
def get_analytics(user_id: str, days: int = 14): return _store().get_analytics(user_id, days)
