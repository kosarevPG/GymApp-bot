# 🚀 Инструкция по настройке

## Шаг 1: Установка зависимостей

```bash
pip install -r requirements.txt
```

## Шаг 2: Настройка Google Sheets API

1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Создайте новый проект или выберите существующий
3. Включите API:
   - Google Sheets API
   - Google Drive API
4. Создайте Service Account:
   - Перейдите в "IAM & Admin" → "Service Accounts"
   - Нажмите "Create Service Account"
   - Заполните данные и создайте
   - Перейдите в созданный аккаунт → "Keys" → "Add Key" → "Create new key" → JSON
   - Сохраните файл как `credentials.json` в корне проекта
5. Скопируйте email Service Account (например: `your-service@project.iam.gserviceaccount.com`)

## Шаг 3: Создание Google Spreadsheet

1. Создайте новую Google таблицу
2. Переименуйте листы:
   - `Sheet1` → `LOG`
   - `Sheet2` → `EXERCISES`
   - `Sheet3` → `LAST_RESULTS`
3. Добавьте заголовки:

**Лист LOG:**
```
A1: Date
B1: Exercise
C1: Weight
D1: Reps
E1: Rest
F1: Set_Group_ID
```

**Лист EXERCISES:**
```
A1: Exercise Name
B1: Muscle Group
C1: Photo_File_ID
```

**Лист LAST_RESULTS:**
```
A1: Exercise Name
B1: Last Weight
C1: Last Reps
```

4. Поделитесь таблицей с email Service Account (права "Редактор")
5. Скопируйте ID таблицы из URL (между `/d/` и `/edit`)

## Шаг 4: Создание Telegram бота

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram
2. Отправьте `/newbot`
3. Следуйте инструкциям и получите токен
4. Отправьте `/newapp` и создайте Mini App:
   - Выберите вашего бота
   - Укажите название и описание
   - Загрузите иконку (опционально)
   - Укажите URL вашего фронтенда (где будет размещен index.html)

## Шаг 5: Настройка переменных окружения

1. Скопируйте `env.example` в `.env`:
```bash
cp env.example .env
```

2. Отредактируйте `.env`:
```env
BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
WEBAPP_URL=https://your-domain.com/
GOOGLE_CREDENTIALS_PATH=credentials.json
SPREADSHEET_ID=1a2b3c4d5e6f7g8h9i0j
```

## Шаг 6: Размещение фронтенда

Загрузите `index.html` на любой хостинг:
- GitHub Pages
- Netlify
- Vercel
- Ваш собственный сервер

Важно: URL должен быть HTTPS!

## Шаг 7: Запуск бота

```bash
python bot.py
```

Бот готов к работе! Отправьте `/start` в Telegram.

## 🎯 Первое использование

1. Отправьте `/add_exercise` для добавления первого упражнения
2. Введите название, выберите группу мышц, отправьте фото (или пропустите)
3. Отправьте `/start` и выберите упражнение
4. Запишите первый подход!

## ⚠️ Важные замечания

- Убедитесь, что `credentials.json` добавлен в `.gitignore`
- Не публикуйте `.env` файл в репозиторий
- Для продакшена используйте переменные окружения на сервере
- Рекомендуется использовать виртуальное окружение Python


