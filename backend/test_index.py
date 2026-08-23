import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import index
from request_auth import AuthenticatedRequestUser
from supabase_store import ConflictError
from telegram_auth import AuthenticationError


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
            "authenticate_request",
            return_value=AuthenticatedRequestUser(USER_ID, "telegram"),
        )

    def test_options_does_not_require_auth(self):
        result = index.handler(self.event("OPTIONS", "/api/init", init_data=""), None)
        self.assertEqual(result["statusCode"], 204)

    def test_auth_is_fail_closed(self):
        with patch.object(
            index,
            "authenticate_request",
            side_effect=AuthenticationError("Supabase access token is required"),
        ):
            result = index.handler(self.event("GET", "/api/init", init_data=""), None)
        self.assertEqual(result["statusCode"], 401)

    def test_static_frontend_does_not_bypass_api_auth(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(index, "STATIC_ROOT", Path(directory)):
            Path(directory, "index.html").write_text(
                '<h1>GymApp staging</h1><script src="/assets/app.js"></script>'
                '<link rel="manifest" href="./manifest.json">',
                encoding="utf-8",
            )
            static_result = index.handler({"httpMethod": "GET", "path": "/"}, None)
            self.assertEqual(static_result["statusCode"], 200)
            self.assertIn("GymApp staging", static_result["body"])
            self.assertIn('src="?url=/assets/app.js"', static_result["body"])
            self.assertIn('href="?url=/manifest.json"', static_result["body"])

            yandex_root_result = index.handler({"httpMethod": "GET"}, None)
            self.assertEqual(yandex_root_result["statusCode"], 200)
            self.assertIn("GymApp staging", yandex_root_result["body"])

            with patch.object(
                index,
                "authenticate_request",
                side_effect=AuthenticationError("Authentication is required"),
            ):
                api_result = index.handler(self.event("GET", "/api/init", init_data=""), None)
            self.assertEqual(api_result["statusCode"], 401)

            with patch.object(
                index,
                "authenticate_request",
                side_effect=AuthenticationError("Authentication is required"),
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

    def test_session_deeplink_requires_auth(self):
        with patch.object(
            index,
            "authenticate_request",
            side_effect=AuthenticationError("Authentication is required"),
        ), patch.object(index, "get_workout_session") as lookup:
            result = index.handler(
                self.event("GET", "/api/session?session_id=e96b22f8-695a-40b0-916a-57f3a33db4f1", init_data=""),
                None,
            )
        self.assertEqual(result["statusCode"], 401)
        lookup.assert_not_called()

    def test_session_deeplink_uses_the_server_resolved_owner(self):
        session_id = "e96b22f8-695a-40b0-916a-57f3a33db4f1"
        with self.auth(), patch.object(
            index, "get_workout_session", return_value={"id": session_id, "exercises": []}
        ) as lookup:
            result = index.handler(
                self.event("GET", f"/api/session?session_id={session_id}"), None
            )
        self.assertEqual(result["statusCode"], 200)
        lookup.assert_called_once_with(USER_ID, session_id)

    def test_session_deeplink_returns_404_for_a_session_that_is_not_the_callers(self):
        with self.auth(), patch.object(index, "get_workout_session", return_value=None):
            result = index.handler(
                self.event("GET", "/api/session?session_id=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
                None,
            )
        # 404 rather than 403: the response must not confirm that the session exists.
        self.assertEqual(result["statusCode"], 404)

    def test_session_deeplink_without_an_id_is_a_bad_request(self):
        with self.auth(), patch.object(index, "get_workout_session") as lookup:
            result = index.handler(self.event("GET", "/api/session"), None)
        self.assertEqual(result["statusCode"], 400)
        lookup.assert_not_called()


if __name__ == "__main__":
    unittest.main()
