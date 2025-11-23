"""
Основной файл Telegram бота для трекинга тренировок.
Использует aiogram 3.x и Google Sheets для хранения данных.
"""

import asyncio
import logging
import os
import uuid
import json
from typing import Dict

from aiohttp import web
from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application
from aiogram.enums import ParseMode
from dotenv import load_dotenv

from google_sheets import GoogleSheetsManager

load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- CONFIG ---
BOT_TOKEN = os.getenv("BOT_TOKEN")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://your-domain.com/")
SPREADSHEET_ID = os.getenv("SPREADSHEET_ID")
USE_WEBHOOK = os.getenv("USE_WEBHOOK", "false").lower() == "true"
WEBHOOK_PATH = os.getenv("WEBHOOK_PATH", "/webhook")
WEBHOOK_URL = os.getenv("WEBHOOK_URL")
PORT = int(os.getenv("PORT", 8000))

# --- INIT ---
bot = Bot(token=BOT_TOKEN, parse_mode=ParseMode.HTML)
dp = Dispatcher(storage=MemoryStorage())
try:
    sheets_manager = GoogleSheetsManager(
        credentials_json=os.getenv("GOOGLE_CREDENTIALS_JSON"),
        credentials_path=os.getenv("GOOGLE_CREDENTIALS_PATH", "credentials.json"),
        spreadsheet_id=SPREADSHEET_ID
    )
except Exception as e:
    logger.critical(f"Sheets Init Failed: {e}")
    raise

# --- FSM ---
class AddExerciseStates(StatesGroup):
    waiting_for_name = State()
    waiting_for_group = State()
    waiting_for_photo = State()

# --- BOT HANDLERS ---

@dp.message(Command("start"))
async def cmd_start(message: Message):
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🏋️ Открыть приложение", web_app=WebAppInfo(url=WEBAPP_URL))
    ]])
    await message.answer("🏋️ <b>Gym Logger</b>\nЖми кнопку:", reply_markup=kb)


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
    photo_file_id = message.photo[-1].file_id
    data = await state.get_data()
    
    exercise_name = data.get("exercise_name")
    muscle_group = data.get("muscle_group")
    
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

# --- API HELPERS ---

def json_response(data, status=200):
    return web.json_response(
        data, 
        status=status,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data",
        }
    )


async def handle_options(request):
    return json_response({"status": "ok"})

async def health_check(request):
    return web.Response(text="OK")

# --- API ENDPOINTS ---

async def api_groups(request):
    try:
        groups = sheets_manager.get_muscle_groups()
        return json_response({"groups": groups})
    except Exception as e:
        return json_response({"error": str(e)}, 500)


async def api_exercises(request):
    try:
        group = request.query.get("group", "")
        exercises = sheets_manager.get_exercises_by_group(group)
        return json_response({"exercises": exercises})
    except Exception as e:
        return json_response({"error": str(e)}, 500)


async def api_history(request):
    try:
        ex_name = request.query.get("exercise", "")
        mode = request.query.get("mode", "full")
        
        if mode == "last":
            data = sheets_manager.get_last_workout(ex_name)
            return json_response({"sets": data})
        else:
            limit = int(request.query.get("limit", "20"))
            data = sheets_manager.get_exercise_history(ex_name, limit)
            return json_response({"history": data})
    except Exception as e:
        return json_response({"error": str(e)}, 500)


async def api_save_set(request):
    """Единый энпоинт для сохранения."""
    try:
        data = await request.json()
        
        # Поддержка обоих форматов: одного сета (из API) и батча (из WebApp)
        if data.get("type") == "workout_data":
            payload = data.get("payload", [])
            user_id = data.get("user_id")
        else:
            # Превращаем одиночный запрос в список
            payload = [{
                "exercise": data.get("exercise"),
                "weight": float(data.get("weight", 0)),
                "reps": int(data.get("reps", 0)),
                "rest": data.get("rest", 0)
            }]
            user_id = data.get("user_id")

        if not payload:
            return json_response({"error": "No data"}, 400)

        set_group_id = str(uuid.uuid4())
        success = sheets_manager.save_workout_log(payload, set_group_id)

        if success and user_id:
            try:
                msg = f"✅ Сохранено упражнений: {len(payload)}"
                await bot.send_message(chat_id=user_id, text=msg)
            except: 
                pass # Не блокируем ответ, если не удалось отправить сообщение

        return json_response({"status": "success" if success else "error"})
        
    except Exception as e:
        logger.error(f"Save error: {e}", exc_info=True)
        return json_response({"error": str(e)}, 500)

# --- SERVER SETUP ---

def create_app():
    app = web.Application()
    app.router.add_get("/", health_check)
    app.router.add_get("/health", health_check)
    
    # API Routes
    for path, handler in [
        ("/api/groups", api_groups),
        ("/api/exercises", api_exercises),
        ("/api/history", api_history),
        ("/api/save_set", api_save_set),
        ("/api/webapp-data", api_save_set) # Alias
    ]:
        app.router.add_get(path, handler)
        app.router.add_post(path, handler)
        app.router.add_options(path, handle_options)
    
    return app


async def main():
    app = create_app()
    
    if USE_WEBHOOK and WEBHOOK_URL:
        logger.info("Starting Webhook Mode")
        webhook_handler = SimpleRequestHandler(dispatcher=dp, bot=bot)
        webhook_handler.register(app, path=WEBHOOK_PATH)
        setup_application(app, dp, bot=bot)
        
        await bot.set_webhook(WEBHOOK_URL)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", PORT)
        await site.start()
        
        # Бесконечный цикл, чтобы main не завершился
        await asyncio.Event().wait()
    else:
        logger.info("Starting Polling Mode")
        # Keep-alive server
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", PORT)
        await site.start()
        
        try:
            await dp.start_polling(bot)
        finally:
            await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
