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
        Получает упражнения выбранной группы с описанием и фото.
        
        Args:
            muscle_group: Название группы мышц
            
        Returns:
            Список словарей с данными упражнений: [{"name": "...", "desc": "...", "image": "..."}, ...]
        """
        try:
            all_data = self.exercises_sheet.get_all_records()
            # Фильтруем и собираем объект
            exercises = []
            for row in all_data:
                if row.get('Muscle Group', '').strip() == muscle_group.strip():
                    exercises.append({
                        'name': row.get('Exercise Name', ''),
                        'desc': row.get('Description', 'Описание отсутствует'),
                        'image': row.get('Image_URL', '')  # Ссылка на картинку
                    })
            
            # Сортируем по имени
            return sorted(exercises, key=lambda x: x['name'])
        except Exception as e:
            logger.error(f"Ошибка чтения упражнений: {e}")
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
            
            # Формат: "2025.11.23, 19:17" (год.месяц.день, время)
            now = datetime.now()
            timestamp = f"{now.strftime('%Y.%m.%d')}, {now.strftime('%H:%M')}"
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
        Исправлена проблема с запятыми и пустыми ячейками (None) для русской локализации Google Sheets.
        
        Args:
            exercise_name: Название упражнения
            
        Returns:
            Список словарей с данными подходов последней тренировки:
            [{"weight": 100, "reps": 5, "rest": 120}, ...]
        """
        try:
            # Получаем все записи из LOG
            all_logs = self.log_sheet.get_all_records()
            
            # Фильтруем только это упражнение
            ex_logs = [row for row in all_logs if str(row.get('Exercise', '')).strip() == exercise_name.strip()]
            
            if not ex_logs:
                logger.warning(f"Не найдено записей для упражнения: {exercise_name}")
                return []
            
            # Сортировка по дате (последние сначала)
            try:
                # Пробуем разные форматы даты
                def parse_date(date_str):
                    date_str = str(date_str).strip()
                    # Формат: "23.11.2025.11.23, 15:54" или "23.11.2025 15:54" или "2025-11-21"
                    try:
                        # Пробуем новый формат: "23.11.2025.11.23, 15:54"
                        if ',' in date_str:
                            date_part = date_str.split(',')[0].strip()
                            # Берем первую часть до точки (если есть формат с точками)
                            if '.' in date_part:
                                parts = date_part.split('.')
                                if len(parts) >= 3:
                                    # Берем первые 3 части (день, месяц, год)
                                    return datetime.strptime(f"{parts[0]}.{parts[1]}.{parts[2]}", "%d.%m.%Y")
                        # Пробуем стандартный формат: "23.11.2025 15:54"
                        if ' ' in date_str:
                            date_part = date_str.split(' ')[0]
                            return datetime.strptime(date_part, "%d.%m.%Y")
                        # Пробуем формат ISO: "2025-11-21"
                        if '-' in date_str:
                            return datetime.strptime(date_str.split(' ')[0], "%Y-%m-%d")
                    except:
                        pass
                    # Если ничего не подошло, возвращаем минимальную дату
                    return datetime.min
                
                ex_logs.sort(key=lambda x: parse_date(x.get('Date', '')), reverse=True)
            except Exception as e:
                # Если дата кривая, берем просто последние записи
                logger.warning(f"Ошибка сортировки по дате: {e}, используем обратный порядок")
                ex_logs.reverse()
            
            # Берем дату последнего подхода (если список не пуст)
            if not ex_logs:
                return []
            
            # Получаем дату и set_group_id последней записи
            last_record = ex_logs[0]
            last_date_str = str(last_record.get('Date', '')).strip()
            # Извлекаем дату (до запятой или пробела)
            if ',' in last_date_str:
                last_date = last_date_str.split(',')[0].strip()
            elif ' ' in last_date_str:
                last_date = last_date_str.split(' ')[0].strip()
            else:
                last_date = last_date_str
            
            last_set_group_id = str(last_record.get('Set_Group_ID', '')).strip() or ""
            
            logger.info(f"DEBUG: Последняя тренировка для '{exercise_name}': дата={last_date}, set_group_id={last_set_group_id}, всего записей={len(ex_logs)}")
            
            history = []
            for item in ex_logs:
                # Проверяем дату и set_group_id
                current_date_str = str(item.get('Date', '')).strip()
                if ',' in current_date_str:
                    current_date = current_date_str.split(',')[0].strip()
                elif ' ' in current_date_str:
                    current_date = current_date_str.split(' ')[0].strip()
                else:
                    current_date = current_date_str
                
                current_set_group_id = str(item.get('Set_Group_ID', '')).strip() or ""
                
                # Логируем первые несколько записей для отладки
                if len(history) < 3:
                    logger.debug(f"Проверка записи: current_date={current_date}, last_date={last_date}, current_set_group_id={current_set_group_id}, last_set_group_id={last_set_group_id}")
                
                if current_date == last_date and current_set_group_id == last_set_group_id:
                    # === БЛОК ИСПРАВЛЕНИЯ ВЕСА ===
                    raw_weight = item.get('Weight')
                    weight = 0
                    
                    if raw_weight is not None:
                        # Превращаем в строку, меняем запятую на точку
                        weight_str = str(raw_weight).replace(',', '.').strip()
                        if weight_str:  # Если строка не пустая
                            try:
                                weight = float(weight_str)
                                # Если число целое (50.0), делаем красивым (50)
                                if weight.is_integer():
                                    weight = int(weight)
                            except ValueError:
                                weight = 0
                    # ==============================
                    
                    # === БЛОК ИСПРАВЛЕНИЯ ПОВТОРОВ ===
                    raw_reps = item.get('Reps')
                    reps = 0
                    
                    if raw_reps is not None:
                        reps_str = str(raw_reps).replace(',', '.').strip()
                        if reps_str:
                            try:
                                reps = int(float(reps_str))
                            except ValueError:
                                reps = 0
                    # =================================
                    
                    # === БЛОК ИСПРАВЛЕНИЯ ОТДЫХА ===
                    raw_rest = item.get('Rest', 60)
                    rest_seconds = 60  # По умолчанию
                    
                    if raw_rest is not None:
                        rest_str = str(raw_rest).replace(',', '.').strip()
                        if rest_str:
                            try:
                                # Если это текст типа "1,5 мин" или "90 сек"
                                if "мин" in rest_str.lower():
                                    rest_num = float(rest_str.replace("мин", "").replace("сек", "").strip())
                                    rest_seconds = int(rest_num * 60)
                                elif "сек" in rest_str.lower():
                                    rest_num = float(rest_str.replace("сек", "").strip())
                                    rest_seconds = int(rest_num)
                                else:
                                    # Просто число
                                    rest_seconds = int(float(rest_str))
                            except ValueError:
                                rest_seconds = 60
                    # ================================
                    
                    history.append({
                        'weight': weight,
                        'reps': reps,
                        'rest': rest_seconds
                    })
                else:
                    break
            
            # Возвращаем в правильном порядке (от первого подхода к последнему)
            result = history[::-1]
            
            logger.info(f"Найдено {len(result)} подходов для последней тренировки '{exercise_name}' (дата: {last_date})")
            if result:
                logger.info(f"Пример данных последней тренировки: {result[0]}")
            
            return result
            
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
            # Получаем все значения напрямую для лучшего контроля
            all_values = self.log_sheet.get_all_values()
            if not all_values or len(all_values) <= 1:
                logger.warning(f"Лист LOG пуст или содержит только заголовки")
                return []
            
            # Получаем заголовки
            headers = [h.strip() for h in all_values[0]]
            try:
                date_idx = headers.index("Date")
                exercise_idx = headers.index("Exercise")
                weight_idx = headers.index("Weight")
                reps_idx = headers.index("Reps")
                rest_idx = headers.index("Rest")
                set_group_idx = headers.index("Set_Group_ID")
            except ValueError as e:
                logger.error(f"Не найдены необходимые колонки в LOG: {e}")
                return []
            
            # Фильтруем по названию упражнения
            exercise_records = []
            for row in all_values[1:]:  # Пропускаем заголовок
                if len(row) <= exercise_idx:
                    continue
                    
                record_exercise = row[exercise_idx].strip() if row[exercise_idx] else ""
                if record_exercise == exercise_name.strip():
                    # Получаем значения напрямую из строки
                    date_val = row[date_idx].strip() if len(row) > date_idx and row[date_idx] else ""
                    weight_val = row[weight_idx].strip() if len(row) > weight_idx and row[weight_idx] else ""
                    reps_val = row[reps_idx].strip() if len(row) > reps_idx and row[reps_idx] else ""
                    rest_val = row[rest_idx].strip() if len(row) > rest_idx and row[rest_idx] else ""
                    set_group_val = row[set_group_idx].strip() if len(row) > set_group_idx and row[set_group_idx] else ""
                    
                    # Логируем первые несколько записей для отладки
                    if len(exercise_records) < 3:
                        logger.info(f"DEBUG get_exercise_history: Raw row для '{exercise_name}': Weight={repr(weight_val)}, Reps={repr(reps_val)}, Date={repr(date_val)}")
                    
                    # Преобразование веса
                    weight = 0
                    if weight_val:
                        try:
                            weight_str = weight_val.replace(",", ".").strip()
                            if weight_str:
                                weight = float(weight_str)
                        except (ValueError, TypeError) as e:
                            if len(exercise_records) < 3:
                                logger.warning(f"Ошибка преобразования веса '{weight_val}': {e}")
                    
                    # Преобразование повторов
                    reps = 0
                    if reps_val:
                        try:
                            reps_str = reps_val.replace(",", ".").strip()
                            if reps_str:
                                reps = int(float(reps_str))
                        except (ValueError, TypeError):
                            reps = 0
                    
                    # Преобразование отдыха
                    rest_seconds = 0
                    if rest_val:
                        try:
                            if "мин" in rest_val.lower():
                                rest_str = rest_val.replace(",", ".").replace("мин", "").replace("сек", "").strip()
                                if rest_str:
                                    rest_seconds = int(float(rest_str) * 60)
                            else:
                                rest_str = rest_val.replace(",", ".").replace("сек", "").strip()
                                if rest_str:
                                    rest_seconds = int(float(rest_str))
                        except (ValueError, TypeError):
                            rest_seconds = 0
                    
                    if len(exercise_records) < 3:
                        logger.info(f"DEBUG: После преобразования weight={weight}, reps={reps}, rest={rest_seconds}")
                    
                    exercise_records.append({
                        "date": date_val,
                        "weight": weight,
                        "reps": reps,
                        "rest": rest_seconds,
                        "set_group_id": set_group_val
                    })
            
            # Сортируем по дате (последние сначала) и ограничиваем
            exercise_records.sort(key=lambda x: x["date"], reverse=True)
            logger.info(f"Найдено {len(exercise_records)} записей для упражнения '{exercise_name}' (возвращаем {min(limit, len(exercise_records))})")
            if exercise_records:
                # Логируем первые 3 записи для отладки
                for i, rec in enumerate(exercise_records[:3]):
                    logger.info(f"Запись {i+1}: date={rec.get('date')}, weight={rec.get('weight')}, reps={rec.get('reps')}, rest={rec.get('rest')}")
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

