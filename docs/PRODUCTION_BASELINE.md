# Production baseline — gym_* tables

Authoritative row counts. Any deviation is a defect until proven otherwise.

| Table | Rows |
|---|---|
| `gym_exercises` | **60** |
| `gym_workout_sessions` | **49** |
| `gym_sets` | **1122** |
| `gym_set_groups` | **261** |
| orphan rows | **0** |

Set on 2026-08-24, superseding the earlier 60 / 50 / 1123 / 262.

## Why the numbers moved

One session was lost during the Release B rollout: `2026-08-23`,
`source_record_id = live:e96b22f8-695a-40b0-916a-57f3a33db4f6`, id
`0ef2d353-3b04-5d95-a909-66f8711df135`, together with its one set and one set
group by FK cascade. It was the only session ever entered live through the app;
all 49 backfilled sessions from the Google Sheets import are intact.

`pg_stat_statements` shows the removal came through
`DELETE FROM public.gym_workout_sessions WHERE user_id = $1 AND id = $2` issued
via PostgREST — the shape `delete_workout` uses. **Which call it was has not
been established**, and no claim about the cause is recorded here without
evidence for it.

PITR was disabled and no logical backups existed, so there was no restore path.
The pre-deploy backup taken that day covered `med_catalog`, `meds` and `med_log`
only — scoped to the issue being worked on rather than to the release, which is
the planning mistake that made the loss permanent.

The record is treated as test data, deliberately not restored, by the owner's
decision on 2026-08-24.

## Rules that follow from it

1. **No write-smoke against production.** Verification runs read-only. The
   Release A smoke created a throwaway session and deleted it again; even
   though its counts returned to baseline at the time, that class of test is no
   longer run here. Exercise write paths against a local or staging store.
2. **Any release that touches the database backs up every table it can reach**,
   not only the ones named in the ticket.
3. A deletion journal that snapshots a session with its groups and sets before
   the FK cascade is tracked separately; until it exists, a deletion leaves no
   evidence behind.

## Re-checking the baseline

Read-only, `GET` only:

```bash
python scratchpad/gym_counts.py
```

Expected signature:

```
{"gym_exercises": 60, "gym_set_groups": 261, "gym_sets": 1122, "gym_workout_sessions": 49}
```
