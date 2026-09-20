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
# Раньше здесь стояло условие на SPREADSHEET_ID и GOOGLE_CREDENTIALS_BASE64.
# После переезда на Supabase этих переменных не существует, и деплой бэкенда
# молча пропускался. Конфигурацию проверяет сам deploy_function.sh: он
# наследует окружение текущей версии и отказывается терять переменные.
./scripts/deploy_function.sh
echo "Backend deployed."

echo ""
echo "=== Готово ==="
