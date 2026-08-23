#!/bin/bash
# Полный деплой gymtracker в PROD
# Frontend → GitHub Pages, Backend → Yandex Cloud Function

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== 1. Сборка frontend ==="
cd front
npm run build
echo "Build OK."

echo ""
echo "=== 2. Деплой frontend (GitHub Pages) ==="
npm run deploy
echo "Frontend deployed."

echo ""
echo "=== 3. Деплой backend (Yandex Cloud Function) ==="
cd "$ROOT"
if [ -n "$SPREADSHEET_ID" ] && [ -n "$GOOGLE_CREDENTIALS_BASE64" ]; then
  ./scripts/deploy_function.sh
  echo "Backend deployed."
else
  echo "Пропуск: задайте SPREADSHEET_ID и GOOGLE_CREDENTIALS_BASE64 для деплоя бэкенда."
fi

echo ""
echo "=== Готово ==="
