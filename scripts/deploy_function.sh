#!/bin/bash
# Деплой Cloud Function в Yandex Cloud
# Требуется: yc CLI, авторизация (yc init)
# Использование: ./scripts/deploy_function.sh [путь_к_backend]

set -e
BACK_DIR="${1:-backend}"
FUNCTION_ID="${FUNCTION_ID:-}"

if ! command -v yc &>/dev/null; then
  echo "Установите Yandex Cloud CLI: https://cloud.yandex.ru/docs/cli/quickstart"
  exit 1
fi

if [ -z "$FUNCTION_ID" ]; then
  echo "Задайте FUNCTION_ID новой Yandex Cloud Function. Старую функцию скрипт не перезаписывает."
  exit 1
fi

if [ -z "$SPREADSHEET_ID" ] || [ -z "$GOOGLE_CREDENTIALS_BASE64" ] || [ -z "$AUTH_TOKEN" ]; then
  echo "Для деплоя обязательны SPREADSHEET_ID, GOOGLE_CREDENTIALS_BASE64 и AUTH_TOKEN."
  exit 1
fi

cd "$(dirname "$0")/.."
BACK_ABS="$(cd "$BACK_DIR" 2>/dev/null && pwd || true)"
if [ -z "$BACK_ABS" ] || [ ! -d "$BACK_ABS" ]; then
  echo "Папка $BACK_DIR не найдена"
  exit 1
fi
ENV_ARGS=()
[ -n "$SPREADSHEET_ID" ] && ENV_ARGS+=(--environment "SPREADSHEET_ID=$SPREADSHEET_ID")
[ -n "$GOOGLE_CREDENTIALS_BASE64" ] && ENV_ARGS+=(--environment "GOOGLE_CREDENTIALS_BASE64=$GOOGLE_CREDENTIALS_BASE64")
[ -n "$AUTH_TOKEN" ] && ENV_ARGS+=(--environment "AUTH_TOKEN=$AUTH_TOKEN")
[ -n "$BOT_TOKEN" ] && ENV_ARGS+=(--environment "BOT_TOKEN=$BOT_TOKEN")
[ -n "$TELEGRAM_WEBHOOK_SECRET" ] && ENV_ARGS+=(--environment "TELEGRAM_WEBHOOK_SECRET=$TELEGRAM_WEBHOOK_SECRET")
[ -n "$FRONTEND_URL" ] && ENV_ARGS+=(--environment "FRONTEND_URL=$FRONTEND_URL")

echo "Деплой функции $FUNCTION_ID..."
DEPLOY_RESULT="$(yc serverless function version create \
  --function-id="$FUNCTION_ID" \
  --runtime=python312 \
  --entrypoint=index.handler \
  --memory=256m \
  --execution-timeout=30s \
  --source-path="$BACK_ABS" \
  --format=json \
  "${ENV_ARGS[@]}")"

echo "Готово."
