"""
Основной файл Telegram бота для трекинга тренировок.
Использует aiogram 3.x и Google Sheets для хранения данных.
"""

import asyncio
import logging
import os
import uuid
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
from aiogram.client.default import DefaultBotProperties
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

bot = Bot(
    token=BOT_TOKEN,
    default=DefaultBotProperties(parse_mode=ParseMode.HTML)
)
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
    """Обработчик команды /start - показывает меню с группами мышц."""
    try:
        muscle_groups = sheets_manager.get_muscle_groups()
        
        if not muscle_groups:
            await message.answer(
                "📋 Справочник упражнений пуст.\n"
                "Используйте /add_exercise для добавления упражнений."
            )
            return
        
        # Создаем inline клавиатуру с группами мышц
        builder = InlineKeyboardBuilder()
        for group in muscle_groups:
            builder.button(
                text=group,
                callback_data=f"group_{group}"
            )
        builder.adjust(2)  # По 2 кнопки в ряд
        
        await message.answer(
            "🏋️ Выберите группу мышц:",
            reply_markup=builder.as_markup()
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

@dp.callback_query(F.data.startswith("group_"))
async def show_exercises(callback: CallbackQuery):
    """Показать список упражнений выбранной группы мышц."""
    muscle_group = callback.data.replace("group_", "")
    
    try:
        exercises = sheets_manager.get_exercises_by_group(muscle_group)
        
        if not exercises:
            await callback.answer("В этой группе пока нет упражнений", show_alert=True)
            return
        
        builder = InlineKeyboardBuilder()
        for ex in exercises:
            builder.button(
                text=ex["name"],
                callback_data=f"exercise_{ex['name']}"
            )
        builder.adjust(1)  # По одной кнопке в ряд
        
        await callback.message.edit_text(
            f"💪 {muscle_group}\n\nВыберите упражнение:",
            reply_markup=builder.as_markup()
        )
        await callback.answer()
    except Exception as e:
        logger.error(f"Ошибка при показе упражнений: {e}")
        await callback.answer("Произошла ошибка", show_alert=True)


@dp.callback_query(F.data.startswith("exercise_"))
async def handle_exercise_selection(callback: CallbackQuery):
    """Обработка выбора упражнения - отправка фото и кнопки WebApp."""
    exercise_name = callback.data.replace("exercise_", "")
    
    try:
        # Получаем фото тренажера
        photo_file_id = sheets_manager.get_exercise_photo_id(exercise_name)
        
        # Получаем последние результаты
        last_weight, last_reps = sheets_manager.get_last_results(exercise_name)
        
        # Отправляем фото, если есть
        if photo_file_id:
            await callback.message.answer_photo(
                photo_file_id,
                caption=f"🏋️ {exercise_name}"
            )
        
        # Формируем URL для WebApp с параметрами
        webapp_url = f"{WEBAPP_URL}?ex={exercise_name}&w={last_weight}&r={last_reps}"
        
        # Создаем кнопку для открытия WebApp
        keyboard = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(
                text="📝 Записать подход",
                web_app=WebAppInfo(url=webapp_url)
            )
        ]])
        
        text = f"🏋️ {exercise_name}"
        if last_weight > 0 or last_reps > 0:
            text += f"\n\n📊 Прошлый раз: {last_weight}кг × {last_reps}"
        
        await callback.message.answer(text, reply_markup=keyboard)
        await callback.answer()
    except Exception as e:
        logger.error(f"Ошибка при выборе упражнения: {e}")
        await callback.answer("Произошла ошибка", show_alert=True)


# ==================== ОБРАБОТКА ДАННЫХ ОТ WEBAPP ====================

@dp.message(F.web_app_data)
async def handle_webapp_data(message: Message):
    """Обработка данных, полученных от WebApp."""
    try:
        import json
        logger.info("=" * 50)
        logger.info("ПОЛУЧЕНЫ ДАННЫЕ ОТ WEBAPP!")
        logger.info(f"Пользователь: {message.from_user.id} (@{message.from_user.username})")
        logger.info(f"Данные: {message.web_app_data.data}")
        logger.info("=" * 50)
        
        data = json.loads(message.web_app_data.data)
        
        if data.get("type") != "workout_data":
            logger.warning(f"Неверный тип данных: {data.get('type')}")
            await message.answer("❌ Неверный формат данных")
            return
        
        payload = data.get("payload", [])
        if not payload:
            logger.warning("Пустой payload")
            await message.answer("❌ Нет данных для сохранения")
            return
        
        logger.info(f"Payload: {payload}")
        
        # Генерируем UUID для группировки суперсетов
        set_group_id = str(uuid.uuid4())
        
        # Сохраняем в Google Sheets
        logger.info("Сохранение данных в Google Sheets...")
        success = sheets_manager.save_workout_log(payload, set_group_id)
        
        if success:
            exercise_count = len(payload)
            response_text = (
                f"✅ Записано {exercise_count} упражнение(й)!\n"
                f"📊 Подходов: {len(payload)}"
            )
            logger.info(f"Отправка сообщения пользователю {message.from_user.id}: {response_text}")
            
            # Отправляем сообщение
            sent_message = await message.answer(response_text)
            logger.info(f"Сообщение отправлено, message_id: {sent_message.message_id}")
        else:
            logger.error("Ошибка при сохранении в Google Sheets")
            await message.answer("❌ Ошибка при сохранении данных")
    except json.JSONDecodeError as e:
        logger.error(f"Ошибка парсинга JSON: {e}")
        await message.answer("❌ Ошибка парсинга данных")
    except Exception as e:
        logger.error(f"Ошибка обработки данных WebApp: {e}", exc_info=True)
        await message.answer("❌ Произошла ошибка при сохранении")


# ==================== ЗАПУСК БОТА ====================

# Определяем режим работы: webhook или polling
USE_WEBHOOK = os.getenv("USE_WEBHOOK", "false").lower() == "true"
WEBHOOK_PATH = os.getenv("WEBHOOK_PATH", "/webhook")
WEBHOOK_URL = os.getenv("WEBHOOK_URL")  # Полный URL для webhook (например: https://your-bot.onrender.com/webhook)
PORT = int(os.getenv("PORT", 8000))  # Порт для веб-сервера (Render автоматически устанавливает PORT)


async def health_check(request):
    """Простой health check endpoint для Render.com."""
    return web.Response(text="OK")


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
            app.router.add_get("/", health_check)
            app.router.add_get("/health", health_check)
            runner = web.AppRunner(app)
            await runner.setup()
            site = web.TCPSite(runner, "0.0.0.0", PORT)
            await site.start()
            logger.info(f"Keep-alive сервер запущен на порту {PORT}")
        
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

