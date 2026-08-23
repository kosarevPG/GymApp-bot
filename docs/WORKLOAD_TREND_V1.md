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

## What the fixture hash does and does not guarantee

Each repo pins the sha256 above in three places — this document, its fixture,
and its test — and asserts all three agree after normalising CRLF.

**It guarantees**, inside one repo: the fixture cannot be edited unnoticed. Any
change to it fails that repo's suite until the hash is deliberately re-pinned in
both the doc and the test.

**It does not guarantee** anything across repos. Each suite hashes its *own*
copy, so a self-consistent one-sided change — edit the implementation, edit the
fixture, re-pin the hash, all in one repo — leaves both suites green while the
two apps compute or render different things. This was verified rather than
assumed: changing only GymApp's insufficiency sentence and re-pinning its hash
kept GymApp at 8/8 and HealthOS green, with the two apps showing different text
for the same state.

The real cross-repo check is therefore a separate, explicit one.

## Cross-repo drift check

`scripts/check-contract-drift.mjs` in **HealthOS** compares the local contract
and fixture against GymApp-bot's copies on `main`, and runs as the
`contract drift (workload-trend-v1)` CI job.

The direction is deliberate. GymApp-bot is public, so HealthOS reads it with no
credentials at all. The reverse would require giving a **public** repo a token
for a **private** one, which is a worse trade than the check is worth — so
GymApp's CI performs only the intra-repo three-way check, and the cross-repo
comparison lives on the HealthOS side alone.

It reads the peer through the **GitHub Contents API**, not
`raw.githubusercontent`. The raw host is CDN-fronted and kept serving a
pre-merge copy for minutes after a push, ignoring both `Cache-Control: no-cache`
and a cache-busting query parameter — measured during this work, not assumed.
A stale read there yields a *false* DRIFT, which is worse than a SKIP: it blocks
a correct merge and teaches everyone to ignore the job. The API returned the
fresh blob immediately in the same test.

Availability is never a failure: the script exits 0 with a `SKIP` notice when
the API is unreachable, rate-limits, or the file is absent (which is normal while
one side's change has not merged yet), and retries once on a transient 5xx. It
exits non-zero only when both files are read and genuinely differ.

```bash
node scripts/check-contract-drift.mjs
```

## Changing this contract

1. Edit `docs/fixtures/workload-trend-v1.json`.
2. Copy it to the other repo — nothing detects this for you at edit time; the
   drift job catches it after the first side merges.
3. Re-pin the hash in `docs/WORKLOAD_TREND_V1.md`, in
   `medical/tests/workload-trend.test.mjs` and in
   `backend/test_workload_trend.py`, in both repos.
4. Update both implementations until the shared cases pass again.
5. Land both PRs close together. Between the two merges the drift job reports a
   mismatch, and that is correct — the contract really is inconsistent then.

A behaviour change that is not backwards compatible gets a new version
(`workload-trend-v2`) rather than a silent edit of this one.
