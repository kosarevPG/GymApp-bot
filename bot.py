"""
Основной файл Telegram бота для трекинга тренировок.
Использует aiogram 3.x и Google Sheets для хранения данных.
"""

import asyncio
import logging
import os
import uuid
import base64
from typing import Dict

from aiohttp import web
from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    Message, CallbackQuery, InlineKeyboardButton,
    InlineKeyboardMarkup, WebAppInfo
)
from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application
from aiogram.enums import ParseMode
from dotenv import load_dotenv

from google_sheets import GoogleSheetsManager

# Загружаем переменные окружения
load_dotenv()

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Инициализация бота
BOT_TOKEN = os.getenv("BOT_TOKEN")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://your-domain.com/")  # URL вашего фронтенда

if not BOT_TOKEN:
    raise ValueError("BOT_TOKEN не установлен в переменных окружения")

bot = Bot(token=BOT_TOKEN, parse_mode=ParseMode.HTML)
dp = Dispatcher(storage=MemoryStorage())

# Инициализация Google Sheets
# Поддержка чтения credentials из переменной окружения (для Render.com)
CREDENTIALS_JSON = os.getenv("GOOGLE_CREDENTIALS_JSON")  # JSON строка для Render
CREDENTIALS_PATH = os.getenv("GOOGLE_CREDENTIALS_PATH", "credentials.json")  # Путь к файлу для локальной разработки
SPREADSHEET_ID = os.getenv("SPREADSHEET_ID")

if not SPREADSHEET_ID:
    raise ValueError("SPREADSHEET_ID не установлен в переменных окружения")

try:
    # Передаем credentials_json если есть (для Render), иначе используем путь к файлу
    sheets_manager = GoogleSheetsManager(
        credentials_path=CREDENTIALS_PATH if not CREDENTIALS_JSON else None,
        credentials_json=CREDENTIALS_JSON,
        spreadsheet_id=SPREADSHEET_ID
    )
except Exception as e:
    logger.error(f"Не удалось инициализировать Google Sheets: {e}")
    raise


# FSM состояния для добавления упражнения
class AddExerciseStates(StatesGroup):
    waiting_for_name = State()
    waiting_for_group = State()
    waiting_for_photo = State()


# ==================== ОБРАБОТЧИКИ КОМАНД ====================

@dp.message(Command("start"))
async def cmd_start(message: Message):
    """Обработчик команды /start - открывает WebApp."""
    try:
        # Создаем кнопку для открытия WebApp
        keyboard = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(
                text="🏋️ Открыть приложение",
                web_app=WebAppInfo(url=WEBAPP_URL)
            )
        ]])
        
        await message.answer(
            "🏋️ <b>Gym Logger</b>\n\n"
            "Нажмите кнопку ниже, чтобы открыть приложение для записи тренировок:",
            reply_markup=keyboard
        )
    except Exception as e:
        logger.error(f"Ошибка в /start: {e}")
        await message.answer("❌ Произошла ошибка. Попробуйте позже.")


@dp.message(Command("add_exercise"))
async def cmd_add_exercise(message: Message, state: FSMContext):
    """Начало FSM сценария для добавления нового упражнения."""
    await message.answer(
        "➕ Добавление нового упражнения.\n"
        "Введите название упражнения:"
    )
    await state.set_state(AddExerciseStates.waiting_for_name)


@dp.message(AddExerciseStates.waiting_for_name)
async def process_exercise_name(message: Message, state: FSMContext):
    """Обработка названия упражнения."""
    exercise_name = message.text.strip()
    if not exercise_name:
        await message.answer("❌ Название не может быть пустым. Попробуйте снова:")
        return
    
    await state.update_data(exercise_name=exercise_name)
    
    # Получаем список групп мышц для выбора
    muscle_groups = sheets_manager.get_muscle_groups()
    
    if muscle_groups:
        builder = InlineKeyboardBuilder()
        for group in muscle_groups:
            builder.button(
                text=group,
                callback_data=f"select_group_{group}"
            )
        builder.button(text="➕ Новая группа", callback_data="new_group")
        builder.adjust(2)
        
        await message.answer(
            f"📝 Название: {exercise_name}\n"
            "Выберите группу мышц или создайте новую:",
            reply_markup=builder.as_markup()
        )
    else:
        await message.answer(
            "Введите название группы мышц (например: Спина, Грудь, Ноги):"
        )
        await state.set_state(AddExerciseStates.waiting_for_group)


@dp.callback_query(F.data.startswith("select_group_"))
async def process_selected_group(callback: CallbackQuery, state: FSMContext):
    """Обработка выбранной группы мышц."""
    muscle_group = callback.data.replace("select_group_", "")
    data = await state.get_data()
    exercise_name = data.get("exercise_name")
    
    await state.update_data(muscle_group=muscle_group)
    await callback.message.edit_text(
        f"📝 Название: {exercise_name}\n"
        f"💪 Группа: {muscle_group}\n\n"
        "Отправьте фото тренажера (или /skip для пропуска):"
    )
    await state.set_state(AddExerciseStates.waiting_for_photo)
    await callback.answer()


@dp.callback_query(F.data == "new_group")
async def process_new_group(callback: CallbackQuery, state: FSMContext):
    """Запрос названия новой группы мышц."""
    await callback.message.edit_text("Введите название новой группы мышц:")
    await state.set_state(AddExerciseStates.waiting_for_group)
    await callback.answer()


@dp.message(AddExerciseStates.waiting_for_group)
async def process_group_name(message: Message, state: FSMContext):
    """Обработка названия группы мышц."""
    muscle_group = message.text.strip()
    if not muscle_group:
        await message.answer("❌ Название группы не может быть пустым. Попробуйте снова:")
        return
    
    await state.update_data(muscle_group=muscle_group)
    data = await state.get_data()
    exercise_name = data.get("exercise_name")
    
    await message.answer(
        f"📝 Название: {exercise_name}\n"
        f"💪 Группа: {muscle_group}\n\n"
        "Отправьте фото тренажера (или /skip для пропуска):"
    )
    await state.set_state(AddExerciseStates.waiting_for_photo)


@dp.message(AddExerciseStates.waiting_for_photo, F.photo)
async def process_photo(message: Message, state: FSMContext):
    """Обработка фото тренажера."""
    photo_file_id = message.photo[-1].file_id  # Берем фото наибольшего размера
    data = await state.get_data()
    
    exercise_name = data.get("exercise_name")
    muscle_group = data.get("muscle_group")
    
    # Сохраняем упражнение
    success = sheets_manager.add_exercise(exercise_name, muscle_group, photo_file_id)
    
    if success:
        await message.answer(
            f"✅ Упражнение '{exercise_name}' успешно добавлено!\n"
            f"Группа: {muscle_group}"
        )
    else:
        await message.answer("❌ Ошибка при сохранении упражнения.")
    
    await state.clear()


@dp.message(AddExerciseStates.waiting_for_photo, Command("skip"))
async def skip_photo(message: Message, state: FSMContext):
    """Пропуск добавления фото."""
    data = await state.get_data()
    exercise_name = data.get("exercise_name")
    muscle_group = data.get("muscle_group")
    
    success = sheets_manager.add_exercise(exercise_name, muscle_group, "")
    
    if success:
        await message.answer(
            f"✅ Упражнение '{exercise_name}' успешно добавлено!\n"
            f"Группа: {muscle_group}"
        )
    else:
        await message.answer("❌ Ошибка при сохранении упражнения.")
    
    await state.clear()


# ==================== ОБРАБОТЧИКИ CALLBACK ====================
# Убраны обработчики для выбора групп мышц и упражнений - теперь все в WebApp


# ==================== ЗАПУСК БОТА ====================

# Определяем режим работы: webhook или polling
USE_WEBHOOK = os.getenv("USE_WEBHOOK", "false").lower() == "true"
WEBHOOK_PATH = os.getenv("WEBHOOK_PATH", "/webhook")
WEBHOOK_URL = os.getenv("WEBHOOK_URL")  # Полный URL для webhook (например: https://your-bot.onrender.com/webhook)
PORT = int(os.getenv("PORT", 8000))  # Порт для веб-сервера (Render автоматически устанавливает PORT)


async def health_check(request):
    """Простой health check endpoint для Render.com."""
    return web.Response(text="OK")


def get_cors_headers():
    """Получить CORS заголовки для всех ответов."""
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data",
    }


async def api_groups(request):
    """API endpoint: получить список групп мышц."""
    headers = get_cors_headers()
    
    if request.method == "OPTIONS":
        return web.Response(text="OK", headers=headers)
    
    try:
        muscle_groups = sheets_manager.get_muscle_groups()
        return web.json_response({"groups": muscle_groups}, headers=headers)
    except Exception as e:
        logger.error(f"Ошибка получения групп мышц: {e}", exc_info=True)
        return web.json_response(
            {"status": "error", "message": str(e)},
            status=500,
            headers=headers
        )


async def api_exercises(request):
    """API endpoint: получить список упражнений по группе мышц."""
    headers = get_cors_headers()
    
    if request.method == "OPTIONS":
        return web.Response(text="OK", headers=headers)
    
    try:
        muscle_group = request.query.get("group", "")
        if not muscle_group:
            return web.json_response(
                {"status": "error", "message": "Параметр 'group' обязателен"},
                status=400,
                headers=headers
            )
        
        exercises_data = sheets_manager.get_exercises_by_group(muscle_group)
        # Возвращаем полные объекты с описанием и картинками
        return web.json_response({"exercises": exercises_data}, headers=headers)
    except Exception as e:
        logger.error(f"Ошибка получения упражнений: {e}", exc_info=True)
        return web.json_response(
            {"status": "error", "message": str(e)},
            status=500,
            headers=headers
        )


async def api_history(request):
    """API endpoint: получить историю подходов по упражнению."""
    headers = get_cors_headers()
    
    if request.method == "OPTIONS":
        return web.Response(text="OK", headers=headers)
    
    try:
        exercise_name = request.query.get("exercise", "")
        if not exercise_name:
            return web.json_response(
                {"status": "error", "message": "Параметр 'exercise' обязателен"},
                status=400,
                headers=headers
            )
        
        mode = request.query.get("mode", "full")  # "last" или "full"
        
        logger.info(f"Запрос истории для упражнения: '{exercise_name}', mode: {mode}")
        
        if mode == "last":
            # Возвращаем только последнюю тренировку (для автозаполнения)
            last_workout = sheets_manager.get_last_workout(exercise_name)
            logger.info(f"Результат get_last_workout для '{exercise_name}': {len(last_workout)} подходов")
            return web.json_response({"sets": last_workout}, headers=headers)
        else:
            # Возвращаем полную историю
            limit = int(request.query.get("limit", "20"))
            history = sheets_manager.get_exercise_history(exercise_name, limit)
            logger.info(f"Результат get_exercise_history для '{exercise_name}': {len(history)} записей")
            return web.json_response({"history": history}, headers=headers)
    except Exception as e:
        logger.error(f"Ошибка получения истории упражнения: {e}", exc_info=True)
        return web.json_response(
            {"status": "error", "message": str(e)},
            status=500,
            headers=headers
        )


async def api_save_set(request):
    """API endpoint: сохранить один подход."""
    headers = get_cors_headers()
    
    if request.method == "OPTIONS":
        return web.Response(text="OK", headers=headers)
    
    try:
        import json
        data = await request.json()
        
        user_id = data.get("user_id")
        exercise = data.get("exercise")
        weight = data.get("weight")
        reps = data.get("reps")
        rest = data.get("rest", 0)
        
        if not all([user_id, exercise, weight is not None, reps is not None]):
            return web.json_response(
                {"status": "error", "message": "Не все обязательные поля заполнены"},
                status=400,
                headers=headers
            )
        
        # Сохраняем один подход
        set_group_id = str(uuid.uuid4())
        workout_data = [{
            "exercise": exercise,
            "weight": float(weight),
            "reps": int(reps),
            "rest": int(rest)
        }]
        
        success = sheets_manager.save_workout_log(workout_data, set_group_id)
        
        if success:
            # Отправляем сообщение в Telegram
            if user_id:
                try:
                    await bot.send_message(
                        chat_id=user_id,
                        text=f"✅ Записан подход: {weight}кг × {reps}"
                    )
                except Exception as e:
                    logger.error(f"Ошибка отправки сообщения: {e}")
            
            return web.json_response({"status": "success"}, headers=headers)
        else:
            return web.json_response(
                {"status": "error", "message": "Ошибка сохранения"},
                status=500,
                headers=headers
            )
            
    except Exception as e:
        logger.error(f"Ошибка сохранения подхода: {e}", exc_info=True)
        return web.json_response(
            {"status": "error", "message": str(e)},
            status=500,
            headers=headers
        )


async def handle_webapp_post(request):
    """Обработка HTTP POST запросов от WebApp (альтернатива tg.sendData)."""
    # 1. Формируем заголовки CORS вручную (чтобы наверняка)
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data",
    }
    
    # 2. Обработка Preflight запроса (когда браузер "спрашивает разрешение")
    if request.method == "OPTIONS":
        return web.Response(text="OK", headers=headers)
    
    try:
        import json
        
        # Получаем данные из запроса
        data = await request.json()
        logger.info("=" * 50)
        logger.info("📨 ПОЛУЧЕН HTTP POST ОТ WEBAPP!")
        logger.info(f"Данные: {json.dumps(data, ensure_ascii=False)}")
        logger.info("=" * 50)
        
        # Проверяем формат данных
        if data.get("type") != "workout_data":
            logger.warning(f"Неверный тип данных: {data.get('type')}")
            return web.json_response(
                {"status": "error", "message": "Неверный формат данных"},
                status=400,
                headers=headers
            )
        
        payload = data.get("payload", [])
        if not payload:
            logger.warning("Пустой payload")
            return web.json_response(
                {"status": "error", "message": "Нет данных для сохранения"},
                status=400,
                headers=headers
            )
        
        # Получаем user_id из заголовков или данных
        # Telegram WebApp передает initData, но для простоты берем из данных
        user_id = data.get("user_id")
        if not user_id:
            # Пытаемся получить из initData или заголовков
            init_data = request.headers.get("X-Telegram-Init-Data", "")
            logger.info(f"Init data from headers: {init_data[:50] if init_data else 'None'}...")
            # Пока используем None, если нет user_id
            logger.warning("user_id не найден в данных")
        
        logger.info(f"Payload: {payload}")
        logger.info(f"User ID: {user_id}")
        
        # Генерируем UUID для группировки суперсетов
        set_group_id = str(uuid.uuid4())
        
        # Сохраняем в Google Sheets
        logger.info("Сохранение данных в Google Sheets...")
        logger.info(f"Payload для сохранения: {payload}")
        logger.info(f"Set group ID: {set_group_id}")
        success = sheets_manager.save_workout_log(payload, set_group_id)
        logger.info(f"Результат сохранения: success={success}")
        
        if success:
            exercise_count = len(payload)
            
            # Если есть user_id, отправляем сообщение в Telegram
            if user_id:
                try:
                    response_text = (
                        f"✅ Записано {exercise_count} упражнение(й)!\n"
                        f"📊 Подходов: {len(payload)}"
                    )
                    await bot.send_message(
                        chat_id=user_id,
                        text=response_text
                    )
                    logger.info(f"Сообщение отправлено пользователю {user_id}")
                except Exception as e:
                    logger.error(f"Ошибка отправки сообщения пользователю {user_id}: {e}")
            
            # ВАЖНО: Добавляем headers в успешный ответ
            return web.json_response({
                "status": "success",
                "message": f"Записано {exercise_count} упражнение(й)!",
                "sets_count": len(payload)
            }, headers=headers)
        else:
            logger.error("Ошибка при сохранении в Google Sheets")
            # ВАЖНО: Добавляем headers даже в ответ с ошибкой
            return web.json_response(
                {"status": "error", "message": "Ошибка при сохранении данных"},
                status=500,
                headers=headers
            )
            
    except json.JSONDecodeError as e:
        logger.error(f"Ошибка парсинга JSON: {e}")
        # ВАЖНО: Добавляем headers даже в ответ с ошибкой
        return web.json_response(
            {"status": "error", "message": "Ошибка парсинга данных"},
            status=400,
            headers=headers
        )
    except Exception as e:
        logger.error(f"Ошибка обработки HTTP POST от WebApp: {e}", exc_info=True)
        # ВАЖНО: Добавляем headers даже в ответ с ошибкой
        return web.json_response(
            {"status": "error", "message": "Произошла ошибка при сохранении"},
            status=500,
            headers=headers
        )


async def on_startup(bot: Bot):
    """Выполняется при запуске бота."""
    if USE_WEBHOOK and WEBHOOK_URL:
        # Устанавливаем webhook
        await bot.set_webhook(WEBHOOK_URL)
        logger.info(f"Webhook установлен: {WEBHOOK_URL}")
    else:
        logger.info("Используется режим polling")


async def on_shutdown(bot: Bot):
    """Выполняется при остановке бота."""
    if USE_WEBHOOK:
        await bot.delete_webhook()
        logger.info("Webhook удален")
    await bot.session.close()


async def main():
    """Главная функция запуска бота."""
    if USE_WEBHOOK and WEBHOOK_URL:
        # Режим webhook для продакшена (Render.com)
        logger.info("Запуск бота в режиме webhook...")
        
        # Создаем веб-приложение
        app = web.Application()
        
        # Добавляем health check endpoint (обязательно для Render)
        app.router.add_get("/", health_check)
        app.router.add_get("/health", health_check)
        
        # API endpoints для WebApp
        app.router.add_get("/api/groups", api_groups)
        app.router.add_options("/api/groups", api_groups)
        app.router.add_get("/api/exercises", api_exercises)
        app.router.add_options("/api/exercises", api_exercises)
        app.router.add_get("/api/history", api_history)
        app.router.add_options("/api/history", api_history)
        app.router.add_post("/api/save_set", api_save_set)
        app.router.add_options("/api/save_set", api_save_set)
        
        # Просто добавляем маршруты (без cors.add)
        # Регистрируем POST и OPTIONS для одного пути
        app.router.add_post("/api/webapp-data", handle_webapp_post)
        app.router.add_options("/api/webapp-data", handle_webapp_post)  # Нужно для CORS
        
        # Настраиваем webhook handler
        webhook_requests_handler = SimpleRequestHandler(
            dispatcher=dp,
            bot=bot,
        )
        webhook_requests_handler.register(app, path=WEBHOOK_PATH)
        
        # Настраиваем startup и shutdown
        setup_application(app, dp, bot=bot)
        
        # Устанавливаем webhook при старте
        await on_startup(bot)
        
        # Запускаем веб-сервер
        try:
            web.run_app(app, host="0.0.0.0", port=PORT)
        finally:
            await on_shutdown(bot)
    else:
        # Режим polling для локальной разработки или бесплатного тарифа Render
        logger.info("Запуск бота в режиме polling...")
        
        # Запускаем простой веб-сервер для keep-alive на Render (если нужно)
        # Это нужно, чтобы Render не убивал процесс на бесплатном тарифе
        async def keep_alive_server():
            app = web.Application()
            
            # Просто добавляем маршруты (без cors.add)
            # Добавляем health check endpoints
            app.router.add_get("/", health_check)
            app.router.add_get("/health", health_check)
            
            # API endpoints для WebApp
            app.router.add_get("/api/groups", api_groups)
            app.router.add_options("/api/groups", api_groups)
            app.router.add_get("/api/exercises", api_exercises)
            app.router.add_options("/api/exercises", api_exercises)
            app.router.add_get("/api/history", api_history)
            app.router.add_options("/api/history", api_history)
            app.router.add_post("/api/save_set", api_save_set)
            app.router.add_options("/api/save_set", api_save_set)
            
            # Регистрируем POST и OPTIONS для одного пути
            app.router.add_post("/api/webapp-data", handle_webapp_post)
            app.router.add_options("/api/webapp-data", handle_webapp_post)  # Нужно для CORS
            
            runner = web.AppRunner(app)
            await runner.setup()
            site = web.TCPSite(runner, "0.0.0.0", PORT)
            await site.start()
            logger.info(f"Keep-alive сервер запущен на порту {PORT}")
            logger.info(f"Endpoint для WebApp: http://0.0.0.0:{PORT}/api/webapp-data")
        
        # Запускаем keep-alive сервер в фоне
        keep_alive_task = asyncio.create_task(keep_alive_server())
        
        try:
            # Запускаем polling
            await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
        finally:
            keep_alive_task.cancel()
            try:
                await keep_alive_task
            except asyncio.CancelledError:
                pass
            await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())

