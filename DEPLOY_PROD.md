# GymApp v2 deployment

The v2 deployment must use new Yandex Function and frontend URLs. Do not
overwrite the legacy Render service or the old YDB function during validation.

## 1. Create a new Yandex Cloud Function

```bash
yc serverless function create --name gymapp-v2
yc serverless function get gymapp-v2
```

Export the returned function ID and backend secrets:

```bash
export FUNCTION_ID="<new function id>"
export SPREADSHEET_ID="<spreadsheet id>"
export GOOGLE_CREDENTIALS_JSON='<complete service account JSON>'
export AUTH_TOKEN="<long random token>"
export FRONTEND_URL="https://<user>.github.io/GymApp/"
```

Optional Telegram webhook variables:

```bash
export BOT_TOKEN="<telegram bot token>"
export TELEGRAM_WEBHOOK_SECRET="<random secret>"
```

Deploy:

```bash
./scripts/deploy_function.sh
```

Entrypoint: `index.handler`. Runtime: Python 3.12.

## 2. Verify the backend

```bash
curl -H "Authorization: $AUTH_TOKEN" \
  "https://functions.yandexcloud.net/$FUNCTION_ID?url=/api/ping"

curl -H "Authorization: $AUTH_TOKEN" \
  "https://functions.yandexcloud.net/$FUNCTION_ID?url=/api/init"
```

Do not test `save_set` against production until the read-only endpoints and a
spreadsheet backup have been verified.

## 3. Deploy the frontend

Create `front/.env.local`:

```dotenv
VITE_API_BASE_URL=https://functions.yandexcloud.net/<new function id>
```

Then:

```bash
cd front
npm run build
npm run deploy
```

## 4. Telegram

After the new frontend passes acceptance testing, either:

1. set the bot menu button to the new GitHub Pages URL in BotFather; or
2. configure Telegram webhook `/api/telegram` on the new function.

Keep the old Telegram button and Render service unchanged until v2 has been
tested during a real workout.
