import copy
import json
import unittest
from unittest.mock import patch

import index
import test_index as api_tests
import test_supabase_store as store_tests
from test_supabase_store import USER_ID, REQUEST_1, REQUEST_2


class WorkoutFlowTests(unittest.TestCase):
    setUp = store_tests.SupabaseStoreTests.setUp
    payload = staticmethod(store_tests.SupabaseStoreTests.payload)

    def command(self, **changes):
        return {"session_id": REQUEST_2, "started_at": "2026-08-22T09:00:00+03:00", "location": "home", **changes}

    def test_start_finish_retries_and_late_start_do_not_create_duplicates_or_erase_duration(self):
        start = self.command()
        first = self.store.save_session(USER_ID, start)
        self.store.save_session(USER_ID, start)
        self.store.save_set(USER_ID, self.payload(session_id=REQUEST_2))
        finish = self.command(ended_at="2026-08-22T10:00:00+03:00")
        self.store.save_session(USER_ID, finish)
        self.store.save_session(USER_ID, finish)
        self.store.save_session(USER_ID, start)
        self.assertEqual(len(self.client.tables["gym_workout_sessions"]), 1)
        history = self.store.get_global_history(USER_ID)[0]
        self.assertEqual(history["id"], first["session_id"])
        self.assertEqual(history["clientSessionId"], REQUEST_2)
        self.assertEqual((history["location"], history["duration"]), ("home", "60м"))
        self.assertEqual(len(history["exercises"][0]["sets"]), 1)

    def test_repeat_checks_ownership_and_preserves_original_data(self):
        self.store.save_set(USER_ID, self.payload())
        source = copy.deepcopy(self.client.tables["gym_workout_sessions"][0])
        old_set = copy.deepcopy(self.client.tables["gym_sets"][0])
        result = self.store.save_session(USER_ID, self.command(repeated_from_session_id=source["id"]))
        new = next(s for s in self.client.tables["gym_workout_sessions"] if s["id"] == result["session_id"])
        self.assertEqual(new["source_payload"]["repeated_from_session_id"], source["id"])
        self.assertEqual(self.client.tables["gym_workout_sessions"][0], source)
        self.assertEqual(self.client.tables["gym_sets"][0], old_set)
        before = copy.deepcopy(self.client.tables)
        with self.assertRaises(ValueError):
            self.store.save_session(REQUEST_1, self.command(repeated_from_session_id=source["id"]))
        self.assertEqual(self.client.tables, before)

    def test_repeat_of_an_offline_local_session_resolves_the_owned_client_reference(self):
        source = self.store.save_session(USER_ID, self.command())
        result = self.store.save_session(USER_ID, self.command(session_id=REQUEST_1, repeated_from_session_id=REQUEST_2))
        new = next(s for s in self.client.tables["gym_workout_sessions"] if s["id"] == result["session_id"])
        self.assertEqual(new["source_payload"]["repeated_from_session_id"], source["session_id"])

    def test_location_edit_survives_set_writes_and_start_retries(self):
        first = self.store.save_session(USER_ID, self.command())
        self.store.save_session(USER_ID, self.command(location="other", location_update=True))
        self.store.save_session(USER_ID, self.command())
        self.store.save_set(USER_ID, {**self.payload(session_id=REQUEST_2), "location": "gym"})
        self.assertEqual(self.client.tables["gym_workout_sessions"][0]["location"], "other")
        self.store.update_session(USER_ID, {"session_id": first["session_id"], "location": "gym"})
        self.store.save_session(USER_ID, self.command())
        self.assertEqual(self.client.tables["gym_workout_sessions"][0]["location"], "gym")

    def test_long_resumed_session_keeps_actual_span_without_changing_schema_or_clipping(self):
        self.store.save_session(USER_ID, self.command(started_at="2026-08-20T09:00:00+03:00"))
        self.store.save_set(USER_ID, self.payload(session_id=REQUEST_2))
        self.store.save_session(USER_ID, self.command(started_at="2026-08-20T09:00:00+03:00", ended_at="2026-08-22T10:00:00+03:00"))
        session = self.client.tables["gym_workout_sessions"][0]
        self.assertIsNone(session["duration_minutes"])
        self.assertEqual(session["source_payload"]["elapsed_seconds"], 49 * 3600)
        self.assertEqual(self.store.get_global_history(USER_ID)[0]["duration"], "2940м")

    def test_invalid_session_commands_do_not_write(self):
        for data in (self.command(session_id="bad"), self.command(started_at="2027-01-01T00:00:00Z"),
                     self.command(ended_at="2026-08-22T08:59:00+03:00"), self.command(location="park"),
                     self.command(repeated_from_session_id=REQUEST_1)):
            with self.assertRaises(ValueError):
                self.store.save_session(USER_ID, data)
        self.assertEqual(self.client.tables["gym_workout_sessions"], [])

    def test_completed_session_does_not_accept_a_different_start_or_finish(self):
        command = self.command(ended_at="2026-08-22T10:00:00+03:00")
        self.store.save_session(USER_ID, command)
        before = copy.deepcopy(self.client.tables)
        for changes in ({"started_at": "2026-08-22T08:00:00+03:00"}, {"ended_at": "2026-08-22T09:59:00+03:00"}):
            with self.assertRaises(ValueError):
                self.store.save_session(USER_ID, {**command, **changes})
        self.assertEqual(self.client.tables, before)

    def test_timing_and_v2_input_rules_survive_save_retry_edit_and_both_history_apis(self):
        data = {**self.payload(), "input_weight": 60, "weight": 60,
                "load": {"v": 2, "type": "Barbell", "mult": 2, "base": 20, "inputMode": "total"},
                "timing": {"started_at": "2026-08-22T09:59:15+03:00", "ended_at": "2026-08-22T10:00:00+03:00", "duration_seconds": 999, "rest_before_seconds": 120}}
        self.assertEqual(self.store.save_set(USER_ID, data)["status"], "success")
        self.assertTrue(self.store.save_set(USER_ID, data)["deduplicated"])
        self.store.update_set(USER_ID, {"client_request_id": data["client_request_id"], "reps": 11})
        for row in (self.store.get_global_history(USER_ID)[0]["exercises"][0]["sets"][0],
                    self.store.get_exercise_history(USER_ID, "legacy-exercise")["history"][0]["sets"][0]):
            self.assertEqual(row["timing"]["duration_seconds"], 45)
            self.assertEqual(row["timing"]["rest_before_seconds"], 120)
            self.assertEqual(row["load"]["inputMode"], "total")
            self.assertEqual((row["input_weight"], row["weight"]), (60, 60))
        self.store.update_set(USER_ID, {"client_request_id": data["client_request_id"], "timing": None})
        self.assertNotIn("timing", self.store.get_global_history(USER_ID)[0]["exercises"][0]["sets"][0])

    def test_retry_can_add_timing_without_changing_set_identity(self):
        self.store.save_set(USER_ID, self.payload())
        timed = {**self.payload(), "timing": {"started_at": "2026-08-22T09:59:30+03:00", "ended_at": "2026-08-22T10:00:00+03:00"}}
        self.store.save_set(USER_ID, timed)
        self.assertEqual(len(self.client.tables["gym_sets"]), 1)
        self.assertEqual(self.client.tables["gym_sets"][0]["source_payload"]["timing"]["duration_seconds"], 30)

    def test_v2_rules_are_readable_by_old_clients_and_server_does_not_double_a_total(self):
        data = {**self.payload(), "input_weight": 60, "weight": 140,
                "load": {"v": 2, "type": "Barbell", "mult": 2, "base": 20, "inputMode": "total"}}
        self.store.save_set(USER_ID, data)
        row = self.store.get_global_history(USER_ID)[0]["exercises"][0]["sets"][0]
        self.assertEqual(row["weight"], 60)
        rules = row["load"]
        self.assertEqual(row["input_weight"] * rules["mult"] + rules["base"], 60)
        self.assertEqual(rules["equipmentBase"], 20)
        self.store.update_set(USER_ID, {"client_request_id": data["client_request_id"], "input_weight": 65, "weight": 150})
        self.assertEqual(self.client.tables["gym_sets"][0]["total_weight_kg"], 65)

    def test_no_start_leaves_duration_unknown(self):
        self.store.save_set(USER_ID, {**self.payload(), "timing": {"ended_at": "2026-08-22T10:00:00+03:00"}})
        timing = self.store.get_global_history(USER_ID)[0]["exercises"][0]["sets"][0]["timing"]
        self.assertNotIn("duration_seconds", timing)
        self.assertNotIn("rest_before_seconds", timing)

    def test_invalid_timing_or_input_mode_rejected_before_any_session_or_group_write(self):
        for timing in ([], {"ended_at": "2026-08-22T10:00:00+03:00", "duration_seconds": 45},
                       {"ended_at": "2026-08-22T10:00:00+03:00", "started_at": "2026-08-22T10:01:00+03:00"},
                       {"ended_at": "2027-01-01T10:00:00+03:00"}):
            self.assertEqual(self.store.save_set(USER_ID, {**self.payload(), "timing": timing})["status"], "error")
        self.assertEqual(self.store.save_set(USER_ID, {**self.payload(), "load": {"type": "Machine", "inputMode": "total"}})["status"], "error")
        self.assertEqual(self.client.tables["gym_workout_sessions"], [])
        self.assertEqual(self.client.tables["gym_sets"], [])


class WorkoutFlowApiTests(unittest.TestCase):
    def test_session_owner_is_server_resolved_and_bad_commands_answer_400(self):
        helper = api_tests.HandlerTests()
        data = {"session_id": REQUEST_2, "started_at": "2026-08-22T09:00:00Z", "user_id": "forged"}
        with helper.auth(), patch.object(index, "save_session", return_value={"status": "success"}) as save:
            result = index.handler(helper.event("POST", "/api/save_session", data), None)
        self.assertEqual(result["statusCode"], 200)
        save.assert_called_once_with(USER_ID, data)
        with helper.auth(), patch.object(index, "save_session", side_effect=ValueError("invalid interval")):
            result = index.handler(helper.event("POST", "/api/save_session", data), None)
        self.assertEqual(result["statusCode"], 400)
