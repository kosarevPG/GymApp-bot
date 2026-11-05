import unittest

import test_supabase_store as store_tests

USER_ID = store_tests.USER_ID


def rows_of(sheet):
    headers, *rows = sheet
    return [dict(zip(headers, row)) for row in rows]


class ExportTests(unittest.TestCase):
    setUp = store_tests.SupabaseStoreTests.setUp
    payload = staticmethod(store_tests.SupabaseStoreTests.payload)
    add_treadmill = store_tests.SupabaseStoreTests.add_treadmill
    segment = staticmethod(store_tests.SupabaseStoreTests.segment)

    def test_existing_log_columns_keep_their_positions(self):
        self.store.save_set(USER_ID, self.payload())
        headers = self.store.export_data(USER_ID)["log"][0]
        self.assertEqual(headers[:15], [
            "Date", "Exercise_ID", "Exercise_Name_Calc", "Input_Weight", "Total_Weight", "Reps", "Rest",
            "Set_Group_ID", "Note", "Order", "Set_Type", "RPE", "RIR", "Session_ID", "Client_Request_ID",
        ])

    def test_legacy_note_is_exported_beside_the_current_note(self):
        self.store.save_set(USER_ID, self.payload())
        self.client.tables["gym_sets"][0].update(note="сорвался хват", legacy_note="По 15 повторений т.к. не в сете")
        [row] = rows_of(self.store.export_data(USER_ID)["log"])
        self.assertEqual(row["Note"], "сорвался хват")
        self.assertEqual(row["Legacy_Note"], "По 15 повторений т.к. не в сете")

    def test_set_keeps_its_session_group_type_load_and_timing(self):
        load = {"v": 1, "type": "Dumbbell", "mult": 2, "base": 0}
        self.store.save_set(USER_ID, {**self.payload(weight=16), "input_weight": 8, "load": load})
        stored = self.client.tables["gym_sets"][0]
        stored["source_payload"] = {**stored["source_payload"], "timing": {"duration_seconds": 40}}
        [row] = rows_of(self.store.export_data(USER_ID)["log"])
        self.assertEqual(row["Session_UUID"], self.client.tables["gym_workout_sessions"][0]["id"])
        self.assertEqual(row["Group_Type"], self.client.tables["gym_set_groups"][0]["group_type"])
        self.assertEqual(row["Load"], load)
        self.assertEqual(row["Timing"], {"duration_seconds": 40})

    def test_session_context_is_exported(self):
        self.store.save_set(USER_ID, {**self.payload(), "location": "home"})
        session = self.client.tables["gym_workout_sessions"][0]
        session.update(session_note="тренажёр занят, заменил тягу", duration_minutes=60,
                       duration_is_approximate=True)
        [row] = rows_of(self.store.export_data(USER_ID)["sessions"])
        self.assertEqual(row["ID"], session["id"])
        self.assertEqual(row["Date"], "2026.08.22")
        self.assertEqual(row["Location"], "home")
        self.assertEqual(row["Session_Note"], "тренажёр занят, заменил тягу")
        self.assertEqual((row["Duration_Minutes"], row["Duration_Is_Approximate"]), (60, True))

    def test_cardio_is_exported_and_a_session_without_sets_is_not_lost(self):
        self.add_treadmill()
        self.store.save_cardio(USER_ID, self.segment(minutes=12))
        export = self.store.export_data(USER_ID)
        self.assertEqual(rows_of(export["log"]), [])
        [session] = rows_of(export["sessions"])
        [row] = rows_of(export["cardio"])
        self.assertEqual(row["Session_UUID"], session["ID"])
        self.assertEqual(row["Exercise_Name_Calc"], "Дорожка")
        self.assertEqual((row["Date"], row["Minutes"], row["Speed"], row["Incline"]), ("2026.08.22", 12, 6, 5))

    def test_empty_account_exports_only_headers(self):
        export = self.store.export_data(USER_ID)
        self.assertEqual(export["format"], "gymapp-backup-v2")
        for sheet in ("log", "sessions", "cardio"):
            self.assertEqual(rows_of(export[sheet]), [])
