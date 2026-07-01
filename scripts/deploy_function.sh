#!/bin/bash
# Деплой Cloud Function в Yandex Cloud
# Требуется: yc CLI, авторизация (yc init)
# Использование: ./scripts/deploy_function.sh [путь_к_архиву]

set -e
BACK_DIR="${1:-../Gymtracker/Archive/back}"
FUNCTION_ID="${YDB_FUNCTION_ID:-d4errkd42gb1i7s41qsd}"

if ! command -v yc &>/dev/null; then
  echo "Установите Yandex Cloud CLI: https://cloud.yandex.ru/docs/cli/quickstart"
  exit 1
fi

cd "$(dirname "$0")/.."
ARCHIVE="$(pwd)/back.zip"
BACK_ABS="$(cd "$BACK_DIR" 2>/dev/null && pwd || true)"
if [ -z "$BACK_ABS" ] || [ ! -d "$BACK_ABS" ]; then
  echo "Папка $BACK_DIR не найдена"
  exit 1
fi
(cd "$BACK_ABS" && zip -r "$ARCHIVE" index.py ydb_store.py -x "*.pyc" -x "__pycache__/*")

ENV_ARGS=""
[ -n "$YDB_ENDPOINT" ] && ENV_ARGS="$ENV_ARGS --environment=YDB_ENDPOINT=$YDB_ENDPOINT"
[ -n "$YDB_DATABASE" ] && ENV_ARGS="$ENV_ARGS --environment=YDB_DATABASE=$YDB_DATABASE"
[ -n "$AUTH_TOKEN" ] && ENV_ARGS="$ENV_ARGS --environment=AUTH_TOKEN=$AUTH_TOKEN"
ENV_ARGS="$ENV_ARGS --environment=YDB_METADATA_CREDENTIALS=1"
ENV_ARGS="$ENV_ARGS --environment=YDB_LOG_TABLE=${YDB_LOG_TABLE:-workout_logs}"

echo "Деплой функции $FUNCTION_ID..."
yc serverless function version create \
  --function-id="$FUNCTION_ID" \
  --runtime=python312 \
  --entrypoint=index.handler \
  --memory=256m \
  --source-path="$ARCHIVE" \
  $ENV_ARGS

rm -f "$ARCHIVE"
echo "Готово."
