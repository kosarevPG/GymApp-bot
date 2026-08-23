# workload-trend-v1

Shared contract between **HealthOS** and **GymApp**. This file is kept
identical in both repositories.

| | |
|---|---|
| HealthOS implementation | `medical/src/lib/workloadTrend.js` |
| GymApp implementation | `backend/workload_trend.py` |
| Shared fixtures | `docs/fixtures/workload-trend-v1.json` |
| Fixture sha256 (CRLF-normalised) | `619c4854797130089ad8b458e7cf016ed5b3ec83da45eeda415c13fde5a40e90` |

## Why this replaced ACWR

Both apps used to compute an acute:chronic workload ratio from tonnage and
render it as a judgement — GymApp showed a red "риск перетренированности.
Снизьте нагрузку" banner above ratio 1.5, HealthOS coloured its KPI tile red
above 1.3. Three problems, in increasing order of severity:

1. **Two implementations, two thresholds.** The same metric disagreed with
   itself across the two apps.
2. **The denominator was coupled.** Chronic load was the 28-day sum divided by
   four, and those 28 days *included* the 7 acute days, so the acute window sat
   on both sides of the ratio. This is one of the specific pitfalls in
   Impellizzeri et al., *Acute:Chronic Workload Ratio: Conceptual Issues and
   Fundamental Pitfalls* ([PMID 32502973](https://pubmed.ncbi.nlm.nih.gov/32502973/)).
3. **The interpretation was not supportable.** Tonnage summed across unlike
   exercises is not a load measure that justifies an injury-risk claim.

`workload-trend-v1` keeps the useful part — "this week is heavier or lighter
than the recent norm" — and drops the claim. It is a **description**, not a
warning.

## Windows

Days are counted back from `referenceDate` inclusive, day 1 being the reference
date itself. All date maths is done on `YYYY-MM-DD` strings in UTC so a DST
transition can never move a session between buckets.

| Window | Days back | Offsets from reference |
|---|---|---|
| recent | 1–7 | 0–6 |
| baseline | 8–35 | 7–34 |

The two windows are **disjoint** — that is the fix for the coupled denominator.

```
baselineWeeklyVolumeKg = baselineVolumeKg / 4
deltaPct               = round((recentVolumeKg - baselineWeeklyVolumeKg)
                               / baselineWeeklyVolumeKg * 100)
```

## Input

One entry per workout **session**, not per day. Two sessions on the same date
stay two entries and are summed — the session is the unit, so `recentSessions`
and `baselineSessions` stay honest counts.

```json
[{ "date": "2026-08-19", "volumeKg": 1200 }]
```

A row is ignored when its date is not `YYYY-MM-DD`, its volume is not a finite
number, its volume is `<= 0` (a zero-volume row is a logging artefact, not a
session), or its date is in the future. Non-list input is treated as no history
rather than raising.

Each app owns its adapter into this shape:
`workoutsToTrendSessions` (HealthOS) and `sets_to_trend_sessions` (GymApp).

## Output

```json
{
  "version": "workload-trend-v1",
  "status": "ok" | "insufficient",
  "reason": null | "short-history" | "no-baseline-volume",
  "recentVolumeKg": 1480,
  "baselineVolumeKg": 4000,
  "baselineWeeklyVolumeKg": 1000,
  "deltaPct": 48,
  "recentSessions": 2,
  "baselineSessions": 4
}
```

Volumes are rounded to one decimal, `deltaPct` to a whole percent. `deltaPct`
is `null` whenever `status` is `insufficient`.

## Sufficiency

`status` is `insufficient` when either holds, checked in this order:

1. **`short-history`** — the earliest session on record is newer than the start
   of the baseline window (offset 34). The window is only partly covered, so
   the divisor reflects when logging started rather than how training changed.
   No history at all also lands here.
2. **`no-baseline-volume`** — history is long enough but the baseline window
   itself is empty (a break in training).

There is deliberately **no minimum session count**. A threshold would be
another magic number of the kind this contract exists to remove. Instead
`baselineSessions` is always reported and always rendered, so a comparison
resting on one session says so out loud.

## Rendering

The text is produced by the implementation, not by the UI, so both apps read
the same sentence. Rounding uses **half away from zero** (`-0.5 → -1`,
`0.5 → 1`) because `Math.round` breaks ties toward +∞ and Python's `round` uses
banker's rounding; neither matches the other, so both sides implement it
explicitly.

```
Объём последних 7 дней на 48% выше среднего за предыдущие четыре недели (4 тренировки в базовом периоде).
Объём последних 7 дней на 35% ниже среднего за предыдущие четыре недели (4 тренировки в базовом периоде).
Объём последних 7 дней совпадает со средним за предыдущие четыре недели (4 тренировки в базовом периоде).
Недостаточно данных для сравнения: нужна история за предыдущие четыре недели.
```

Presentation rules, enforced by tests in both repos:

- **No risk vocabulary.** `риск`, `опасн`, `оптимальн`, `перетрен`, `снизьте`
  and `ACWR` are asserted absent from the rendered text.
- **No traffic lights.** The readout uses the same neutral foreground colour
  regardless of sign. A red/amber/green scale would reintroduce the threshold
  through styling, which is the same claim in another form.
- **No recommendation.** The contract states what happened to volume. What to
  do about it is not its job.

## Changing this contract

The fixture file is byte-identical in both repos and both test suites assert
the sha256 above (after normalising CRLF). To change behaviour:

1. Edit `docs/fixtures/workload-trend-v1.json`.
2. Copy it to the other repo.
3. Update the hash in `docs/WORKLOAD_TREND_V1.md`,
   `medical/tests/workload-trend.test.mjs` and
   `backend/test_workload_trend.py` in both repos.
4. Update both implementations until the shared cases pass again.

Skipping step 2 makes both suites fail, which is the intended behaviour.
A behaviour change that is not backwards compatible gets a new version
(`workload-trend-v2`) rather than a silent edit of this one.
