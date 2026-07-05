"""Google Sheets storage for GymApp v2.

The module targets the schema that is currently used by the production sheet:

LOG:
Date, Exercise_ID, Exercise_Name_Calc, Input_Weight, Total_Weight, Reps,
Rest, Set_Group_ID, Note, Order, Real_Load_Kg, e1RM, Tonnage

EXERCISES:
ID, Name, Muscle Group, Description, Image_URL, Image_URL2, Weight_Type,
Base_Wt, Multiplier
"""

from __future__ import annotations

import json
import os
import time
import uuid
import base64
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

import gspread
from google.oauth2.service_account import Credentials


MOSCOW_TZ = ZoneInfo("Europe/Moscow")
LOG_SHEET = os.getenv("GOOGLE_LOG_SHEET", "LOG")
EXERCISES_SHEET = os.getenv("GOOGLE_EXERCISES_SHEET", "EXERCISES")
OPTIONAL_LOG_HEADERS = ["Set_Type", "RPE", "RIR", "Session_ID", "Client_Request_ID"]

_client = None
_spreadsheet = None
_log_sheet = None
_exercises_sheet = None
_exercise_cache: Tuple[float, List[Dict[str, Any]]] = (0.0, [])
_log_cache: Tuple[float, List[Dict[str, Any]]] = (0.0, [])


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        clean = str(value if value is not None else "").replace(",", ".").strip()
        return float(clean) if clean else default
    except (TypeError, ValueError):
        return default


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(_to_float(value, default))
    except (TypeError, ValueError):
        return default


def _credentials() -> Credentials:
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]
    raw = os.getenv("GOOGLE_CREDENTIALS_JSON", "").strip()
    if raw:
        return Credentials.from_service_account_info(json.loads(raw), scopes=scopes)

    encoded = os.getenv("GOOGLE_CREDENTIALS_BASE64", "").strip()
    if encoded:
        decoded = base64.b64decode(encoded).decode("utf-8")
        return Credentials.from_service_account_info(json.loads(decoded), scopes=scopes)

    path = os.getenv("GOOGLE_CREDENTIALS_PATH", "credentials.json")
    if path and os.path.exists(path):
        return Credentials.from_service_account_file(path, scopes=scopes)

    raise RuntimeError("Google credentials are not configured")


def _worksheets():
    global _client, _spreadsheet, _log_sheet, _exercises_sheet
    if _log_sheet is not None and _exercises_sheet is not None:
        return _log_sheet, _exercises_sheet

    spreadsheet_id = os.getenv("SPREADSHEET_ID", "").strip()
    if not spreadsheet_id:
        raise RuntimeError("SPREADSHEET_ID is not configured")

    _client = gspread.authorize(_credentials())
    _spreadsheet = _client.open_by_key(spreadsheet_id)
    _log_sheet = _spreadsheet.worksheet(LOG_SHEET)
    _exercises_sheet = _spreadsheet.worksheet(EXERCISES_SHEET)
    return _log_sheet, _exercises_sheet


def _row_dict(headers: List[str], row: List[Any]) -> Dict[str, Any]:
    return {
        header: row[index] if index < len(row) else ""
        for index, header in enumerate(headers)
        if header
    }


def _exercise_records(force: bool = False) -> List[Dict[str, Any]]:
    global _exercise_cache
    now = time.monotonic()
    if not force and _exercise_cache[1] and now - _exercise_cache[0] < 300:
        return _exercise_cache[1]

    _, sheet = _worksheets()
    values = sheet.get_all_values()
    if not values:
        return []
    headers = [str(value).strip() for value in values[0]]
    records = [_row_dict(headers, row) for row in values[1:]]
    records = [record for record in records if str(record.get("ID", "")).strip()]
    _exercise_cache = (now, records)
    return records


def _log_records(force: bool = False) -> List[Dict[str, Any]]:
    global _log_cache
    now = time.monotonic()
    if not force and _log_cache[1] and now - _log_cache[0] < 10:
        return _log_cache[1]

    sheet, _ = _worksheets()
    values = sheet.get_all_values()
    if not values:
        return []
    headers = [str(value).strip() for value in values[0]]
    records = [_row_dict(headers, row) for row in values[1:]]
    for index, record in enumerate(records, start=2):
        record["_row_number"] = index
    _log_cache = (now, records)
    return records


def _invalidate_log_cache() -> None:
    global _log_cache
    _log_cache = (0.0, [])


def _invalidate_exercise_cache() -> None:
    global _exercise_cache
    _exercise_cache = (0.0, [])


def _exercise_to_api(record: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(record.get("ID", "")).strip(),
        "name": str(record.get("Name", "")).strip(),
        "muscleGroup": str(record.get("Muscle Group", "")).strip(),
        "description": str(record.get("Description", "")).strip(),
        "imageUrl": str(record.get("Image_URL", "")).strip(),
        "imageUrl2": str(record.get("Image_URL2", "")).strip(),
        "weightType": str(record.get("Weight_Type", "")).strip(),
        "baseWeight": _to_float(record.get("Base_Wt")),
        "weightMultiplier": _to_float(record.get("Multiplier"), 1.0),
    }


def get_init() -> Dict[str, Any]:
    exercises = [_exercise_to_api(record) for record in _exercise_records()]
    exercises = [exercise for exercise in exercises if exercise["id"] and exercise["name"]]
    exercises.sort(key=lambda exercise: exercise["name"].casefold())
    groups = sorted(
        {exercise["muscleGroup"] for exercise in exercises if exercise["muscleGroup"]},
        key=str.casefold,
    )
    return {"groups": groups, "exercises": exercises}


def _exercise_maps() -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    records = _exercise_records()
    by_id = {str(record.get("ID", "")).strip(): record for record in records}
    by_name = {str(record.get("Name", "")).strip(): record for record in records}
    return by_id, by_name


def _parse_date(value: Any) -> datetime:
    text = str(value or "").strip()
    for fmt in (
        "%Y.%m.%d, %H:%M",
        "%Y.%m.%d %H:%M",
        "%Y.%m.%d",
        "%d.%m.%Y, %H:%M",
        "%d.%m.%Y",
    ):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=MOSCOW_TZ)
        except ValueError:
            continue
    return datetime.min.replace(tzinfo=MOSCOW_TZ)


def _record_to_set(record: Dict[str, Any]) -> Dict[str, Any]:
    total_weight = _to_float(record.get("Total_Weight"))
    if total_weight == 0:
        total_weight = _to_float(record.get("Real_Load_Kg"))
    if total_weight == 0:
        total_weight = _to_float(record.get("Input_Weight"))
    result = {
        "id": str(record.get("Client_Request_ID", "")).strip()
        or str(record.get("_row_number", "")),
        "date": str(record.get("Date", "")).split(",")[0].strip(),
        "weight": total_weight,
        "input_weight": _to_float(record.get("Input_Weight")),
        "reps": _to_int(record.get("Reps")),
        "rest": _to_float(record.get("Rest")),
        "order": _to_int(record.get("Order")),
        "setGroupId": str(record.get("Set_Group_ID", "")).strip(),
    }
    set_type = str(record.get("Set_Type", "")).strip()
    rpe = str(record.get("RPE", "")).strip()
    rir = str(record.get("RIR", "")).strip()
    if set_type:
        result["set_type"] = set_type
    if rpe:
        result["rpe"] = _to_float(rpe)
    if rir:
        result["rir"] = _to_int(rir)
    return result


def get_exercise_history(exercise_id: str, limit: int = 50) -> Dict[str, Any]:
    matching = [
        record
        for record in _log_records()
        if str(record.get("Exercise_ID", "")).strip() == exercise_id
    ]
    matching.sort(key=lambda record: _parse_date(record.get("Date")), reverse=True)

    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for record in matching:
        date = str(record.get("Date", "")).split(",")[0].strip()
        grouped.setdefault(date, []).append(_record_to_set(record))

    dates = sorted(
        grouped,
        key=lambda value: _parse_date(value),
        reverse=True,
    )[: max(1, min(limit, 100))]
    history = [
        {
            "date": date,
            "sets": sorted(grouped[date], key=lambda item: item.get("order", 0)),
        }
        for date in dates
    ]
    latest_note = ""
    for record in matching:
        note = str(record.get("Note", "")).strip()
        if note:
            latest_note = note
            break
    return {"history": history, "note": latest_note}


def _ensure_optional_log_headers() -> List[str]:
    sheet, _ = _worksheets()
    headers = [str(value).strip() for value in sheet.row_values(1)]
    changed = False
    for header in OPTIONAL_LOG_HEADERS:
        if header not in headers:
            headers.append(header)
            changed = True
    if changed:
        sheet.update("A1", [headers], value_input_option="RAW")
    return headers


def _find_existing_request(
    records: Iterable[Dict[str, Any]],
    client_request_id: str,
    exercise_id: str,
    set_group_id: str,
    order: int,
) -> Optional[Dict[str, Any]]:
    for record in records:
        if client_request_id and str(record.get("Client_Request_ID", "")).strip() == client_request_id:
            return record
        same_natural_key = (
            exercise_id
            and set_group_id
            and order > 0
            and str(record.get("Exercise_ID", "")).strip() == exercise_id
            and str(record.get("Set_Group_ID", "")).strip() == set_group_id
            and _to_int(record.get("Order")) == order
        )
        if same_natural_key:
            return record
    return None


def save_set(data: Dict[str, Any]) -> Dict[str, Any]:
    exercise_id = str(data.get("exercise_id", "")).strip()
    if not exercise_id:
        return {"status": "error", "error": "exercise_id is required"}

    by_id, _ = _exercise_maps()
    exercise = by_id.get(exercise_id)
    if not exercise:
        return {"status": "error", "error": "Unknown exercise_id"}

    reps = _to_int(data.get("reps"))
    if reps <= 0:
        return {"status": "error", "error": "reps must be greater than zero"}

    client_request_id = str(
        data.get("client_request_id") or data.get("request_id") or uuid.uuid4()
    ).strip()
    set_group_id = str(data.get("set_group_id") or data.get("session_id") or "").strip()
    order = _to_int(data.get("order"))

    existing = _find_existing_request(
        _log_records(force=True),
        client_request_id,
        exercise_id,
        set_group_id,
        order,
    )
    if existing:
        return {
            "status": "success",
            "row_number": existing.get("_row_number"),
            "request_id": client_request_id,
            "deduplicated": True,
        }

    input_weight = _to_float(data.get("input_weight", data.get("weight")))
    total_weight = _to_float(data.get("weight", input_weight))
    values = {
        "Date": datetime.now(MOSCOW_TZ).strftime("%Y.%m.%d, %H:%M"),
        "Exercise_ID": exercise_id,
        "Exercise_Name_Calc": str(exercise.get("Name", "")).strip(),
        "Input_Weight": input_weight,
        "Total_Weight": total_weight,
        "Reps": reps,
        "Rest": _to_float(data.get("rest")),
        "Set_Group_ID": set_group_id,
        "Note": str(data.get("note", "")),
        "Order": order,
        "Set_Type": str(data.get("set_type", "working") or "working"),
        "RPE": "" if data.get("rpe") in (None, "") else _to_float(data.get("rpe")),
        "RIR": "" if data.get("rir") in (None, "") else _to_int(data.get("rir")),
        "Session_ID": str(data.get("session_id", "")).strip(),
        "Client_Request_ID": client_request_id,
    }

    headers = _ensure_optional_log_headers()
    row = [values.get(header, "") for header in headers]
    sheet, _ = _worksheets()
    sheet.append_row(row, value_input_option="USER_ENTERED")
    _invalidate_log_cache()
    row_number = len(sheet.col_values(1))
    return {
        "status": "success",
        "row_number": row_number,
        "request_id": client_request_id,
    }


def _locate_log_row(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    request_id = str(
        data.get("client_request_id") or data.get("request_id") or data.get("row_number") or ""
    ).strip()
    exercise_id = str(data.get("exercise_id", "")).strip()
    set_group_id = str(data.get("set_group_id") or data.get("session_id") or "").strip()
    order = _to_int(data.get("order"))
    return _find_existing_request(
        _log_records(force=True),
        request_id,
        exercise_id,
        set_group_id,
        order,
    )


def update_set(data: Dict[str, Any]) -> bool:
    record = _locate_log_row(data)
    if not record:
        return False
    sheet, _ = _worksheets()
    headers = [str(value).strip() for value in sheet.row_values(1)]
    row_number = int(record["_row_number"])
    updates = {
        "Input_Weight": data.get("input_weight"),
        "Total_Weight": data.get("weight"),
        "Reps": data.get("reps"),
        "Rest": data.get("rest"),
        "Note": data.get("note"),
        "Set_Type": data.get("set_type"),
        "RPE": data.get("rpe"),
        "RIR": data.get("rir"),
    }
    cells = []
    for header, value in updates.items():
        if value is not None and header in headers:
            cells.append(gspread.Cell(row_number, headers.index(header) + 1, value))
    if cells:
        sheet.update_cells(cells, value_input_option="USER_ENTERED")
        _invalidate_log_cache()
    return True


def delete_set(data: Dict[str, Any]) -> bool:
    record = _locate_log_row(data)
    if not record:
        return False
    sheet, _ = _worksheets()
    sheet.delete_rows(int(record["_row_number"]))
    _invalidate_log_cache()
    return True


def delete_workout(date_text: str) -> int:
    """Удаляет все строки LOG за указанную дату (часть до запятой в Date)."""
    date_text = str(date_text or "").strip()
    if not date_text:
        return 0
    rows = [
        int(record["_row_number"])
        for record in _log_records(force=True)
        if str(record.get("Date", "")).split(",")[0].strip() == date_text
    ]
    if not rows:
        return 0
    sheet, _ = _worksheets()
    requests = [
        {
            "deleteDimension": {
                "range": {
                    "sheetId": sheet.id,
                    "dimension": "ROWS",
                    "startIndex": row_number - 1,
                    "endIndex": row_number,
                }
            }
        }
        for row_number in sorted(rows, reverse=True)
    ]
    sheet.spreadsheet.batch_update({"requests": requests})
    _invalidate_log_cache()
    return len(rows)


def export_data() -> Dict[str, Any]:
    """Полный слепок таблицы: сырые значения листов с заголовками."""
    log_sheet, exercises_sheet = _worksheets()
    return {
        "format": "gymapp-backup-v1",
        "exported_at": datetime.now(MOSCOW_TZ).isoformat(),
        "exercises": exercises_sheet.get_all_values(),
        "log": log_sheet.get_all_values(),
    }


def _log_fingerprint(get) -> str:
    return "|".join([get("Date"), get("Exercise_ID"), get("Set_Group_ID"), get("Order"), get("Reps")])


def import_data(data: Dict[str, Any]) -> Dict[str, Any]:
    """Импорт слепка export_data: упражнения сливаются по ID, подходы
    добавляются только новые (по Client_Request_ID или натуральному ключу)."""
    result = {"exercises_added": 0, "exercises_updated": 0, "log_added": 0, "log_skipped": 0}
    log_sheet, exercises_sheet = _worksheets()

    ex_values = data.get("exercises") or []
    if isinstance(ex_values, list) and len(ex_values) > 1:
        in_headers = [str(header).strip() for header in ex_values[0]]
        in_map = {header: index for index, header in enumerate(in_headers)}
        existing = exercises_sheet.get_all_values()
        headers = [str(header).strip() for header in existing[0]]
        id_index = headers.index("ID") if "ID" in headers else 0
        row_by_id = {
            str(row[id_index]).strip(): index
            for index, row in enumerate(existing[1:], start=2)
            if len(row) > id_index and str(row[id_index]).strip()
        }
        cells = []
        appends = []
        for row in ex_values[1:]:
            def get_ex(header: str, row=row) -> str:
                index = in_map.get(header)
                return str(row[index]).strip() if index is not None and index < len(row) else ""

            exercise_id = get_ex("ID")
            if not exercise_id:
                continue
            aligned = [get_ex(header) for header in headers]
            if exercise_id in row_by_id:
                row_number = row_by_id[exercise_id]
                cells.extend(
                    gspread.Cell(row_number, column + 1, aligned[column])
                    for column in range(len(headers))
                )
                result["exercises_updated"] += 1
            else:
                appends.append(aligned)
        if cells:
            exercises_sheet.update_cells(cells, value_input_option="USER_ENTERED")
        if appends:
            exercises_sheet.append_rows(appends, value_input_option="USER_ENTERED")
            result["exercises_added"] = len(appends)
        _invalidate_exercise_cache()

    log_values = data.get("log") or []
    if isinstance(log_values, list) and len(log_values) > 1:
        in_headers = [str(header).strip() for header in log_values[0]]
        in_map = {header: index for index, header in enumerate(in_headers)}
        headers = _ensure_optional_log_headers()
        existing_records = _log_records(force=True)
        existing_ids = {
            str(record.get("Client_Request_ID", "")).strip()
            for record in existing_records
        } - {""}
        existing_fingerprints = {
            _log_fingerprint(lambda header, record=record: str(record.get(header, "")).strip())
            for record in existing_records
        }
        appends = []
        for row in log_values[1:]:
            def get_log(header: str, row=row) -> str:
                index = in_map.get(header)
                return str(row[index]).strip() if index is not None and index < len(row) else ""

            if not get_log("Date") or not get_log("Exercise_ID"):
                continue
            request_id = get_log("Client_Request_ID")
            fingerprint = _log_fingerprint(get_log)
            if (request_id and request_id in existing_ids) or fingerprint in existing_fingerprints:
                result["log_skipped"] += 1
                continue
            aligned = [get_log(header) for header in headers]
            if "Client_Request_ID" in headers and not request_id:
                aligned[headers.index("Client_Request_ID")] = str(uuid.uuid4())
            appends.append(aligned)
            existing_fingerprints.add(fingerprint)
            if request_id:
                existing_ids.add(request_id)
        if appends:
            log_sheet.append_rows(appends, value_input_option="USER_ENTERED")
            result["log_added"] = len(appends)
        _invalidate_log_cache()

    return result


def create_exercise(name: str, group: str) -> Dict[str, Any]:
    _, sheet = _worksheets()
    headers = [str(value).strip() for value in sheet.row_values(1)]
    exercise_id = str(uuid.uuid4())
    values = {
        "ID": exercise_id,
        "Name": name.strip(),
        "Muscle Group": group.strip(),
        "Description": "",
        "Image_URL": "",
        "Image_URL2": "",
        "Weight_Type": "Machine",
        "Base_Wt": 0,
        "Multiplier": 1,
    }
    sheet.append_row([values.get(header, "") for header in headers], value_input_option="USER_ENTERED")
    _invalidate_exercise_cache()
    return _exercise_to_api(values)


def update_exercise(exercise_id: str, updates: Dict[str, Any]) -> bool:
    _, sheet = _worksheets()
    values = sheet.get_all_values()
    if not values:
        return False
    headers = [str(value).strip() for value in values[0]]
    row_number = None
    for index, row in enumerate(values[1:], start=2):
        if row and str(row[0]).strip() == exercise_id:
            row_number = index
            break
    if not row_number:
        return False

    mapping = {
        "name": "Name",
        "muscleGroup": "Muscle Group",
        "description": "Description",
        "imageUrl": "Image_URL",
        "imageUrl2": "Image_URL2",
        "weightType": "Weight_Type",
        "baseWeight": "Base_Wt",
        "weightMultiplier": "Multiplier",
    }
    cells = []
    for api_name, sheet_name in mapping.items():
        if api_name in updates and sheet_name in headers:
            value = updates[api_name]
            if api_name == "imageUrl" and str(value).startswith("data:"):
                continue
            cells.append(gspread.Cell(row_number, headers.index(sheet_name) + 1, value))
    if cells:
        sheet.update_cells(cells, value_input_option="USER_ENTERED")
        _invalidate_exercise_cache()
    return True


def get_global_history(limit_rows: int = 3000) -> List[Dict[str, Any]]:
    records = _log_records()[-limit_rows:]
    by_id, _ = _exercise_maps()
    days: Dict[str, Dict[str, Any]] = {}
    for record in records:
        exercise_id = str(record.get("Exercise_ID", "")).strip()
        exercise = by_id.get(exercise_id, {})
        date = str(record.get("Date", "")).split(",")[0].strip()
        if not date:
            continue
        day = days.setdefault(
            date,
            {"date": date, "muscleGroups": set(), "groups": {}, "rowCount": 0},
        )
        muscle = str(exercise.get("Muscle Group", "")).strip()
        if muscle:
            day["muscleGroups"].add(muscle)
        set_group_id = str(record.get("Set_Group_ID", "")).strip()
        key = (exercise_id, set_group_id)
        block = day["groups"].setdefault(
            key,
            {
                "name": str(record.get("Exercise_Name_Calc", "")).strip()
                or str(exercise.get("Name", "")).strip(),
                "exerciseId": exercise_id,
                "setGroupId": set_group_id,
                "sets": [],
            },
        )
        block["sets"].append(_record_to_set(record))
        day["rowCount"] += 1

    result = []
    for date in sorted(days, key=_parse_date, reverse=True):
        day = days[date]
        blocks = list(day["groups"].values())
        group_counts: Dict[str, int] = {}
        for block in blocks:
            group_id = block["setGroupId"]
            if group_id:
                group_counts[group_id] = group_counts.get(group_id, 0) + 1
        exercises = []
        for block in blocks:
            group_id = block["setGroupId"]
            exercises.append(
                {
                    "name": block["name"],
                    "exerciseId": block["exerciseId"],
                    "supersetId": group_id if group_id and group_counts.get(group_id, 0) > 1 else None,
                    "sets": sorted(block["sets"], key=lambda item: item.get("order", 0)),
                }
            )
        exercises.sort(
            key=lambda block: min(
                (item.get("order", 0) for item in block["sets"]),
                default=0,
            )
        )
        result.append(
            {
                "id": date,
                "date": date,
                "muscleGroups": sorted(day["muscleGroups"], key=str.casefold),
                "duration": f"{day['rowCount'] * 2}м",
                "exercises": exercises,
            }
        )
    return result


def get_analytics(days: int = 14) -> Dict[str, Any]:
    cutoff = datetime.now(MOSCOW_TZ) - timedelta(days=max(1, min(days, 365)))
    by_id, _ = _exercise_maps()
    volume = 0.0
    muscle_volume: Dict[str, float] = {}
    muscle_sets: Dict[str, int] = {}
    for record in _log_records():
        if _parse_date(record.get("Date")) < cutoff:
            continue
        set_type = str(record.get("Set_Type", "")).strip().lower()
        if set_type and set_type != "working":
            continue
        weight = _to_float(record.get("Total_Weight"))
        if weight == 0:
            weight = _to_float(record.get("Real_Load_Kg"))
        reps = _to_int(record.get("Reps"))
        load = weight * reps
        volume += load
        exercise = by_id.get(str(record.get("Exercise_ID", "")).strip(), {})
        muscle = str(exercise.get("Muscle Group", "")).strip() or "Другое"
        muscle_volume[muscle] = muscle_volume.get(muscle, 0.0) + load
        muscle_sets[muscle] = muscle_sets.get(muscle, 0) + 1

    def period_volume(period_days: int) -> float:
        period_cutoff = datetime.now(MOSCOW_TZ) - timedelta(days=period_days)
        total = 0.0
        for item in _log_records():
            if _parse_date(item.get("Date")) < period_cutoff:
                continue
            set_type = str(item.get("Set_Type", "")).strip().lower()
            if set_type and set_type != "working":
                continue
            weight = _to_float(item.get("Total_Weight")) or _to_float(item.get("Real_Load_Kg"))
            total += weight * _to_int(item.get("Reps"))
        return total

    def training_days(period_days: int) -> int:
        period_cutoff = datetime.now(MOSCOW_TZ) - timedelta(days=period_days)
        days_seen = set()
        for item in _log_records():
            stamp = _parse_date(item.get("Date"))
            if stamp < period_cutoff:
                continue
            set_type = str(item.get("Set_Type", "")).strip().lower()
            if set_type and set_type != "working":
                continue
            days_seen.add(stamp.date())
        return len(days_seen)

    acute = period_volume(7)
    chronic = period_volume(28) / 4.0
    ratio = acute / chronic if chronic else 0.0
    # ACWR не показателен без накопленной базы: после перерыва хроническая
    # нагрузка занижена и коэффициент взлетает при любой тренировке.
    days_28 = training_days(28)
    if days_28 < 8:
        status = "building"
    elif ratio < 0.8:
        status = "under"
    elif ratio > 1.5:
        status = "danger"
    else:
        status = "optimal"
    return {
        "proposals": [],
        "baseline": {},
        "volume": round(volume, 1),
        "acwr": {
            "acute": round(acute, 1),
            "chronic": round(chronic, 1),
            "ratio": round(ratio, 2),
            "status": status,
            "trainingDays": days_28,
        },
        "muscleVolume": {key: round(value, 1) for key, value in muscle_volume.items()},
        "muscleSets": muscle_sets,
    }
