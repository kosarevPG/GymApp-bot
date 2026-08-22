import copy
import json
import unittest
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from supabase_store import SupabaseRestClient, SupabaseStore


USER_ID = "11111111-1111-4111-8111-111111111111"
EXERCISE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
REQUEST_1 = "22222222-2222-4222-8222-222222222222"
REQUEST_2 = "33333333-3333-4333-8333-333333333333"


class MemoryClient:
    def __init__(self):
        self.tables = {
            "gym_exercises": [], "gym_workout_sessions": [],
            "gym_set_groups": [], "gym_sets": [],
        }

    @staticmethod
    def _same(left, right):
        if isinstance(left, bool):
            return str(left).lower() == str(right).lower()
        return str(left) == str(right)

    def select(self, table, *, columns="*", filters=None, order="", limit=None):
        del columns, order
        rows = [copy.deepcopy(row) for row in self.tables[table]]
        for key, value in (filters or {}).items():
            if str(value).startswith("eq."):
                value = str(value)[3:]
            rows = [row for row in rows if self._same(row.get(key), value)]
        return rows[:limit] if limit is not None else rows

    def upsert(self, table, row, *, on_conflict):
        keys = on_conflict.split(",")
        for existing in self.tables[table]:
            if all(self._same(existing.get(key), row.get(key)) for key in keys):
                existing.update(copy.deepcopy(row))
                return [copy.deepcopy(existing)]
        stored = copy.deepcopy(row)
        self.tables[table].append(stored)
        return [copy.deepcopy(stored)]

    def update(self, table, values, *, filters):
        changed = []
        for row in self.tables[table]:
            if all(self._same(row.get(key), value) for key, value in filters.items()):
                row.update(copy.deepcopy(values))
                changed.append(copy.deepcopy(row))
        return changed

    def delete(self, table, *, filters):
        removed = []
        kept = []
        for row in self.tables[table]:
            if all(self._same(row.get(key), value) for key, value in filters.items()):
                removed.append(copy.deepcopy(row))
            else:
                kept.append(row)
        self.tables[table] = kept
        return removed


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    @staticmethod
    def read():
        return json.dumps([]).encode()


class SupabaseRestClientTests(unittest.TestCase):
    def test_new_secret_key_is_sent_only_as_apikey(self):
        client = SupabaseRestClient("https://example.supabase.co", "sb_secret_example")
        with patch("supabase_store.urlopen", return_value=FakeResponse()) as send:
            client.select("gym_sets", filters={"user_id": USER_ID})
        headers = dict(send.call_args.args[0].header_items())
        self.assertEqual(headers["Apikey"], "sb_secret_example")
        self.assertNotIn("Authorization", headers)

    def test_legacy_service_role_jwt_also_uses_bearer_header(self):
        key = "header.payload.signature"
        client = SupabaseRestClient("https://example.supabase.co", key)
        with patch("supabase_store.urlopen", return_value=FakeResponse()) as send:
            client.select("gym_sets", filters={"user_id": USER_ID})
        headers = dict(send.call_args.args[0].header_items())
        self.assertEqual(headers["Apikey"], key)
        self.assertEqual(headers["Authorization"], f"Bearer {key}")


class SupabaseStoreTests(unittest.TestCase):
    def setUp(self):
        self.client = MemoryClient()
        self.client.tables["gym_exercises"].append({
            "id": EXERCISE_ID, "user_id": USER_ID, "source": "gymapp",
            "source_key": "legacy-exercise", "name_ru": "Жим",
            "muscle_group": "Грудь", "weight_type": "Machine",
            "base_weight_kg": 0, "multiplier": 1, "tonnage_mode": "external_load",
            "technique_note": "Лопатки сведены", "is_active": True, "source_payload": {},
        })
        self.current = datetime(2026, 8, 22, 10, 0, tzinfo=ZoneInfo("Europe/Moscow"))
        self.store = SupabaseStore(self.client, now=lambda: self.current)

    @staticmethod
    def payload(request_id=REQUEST_1, session_id="session-morning", weight=40):
        return {
            "exercise_id": "legacy-exercise", "input_weight": 20, "weight": weight,
            "reps": 10, "rest": 1.5, "set_group_id": f"group-{session_id}",
            "session_id": session_id, "order": 1, "set_type": "working",
            "client_request_id": request_id,
        }

    def test_save_and_retry_are_idempotent(self):
        first = self.store.save_set(USER_ID, self.payload())
        second = self.store.save_set(USER_ID, self.payload())
        self.assertEqual(first["status"], "success")
        self.assertTrue(second["deduplicated"])
        self.assertEqual(len(self.client.tables["gym_sets"]), 1)
        self.assertEqual(self.client.tables["gym_sets"][0]["client_request_id"], REQUEST_1)

    def test_update_then_delete_by_stable_request_id(self):
        self.store.save_set(USER_ID, self.payload())
        self.assertTrue(self.store.update_set(USER_ID, {
            "client_request_id": REQUEST_1, "weight": 45, "reps": 8, "rest": 2,
        }))
        row = self.client.tables["gym_sets"][0]
        self.assertEqual(row["total_weight_kg"], 45)
        self.assertEqual(row["reps"], 8)
        self.assertEqual(row["rest_seconds"], 120)
        self.assertTrue(self.store.delete_set(USER_ID, {"client_request_id": REQUEST_1}))
        self.assertEqual(self.client.tables["gym_sets"], [])

    def test_history_uses_technique_note_and_client_request_id(self):
        self.store.save_set(USER_ID, self.payload())
        result = self.store.get_exercise_history(USER_ID, "legacy-exercise")
        self.assertEqual(result["note"], "Лопатки сведены")
        self.assertEqual(result["history"][0]["date"], "2026.08.22")
        self.assertEqual(result["history"][0]["sets"][0]["id"], REQUEST_1)
        self.assertEqual(result["history"][0]["sets"][0]["rest"], 1.5)

    def test_two_workouts_on_same_day_remain_distinct(self):
        self.store.save_set(USER_ID, self.payload(REQUEST_1, "session-morning", 40))
        self.current = datetime(2026, 8, 22, 20, 0, tzinfo=ZoneInfo("Europe/Moscow"))
        self.store.save_set(USER_ID, self.payload(REQUEST_2, "session-evening", 50))
        history = self.store.get_global_history(USER_ID)
        self.assertEqual(len(history), 2)
        self.assertEqual({row["date"] for row in history}, {"2026.08.22"})
        self.assertEqual(len({row["id"] for row in history}), 2)
        self.assertEqual(
            {row["exercises"][0]["sets"][0]["id"] for row in history},
            {REQUEST_1, REQUEST_2},
        )

    def test_delete_workout_removes_both_sessions_for_api_date(self):
        self.store.save_set(USER_ID, self.payload(REQUEST_1, "session-morning"))
        self.store.save_set(USER_ID, self.payload(REQUEST_2, "session-evening"))
        self.assertEqual(self.store.delete_workout(USER_ID, "2026.08.22"), 2)
        self.assertEqual(self.store.get_global_history(USER_ID), [])

    def test_delete_workout_can_target_one_of_two_same_day_sessions(self):
        self.store.save_set(USER_ID, self.payload(REQUEST_1, "session-morning"))
        self.store.save_set(USER_ID, self.payload(REQUEST_2, "session-evening"))
        history = self.store.get_global_history(USER_ID)
        morning = next(
            row for row in history
            if row["exercises"][0]["sets"][0]["id"] == REQUEST_1
        )
        self.assertEqual(
            self.store.delete_workout(USER_ID, "2026.08.22", morning["id"]), 1
        )
        remaining = self.store.get_global_history(USER_ID)
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]["exercises"][0]["sets"][0]["id"], REQUEST_2)


if __name__ == "__main__":
    unittest.main()
