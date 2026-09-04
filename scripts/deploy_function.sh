#!/bin/bash
# Деплой Cloud Function в Yandex Cloud.
# Требуется: yc CLI, авторизация (yc init), python3.
# Использование: ./scripts/deploy_function.sh [путь_к_backend]
#
# ВАЖНО про окружение.
# `yc serverless function version create` задаёт окружение новой версии ЦЕЛИКОМ:
# всё, что не передано через --environment, в новой версии просто исчезает.
# Прежняя версия этого скрипта собирала список только из переменных оболочки и
# не знала про SUPABASE_* вовсе — то есть выкатывала прод без конфигурации
# Supabase. На 2026-08-23 живая версия несла 11 переменных, из которых скрипт
# передал бы 6: SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_AUTH_API_KEY,
# TELEGRAM_USER_MAP и TELEGRAM_INIT_DATA_MAX_AGE_SECONDS пропали бы, и функция
# перестала бы работать сразу после деплоя.
#
# Теперь по умолчанию окружение НАСЛЕДУЕТСЯ у текущей версии ($latest), а
# переменные оболочки лишь переопределяют одноимённые ключи. Удаление ключа —
# отдельное осознанное действие: ENV_DROP="KEY1,KEY2".

set -euo pipefail
BACK_DIR="${1:-backend}"
FUNCTION_ID="${FUNCTION_ID:-}"

if ! command -v yc &>/dev/null; then
  echo "Установите Yandex Cloud CLI: https://cloud.yandex.ru/docs/cli/quickstart" >&2
  exit 1
fi
if ! command -v python3 &>/dev/null && ! command -v python &>/dev/null; then
  echo "Нужен python3 — скрипт им собирает окружение новой версии." >&2
  exit 1
fi
PY="$(command -v python3 || command -v python)"

if [ -z "$FUNCTION_ID" ]; then
  echo "Задайте FUNCTION_ID. Старую функцию скрипт не перезаписывает." >&2
  exit 1
fi

cd "$(dirname "$0")/.."
BACK_ABS="$(cd "$BACK_DIR" 2>/dev/null && pwd || true)"
if [ -z "$BACK_ABS" ] || [ ! -d "$BACK_ABS" ]; then
  echo "Папка $BACK_DIR не найдена" >&2
  exit 1
fi

echo "Читаю окружение текущей версии функции $FUNCTION_ID..."
CURRENT_JSON="$(yc serverless function version get-by-tag \
  --function-id="$FUNCTION_ID" --tag='$latest' --format=json 2>/dev/null || echo '{}')"

# Пишем во временный файл: значения могут содержать переводы строк и кавычки.
ENV_FILE="$(mktemp)"
DROP_LIST="${ENV_DROP:-}"
trap 'rm -f "$ENV_FILE"' EXIT

CURRENT_JSON="$CURRENT_JSON" DROP_LIST="$DROP_LIST" "$PY" - "$ENV_FILE" <<'PYEOF'
import json, os, sys

out_path = sys.argv[1]
current = json.loads(os.environ.get("CURRENT_JSON") or "{}")
inherited = dict(current.get("environment") or {})
drop = {k.strip() for k in (os.environ.get("DROP_LIST") or "").split(",") if k.strip()}

# Ключи, которые бэкенд умеет читать. Переменная оболочки применяется, только
# если она есть в окружении, — пустая строка это тоже осознанное значение.
KNOWN = [
    "SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_AUTH_API_KEY",
    "BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_USER_MAP",
    "TELEGRAM_INIT_DATA_MAX_AGE_SECONDS", "FRONTEND_URL",
    "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT",
]

final = dict(inherited)
overridden = []
for key in KNOWN:
    if key in os.environ:
        if inherited.get(key) != os.environ[key]:
            overridden.append(key)
        final[key] = os.environ[key]

dropped = sorted(drop & set(final))
for key in dropped:
    del final[key]

missing = sorted(set(inherited) - set(final) - set(dropped))
if missing:
    sys.stderr.write(
        "ОТКАЗ: новая версия потеряла бы переменные, которые есть в текущей: "
        + ", ".join(missing)
        + "\nЭто почти всегда означает обрыв прода. Передайте их явно или "
          'удалите осознанно через ENV_DROP="KEY1,KEY2".\n'
    )
    sys.exit(2)

with open(out_path, "w", encoding="utf-8") as fh:
    for key, value in sorted(final.items()):
        fh.write(key + "\0" + (value or "") + "\0")

sys.stderr.write("унаследовано из $latest : %d\n" % len(inherited))
sys.stderr.write("переопределено из shell : %s\n" % (", ".join(overridden) or "(нет)"))
sys.stderr.write("удалено через ENV_DROP  : %s\n" % (", ".join(dropped) or "(нет)"))
sys.stderr.write("итого переменных        : %d — %s\n" % (len(final), ", ".join(sorted(final))))
PYEOF

ENV_ARGS=()
while IFS= read -r -d '' key && IFS= read -r -d '' value; do
  ENV_ARGS+=(--environment "$key=$value")
done < "$ENV_FILE"

if [ "${#ENV_ARGS[@]}" -eq 0 ]; then
  echo "ОТКАЗ: не собрано ни одной переменной окружения." >&2
  exit 1
fi

# Каждая переменная занимает два элемента массива: --environment и KEY=VALUE.
ENV_COUNT=$(( ${#ENV_ARGS[@]} / 2 ))

if [ -n "${DRY_RUN:-}" ]; then
  echo "DRY_RUN: деплой не выполняется. Переменных к передаче: $ENV_COUNT."
  exit 0
fi

PREVIOUS_VERSION="$(printf '%s' "$CURRENT_JSON" | "$PY" -c 'import json,sys; print((json.load(sys.stdin) or {}).get("id",""))' 2>/dev/null || true)"
echo "Откат при проблеме: yc serverless function version set-tag --id ${PREVIOUS_VERSION:-<см. version list>} --tag '\$latest'"

echo "Деплой функции $FUNCTION_ID..."
yc serverless function version create \
  --function-id="$FUNCTION_ID" \
  --runtime=python312 \
  --entrypoint=index.handler \
  --memory=256m \
  --execution-timeout=30s \
  --source-path="$BACK_ABS" \
  --format=json \
  "${ENV_ARGS[@]}" > /dev/null

echo "Готово. Предыдущая версия: ${PREVIOUS_VERSION:-неизвестна}"
