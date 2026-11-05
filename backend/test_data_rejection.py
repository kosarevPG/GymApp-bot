"""Плохие значения подхода получают 400, а сбой хранилища — 503: очередь на
телефоне по этому коду решает, идти ли дальше или прервать проход."""

import io
import json
import unittest
import uuid
from unittest import mock
from urllib.error import HTTPError, URLError

import index
import supabase_store as store_module
from supabase_store import (
    DataRejectedError,
    StorageUnavailableError,
    SupabaseRestClient,
    SupabaseStore,
)

USER_ID = str(uuid.uuid4())


class RecordingClient:
    """Пишет обращения; при заданной ошибке падает на вставке подхода, как база."""

    def __init__(self, upsert_error=None):
        self.upsert_error = upsert_error
        self.upserts = []

    def select(self, *args, **kwargs):
        return []

    def upsert(self, table, row, **kwargs):
        if table == "gym_sets" and self.upsert_error:
            raise self.upsert_error
        self.upserts.append(table)
        return [row]

    def update(self, *args, **kwargs):
        return [{}]


def set_payload(**overrides):
    return {
        "client_request_id": str(uuid.uuid4()),
        "performed_at": "2026-11-01T10:00:00+03:00",
        "exercise_id": "bench",
        "session_id": str(uuid.uuid4()),
        "order": 1,
        "weight": 60,
        "input_weight": 60,
        "reps": 8,
        "rest": 2,
        **overrides,
    }


def post(endpoint, body, client):
    store = SupabaseStore(client)
    store._resolve_exercise = lambda *args: {"id": str(uuid.uuid4()), "tonnage_mode": "external_load"}
    event = {
        "httpMethod": "POST",
        "queryStringParameters": {"url": f"/api/{endpoint}"},
        "headers": {},
        "body": json.dumps(body),
    }
    authenticated = mock.Mock(user_id=USER_ID)
    with mock.patch.object(index, "authenticate_request", return_value=authenticated), \
            mock.patch.object(store_module, "_store", return_value=store):
        result = index.handler(event, None)
    return result["statusCode"], json.loads(result["body"])


class OutOfRangeValues(unittest.TestCase):
    def test_rpe_out_of_range_is_rejected_before_any_write(self):
        client = RecordingClient()
        status, body = post("save_set", set_payload(rpe=85), client)
        self.assertEqual(status, 400)
        self.assertIn("RPE", body["error"])
        # Отклонённый подход не должен оставить после себя пустую тренировку.
        self.assertEqual(client.upserts, [])

    def test_valid_rpe_is_saved(self):
        client = RecordingClient()
        status, body = post("save_set", set_payload(rpe=8), client)
        self.assertEqual((status, body["status"]), (200, "success"))
        self.assertIn("gym_sets", client.upserts)

    def test_weight_that_does_not_fit_the_column_is_rejected(self):
        status, _ = post("save_set", set_payload(weight=1_000_000, input_weight=1_000_000), RecordingClient())
        self.assertEqual(status, 400)

    def test_update_set_checks_the_same_ranges(self):
        client = RecordingClient()
        client.select = lambda *args, **kwargs: [{"id": str(uuid.uuid4()), "source_payload": {}}]
        status, body = post("update_set", {"client_request_id": str(uuid.uuid4()), "rpe": 85}, client)
        self.assertEqual(status, 400)
        self.assertIn("RPE", body["error"])


class HandlerStatus(unittest.TestCase):
    def test_database_rejection_inside_save_set_is_400(self):
        status, body = post("save_set", set_payload(), RecordingClient(DataRejectedError("значение вне допустимого диапазона")))
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "значение вне допустимого диапазона")

    def test_storage_failure_is_503(self):
        status, _ = post("save_set", set_payload(), RecordingClient(StorageUnavailableError("Supabase returned 502")))
        self.assertEqual(status, 503)

    def test_network_failure_is_503(self):
        status, _ = post("save_set", set_payload(), RecordingClient(URLError("connection refused")))
        self.assertEqual(status, 503)

    def test_bug_in_processing_stays_500(self):
        status, _ = post("save_set", set_payload(), RecordingClient(KeyError("oops")))
        self.assertEqual(status, 500)


class RestClientErrors(unittest.TestCase):
    def fail_with(self, status, body):
        error = HTTPError("https://x/rest/v1/gym_sets", status, "error", {}, io.BytesIO(body.encode()))
        with mock.patch.object(store_module, "urlopen", side_effect=error):
            SupabaseRestClient("https://x", "key").upsert("gym_sets", {"id": 1}, on_conflict="id")

    def test_check_constraint_becomes_data_rejection(self):
        with self.assertRaises(DataRejectedError) as caught:
            self.fail_with(400, '{"code":"23514","message":"violates check constraint"}')
        self.assertEqual(str(caught.exception), "значение вне допустимого диапазона")

    def test_numeric_overflow_becomes_data_rejection(self):
        with self.assertRaises(DataRejectedError):
            self.fail_with(400, '{"code":"22003","message":"numeric field overflow"}')

    def test_server_side_failure_is_storage_unavailable(self):
        with self.assertRaises(StorageUnavailableError):
            self.fail_with(502, "bad gateway")

    def test_missing_function_stays_a_plain_runtime_error(self):
        # На PGRST202 держится откат get_journal_delta к полной истории.
        with self.assertRaises(RuntimeError) as caught:
            self.fail_with(404, '{"code":"PGRST202","message":"not found"}')
        self.assertNotIsInstance(caught.exception, (DataRejectedError, StorageUnavailableError))
        self.assertIn("PGRST202", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
