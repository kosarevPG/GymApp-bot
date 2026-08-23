# Where a workout note belongs

Three stores hold free text about training. They are not interchangeable, and
nothing should copy text between them. This file is kept identical in the
HealthOS and GymApp repositories.

| Store | Grain | Written by | Holds |
|---|---|---|---|
| `gym_sets.note` | one set | GymApp | What happened in **that set** |
| `gym_workout_sessions.session_note` | one session | GymApp | Technical comment on **that session** |
| `episodes` + `metadata.workout_reflection` | one session | HealthOS | Wellbeing, sleep, pain, reflection |

## `gym_sets.note` — one set

Scope is a single set of a single exercise: "последний повтор с читингом",
"сорвался хват", "сменил угол скамьи". If the remark is not about one specific
set, it does not go here.

`gym_sets.legacy_note` sits beside it and is **read-only history**: it holds
notes carried over from the Google Sheets era by the 2026-08-23 import. Nothing
writes to it. As of that import 710 sets carry a `legacy_note` and 0 carry a
`note`.

## `gym_workout_sessions.session_note` — one session, technical

Scope is the session as a training unit: "тренажёр занят, заменил тягу",
"зал закрывался, свернул программу", "новая штанга, вес другой". Facts about
how the session ran, written in GymApp where the session is being logged.

Not for how the body felt — that is the third store.

## `episodes` / `workout_reflection` — one session, subjective

Written by HealthOS as its own `episodes` row, `type: 'workout_note'`, with:

```json
{
  "ingest": "web_manual_v1",
  "workout_reflection": {
    "session_id": "<gym_workout_sessions.id>",
    "wellbeing": 4,
    "sleep": 3,
    "pain": 2,
    "technique": "берегу правое плечо"
  }
}
```

Scope is how the session felt and what it cost: самочувствие, сон, боль,
техника, свободная рефлексия. It lives in `episodes` and not in `gym_*` because
it belongs to the same subjective layer as pain reports and dictated notes from
the Telegram bot, and because HealthOS holds **no write grant on `gym_*`** —
see below.

### session_id, and what happens without it

`session_id` is the binding. Before it existed, reflections were keyed by
`start` (a date), so two sessions on one day shared a diary and each showed the
other's notes.

Resolution rules, implemented in `medical/src/lib/workoutReflections.js` and
covered by `medical/tests/workout-reflections.test.mjs`:

1. `session_id` present and the session is loaded → bound to that session.
2. `session_id` present but no such session → shown once as unassigned, never
   silently re-bound by date.
3. No `session_id` (legacy row) and the day holds **exactly one** session →
   bound to it by date.
4. No `session_id` and the day holds zero or several sessions → left
   day-level/unassigned and rendered once, below the history, not beside each
   workout.

Rule 4 is the point of the exercise: a guess between two sessions is worse than
an honest "not attributed".

No migration backfills `session_id` into existing rows. As of 2026-08-23 there
are 5 reflections in production, all on days with exactly one session, so rule 3
resolves every one of them; rule 4 is currently unreachable in this data and
exists for the first double day.

## Direction of writes

```
GymApp    ──writes──>  gym_exercises · gym_workout_sessions · gym_set_groups · gym_sets
HealthOS  ──reads───>  gym_exercise_history · gym_workout_projection   (views, select-only)
HealthOS  ──writes──>  episodes                                        (its own subjective layer)
```

HealthOS has **select-only** grants on the `gym_*` tables and must keep them.
"HealthOS is read-only" is precise about training data and only about training
data: it has always written its own `episodes` rows, and the reflection diary is
one of them. Adding a second writer to `gym_*` is what the rule forbids — not
HealthOS storing its own observations.

To correct training data from HealthOS, use the «Исправить в GymApp» button,
which deep-links to `?session=<uuid>` in GymApp. Editing happens in the app that
owns the row.
