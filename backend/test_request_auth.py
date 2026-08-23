import io
import json
import os
import unittest
from urllib.error import HTTPError
from unittest.mock import patch

import request_auth
from telegram_auth import AuthenticatedUser, AuthenticationError


USER_ID = "11111111-1111-4111-8111-111111111111"


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.payload


class RequestAuthTests(unittest.TestCase):
    def setUp(self):
        self.old_env = os.environ.copy()
        os.environ["SUPABASE_URL"] = "https://project.supabase.co"
        os.environ["SUPABASE_AUTH_API_KEY"] = "publishable-test-key"

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.old_env)

    def test_telegram_init_data_keeps_existing_validation_path(self):
        with patch.object(
            request_auth,
            "authenticate_init_data",
            return_value=AuthenticatedUser("42", USER_ID),
        ) as telegram, patch.object(
            request_auth, "authenticate_supabase_access_token"
        ) as supabase:
            result = request_auth.authenticate_request(
                {
                    "x-telegram-init-data": "signed",
                    "authorization": "Bearer standalone-token",
                }
            )
        self.assertEqual(result.user_id, USER_ID)
        self.assertEqual(result.source, "telegram")
        telegram.assert_called_once()
        supabase.assert_not_called()

    def test_valid_supabase_token_resolves_server_owner(self):
        captured = {}

        def fake_urlopen(req, timeout):
            captured["request"] = req
            captured["timeout"] = timeout
            return FakeResponse({"id": USER_ID, "email": "not-used@example.test"})

        with patch.object(request_auth, "urlopen", side_effect=fake_urlopen):
            result = request_auth.authenticate_request(
                {"authorization": "Bearer valid-access-token"}
            )

        self.assertEqual(result.user_id, USER_ID)
        self.assertEqual(result.source, "supabase")
        self.assertEqual(captured["request"].full_url, "https://project.supabase.co/auth/v1/user")
        self.assertEqual(captured["request"].get_header("Authorization"), "Bearer valid-access-token")
        self.assertEqual(captured["request"].get_header("Apikey"), "publishable-test-key")
        self.assertEqual(captured["timeout"], 10)

    def test_edge_proxy_token_is_reverified_by_yandex_backend(self):
        with patch.object(
            request_auth, "urlopen", return_value=FakeResponse({"id": USER_ID})
        ) as auth_api:
            result = request_auth.authenticate_request(
                {"x-supabase-access-token": "edge-forwarded-access-token"}
            )
        self.assertEqual(result.user_id, USER_ID)
        self.assertEqual(result.source, "supabase")
        request = auth_api.call_args.args[0]
        self.assertEqual(
            request.get_header("Authorization"),
            "Bearer edge-forwarded-access-token",
        )

    def test_expired_supabase_token_is_rejected(self):
        error = HTTPError(
            "https://project.supabase.co/auth/v1/user",
            401,
            "Unauthorized",
            {},
            io.BytesIO(b'{}'),
        )
        with patch.object(request_auth, "urlopen", side_effect=error):
            with self.assertRaises(AuthenticationError) as caught:
                request_auth.authenticate_request(
                    {"authorization": "Bearer expired-access-token"}
                )
        self.assertEqual(caught.exception.status, 401)
        self.assertIn("invalid or expired", str(caught.exception))

    def test_missing_or_malformed_bearer_fails_closed(self):
        for headers in ({}, {"authorization": "Basic value"}, {"authorization": "Bearer"}):
            with self.subTest(headers=headers), self.assertRaises(AuthenticationError) as caught:
                request_auth.authenticate_request(headers)
            self.assertEqual(caught.exception.status, 401)

    def test_invalid_auth_user_id_is_rejected(self):
        with patch.object(
            request_auth, "urlopen", return_value=FakeResponse({"id": "attacker-owner"})
        ):
            with self.assertRaises(AuthenticationError) as caught:
                request_auth.authenticate_request(
                    {"authorization": "Bearer valid-access-token"}
                )
        self.assertEqual(caught.exception.status, 503)


if __name__ == "__main__":
    unittest.main()
