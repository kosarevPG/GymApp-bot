import json
import os
import unittest
from unittest.mock import patch

import index


class HandlerTests(unittest.TestCase):
    def setUp(self):
        self.old_token = os.environ.get("AUTH_TOKEN")
        os.environ["AUTH_TOKEN"] = "test-token"

    def tearDown(self):
        if self.old_token is None:
            os.environ.pop("AUTH_TOKEN", None)
        else:
            os.environ["AUTH_TOKEN"] = self.old_token

    @staticmethod
    def event(method: str, url: str, body=None, token="test-token"):
        return {
            "httpMethod": method,
            "headers": {"Authorization": token},
            "queryStringParameters": {"url": url},
            "body": json.dumps(body) if body is not None else "",
        }

    def test_options_does_not_require_auth(self):
        result = index.handler(self.event("OPTIONS", "/api/init", token=""), None)
        self.assertEqual(result["statusCode"], 204)

    def test_auth_is_required(self):
        result = index.handler(self.event("GET", "/api/init", token="wrong"), None)
        self.assertEqual(result["statusCode"], 403)

    def test_nested_query_string_is_parsed(self):
        with patch.object(index, "get_exercise_history", return_value={"history": [], "note": ""}) as history:
            result = index.handler(
                self.event("GET", "/api/history?exercise_id=exercise-1"),
                None,
            )
        self.assertEqual(result["statusCode"], 200)
        history.assert_called_once_with("exercise-1")

    def test_save_set_returns_storage_result(self):
        payload = {
            "exercise_id": "exercise-1",
            "reps": 10,
            "client_request_id": "request-1",
        }
        with patch.object(
            index,
            "save_set",
            return_value={"status": "success", "request_id": "request-1"},
        ) as save:
            result = index.handler(self.event("POST", "/api/save_set", payload), None)
        self.assertEqual(result["statusCode"], 200)
        save.assert_called_once_with(payload)


if __name__ == "__main__":
    unittest.main()
