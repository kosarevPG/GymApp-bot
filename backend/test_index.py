import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import index
from supabase_store import ConflictError
from telegram_auth import AuthenticatedUser, AuthenticationError


USER_ID = "11111111-1111-4111-8111-111111111111"


class HandlerTests(unittest.TestCase):
    @staticmethod
    def event(method: str, url: str, body=None, init_data="signed-init-data"):
        return {
            "httpMethod": method,
            "headers": {"X-Telegram-Init-Data": init_data},
            "queryStringParameters": {"url": url},
            "body": json.dumps(body) if body is not None else "",
        }

    def auth(self):
        return patch.object(
            index,
            "authenticate_init_data",
            return_value=AuthenticatedUser("123", USER_ID),
        )

    def test_options_does_not_require_auth(self):
        result = index.handler(self.event("OPTIONS", "/api/init", init_data=""), None)
        self.assertEqual(result["statusCode"], 204)

    def test_auth_is_fail_closed(self):
        with patch.object(
            index,
            "authenticate_init_data",
            side_effect=AuthenticationError("Telegram initData is required"),
        ):
            result = index.handler(self.event("GET", "/api/init", init_data=""), None)
        self.assertEqual(result["statusCode"], 401)

    def test_static_frontend_does_not_bypass_api_auth(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(index, "STATIC_ROOT", Path(directory)):
            Path(directory, "index.html").write_text("<h1>GymApp staging</h1>", encoding="utf-8")
            static_result = index.handler({"httpMethod": "GET", "path": "/"}, None)
            self.assertEqual(static_result["statusCode"], 200)
            self.assertIn("GymApp staging", static_result["body"])

            with patch.object(
                index,
                "authenticate_init_data",
                side_effect=AuthenticationError("Telegram initData is required"),
            ):
                api_result = index.handler(self.event("GET", "/api/init", init_data=""), None)
            self.assertEqual(api_result["statusCode"], 401)

            with patch.object(
                index,
                "authenticate_init_data",
                side_effect=AuthenticationError("Telegram initData is required"),
            ):
                api_root_result = index.handler(self.event("GET", "/api", init_data=""), None)
            self.assertEqual(api_root_result["statusCode"], 401)

    def test_nested_query_string_is_parsed_and_user_is_server_owned(self):
        with self.auth(), patch.object(
            index, "get_exercise_history", return_value={"history": [], "note": ""}
        ) as history:
            result = index.handler(
                self.event("GET", "/api/history?exercise_id=exercise-1"), None
            )
        self.assertEqual(result["statusCode"], 200)
        history.assert_called_once_with(USER_ID, "exercise-1")

    def test_save_set_ignores_any_client_owner(self):
        payload = {
            "user_id": "attacker-selected-owner",
            "exercise_id": "exercise-1",
            "reps": 10,
            "client_request_id": "22222222-2222-4222-8222-222222222222",
        }
        with self.auth(), patch.object(
            index,
            "save_set",
            return_value={"status": "success", "request_id": payload["client_request_id"]},
        ) as save:
            result = index.handler(self.event("POST", "/api/save_set", payload), None)
        self.assertEqual(result["statusCode"], 200)
        save.assert_called_once_with(USER_ID, payload)

    def test_ambiguous_date_delete_returns_conflict(self):
        with self.auth(), patch.object(
            index,
            "delete_workout",
            side_effect=ConflictError("Multiple workout sessions exist for this date"),
        ):
            result = index.handler(
                self.event("POST", "/api/delete_workout", {"date": "2026.08.22"}),
                None,
            )
        self.assertEqual(result["statusCode"], 409)
        self.assertEqual(json.loads(result["body"])["code"], "ambiguous_workout_date")


if __name__ == "__main__":
    unittest.main()
