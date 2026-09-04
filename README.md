# GymApp v2

Offline-first Telegram Mini App for recording gym workouts.

## Architecture

```text
Telegram
  → React/Vite on GitHub Pages
  → local cache + durable offline queue
  → Yandex Cloud Function
  → Supabase normalized gym tables
```

The UI never waits for the backend before accepting a completed set. Every set
is stored locally with a stable `client_request_id` and synchronized in the
background. The backend deduplicates retries.

## Project layout

- `front/` — React/Vite Mini App.
- `backend/` — Yandex Cloud Function validating Telegram `initData` and using
  the Supabase adapter.
- `scripts/deploy_function.sh` — safe backend deployment; requires an explicit
  new `FUNCTION_ID`.

## Local checks

```powershell
$env:PYTHONPATH=(Resolve-Path backend).Path
python -m unittest discover -s backend -p "test_*.py" -v

cd front
npm install
npm run build
```

## Configuration

Frontend:

```bash
cp front/.env.example front/.env.local
```

Backend environment:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (server-only)
- `BOT_TOKEN`
- `TELEGRAM_USER_MAP`
- `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` (optional, default `86400`)
- `TELEGRAM_WEBHOOK_SECRET` (required when the webhook is enabled)
- `FRONTEND_URL`

See `DEPLOY_PROD.md` for deployment.

## Backup

The pre-v2 implementation — the aiogram bot on Render and its Google Sheets
adapter — is preserved in:

- Git branch `codex/backup-google-sheets-2026-07-01`
- local backup directory `D:\Projects\GymApp-backups\2026-07-01-before-v2`

The local backup contains the workspace archive, Git bundle, a mirror of the
published `GymApp-frontend` repository, and a separate local secrets directory.
