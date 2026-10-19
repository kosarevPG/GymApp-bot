import copy
import unittest
from unittest.mock import patch

import index
import test_index as api_tests
import test_supabase_store as store_tests
from scripts.restore_home_workout_20261012 import build_plan, OWNER

USER_ID = store_tests.USER_ID
REQUEST_2 = store_tests.REQUEST_2


class SessionMetadataTests(unittest.TestCase):
    setUp = store_tests.SupabaseStoreTests.setUp
    payload = staticmethod(store_tests.SupabaseStoreTests.payload)
    def test_location_survives_later_sets_retries_and_saved_session_edits(self):
        payload = {**self.payload(), "location": "home"}
        self.store.save_set(USER_ID, payload)
        session = self.client.tables["gym_workout_sessions"][0]
        self.assertEqual(session["location"], "home")
        self.store.update_session(USER_ID, {"session_id": session["id"], "location": "other",
                                          "duration_minutes": 60, "duration_is_approximate": True})
        self.store.save_set(USER_ID, payload)
        self.store.save_set(USER_ID, {**payload, "client_request_id": REQUEST_2, "order": 2})
        self.assertEqual(len(self.client.tables["gym_workout_sessions"]), 1)
        self.assertEqual(len(self.client.tables["gym_sets"]), 2)
        history = self.store.get_global_history(USER_ID)[0]
        self.assertEqual((history["location"], history["duration"]), ("other", "≈60м"))

    def test_old_client_does_not_backfill_location_and_keeps_duration_estimate(self):
        self.store.save_set(USER_ID, self.payload())
        history = self.store.get_global_history(USER_ID)[0]
        self.assertIsNone(history["location"])
        self.assertEqual(history["duration"], "2м")

    def test_cardio_first_session_keeps_location_after_strength_and_metadata_edit(self):
        store_tests.SupabaseStoreTests.add_treadmill(self)
        payload = {**store_tests.SupabaseStoreTests.segment(),"location":"home"}
        self.assertEqual(self.store.save_cardio(USER_ID,payload)["status"],"success")
        session = self.client.tables["gym_workout_sessions"][0]
        self.store.update_session(USER_ID,{"session_id":session["id"],"location":"other"})
        self.store.save_set(USER_ID,{**self.payload(),"location":"gym"})
        self.store.save_cardio(USER_ID,payload)
        self.assertEqual(self.store.get_global_history(USER_ID)[0]["location"],"other")
        self.assertEqual(len(self.client.tables["gym_workout_sessions"]),1)

    def test_per_arm_load_snapshot_survives_save_and_history(self):
        load = {"v":1,"type":"Dumbbell","mult":2,"base":0,"perSide":True}
        self.store.save_set(USER_ID,{**self.payload(weight=16),"input_weight":8,"reps":12,"load":load})
        row = self.store.get_global_history(USER_ID)[0]["exercises"][0]["sets"][0]
        self.assertEqual(row["load"],load)
        self.assertEqual((row["input_weight"],row["weight"],row["reps"]),(8,16,12))

    def test_date_only_session_sorts_before_older_timed_session_even_with_row_limit(self):
        self.store.save_set(USER_ID,self.payload())
        session = copy.deepcopy(self.client.tables["gym_workout_sessions"][0])
        session.update(id=REQUEST_2,workout_date="2026-08-23",started_at=None,ended_at=None)
        self.client.tables["gym_workout_sessions"].append(session)
        row = copy.deepcopy(self.client.tables["gym_sets"][0])
        row.update(id=REQUEST_2,session_id=REQUEST_2,performed_at=None,client_request_id=REQUEST_2)
        self.client.tables["gym_sets"].append(row)
        history = self.store.get_exercise_history(USER_ID,"legacy-exercise")
        self.assertEqual(history["history"][0]["session_id"],REQUEST_2)
        self.assertEqual(self.store.get_global_history(USER_ID,limit_rows=1)[0]["id"],REQUEST_2)

    def test_metadata_edits_are_owned_and_idempotent(self):
        self.store.save_set(USER_ID, self.payload())
        session = self.client.tables["gym_workout_sessions"][0]
        data = {"session_id": session["id"], "location": "home"}
        before = copy.deepcopy(self.client.tables)
        self.assertFalse(self.store.update_session(REQUEST_2, data))
        self.assertEqual(self.client.tables, before)
        self.assertTrue(self.store.update_session(USER_ID, data))
        self.assertTrue(self.store.update_session(USER_ID, data))
        self.store.update_session(USER_ID, {**data, "location": None})
        self.assertIsNone(session["location"])

    def test_invalid_metadata_does_not_write(self):
        for data in ({"location": "park"}, {"duration_minutes": -1}, {"duration_minutes": "60"},
                     {"duration_minutes": float("nan")}, {"duration_minutes": 1441},
                     {"duration_is_approximate": "yes"}):
            with self.assertRaises(ValueError):
                self.store.update_session(USER_ID, {"session_id": REQUEST_2, **data})
        result = self.store.save_set(USER_ID, {**self.payload(), "location": "park"})
        self.assertEqual(result["status"], "error")
        self.assertEqual(self.client.tables["gym_workout_sessions"], [])

    def test_restored_records_flow_into_history_and_analytics_without_timestamps(self):
        plan = build_plan(OWNER, confirmed_lateral_raises=True)
        self.client.tables["gym_workout_sessions"] = [plan["session"]]
        self.client.tables["gym_set_groups"] = plan["groups"]
        exercises = [{"id": e["id"], "source_key": e["key"] or e["id"], "user_id": OWNER,
                      "name_ru": e["name"], "muscle_group": e["muscle"], "weight_type": e["kind"],
                      "multiplier": e["mult"], "source_payload": {"reps_per_side":e["per_side"]}}
                     for e in plan["exercises"]]
        self.client.tables["gym_exercises"] = exercises
        self.client.tables["gym_sets"] = [dict(s,exercise_id=exercises[s["exercise_slot"]-1]["id"]) for s in plan["sets"]]
        history = self.store.get_global_history(OWNER)
        self.assertEqual(len(history),1)
        self.assertEqual((history[0]["location"],history[0]["duration"]),("home","≈60м"))
        self.assertEqual([len(e["sets"]) for e in history[0]["exercises"]],[5,4,4,4,4])
        self.assertEqual(self.store.get_analytics(OWNER)["volume"],4408)
        for e in exercises:
            past = self.store.get_exercise_history(OWNER,e["source_key"])
            self.assertEqual(len(past["history"]),1)
            self.assertEqual(len(past["history"][0]["sets"]),5 if e==exercises[0] else 4)


class MetadataApiTests(unittest.TestCase):
    def test_owner_is_server_resolved_and_invalid_values_answer_400(self):
        helper = api_tests.HandlerTests()
        data = {"session_id": REQUEST_2, "location": "home", "user_id": "forged"}
        with helper.auth(), patch.object(index, "update_session", return_value=True) as update:
            result = index.handler(helper.event("POST", "/api/update_session", data), None)
        self.assertEqual(result["statusCode"], 200)
        update.assert_called_once_with(USER_ID, data)
        with helper.auth(), patch.object(index, "update_session", side_effect=ValueError("invalid location")):
            result = index.handler(helper.event("POST", "/api/update_session", data), None)
        self.assertEqual(result["statusCode"], 400)
        with helper.auth(), patch.object(index, "update_session", return_value=False):
            result = index.handler(helper.event("POST", "/api/update_session", data), None)
        self.assertEqual(result["statusCode"], 404)
