import unittest

import test_supabase_store as store_tests

USER_ID = store_tests.USER_ID
REQUEST_1 = store_tests.REQUEST_1


class ExerciseNotesTests(unittest.TestCase):
    setUp = store_tests.SupabaseStoreTests.setUp
    payload = staticmethod(store_tests.SupabaseStoreTests.payload)

    def exercise(self):
        return next(row for row in self.store.get_init(USER_ID)["exercises"] if row["id"] == "legacy-exercise")

    def test_technique_note_is_written_read_and_cleared(self):
        self.assertTrue(self.store.update_exercise(USER_ID, "legacy-exercise", {"techniqueNote": "  Хват прямой  "}))
        self.assertEqual(self.exercise()["techniqueNote"], "Хват прямой")
        self.assertTrue(self.store.update_exercise(USER_ID, "legacy-exercise", {"techniqueNote": ""}))
        self.assertEqual(self.exercise()["techniqueNote"], "")
        self.assertIsNone(self.client.tables["gym_exercises"][0]["technique_note"])

    def test_other_exercise_updates_leave_the_technique_note_alone(self):
        self.store.update_exercise(USER_ID, "legacy-exercise", {"techniqueNote": "Хват прямой"})
        self.store.update_exercise(USER_ID, "legacy-exercise", {"name": "Жим узким"})
        self.assertEqual(self.exercise()["techniqueNote"], "Хват прямой")

    def test_note_can_be_set_and_cleared_on_a_saved_set_without_touching_it(self):
        self.store.save_set(USER_ID, self.payload())
        before = dict(self.client.tables["gym_sets"][0])
        self.assertTrue(self.store.update_set(USER_ID, {"client_request_id": REQUEST_1, "note": " тяжеловато "}))
        row = self.client.tables["gym_sets"][0]
        self.assertEqual(row["note"], "тяжеловато")
        for column in ("total_weight_kg", "input_weight_kg", "reps", "rest_seconds", "source_payload"):
            self.assertEqual(row[column], before[column])
        self.assertTrue(self.store.update_set(USER_ID, {"client_request_id": REQUEST_1, "note": ""}))
        self.assertIsNone(self.client.tables["gym_sets"][0]["note"])

    def test_history_returns_the_day_note_and_not_the_legacy_one(self):
        self.store.save_set(USER_ID, {**self.payload(), "note": "тяжеловато"})
        row = self.store.get_exercise_history(USER_ID, "legacy-exercise")["history"][0]["sets"][0]
        self.assertEqual(row["note"], "тяжеловато")
        self.client.tables["gym_sets"][0].update(note=None, legacy_note="старая заметка")
        row = self.store.get_exercise_history(USER_ID, "legacy-exercise")["history"][0]["sets"][0]
        self.assertNotIn("note", row)
        journal = self.store.get_global_history(USER_ID)[0]["exercises"][0]["sets"][0]
        self.assertNotIn("note", journal)

    def test_technique_note_is_exported_and_is_not_copied_to_sets(self):
        self.store.update_exercise(USER_ID, "legacy-exercise", {"techniqueNote": "Хват прямой"})
        self.store.save_set(USER_ID, self.payload())
        self.assertIsNone(self.client.tables["gym_sets"][0]["note"])
        headers, *rows = self.store.export_data(USER_ID)["exercises"]
        row = dict(zip(headers, next(r for r in rows if r[0] == "legacy-exercise")))
        self.assertEqual(row["Technique_Note"], "Хват прямой")
