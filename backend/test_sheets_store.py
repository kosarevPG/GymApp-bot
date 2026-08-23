import unittest
from unittest.mock import MagicMock, patch

import sheets_store


BASE_HEADERS = [
    "Date",
    "Exercise_ID",
    "Exercise_Name_Calc",
    "Input_Weight",
    "Total_Weight",
    "Reps",
    "Rest",
    "Set_Group_ID",
    "Note",
    "Order",
    "Real_Load_Kg",
    "e1RM",
    "Tonnage",
    "Set_Type",
    "RPE",
    "RIR",
    "Session_ID",
    "Client_Request_ID",
]


class SheetsStoreTests(unittest.TestCase):
    def test_save_set_matches_production_column_order(self):
        sheet = MagicMock()
        sheet.col_values.return_value = ["Date", "2026.07.01, 12:00"]
        exercise = {"ID": "exercise-1", "Name": "Exercise"}
        payload = {
            "exercise_id": "exercise-1",
            "input_weight": 20,
            "weight": 40,
            "reps": 12,
            "rest": 1.5,
            "set_group_id": "group-1",
            "session_id": "session-1",
            "note": "note",
            "order": 3,
            "set_type": "working",
            "rpe": 8,
            "rir": 2,
            "client_request_id": "request-1",
        }
        with (
            patch.object(sheets_store, "_exercise_maps", return_value=({"exercise-1": exercise}, {})),
            patch.object(sheets_store, "_log_records", return_value=[]),
            patch.object(sheets_store, "_ensure_optional_log_headers", return_value=BASE_HEADERS),
            patch.object(sheets_store, "_worksheets", return_value=(sheet, MagicMock())),
        ):
            result = sheets_store.save_set(payload)

        self.assertEqual(result["status"], "success")
        row = sheet.append_row.call_args.args[0]
        values = dict(zip(BASE_HEADERS, row))
        self.assertEqual(values["Exercise_ID"], "exercise-1")
        self.assertEqual(values["Exercise_Name_Calc"], "Exercise")
        self.assertEqual(values["Input_Weight"], 20)
        self.assertEqual(values["Total_Weight"], 40)
        self.assertEqual(values["Reps"], 12)
        self.assertEqual(values["Session_ID"], "session-1")
        self.assertEqual(values["Client_Request_ID"], "request-1")
        self.assertEqual(values["Real_Load_Kg"], "")
        self.assertEqual(values["e1RM"], "")
        self.assertEqual(values["Tonnage"], "")

    def test_retry_is_deduplicated(self):
        sheet = MagicMock()
        exercise = {"ID": "exercise-1", "Name": "Exercise"}
        existing = {
            "Exercise_ID": "exercise-1",
            "Set_Group_ID": "group-1",
            "Order": "3",
            "Client_Request_ID": "request-1",
            "_row_number": 25,
        }
        payload = {
            "exercise_id": "exercise-1",
            "reps": 12,
            "set_group_id": "group-1",
            "order": 3,
            "client_request_id": "request-1",
        }
        with (
            patch.object(sheets_store, "_exercise_maps", return_value=({"exercise-1": exercise}, {})),
            patch.object(sheets_store, "_log_records", return_value=[existing]),
            patch.object(sheets_store, "_worksheets", return_value=(sheet, MagicMock())),
        ):
            result = sheets_store.save_set(payload)

        self.assertTrue(result["deduplicated"])
        self.assertEqual(result["row_number"], 25)
        sheet.append_row.assert_not_called()

    def test_repeated_order_in_same_group_still_writes_a_row(self):
        """Счётчик Order может начаться заново внутри той же set-группы
        (восстановленная тренировка). Это новый подход, а не дубль."""
        sheet = MagicMock()
        sheet.col_values.return_value = ["Date", "row"]
        exercise = {"ID": "exercise-1", "Name": "Exercise"}
        existing = {
            "Exercise_ID": "exercise-1",
            "Set_Group_ID": "group-1",
            "Order": "1",
            "Client_Request_ID": "morning-uuid",
            "_row_number": 10,
        }
        payload = {
            "exercise_id": "exercise-1",
            "reps": 10,
            "set_group_id": "group-1",
            "order": 1,
            "client_request_id": "evening-uuid",
        }
        with (
            patch.object(sheets_store, "_exercise_maps", return_value=({"exercise-1": exercise}, {})),
            patch.object(sheets_store, "_log_records", return_value=[existing]),
            patch.object(sheets_store, "_ensure_optional_log_headers", return_value=BASE_HEADERS),
            patch.object(sheets_store, "_worksheets", return_value=(sheet, MagicMock())),
        ):
            result = sheets_store.save_set(payload)

        self.assertEqual(result["status"], "success")
        self.assertNotIn("deduplicated", result)
        sheet.append_row.assert_called_once()

    def test_locate_prefers_client_request_id_over_natural_key(self):
        sheet = MagicMock()
        old_row = {"Exercise_ID": "exercise-1", "Set_Group_ID": "group-1", "Order": "1",
                   "Client_Request_ID": "morning-uuid", "_row_number": 10}
        new_row = {"Exercise_ID": "exercise-1", "Set_Group_ID": "group-1", "Order": "5",
                   "Client_Request_ID": "evening-uuid", "_row_number": 42}
        with (
            patch.object(sheets_store, "_log_records", return_value=[old_row, new_row]),
            patch.object(sheets_store, "_worksheets", return_value=(sheet, MagicMock())),
        ):
            found = sheets_store._locate_log_row({
                "client_request_id": "evening-uuid",
                "exercise_id": "exercise-1",
                "set_group_id": "group-1",
                "order": 1,
            })

        self.assertEqual(found["_row_number"], 42)

    def test_legacy_row_without_request_id_falls_back_to_natural_key(self):
        sheet = MagicMock()
        legacy = {"Exercise_ID": "exercise-1", "Set_Group_ID": "group-1", "Order": "3",
                  "Client_Request_ID": "", "_row_number": 7}
        with (
            patch.object(sheets_store, "_log_records", return_value=[legacy]),
            patch.object(sheets_store, "_worksheets", return_value=(sheet, MagicMock())),
        ):
            found = sheets_store._locate_log_row({
                "client_request_id": "7",
                "exercise_id": "exercise-1",
                "set_group_id": "group-1",
                "order": 3,
            })

        self.assertEqual(found["_row_number"], 7)

    def test_save_set_refreshes_catalog_for_freshly_created_exercise(self):
        sheet = MagicMock()
        sheet.col_values.return_value = ["Date", "row"]
        exercise = {"ID": "brand-new", "Name": "Новое"}

        def maps(force=False):
            # Тёплый инстанс держит каталог до 5 минут и нового упражнения не видит.
            return ({"brand-new": exercise}, {}) if force else ({}, {})

        with (
            patch.object(sheets_store, "_exercise_maps", side_effect=maps),
            patch.object(sheets_store, "_log_records", return_value=[]),
            patch.object(sheets_store, "_ensure_optional_log_headers", return_value=BASE_HEADERS),
            patch.object(sheets_store, "_worksheets", return_value=(sheet, MagicMock())),
        ):
            result = sheets_store.save_set({
                "exercise_id": "brand-new",
                "reps": 8,
                "client_request_id": "req-1",
            })

        self.assertEqual(result["status"], "success")
        sheet.append_row.assert_called_once()

    def test_update_exercise_saves_secondary_muscles(self):
        headers = ["ID", "Name", "Muscle Group", "Secondary_Muscles"]
        sheet = MagicMock()
        sheet.row_values.return_value = headers
        sheet.get_all_values.return_value = [headers, ["exercise-1", "Жим", "Грудь", ""]]
        with patch.object(sheets_store, "_worksheets", return_value=(MagicMock(), sheet)):
            ok = sheets_store.update_exercise("exercise-1", {"secondaryMuscles": "Трицепс, Плечи"})

        self.assertTrue(ok)
        written = {cell.col: cell.value for cell in sheet.update_cells.call_args.args[0]}
        self.assertEqual(written[headers.index("Secondary_Muscles") + 1], "Трицепс, Плечи")


if __name__ == "__main__":
    unittest.main()
