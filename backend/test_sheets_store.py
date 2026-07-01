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


if __name__ == "__main__":
    unittest.main()
