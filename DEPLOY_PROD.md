# Деплой gymtracker в PROD

## Архитектура

- **Frontend**: React + Vite → GitHub Pages
- **Backend**: Yandex Cloud Function (Python 3.12) + YDB

## Чеклист перед деплоем

- [ ] `npm run build` в `front/` — сборка без ошибок
- [ ] Переменные YDB и AUTH_TOKEN заданы (для бэкенда)
- [ ] Миграция YDB выполнена (если таблицы уже существуют)

---

## 1. Миграция YDB (при первом деплое или изменении схемы)

```bash
cd /path/to/Gymtracker/Archive/back
export YDB_ENDPOINT="grpcs://ydb.serverless.yandexcloud.net:2135"
export YDB_DATABASE="/ru-central1/b1g.../etn..."
export YDB_METADATA_CREDENTIALS=1   # или YDB_SERVICE_ACCOUNT_KEY_FILE_CREDENTIALS=path/to/key.json

pip install ydb
python run_migration_analytics.py
```

---

## 2. Деплой Backend (Yandex Cloud Function)

Требуется: [Yandex Cloud CLI](https://cloud.yandex.ru/docs/cli/quickstart), `yc init`

```bash
cd GymApp
export YDB_ENDPOINT="grpcs://ydb.serverless.yandexcloud.net:2135"
export YDB_DATABASE="/ru-central1/b1g.../etn..."
export AUTH_TOKEN="ваш_секретный_токен"

./scripts/deploy_function.sh
```

Путь к бэкенду по умолчанию: `../Gymtracker/Archive/back` (соседняя папка с GymApp). Или: `./scripts/deploy_function.sh /путь/к/back`.

---

## 3. Деплой Frontend (GitHub Pages)

```bash
cd GymApp/front
npm run deploy
```

Публикует `dist/` в ветку `gh-pages`. URL: `https://<user>.github.io/GymApp/`

**Важно:** В `vite.config.ts` задан `base: '/GymApp/'` — для корневого репозитория измените на `base: '/'`.

---

## 4. Переменные окружения

### Frontend (build-time)

| Переменная | Описание |
|------------|----------|
| `VITE_API_BASE_URL` | URL Cloud Function (по умолчанию: `https://functions.yandexcloud.net/d4errkd42gb1i7s41qsd`) |

### Backend (Yandex Cloud Function)

| Переменная | Описание |
|------------|----------|
| `YDB_ENDPOINT` | Endpoint YDB |
| `YDB_DATABASE` | Путь к базе |
| `AUTH_TOKEN` | Секретный токен для API |
| `YDB_METADATA_CREDENTIALS` | `1` — использовать metadata сервисного аккаунта |
| `YDB_LOG_TABLE` | `workout_logs` (по умолчанию) |

---

## Быстрый деплой (всё сразу)

```bash
# 1. Сборка
cd GymApp/front && npm run build

# 2. Деплой фронта
npm run deploy

# 3. Деплой бэка (если нужен)
cd .. && ./scripts/deploy_function.sh
```
