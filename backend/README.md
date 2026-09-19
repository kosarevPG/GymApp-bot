# GymApp v2 backend

Yandex Cloud Function that stores workouts in Supabase.

## Environment

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (server-only `sb_secret_...`; legacy service-role JWT is
  accepted through `SUPABASE_SERVICE_ROLE_KEY` during key migration)
- `BOT_TOKEN` (required for Telegram Mini App `initData` verification)
- `TELEGRAM_USER_MAP` (required JSON allowlist: Telegram user ID to Supabase
  `auth.users.id`, for example `{"123456789":"...uuid..."}`)
- `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` (optional, default `86400`)
- `TELEGRAM_WEBHOOK_SECRET` (required when the Telegram webhook is enabled)
- `FRONTEND_URL` (required for the `/start` button)

Entrypoint: `index.handler`.

Every Mini App request must include the unmodified `Telegram.WebApp.initData`
in `X-Telegram-Init-Data`. The backend validates its HMAC and age, checks the
allowlist, and supplies `user_id` to the storage adapter itself.

The Supabase secret must exist only in the Yandex Function environment. Never
put it in Vite variables, GitHub Pages, or the repository.

`save_set` requires the timezone-aware `performed_at` captured when the item
enters the offline queue. The adapter converts it to `Europe/Moscow`, derives
`workout_date`, and maintains session bounds from the minimum/maximum actual
set timestamps. Reads page through the complete Data API result instead of
assuming the default 1000-row response is complete.

A repeated `save_set` with an already stored `client_request_id` answers
`deduplicated` and, if the editable fields (weights, reps, rest, set type,
RPE/RIR, note) differ from the row, applies them and adds `updated: true`. A
retry after a lost response may carry an edit made while the first request was
in flight; answering "already saved" would drop it. The client aborts a queued
request only after 35 s, longer than the function's 30 s execution timeout, so
an abandoned request cannot land after its own retry.

`save_set` and a weight edit through `update_set` may carry `load`: the rules
the client used to turn the typed number into the total (`type`, `mult`,
`base`, and `bw` for bodyweight and assisted exercises). It is stored as
`source_payload.load` on the set and returned with it in history, so a later
change of the exercise's settings does not reinterpret old numbers. Anything
that is not a recognisable snapshot is dropped. Sets saved before this have no
`load`; the client reads them by the exercise's current settings. No stored
weight is ever rewritten.

`delete_set` with `missing_ok: true` treats an absent row as deleted. The
offline queue sends it: its deletes may target sets that never reached the
server or repeat a delete whose answer was lost. Without the flag (history
screen) an absent row is still an error. When a superset loses all but one
exercise, its group becomes `single` again.

`delete_workout` should receive `session_id`. The legacy date-only form is
accepted only when that date resolves to exactly one owner session; ambiguity
returns HTTP 409. Deleting a workout sends one owner-scoped session DELETE and
relies on the database foreign-key cascades.
