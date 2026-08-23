"""Live GymApp staging smoke test.

Requires an isolated staging backend and fresh Telegram Mini App initData.
The script never prints initData or authorization headers.
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


API_BASE_URL = required_env("GYMAPP_STAGING_API_BASE_URL")
INIT_DATA = required_env("GYMAPP_STAGING_INIT_DATA")
EXERCISE_ID = required_env("GYMAPP_STAGING_EXERCISE_ID")


def api(endpoint: str, method: str = "GET", body: dict | None = None):
    separator = "&" if "?" in API_BASE_URL else "?"
    url = f"{API_BASE_URL}{separator}{urlencode({'url': f'/api/{endpoint}'})}"
    payload = None if body is None else json.dumps(body).encode("utf-8")
    request = Request(
        url,
        data=payload,
        method=method,
        headers={
            "Content-Type": "application/json",
            "X-Telegram-Init-Data": INIT_DATA,
        },
    )
    try:
        with urlopen(request, timeout=20) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw)
        except json.JSONDecodeError:
            detail = {"error": f"HTTP {error.code}"}
        raise RuntimeError(f"{endpoint} failed with HTTP {error.code}: {detail}") from error


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    run_id = uuid.uuid4()
    client_request_id = str(uuid.uuid5(run_id, "request"))
    client_session_id = f"staging-{uuid.uuid5(run_id, 'session')}"
    performed_at = datetime.now(timezone.utc).isoformat()
    save_payload = {
        "exercise_id": EXERCISE_ID,
        "input_weight": 20,
        "weight": 40,
        "reps": 10,
        "rest": 1.5,
        "set_group_id": f"group-{client_session_id}",
        "session_id": client_session_id,
        "order": 1,
        "set_type": "working",
        "client_request_id": client_request_id,
        "performed_at": performed_at,
    }

    _, saved = api("save_set", "POST", save_payload)
    expect(saved.get("status") == "success", "save_set did not succeed")

    _, retried = api("save_set", "POST", save_payload)
    expect(retried.get("status") == "success", "retry did not succeed")
    expect(retried.get("deduplicated") is True, "retry was not deduplicated")

    _, updated = api(
        "update_set",
        "POST",
        {"client_request_id": client_request_id, "weight": 45, "reps": 8, "rest": 2},
    )
    expect(updated.get("status") == "success", "update_set did not succeed")

    _, exercise_history = api(f"history?exercise_id={EXERCISE_ID}")
    groups = exercise_history.get("history") or []
    matching_groups = [
        group for group in groups
        if any(item.get("id") == client_request_id for item in group.get("sets") or [])
    ]
    expect(len(matching_groups) == 1, "saved set missing or duplicated in exercise history")
    history_group = matching_groups[0]
    matching_set = next(item for item in history_group["sets"] if item.get("id") == client_request_id)
    expect(bool(history_group.get("session_id")), "exercise history omitted session_id")
    expect(matching_set.get("weight") == 45 and matching_set.get("reps") == 8, "update not visible in history")

    _, global_history = api("global_history")
    session = next(
        (row for row in global_history if any(
            item.get("id") == client_request_id
            for exercise in row.get("exercises") or []
            for item in exercise.get("sets") or []
        )),
        None,
    )
    expect(session is not None and bool(session.get("id")), "saved session missing in global history")

    _, deleted = api(
        "delete_workout",
        "POST",
        {"date": session.get("date"), "session_id": session["id"]},
    )
    expect(deleted.get("status") == "success" and deleted.get("deleted") == 1, "target session delete failed")

    _, final_history = api("global_history")
    expect(all(row.get("id") != session["id"] for row in final_history), "deleted session still appears")

    print(json.dumps({
        "status": "PASS",
        "performed_at": performed_at,
        "client_request_id": client_request_id,
        "session_id": session["id"],
        "checks": ["save", "retry", "update", "history", "delete", "final_history"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # sanitized: request credentials are never included
        print(json.dumps({"status": "FAIL", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
