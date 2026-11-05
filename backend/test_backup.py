import gzip
import json
import unittest
import uuid
from datetime import datetime
from unittest import mock
from zoneinfo import ZoneInfo

import backup
import index
import supabase_store

OWNER = str(uuid.uuid4())
OTHER = str(uuid.uuid4())
TIMER_EVENT = {"messages": [{"event_metadata": {"event_type": "yandex.cloud.events.serverless.triggers.TimerMessage"},
                             "details": {"trigger_id": "x", "payload": "gymapp-backup"}}]}
ENV = {"BACKUP_BUCKET": "backups", "TELEGRAM_USER_MAP": json.dumps({"1": OWNER, "2": OTHER, "3": OWNER})}


class TableClient:
    """Отвечает строками своих таблиц; journal_missing имитирует базу до миграции."""

    def __init__(self, journal_missing=False):
        self.journal_missing = journal_missing
        self.reads = []

    def select(self, table, *, columns="*", filters=None, order="", limit=None, offset=0):
        self.reads.append(table)
        if table == "gym_deleted_rows" and self.journal_missing:
            raise RuntimeError('Supabase Data API returned 404: {"code":"PGRST205"}')
        if offset:
            return []
        return [{"id": f"{table}-1", "user_id": filters["user_id"]}]


def run(client, now=datetime(2026, 11, 6, 3, 0, tzinfo=ZoneInfo("Europe/Moscow"))):
    written = {}
    store = supabase_store.SupabaseStore(client, now=lambda: now)
    with mock.patch.dict("os.environ", ENV):
        results = backup.run_backup(store, now, put=lambda bucket, key, body, kind: written.update({(bucket, key): (body, kind)}))
    return results, written


class NightlyBackup(unittest.TestCase):
    def test_every_owner_gets_one_file_with_all_tables(self):
        results, written = run(TableClient())
        self.assertEqual(sorted(key for _, key in written), sorted(f"gymapp/{user}/2026-11-06.json.gz" for user in (OWNER, OTHER)))
        body, kind = written[("backups", f"gymapp/{OWNER}/2026-11-06.json.gz")]
        self.assertEqual(kind, "application/gzip")
        data = json.loads(gzip.decompress(body))
        self.assertEqual(data["format"], "gymapp-raw-backup-v1")
        self.assertEqual(set(data["tables"]), set(backup.TABLES))
        self.assertTrue(all(row["user_id"] == OWNER for rows in data["tables"].values() for row in rows))
        self.assertEqual(results[f"gymapp/{OWNER}/2026-11-06.json.gz"]["counts"]["gym_sets"], 1)

    def test_backup_works_before_the_journal_migration(self):
        results, written = run(TableClient(journal_missing=True))
        entry = results[f"gymapp/{OWNER}/2026-11-06.json.gz"]
        self.assertEqual(entry["missing_tables"], ["gym_deleted_rows"])
        self.assertIn("gym_sets", entry["counts"])

    def test_other_read_errors_fail_the_backup(self):
        client = TableClient()
        client.select = mock.Mock(side_effect=RuntimeError("Supabase Data API returned 500"))
        with self.assertRaises(RuntimeError):
            run(client)

    def test_missing_bucket_is_an_error(self):
        store = supabase_store.SupabaseStore(TableClient())
        with mock.patch.dict("os.environ", {"BACKUP_BUCKET": "", "TELEGRAM_USER_MAP": ENV["TELEGRAM_USER_MAP"]}):
            with self.assertRaises(RuntimeError):
                backup.run_backup(store, datetime.now(), put=lambda *args: None)


class TimerRouting(unittest.TestCase):
    def test_timer_event_runs_the_backup_without_http_auth(self):
        store = supabase_store.SupabaseStore(TableClient())
        with mock.patch.object(supabase_store, "_store", return_value=store), \
                mock.patch.object(index, "run_backup", return_value={"k": {}}) as run_backup, \
                mock.patch.object(index, "authenticate_request") as authenticate:
            result = index.handler(TIMER_EVENT, None)
        self.assertEqual(result["statusCode"], 200)
        run_backup.assert_called_once()
        authenticate.assert_not_called()

    def test_http_request_cannot_trigger_a_backup(self):
        event = {"httpMethod": "POST", "queryStringParameters": {"url": "/api/ping"}, "headers": {},
                 "body": json.dumps(TIMER_EVENT)}
        with mock.patch.object(index, "run_backup") as run_backup:
            result = index.handler(event, None)
        run_backup.assert_not_called()
        self.assertIn(result["statusCode"], (401, 403, 404, 503))

    def test_failed_backup_reports_500(self):
        with mock.patch.object(supabase_store, "_store", return_value=supabase_store.SupabaseStore(TableClient())), \
                mock.patch.object(index, "run_backup", side_effect=RuntimeError("boom")):
            self.assertEqual(index.handler(TIMER_EVENT, None)["statusCode"], 500)


if __name__ == "__main__":
    unittest.main()
