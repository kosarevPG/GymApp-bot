# GymApp v2 backend

Yandex Cloud Function that stores workouts in the existing Google Spreadsheet.

## Environment

- `SPREADSHEET_ID`
- `GOOGLE_CREDENTIALS_BASE64`
- `AUTH_TOKEN`
- `BOT_TOKEN` (optional Telegram webhook)
- `TELEGRAM_WEBHOOK_SECRET` (recommended for Telegram webhook)
- `FRONTEND_URL` (required for the `/start` button)

Entrypoint: `index.handler`.

The first successful `save_set` request extends `LOG` with the optional columns
`Set_Type`, `RPE`, `RIR`, `Session_ID`, and `Client_Request_ID`. Existing
columns and formulas are preserved.
