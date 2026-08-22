import hashlib
import hmac
import json
import os
import unittest
from urllib.parse import urlencode

from telegram_auth import AuthenticationError, authenticate_init_data


BOT_TOKEN = "123456:test-bot-token"
USER_ID = "11111111-1111-4111-8111-111111111111"
NOW = 1_800_000_000


def signed_init_data(telegram_id=42, auth_date=NOW):
    values = {
        "auth_date": str(auth_date),
        "query_id": "AAExample",
        "user": json.dumps({"id": telegram_id, "first_name": "Test"}, separators=(",", ":")),
    }
    check = "\n".join(f"{key}={value}" for key, value in sorted(values.items()))
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    values["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(values)


class TelegramAuthTests(unittest.TestCase):
    def setUp(self):
        self.old_env = os.environ.copy()
        os.environ["BOT_TOKEN"] = BOT_TOKEN
        os.environ["TELEGRAM_USER_MAP"] = json.dumps({"42": USER_ID})
        os.environ["TELEGRAM_INIT_DATA_MAX_AGE_SECONDS"] = "900"

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.old_env)

    def test_valid_signature_resolves_server_user(self):
        result = authenticate_init_data(
            {"x-telegram-init-data": signed_init_data()}, now=NOW
        )
        self.assertEqual(result.telegram_user_id, "42")
        self.assertEqual(result.user_id, USER_ID)

    def test_missing_init_data_is_rejected(self):
        with self.assertRaises(AuthenticationError) as caught:
            authenticate_init_data({}, now=NOW)
        self.assertEqual(caught.exception.status, 401)

    def test_tampered_init_data_is_rejected(self):
        raw = signed_init_data().replace("Test", "Mallory")
        with self.assertRaises(AuthenticationError):
            authenticate_init_data({"x-telegram-init-data": raw}, now=NOW)

    def test_expired_init_data_is_rejected(self):
        with self.assertRaises(AuthenticationError):
            authenticate_init_data(
                {"x-telegram-init-data": signed_init_data(auth_date=NOW - 901)}, now=NOW
            )

    def test_user_outside_allowlist_is_rejected(self):
        with self.assertRaises(AuthenticationError) as caught:
            authenticate_init_data(
                {"x-telegram-init-data": signed_init_data(telegram_id=99)}, now=NOW
            )
        self.assertEqual(caught.exception.status, 403)

    def test_missing_server_configuration_fails_closed(self):
        os.environ.pop("TELEGRAM_USER_MAP")
        with self.assertRaises(AuthenticationError) as caught:
            authenticate_init_data(
                {"x-telegram-init-data": signed_init_data()}, now=NOW
            )
        self.assertEqual(caught.exception.status, 503)


if __name__ == "__main__":
    unittest.main()
