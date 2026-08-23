# GymApp v2 deployment

The v2 deployment must use new Yandex Function and frontend URLs. Do not
overwrite the legacy Render service or the old YDB function during validation.

## 1. Create a new Yandex Cloud Function

```bash
yc serverless function create --name gymapp-v2
yc serverless function get gymapp-v2
```

Deploy:

```bash
FUNCTION_ID="<function id>" ./scripts/deploy_function.sh
```

Entrypoint: `index.handler`. Runtime: Python 3.12.

### About the environment — read this before changing it

`yc serverless function version create` replaces the version's environment
**wholesale**: anything not passed via `--environment` is gone in the new
version. The script therefore **inherits the current `$latest` environment** and
lets shell variables override individual keys. It refuses to deploy if the
result would lose a key that the live version has; removing one is a separate,
deliberate act:

```bash
FUNCTION_ID="…" ENV_DROP="SPREADSHEET_ID,GOOGLE_CREDENTIALS_BASE64" ./scripts/deploy_function.sh
```

This is not hypothetical. Before 2026-08-23 the script built the list only from
shell variables and did not know about `SUPABASE_*` at all — following this
runbook would have deployed a version with no Supabase configuration and taken
production down on the spot. The Sheets-era variables (`SPREADSHEET_ID`,
`GOOGLE_CREDENTIALS_BASE64`, `AUTH_TOKEN`) are no longer required.

Check what would be sent without deploying:

```bash
FUNCTION_ID="<function id>" DRY_RUN=1 ./scripts/deploy_function.sh
```

Roll back to the previous version at any time:

```bash
yc serverless function version set-tag --id <previous version id> --tag '$latest'
```

The script prints the previous version id before and after deploying.

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
