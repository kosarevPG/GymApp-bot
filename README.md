# gymtracker - Telegram Mini App

Telegram-бот с веб-интерфейсом для записи подходов в тренажерном зале.

## 🚀 Возможности

- 📝 Запись подходов через удобный интерфейс с барабанами выбора (iOS style)
- 💾 Автоматическая подстановка весов с прошлой тренировки
- 🔄 Поддержка суперсетов (запись нескольких упражнений пакетом)
- 📸 Отображение фото тренажера в чате
- 📊 Хранение данных в Google Sheets

## 📋 Требования

- Python 3.10+
- Google Spreadsheet с 3 листами: LOG, EXERCISES, LAST_RESULTS
- Telegram Bot Token
- Хостинг для фронтенда (index.html) - рекомендуется GitHub Pages (бесплатно)
- Хостинг для бота - рекомендуется Render.com (бесплатно)

## 🚀 Быстрый старт

### Вариант 1: Локальная разработка

См. подробную инструкцию в [SETUP.md](SETUP.md)

### Вариант 2: Деплой на Render.com + GitHub Pages (рекомендуется)

См. подробную инструкцию в [DEPLOY.md](DEPLOY.md)

**Кратко:**
1. Frontend → GitHub Pages (бесплатно, HTTPS)
2. Backend → Render.com (бесплатно, с keep-alive сервером)
3. Google Credentials → переменная окружения `GOOGLE_CREDENTIALS_JSON`

## 🛠 Установка (локальная разработка)

### 1. Клонирование и установка зависимостей

```bash
pip install -r requirements.txt
```

### 2. Настройка Google Sheets API

1. Создайте проект в [Google Cloud Console](https://console.cloud.google.com/)
2. Включите Google Sheets API и Google Drive API
3. Создайте Service Account и скачайте JSON ключ
4. Сохраните файл как `credentials.json` в корне проекта
5. Поделитесь вашей Google таблицей с email из Service Account

### 3. Создание Google Spreadsheet

Создайте таблицу с тремя листами:

**Лист 1: LOG**
- Колонка A: Date (dd.mm.yyyy hh:mm)
- Колонка B: Exercise (String)
- Колонка C: Weight (Float)
- Колонка D: Reps (Integer)
- Колонка E: Rest (Integer, seconds)
- Колонка F: Set_Group_ID (String/UUID)

**Лист 2: EXERCISES**
- Колонка A: Exercise Name
- Колонка B: Muscle Group
- Колонка C: Photo_File_ID (Telegram file_id)

**Лист 3: LAST_RESULTS**
- Колонка A: Exercise Name
- Колонка B: Last Weight
- Колонка C: Last Reps

### 4. Настройка переменных окружения

Скопируйте `env.example` в `.env` и заполните:

```bash
cp env.example .env
```

Отредактируйте `.env`:
- `BOT_TOKEN` - токен от @BotFather
- `WEBAPP_URL` - URL где размещен index.html
- `GOOGLE_CREDENTIALS_PATH` - путь к credentials.json (для локальной разработки)
- `SPREADSHEET_ID` - ID вашей Google таблицы

**Для деплоя на Render.com:**
- Используйте `GOOGLE_CREDENTIALS_JSON` вместо `GOOGLE_CREDENTIALS_PATH`
- Вставьте весь JSON из credentials.json как одну строку

### 5. Размещение фронтенда

**Вариант 1: GitHub Pages (рекомендуется, бесплатно)**
1. Создайте репозиторий на GitHub
2. Загрузите `index.html`
3. Включите GitHub Pages в настройках
4. Получите URL вида: `https://ваш-ник.github.io/репозиторий/`

**Вариант 2: Другой хостинг**
Загрузите `index.html` на любой хостинг с HTTPS и укажите URL в `WEBAPP_URL`.

## 🎮 Использование

### Локальный запуск бота

```bash
python bot.py
```

Бот запустится в режиме polling с keep-alive сервером на порту 8000.

### Деплой на Render.com

См. подробную инструкцию в [DEPLOY.md](DEPLOY.md)

**Важно для Render.com:**
- На бесплатном тарифе сервер "засыпает" через 15 минут бездействия
- Первый запрос после "сна" может занять 30-50 секунд
- Для личного использования это нормально

### Команды бота

- `/start` - Показать меню с группами мышц
- `/add_exercise` - Добавить новое упражнение

### Работа с ботом

1. Отправьте `/start`
2. Выберите группу мышц
3. Выберите упражнение
4. Бот отправит фото тренажера (если есть) и кнопку "Записать подход"
5. В открывшемся WebApp выберите вес, повторы и отдых
6. Нажмите "Добавить в сет (+)" для суперсетов
7. Нажмите "Сохранить и закрыть"

## 📁 Структура проекта

```
gymtracker/
├── bot.py                 # Основной файл бота
├── google_sheets.py       # Модуль для работы с Google Sheets
├── index.html            # Фронтенд (WebApp)
├── requirements.txt      # Зависимости Python
├── .env.example         # Пример конфигурации
├── README.md            # Документация
└── credentials.json     # Google API credentials (не в git!)
```

## 🔧 Технологии

- **Backend**: Python 3.10+, aiogram 3.x, gspread, aiohttp
- **Frontend**: HTML5, CSS3, Vanilla JS, mobile-select.js
- **Database**: Google Spreadsheet
- **Hosting**: Render.com (backend), GitHub Pages (frontend)

## 📚 Документация

- [SETUP.md](SETUP.md) - Подробная инструкция по настройке для локальной разработки
- [DEPLOY.md](DEPLOY.md) - Инструкция по деплою на Render.com и GitHub Pages

## 📝 Лицензия

MIT

