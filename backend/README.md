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
