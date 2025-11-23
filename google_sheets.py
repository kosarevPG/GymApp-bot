"""
Модуль для работы с Google Sheets API.
Обеспечивает чтение и запись данных в таблицу с тремя листами:
- LOG: журнал тренировок
- EXERCISES: справочник упражнений
- LAST_RESULTS: кэш последних результатов
"""

import gspread
from google.oauth2.service_account import Credentials
from typing import List, Dict, Optional, Tuple
import logging
import os
import json
from datetime import datetime

logger = logging.getLogger(__name__)


class GoogleSheetsManager:
    """Класс для управления данными в Google Sheets."""
    
    def __init__(self, credentials_path: str = None, spreadsheet_id: str = None, credentials_json: str = None):
        """
        Инициализация менеджера Google Sheets.
        
        Args:
            credentials_path: Путь к JSON файлу с credentials для Google API (для локальной разработки)
            spreadsheet_id: ID Google Spreadsheet (можно передать или взять из env)
            credentials_json: JSON строка с credentials (для деплоя на Render.com)
        """
        try:
            scope = [
                'https://spreadsheets.google.com/feeds',
                'https://www.googleapis.com/auth/drive'
            ]
            
            # Приоритет: credentials_json (для Render) > credentials_path (локально)
            if credentials_json:
                # Читаем из переменной окружения (JSON строка)
                creds_info = json.loads(credentials_json)
                creds = Credentials.from_service_account_info(creds_info, scopes=scope)
                logger.info("Google Sheets credentials загружены из переменной окружения")
            elif credentials_path and os.path.exists(credentials_path):
                # Читаем из файла (локальная разработка)
                creds = Credentials.from_service_account_file(credentials_path, scopes=scope)
                logger.info(f"Google Sheets credentials загружены из файла: {credentials_path}")
            else:
                # Пытаемся прочитать из переменной окружения GOOGLE_CREDENTIALS_JSON
                creds_env = os.getenv("GOOGLE_CREDENTIALS_JSON")
                if creds_env:
                    creds_info = json.loads(creds_env)
                    creds = Credentials.from_service_account_info(creds_info, scopes=scope)
                    logger.info("Google Sheets credentials загружены из GOOGLE_CREDENTIALS_JSON")
                else:
                    raise ValueError("Не указаны credentials. Используйте credentials_path, credentials_json или GOOGLE_CREDENTIALS_JSON")
            
            self.client = gspread.authorize(creds)
            
            # Получаем spreadsheet_id из параметра или переменной окружения
            if not spreadsheet_id:
                spreadsheet_id = os.getenv("SPREADSHEET_ID")
            
            if not spreadsheet_id:
                raise ValueError("SPREADSHEET_ID не указан")
            
            self.spreadsheet = self.client.open_by_key(spreadsheet_id)
            self.log_sheet = self.spreadsheet.worksheet('LOG')
            self.exercises_sheet = self.spreadsheet.worksheet('EXERCISES')
            self.last_results_sheet = self.spreadsheet.worksheet('LAST_RESULTS')
            logger.info("Google Sheets подключен успешно")
        except Exception as e:
            logger.error(f"Ошибка подключения к Google Sheets: {e}")
            raise
    
    def get_muscle_groups(self) -> List[str]:
        """
        Получить список уникальных групп мышц из листа EXERCISES.
        
        Returns:
            Список уникальных групп мышц
        """
        try:
            # Читаем колонку B (группы мышц), пропуская заголовок
            groups = self.exercises_sheet.col_values(2)[1:]  # [1:] пропускает заголовок
            unique_groups = list(set([g.strip() for g in groups if g.strip()]))
            return sorted(unique_groups)
        except Exception as e:
            logger.error(f"Ошибка получения групп мышц: {e}")
            return []
    
    def get_exercises_by_group(self, muscle_group: str) -> List[Dict[str, str]]:
        """
        Получить список упражнений по группе мышц.
        
        Args:
            muscle_group: Название группы мышц
            
        Returns:
            Список словарей с данными упражнений: [{"name": "...", "photo_id": "..."}, ...]
        """
        try:
            all_exercises = self.exercises_sheet.get_all_records()
            exercises = [
                {
                    "name": ex["Exercise Name"],
                    "photo_id": ex.get("Photo_File_ID", "")
                }
                for ex in all_exercises
                if ex.get("Muscle Group", "").strip() == muscle_group.strip()
            ]
            return exercises
        except Exception as e:
            logger.error(f"Ошибка получения упражнений для группы {muscle_group}: {e}")
            return []
    
    def get_exercise_photo_id(self, exercise_name: str) -> Optional[str]:
        """
        Получить file_id фото тренажера для упражнения.
        
        Args:
            exercise_name: Название упражнения
            
        Returns:
            Telegram file_id фото или None
        """
        try:
            all_exercises = self.exercises_sheet.get_all_records()
            for ex in all_exercises:
                if ex["Exercise Name"].strip() == exercise_name.strip():
                    return ex.get("Photo_File_ID", "")
            return None
        except Exception as e:
            logger.error(f"Ошибка получения фото для упражнения {exercise_name}: {e}")
            return None
    
    def get_last_results(self, exercise_name: str) -> Tuple[float, int]:
        """
        Получить последние результаты по упражнению из кэша.
        
        Args:
            exercise_name: Название упражнения
            
        Returns:
            Кортеж (last_weight, last_reps). Если данных нет, возвращает (0, 0)
        """
        try:
            # Проверяем, что лист не пустой
            all_values = self.last_results_sheet.get_all_values()
            if len(all_values) <= 1:  # Только заголовки или пусто
                logger.debug(f"Лист LAST_RESULTS пуст или содержит только заголовки")
                return (0, 0)
            
            all_results = self.last_results_sheet.get_all_records()
            if not all_results:
                logger.debug(f"Нет записей в LAST_RESULTS")
                return (0, 0)
            
            for result in all_results:
                if result.get("Exercise Name", "").strip() == exercise_name.strip():
                    last_weight = float(result.get("Last Weight", 0) or 0)
                    last_reps = int(result.get("Last Reps", 0) or 0)
                    logger.debug(f"Найдены последние результаты для {exercise_name}: вес={last_weight}, повторы={last_reps}")
                    return (last_weight, last_reps)
            
            logger.debug(f"Упражнение {exercise_name} не найдено в LAST_RESULTS")
            return (0, 0)
        except IndexError as e:
            logger.warning(f"Лист LAST_RESULTS пуст или не имеет заголовков для {exercise_name}: {e}")
            return (0, 0)
        except Exception as e:
            logger.error(f"Ошибка получения последних результатов для {exercise_name}: {e}", exc_info=True)
            return (0, 0)
    
    def save_workout_log(self, workout_data: List[Dict], set_group_id: str) -> bool:
        """
        Сохранить данные тренировки в лист LOG.
        
        Args:
            workout_data: Список словарей с данными подходов:
                [{"exercise": "...", "weight": 100, "reps": 5, "rest": 120}, ...]
            set_group_id: UUID для группировки суперсетов
            
        Returns:
            True если успешно, False в случае ошибки
        """
        try:
            logger.info(f"Начало сохранения данных в LOG. Количество записей: {len(workout_data)}")
            logger.info(f"Данные для сохранения: {workout_data}")
            
            # Формат: "23.11.2025.11.23, 15:54" (дата дублируется: день.месяц.год.месяц.день, время)
            now = datetime.now()
            timestamp = f"{now.strftime('%d.%m.%Y')}.{now.strftime('%m.%d')}, {now.strftime('%H:%M')}"
            rows_to_add = []
            
            for workout in workout_data:
                row = [
                    timestamp,
                    workout["exercise"],
                    workout["weight"],
                    workout["reps"],
                    workout["rest"],
                    set_group_id
                ]
                rows_to_add.append(row)
            
            logger.info(f"Подготовлено {len(rows_to_add)} строк для добавления: {rows_to_add}")
            
            # Проверяем, что лист существует
            if not self.log_sheet:
                logger.error("Лист LOG не найден!")
                return False
            
            # Добавляем все строки одним запросом
            logger.info("Вызов append_rows...")
            self.log_sheet.append_rows(rows_to_add)
            logger.info(f"✅ Успешно сохранено {len(rows_to_add)} записей в LOG")
            
            # Проверяем, что данные действительно сохранились
            try:
                all_values = self.log_sheet.get_all_values()
                logger.info(f"Всего строк в LOG после сохранения: {len(all_values)}")
            except Exception as check_error:
                logger.warning(f"Не удалось проверить сохранение: {check_error}")
            
            return True
        except Exception as e:
            logger.error(f"❌ Ошибка сохранения в LOG: {e}", exc_info=True)
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return False
    
    def get_last_workout(self, exercise_name: str) -> List[Dict]:
        """
        Получить последнюю тренировку по упражнению (для автозаполнения).
        
        Args:
            exercise_name: Название упражнения
            
        Returns:
            Список словарей с данными подходов последней тренировки:
            [{"weight": 100, "reps": 5, "rest": 120}, ...]
        """
        try:
            # Получаем все записи из LOG
            all_records = self.log_sheet.get_all_records()
            
            # Фильтруем по названию упражнения
            exercise_records = []
            for record in all_records:
                record_exercise = record.get("Exercise", "").strip()
                if record_exercise == exercise_name.strip():
                    # Безопасное преобразование Weight
                    weight_value = record.get("Weight", "") or ""
                    weight = 0
                    if weight_value:
                        try:
                            if isinstance(weight_value, (int, float)):
                                weight = float(weight_value)
                            elif isinstance(weight_value, str):
                                weight_str = weight_value.replace(",", ".").strip()
                                if weight_str:
                                    weight = float(weight_str)
                        except (ValueError, TypeError):
                            weight = 0
                    
                    # Безопасное преобразование Reps
                    reps_value = record.get("Reps", "") or ""
                    reps = 0
                    if reps_value:
                        try:
                            if isinstance(reps_value, (int, float)):
                                reps = int(reps_value)
                            elif isinstance(reps_value, str):
                                reps_str = reps_value.strip()
                                if reps_str:
                                    reps = int(float(reps_str))
                        except (ValueError, TypeError):
                            reps = 0
                    
                    # Безопасное преобразование Rest (может быть текст или число)
                    rest_value = record.get("Rest", "") or ""
                    rest_seconds = 0
                    if rest_value:
                        try:
                            # Пытаемся преобразовать в число
                            if isinstance(rest_value, (int, float)):
                                rest_seconds = int(rest_value)
                            elif isinstance(rest_value, str):
                                # Если это текст типа "1,5 мин", пропускаем
                                # Или пытаемся извлечь число
                                rest_str = rest_value.replace(",", ".").replace("мин", "").replace("сек", "").strip()
                                if rest_str:
                                    rest_seconds = int(float(rest_str) * 60) if "мин" in rest_value.lower() else int(float(rest_str))
                        except (ValueError, TypeError):
                            rest_seconds = 0
                    
                    exercise_records.append({
                        "date": record.get("Date", ""),
                        "weight": weight,
                        "reps": reps,
                        "rest": rest_seconds,
                        "set_group_id": record.get("Set_Group_ID", "") or ""
                    })
            
            if not exercise_records:
                logger.warning(f"Не найдено записей для упражнения: {exercise_name}")
                return []
            
            # Сортируем по дате (последние сначала)
            exercise_records.sort(key=lambda x: x["date"], reverse=True)
            
            # Берем последнюю тренировку (все подходы с одинаковым set_group_id и датой)
            last_date = exercise_records[0]["date"]
            last_set_group_id = exercise_records[0]["set_group_id"] or ""
            
            # Находим все подходы последней тренировки
            last_workout = [
                {
                    "weight": record["weight"],
                    "reps": record["reps"],
                    "rest": record["rest"]
                }
                for record in exercise_records
                if record["date"] == last_date and (record["set_group_id"] or "") == last_set_group_id
            ]
            
            logger.info(f"Найдено {len(last_workout)} подходов для последней тренировки '{exercise_name}' (дата: {last_date})")
            if last_workout:
                logger.info(f"Пример данных последней тренировки: {last_workout[0]}")
            return last_workout
            
        except Exception as e:
            logger.error(f"Ошибка получения последней тренировки для {exercise_name}: {e}", exc_info=True)
            return []
    
    def get_exercise_history(self, exercise_name: str, limit: int = 10) -> List[Dict]:
        """
        Получить историю подходов по упражнению из листа LOG.
        
        Args:
            exercise_name: Название упражнения
            limit: Максимальное количество последних записей (по умолчанию 10)
            
        Returns:
            Список словарей с данными подходов:
            [{"date": "...", "weight": 100, "reps": 5, "rest": 120, "set_group_id": "..."}, ...]
        """
        try:
            # Получаем все записи из LOG
            all_records = self.log_sheet.get_all_records()
            
            # Фильтруем по названию упражнения
            exercise_records = []
            for record in all_records:
                record_exercise = record.get("Exercise", "").strip()
                if record_exercise == exercise_name.strip():
                    # Безопасное преобразование Weight
                    weight_value = record.get("Weight", "") or ""
                    weight = 0
                    if weight_value:
                        try:
                            if isinstance(weight_value, (int, float)):
                                weight = float(weight_value)
                            elif isinstance(weight_value, str):
                                weight_str = weight_value.replace(",", ".").strip()
                                if weight_str:
                                    weight = float(weight_str)
                        except (ValueError, TypeError):
                            weight = 0
                    
                    # Безопасное преобразование Reps
                    reps_value = record.get("Reps", "") or ""
                    reps = 0
                    if reps_value:
                        try:
                            if isinstance(reps_value, (int, float)):
                                reps = int(reps_value)
                            elif isinstance(reps_value, str):
                                reps_str = reps_value.strip()
                                if reps_str:
                                    reps = int(float(reps_str))
                        except (ValueError, TypeError):
                            reps = 0
                    
                    # Безопасное преобразование Rest (может быть текст или число)
                    rest_value = record.get("Rest", "") or ""
                    rest_seconds = 0
                    if rest_value:
                        try:
                            # Пытаемся преобразовать в число
                            if isinstance(rest_value, (int, float)):
                                rest_seconds = int(rest_value)
                            elif isinstance(rest_value, str):
                                # Если это текст типа "1,5 мин", пропускаем
                                # Или пытаемся извлечь число
                                rest_str = rest_value.replace(",", ".").replace("мин", "").replace("сек", "").strip()
                                if rest_str:
                                    rest_seconds = int(float(rest_str) * 60) if "мин" in rest_value.lower() else int(float(rest_str))
                        except (ValueError, TypeError):
                            rest_seconds = 0
                    
                    exercise_records.append({
                        "date": record.get("Date", ""),
                        "weight": weight,
                        "reps": reps,
                        "rest": rest_seconds,
                        "set_group_id": record.get("Set_Group_ID", "") or ""
                    })
            
            # Сортируем по дате (последние сначала) и ограничиваем
            exercise_records.sort(key=lambda x: x["date"], reverse=True)
            logger.info(f"Найдено {len(exercise_records)} записей для упражнения '{exercise_name}' (возвращаем {min(limit, len(exercise_records))})")
            if exercise_records:
                logger.info(f"Пример данных истории: weight={exercise_records[0].get('weight')}, reps={exercise_records[0].get('reps')}")
            return exercise_records[:limit]
            
        except Exception as e:
            logger.error(f"Ошибка получения истории для упражнения {exercise_name}: {e}", exc_info=True)
            return []
    
    def add_exercise(self, exercise_name: str, muscle_group: str, photo_file_id: str = "") -> bool:
        """
        Добавить новое упражнение в справочник EXERCISES.
        
        Args:
            exercise_name: Название упражнения
            muscle_group: Группа мышц
            photo_file_id: Telegram file_id фото (опционально)
            
        Returns:
            True если успешно, False в случае ошибки
        """
        try:
            row = [exercise_name, muscle_group, photo_file_id]
            self.exercises_sheet.append_row(row)
            logger.info(f"Добавлено упражнение: {exercise_name}")
            return True
        except Exception as e:
            logger.error(f"Ошибка добавления упражнения: {e}")
            return False

