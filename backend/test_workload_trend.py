import hashlib
import json
import pathlib
import re
import unittest

from workload_trend import (
    WORKLOAD_TREND_VERSION,
    compute_workload_trend,
    format_workload_trend,
    sets_to_trend_sessions,
)

FIXTURE_PATH = pathlib.Path(__file__).resolve().parent.parent / "docs" / "fixtures" / "workload-trend-v1.json"

# This pin catches an unnoticed edit of the fixture INSIDE this repo: changing it
# fails here until the hash is deliberately re-pinned in both this file and
# docs/WORKLOAD_TREND_V1.md. It says nothing about HealthOS's copy — a
# self-consistent one-sided change here would leave both suites green. The
# cross-repo comparison lives in HealthOS (scripts/check-contract-drift.mjs),
# which reads this repo's public copy; see docs/WORKLOAD_TREND_V1.md for why it
# runs in that direction only.
# CRLF is normalised first so a Windows checkout and a Linux runner agree.
FIXTURE_SHA256 = "619c4854797130089ad8b458e7cf016ed5b3ec83da45eeda415c13fde5a40e90"

# No risk/alarm vocabulary may re-enter the rendered sentence — that is the
# whole point of replacing ACWR.
BANNED_WORDS = ["риск", "опасн", "оптимальн", "перетрен", "снизьте", "acwr"]


def _load():
    text = FIXTURE_PATH.read_text(encoding="utf-8").replace("\r\n", "\n")
    return text, json.loads(text)


class WorkloadTrendFixtureTest(unittest.TestCase):
    def test_fixture_hash_matches_the_other_repo(self):
        text, _ = _load()
        actual = hashlib.sha256(text.encode("utf-8")).hexdigest()
        self.assertEqual(
            actual,
            FIXTURE_SHA256,
            "docs/fixtures/workload-trend-v1.json changed (sha256 %s). Update the "
            "hash here, in HealthOS medical/tests/workload-trend.test.mjs, and in "
            "docs/WORKLOAD_TREND_V1.md — and copy the file to the other repo." % actual,
        )

    def test_documented_hash_matches_the_pinned_one(self):
        """The doc must not quietly describe a different contract than the tests."""
        doc = (FIXTURE_PATH.parent.parent / "WORKLOAD_TREND_V1.md").read_text(encoding="utf-8")
        documented = re.search(r"`([0-9a-f]{64})`", doc)
        self.assertIsNotNone(documented, "no fixture hash found in docs/WORKLOAD_TREND_V1.md")
        self.assertEqual(documented.group(1), FIXTURE_SHA256)

    def test_contract_header(self):
        _, fixture = _load()
        self.assertEqual(fixture["contract"], WORKLOAD_TREND_VERSION)
        self.assertGreaterEqual(len(fixture["cases"]), 12)

    def test_every_case_matches(self):
        _, fixture = _load()
        for case in fixture["cases"]:
            with self.subTest(case=case["name"]):
                actual = compute_workload_trend(case["sessions"], case["referenceDate"])
                self.assertEqual(actual, case["expected"])
                self.assertEqual(format_workload_trend(actual), case["expectedText"])

    def test_no_alarm_vocabulary(self):
        _, fixture = _load()
        for case in fixture["cases"]:
            text = format_workload_trend(
                compute_workload_trend(case["sessions"], case["referenceDate"])
            ).lower()
            for word in BANNED_WORDS:
                self.assertNotIn(word, text)


class WorkloadTrendEdgeTest(unittest.TestCase):
    def test_junk_input_never_claims_a_trend(self):
        for junk in (None, [], "nonsense", 42, [{"date": None}], [None]):
            trend = compute_workload_trend(junk, "2026-08-23")
            self.assertEqual(trend["status"], "insufficient")
            self.assertIsNone(trend["deltaPct"])
            self.assertEqual(format_workload_trend(trend), format_workload_trend(None))

    def test_bad_reference_date(self):
        self.assertEqual(compute_workload_trend([], "not-a-date")["status"], "insufficient")
        self.assertEqual(compute_workload_trend([], "")["status"], "insufficient")

    def test_future_rows_are_ignored(self):
        sessions = [
            {"date": "2026-07-20", "volumeKg": 1000},
            {"date": "2026-07-27", "volumeKg": 1000},
            {"date": "2026-08-03", "volumeKg": 1000},
            {"date": "2026-08-10", "volumeKg": 1000},
            {"date": "2026-08-18", "volumeKg": 1000},
            {"date": "2026-12-31", "volumeKg": 99999},
        ]
        trend = compute_workload_trend(sessions, "2026-08-23")
        self.assertEqual(trend["status"], "ok")
        self.assertEqual(trend["recentVolumeKg"], 1000)
        self.assertEqual(trend["recentSessions"], 1)

    def test_adapter_sums_sets_per_session(self):
        rows = [
            {"session_id": "s1", "load": 100},
            {"session_id": "s1", "load": 50},
            {"session_id": "s2", "load": 70},
            {"session_id": "orphan", "load": 999},
            {"session_id": "", "load": 999},
        ]
        out = sets_to_trend_sessions(
            rows,
            {"s1": "2026-08-19", "s2": "2026-08-20"},
            lambda row: row["load"],
        )
        self.assertEqual(
            sorted(out, key=lambda item: item["date"]),
            [
                {"date": "2026-08-19", "volumeKg": 150},
                {"date": "2026-08-20", "volumeKg": 70},
            ],
        )


if __name__ == "__main__":
    unittest.main()
