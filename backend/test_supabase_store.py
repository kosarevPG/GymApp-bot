import copy
import json
import unittest
import uuid
from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

from supabase_store import ConflictError, SupabaseRestClient, SupabaseStore


USER_ID = "11111111-1111-4111-8111-111111111111"
EXERCISE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
REQUEST_1 = "22222222-2222-4222-8222-222222222222"
REQUEST_2 = "33333333-3333-4333-8333-333333333333"


class MemoryClient:
    def __init__(self, max_page_size=2):
        self.max_page_size = max_page_size
        self.select_calls = []
        self.delete_calls = []
        self.tables = {
            "gym_exercises": [], "gym_workout_sessions": [],
            "gym_set_groups": [], "gym_sets": [],
        }

    @staticmethod
    def _same(left, right):
        if isinstance(left, bool):
            return str(left).lower() == str(right).lower()
        return str(left) == str(right)

    def select(self, table, *, columns="*", filters=None, order="", limit=None, offset=0):
        del columns
        self.select_calls.append((table, offset, limit))
        rows = [copy.deepcopy(row) for row in self.tables[table]]
        for key, value in (filters or {}).items():
            if str(value).startswith("eq."):
                value = str(value)[3:]
            rows = [row for row in rows if self._same(row.get(key), value)]
        if order:
            column, _, direction = order.partition(".")
            rows.sort(key=lambda row: str(row.get(column) or ""), reverse=direction == "desc")
        page_size = min(limit or self.max_page_size, self.max_page_size)
        return rows[offset:offset + page_size]

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
        self.delete_calls.append((table, copy.deepcopy(filters)))
        removed = []
        kept = []
        for row in self.tables[table]:
            if all(self._same(row.get(key), value) for key, value in filters.items()):
                removed.append(copy.deepcopy(row))
            else:
                kept.append(row)
        self.tables[table] = kept
        if table == "gym_workout_sessions" and removed:
            session_ids = {row["id"] for row in removed}
            self.tables["gym_sets"] = [
                row for row in self.tables["gym_sets"] if row.get("session_id") not in session_ids
            ]
            self.tables["gym_set_groups"] = [
                row for row in self.tables["gym_set_groups"] if row.get("session_id") not in session_ids
            ]
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
    def payload(
        request_id=REQUEST_1,
        session_id="session-morning",
        weight=40,
        performed_at="2026-08-22T10:00:00+03:00",
    ):
        return {
            "exercise_id": "legacy-exercise", "input_weight": 20, "weight": weight,
            "reps": 10, "rest": 1.5, "set_group_id": f"group-{session_id}",
            "session_id": session_id, "order": 1, "set_type": "working",
            "client_request_id": request_id,
            "performed_at": performed_at,
        }

    def test_save_and_retry_are_idempotent(self):
        first = self.store.save_set(USER_ID, self.payload())
        second = self.store.save_set(USER_ID, self.payload())
        self.assertEqual(first["status"], "success")
        self.assertTrue(second["deduplicated"])
        self.assertEqual(len(self.client.tables["gym_sets"]), 1)
        self.assertEqual(self.client.tables["gym_sets"][0]["client_request_id"], REQUEST_1)

    def test_performed_at_requires_timezone_and_is_stable_per_request(self):
        invalid = self.payload(performed_at="2026-08-22T10:00:00")
        self.assertEqual(self.store.save_set(USER_ID, invalid)["status"], "error")
        self.assertEqual(self.client.tables["gym_sets"], [])

        self.assertEqual(self.store.save_set(USER_ID, self.payload())["status"], "success")
        changed_time = self.payload(performed_at="2026-08-22T09:00:00+03:00")
        result = self.store.save_set(USER_ID, changed_time)
        self.assertEqual(result["status"], "error")
        self.assertIn("does not match", result["error"])

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
        self.assertTrue(result["history"][0]["session_id"])
        self.assertEqual(result["history"][0]["sets"][0]["id"], REQUEST_1)
        self.assertEqual(result["history"][0]["sets"][0]["rest"], 1.5)

    def test_two_identical_workouts_on_same_day_remain_distinct(self):
        self.store.save_set(USER_ID, self.payload(REQUEST_1, "session-morning", 40))
        self.current = datetime(2026, 8, 22, 20, 0, tzinfo=ZoneInfo("Europe/Moscow"))
        self.store.save_set(USER_ID, self.payload(
            REQUEST_2, "session-evening", 40, "2026-08-22T20:00:00+03:00"
        ))
        history = self.store.get_global_history(USER_ID)
        self.assertEqual(len(history), 2)
        self.assertEqual({row["date"] for row in history}, {"2026.08.22"})
        self.assertEqual(len({row["id"] for row in history}), 2)
        self.assertEqual(
            {row["exercises"][0]["sets"][0]["id"] for row in history},
            {REQUEST_1, REQUEST_2},
        )
        exercise_history = self.store.get_exercise_history(USER_ID, "legacy-exercise")
        self.assertEqual(len(exercise_history["history"]), 2)
        self.assertEqual(
            len({group["session_id"] for group in exercise_history["history"]}), 2
        )
        self.assertEqual(
            {group["date"] for group in exercise_history["history"]}, {"2026.08.22"}
        )

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
        self.assertEqual(
            self.client.delete_calls,
            [("gym_workout_sessions", {"user_id": USER_ID, "id": morning["id"]})],
        )

    def test_date_only_delete_is_ambiguous_for_two_sessions(self):
        self.store.save_set(USER_ID, self.payload(REQUEST_1, "session-morning"))
        self.store.save_set(USER_ID, self.payload(REQUEST_2, "session-evening"))
        with self.assertRaises(ConflictError):
            self.store.delete_workout(USER_ID, "2026.08.22")
        self.assertEqual(self.client.delete_calls, [])
        self.assertEqual(len(self.store.get_global_history(USER_ID)), 2)

    def test_date_only_delete_is_allowed_for_one_session(self):
        self.store.save_set(USER_ID, self.payload())
        session_id = self.client.tables["gym_workout_sessions"][0]["id"]
        self.assertEqual(self.store.delete_workout(USER_ID, "2026.08.22"), 1)
        self.assertEqual(
            self.client.delete_calls,
            [("gym_workout_sessions", {"user_id": USER_ID, "id": session_id})],
        )
        self.assertEqual(self.client.tables["gym_sets"], [])

    def test_offline_sync_next_day_preserves_actual_time_and_date(self):
        self.current = datetime(2026, 8, 24, 9, 0, tzinfo=ZoneInfo("Europe/Moscow"))
        payload = self.payload(
            REQUEST_1,
            "offline-session",
            performed_at="2026-08-22T22:30:00Z",
        )
        first = self.store.save_set(USER_ID, payload)
        session = self.client.tables["gym_workout_sessions"][0]
        stored_set = self.client.tables["gym_sets"][0]
        self.assertEqual(first["status"], "success")
        self.assertEqual(session["workout_date"], "2026-08-23")
        self.assertEqual(session["started_at"], "2026-08-23T01:30:00+03:00")
        self.assertEqual(session["ended_at"], "2026-08-23T01:30:00+03:00")
        self.assertEqual(stored_set["performed_at"], "2026-08-23T01:30:00+03:00")

        self.current = datetime(2026, 8, 25, 9, 0, tzinfo=ZoneInfo("Europe/Moscow"))
        retry = self.store.save_set(USER_ID, payload)
        self.assertTrue(retry["deduplicated"])
        self.assertEqual(self.client.tables["gym_workout_sessions"][0], session)
        self.assertEqual(self.client.tables["gym_sets"][0], stored_set)

    def test_session_bounds_use_min_and_max_performed_times(self):
        self.current = datetime(2026, 8, 23, 9, 0, tzinfo=ZoneInfo("Europe/Moscow"))
        later = self.payload(
            REQUEST_1, "bounds-session", performed_at="2026-08-22T20:00:00+03:00"
        )
        earlier = self.payload(
            REQUEST_2, "bounds-session", performed_at="2026-08-22T09:00:00+03:00"
        )
        earlier["order"] = 2
        self.store.save_set(USER_ID, later)
        self.store.save_set(USER_ID, earlier)
        session = self.client.tables["gym_workout_sessions"][0]
        self.assertEqual(session["started_at"], "2026-08-22T09:00:00+03:00")
        self.assertEqual(session["ended_at"], "2026-08-22T20:00:00+03:00")

    def test_history_reads_more_than_1000_sets_through_paginated_client(self):
        session_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        group_id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        self.client.tables["gym_workout_sessions"].append({
            "id": session_id, "user_id": USER_ID, "workout_date": "2026-08-22",
            "started_at": "2026-08-22T10:00:00+03:00", "ended_at": "2026-08-22T12:00:00+03:00",
        })
        self.client.tables["gym_set_groups"].append({
            "id": group_id, "user_id": USER_ID, "session_id": session_id,
            "legacy_group_id": "large-group", "group_type": "single",
        })
        base = datetime(2026, 8, 22, 10, 0, tzinfo=ZoneInfo("Europe/Moscow"))
        for index in range(1005):
            request_id = str(uuid.UUID(int=index + 100))
            self.client.tables["gym_sets"].append({
                "id": str(uuid.UUID(int=index + 2000)), "user_id": USER_ID,
                "session_id": session_id, "set_group_id": group_id,
                "exercise_id": EXERCISE_ID, "client_request_id": request_id,
                "performed_at": (base + timedelta(seconds=index)).isoformat(),
                "position": index + 1, "input_weight_kg": 20,
                "total_weight_kg": 40, "reps": 10, "rest_seconds": 60,
                "set_type": "working", "include_in_tonnage": True,
            })
        result = self.store.get_exercise_history(USER_ID, "legacy-exercise")
        self.assertEqual(len(result["history"]), 1)
        self.assertEqual(len(result["history"][0]["sets"]), 1005)
        set_reads = [call for call in self.client.select_calls if call[0] == "gym_sets"]
        self.assertGreater(len(set_reads), 500)


if __name__ == "__main__":
    unittest.main()


class AnalyticsWorkloadTrendTests(unittest.TestCase):
    """get_analytics must emit workload-trend-v1 and nothing ACWR-shaped."""

    REFERENCE = datetime(2026, 8, 22, 10, 0, tzinfo=ZoneInfo("Europe/Moscow"))

    def setUp(self):
        self.client = MemoryClient(max_page_size=500)
        self.client.tables["gym_exercises"].append({
            "id": EXERCISE_ID, "user_id": USER_ID, "source": "gymapp",
            "source_key": "legacy-exercise", "name_ru": "Жим",
            "muscle_group": "Грудь", "weight_type": "Machine",
            "base_weight_kg": 0, "multiplier": 1, "tonnage_mode": "external_load",
            "technique_note": "", "is_active": True, "source_payload": {},
        })
        self.store = SupabaseStore(self.client, now=lambda: self.REFERENCE)

    def _add_session(self, workout_date, weight, reps=10):
        session_id = f"session-{workout_date}"
        self.client.tables["gym_workout_sessions"].append({
            "id": session_id, "user_id": USER_ID, "workout_date": workout_date,
            "source": "gymapp", "source_record_id": f"{workout_date}:1",
        })
        self.client.tables["gym_sets"].append({
            "id": f"set-{workout_date}", "user_id": USER_ID,
            "session_id": session_id, "exercise_id": EXERCISE_ID,
            "position": 1, "reps": reps, "total_weight_kg": weight,
            "input_weight_kg": weight, "rest_seconds": 90, "set_type": "working",
            "include_in_tonnage": True, "source": "gymapp",
            "source_record_id": f"{workout_date}:1:1",
            "performed_at": f"{workout_date}T10:00:00+03:00",
        })

    def _full_history(self):
        # Baseline window for 2026-08-22 is 2026-07-19..2026-08-15 (offsets 7..34).
        for workout_date in ("2026-07-19", "2026-07-26", "2026-08-02", "2026-08-09"):
            self._add_session(workout_date, 100)  # 100kg x 10 = 1000kg each
        self._add_session("2026-08-18", 148)      # 148kg x 10 = 1480kg, recent window

    def test_emits_workload_trend_and_drops_acwr(self):
        self._full_history()
        analytics = self.store.get_analytics(USER_ID, days=28)
        self.assertNotIn("acwr", analytics)
        trend = analytics["workloadTrend"]
        self.assertEqual(trend["version"], "workload-trend-v1")
        self.assertEqual(trend["status"], "ok")
        self.assertEqual(trend["recentVolumeKg"], 1480)
        self.assertEqual(trend["baselineVolumeKg"], 4000)
        self.assertEqual(trend["baselineWeeklyVolumeKg"], 1000)
        self.assertEqual(trend["deltaPct"], 48)
        self.assertEqual(trend["recentSessions"], 1)
        self.assertEqual(trend["baselineSessions"], 4)
        self.assertEqual(
            trend["text"],
            "Объём последних 7 дней на 48% выше среднего за предыдущие четыре "
            "недели (4 тренировки в базовом периоде).",
        )

    def test_text_carries_no_alarm_vocabulary(self):
        self._full_history()
        text = self.store.get_analytics(USER_ID, days=28)["workloadTrend"]["text"].lower()
        for word in ("риск", "опасн", "оптимальн", "перетрен", "снизьте", "acwr"):
            self.assertNotIn(word, text)

    def test_short_history_reports_insufficient_instead_of_a_ratio(self):
        # Only two weeks of history: the old formula divided by a nearly empty
        # chronic window and produced an alarming ratio out of thin air.
        self._add_session("2026-08-12", 100)
        self._add_session("2026-08-18", 200)
        trend = self.store.get_analytics(USER_ID, days=28)["workloadTrend"]
        self.assertEqual(trend["status"], "insufficient")
        self.assertEqual(trend["reason"], "short-history")
        self.assertIsNone(trend["deltaPct"])
        self.assertEqual(
            trend["text"],
            "Недостаточно данных для сравнения: нужна история за предыдущие "
            "четыре недели.",
        )

    def test_two_sessions_on_one_day_are_summed(self):
        self._full_history()
        session_id = "session-2026-08-18-second"
        self.client.tables["gym_workout_sessions"].append({
            "id": session_id, "user_id": USER_ID, "workout_date": "2026-08-18",
            "source": "gymapp", "source_record_id": "2026-08-18:2",
        })
        self.client.tables["gym_sets"].append({
            "id": "set-second", "user_id": USER_ID, "session_id": session_id,
            "exercise_id": EXERCISE_ID, "position": 1, "reps": 10,
            "total_weight_kg": 52, "input_weight_kg": 52, "rest_seconds": 90,
            "set_type": "working", "include_in_tonnage": True, "source": "gymapp",
            "source_record_id": "2026-08-18:2:1",
            "performed_at": "2026-08-18T18:00:00+03:00",
        })
        trend = self.store.get_analytics(USER_ID, days=28)["workloadTrend"]
        self.assertEqual(trend["recentVolumeKg"], 2000)
        self.assertEqual(trend["recentSessions"], 2)
        self.assertEqual(trend["deltaPct"], 100)


OTHER_USER_ID = "99999999-9999-4999-8999-999999999999"


class WorkoutSessionLookupTests(unittest.TestCase):
    """?session=<uuid> deep link: the owner filter is the access control."""

    SESSION_ID = "e96b22f8-695a-40b0-916a-57f3a33db4f1"
    FOREIGN_SESSION_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

    def setUp(self):
        self.client = MemoryClient(max_page_size=500)
        self.client.tables["gym_exercises"].append({
            "id": EXERCISE_ID, "user_id": USER_ID, "source": "gymapp",
            "source_key": "legacy-exercise", "name_ru": "Жим",
            "muscle_group": "Грудь", "weight_type": "Machine",
            "base_weight_kg": 0, "multiplier": 1, "tonnage_mode": "external_load",
            "technique_note": "", "is_active": True, "source_payload": {},
        })
        self._session(self.SESSION_ID, USER_ID, "2026-08-22")
        self._session(self.FOREIGN_SESSION_ID, OTHER_USER_ID, "2026-08-22")
        self.store = SupabaseStore(
            self.client,
            now=lambda: datetime(2026, 8, 22, 10, 0, tzinfo=ZoneInfo("Europe/Moscow")),
        )

    def _session(self, session_id, user_id, workout_date, with_sets=True):
        self.client.tables["gym_workout_sessions"].append({
            "id": session_id, "user_id": user_id, "workout_date": workout_date,
            "source": "gymapp", "source_record_id": f"{workout_date}:{session_id[:4]}",
        })
        if with_sets:
            self.client.tables["gym_sets"].append({
                "id": f"set-{session_id}", "user_id": user_id, "session_id": session_id,
                "exercise_id": EXERCISE_ID, "position": 1, "reps": 10,
                "total_weight_kg": 40, "input_weight_kg": 20, "rest_seconds": 90,
                "set_type": "working", "include_in_tonnage": True, "source": "gymapp",
                "source_record_id": f"{session_id}:1",
                "performed_at": f"{workout_date}T10:00:00+03:00",
            })

    def test_owner_gets_their_session(self):
        found = self.store.get_workout_session(USER_ID, self.SESSION_ID)
        self.assertIsNotNone(found)
        self.assertEqual(found["id"], self.SESSION_ID)
        self.assertEqual(found["exercises"][0]["name"], "Жим")

    def test_another_users_session_is_indistinguishable_from_missing(self):
        foreign = self.store.get_workout_session(USER_ID, self.FOREIGN_SESSION_ID)
        absent = self.store.get_workout_session(USER_ID, "11111111-2222-4333-8444-555555555555")
        self.assertIsNone(foreign)
        self.assertIsNone(absent)

    def test_owner_filter_is_sent_to_the_backend(self):
        self.client.select_calls.clear()
        self.store.get_workout_session(USER_ID, self.SESSION_ID)
        self.assertTrue(
            any(table == "gym_workout_sessions" for table, _, _ in self.client.select_calls),
            "the session lookup must hit gym_workout_sessions",
        )

    def test_malformed_ids_are_rejected_before_any_query(self):
        self.client.select_calls.clear()
        for bad in ("", "   ", "not-a-uuid", "../etc/passwd", "'; drop table gym_sets; --", None):
            self.assertIsNone(self.store.get_workout_session(USER_ID, bad))
        self.assertEqual(self.client.select_calls, [], "must not query on malformed input")

    def test_owned_session_without_sets_is_still_returned(self):
        empty_id = "cccccccc-dddd-4eee-8fff-000000000000"
        self._session(empty_id, USER_ID, "2026-08-20", with_sets=False)
        found = self.store.get_workout_session(USER_ID, empty_id)
        self.assertIsNotNone(found)
        self.assertEqual(found["id"], empty_id)
        self.assertEqual(found["exercises"], [])
