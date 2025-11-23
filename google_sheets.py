"""
Модуль для работы с Google Sheets API.
Оптимизирован для стабильного парсинга данных.
"""

import gspread
from google.oauth2.service_account import Credentials
from typing import List, Dict, Optional, Tuple, Any
import logging
import os
import json
from datetime import datetime

logger = logging.getLogger(__name__)


class DataParser:
    """Вспомогательный класс для парсинга грязных данных из таблиц."""
    
    @staticmethod
    def to_float(value: Any, default: float = 0.0) -> float:
        if value is None:
            return default
        try:
            # Заменяем запятую на точку и убираем пробелы
            clean_val = str(value).replace(',', '.').strip()
            # Обработка текста с единицами измерения ("1.5 мин")
            for suffix in ["мин", "сек", "s", "m"]:
                if suffix in clean_val.lower():
                    clean_val = clean_val.lower().replace(suffix, "").strip()
            if not clean_val:
                return default
            return float(clean_val)
        except (ValueError, TypeError):
            return default

    @staticmethod
    def to_int(value: Any, default: int = 0) -> int:
        try:
            return int(DataParser.to_float(value, default))
        except (ValueError, TypeError):
            return default

    @staticmethod
    def parse_rest_to_minutes(value: Any) -> float:
        """Умный парсинг отдыха: конвертирует секунды (>100) в минуты."""
        val = str(value).lower()
        num = DataParser.to_float(val)
        
        # Явное указание секунд
        if "сек" in val or "s" in val:
            return num / 60.0
        # Эвристика: если число больше 59, скорее всего это секунды
        if num > 59:
            return num / 60.0
        return num

    @staticmethod
    def parse_date(date_str: Any) -> datetime:
        """Универсальный парсер даты."""
        s = str(date_str).strip().split(',')[0].strip() # Отсекаем время
        formats = [
            "%Y.%m.%d", "%d.%m.%Y", "%Y-%m-%d", "%d-%m-%Y",
            "%Y/%m/%d", "%d/%m/%Y"
        ]
        for fmt in formats:
            try:
                return datetime.strptime(s, fmt)
            except ValueError:
                continue
        return datetime.min


class GoogleSheetsManager:
    def __init__(self, credentials_path: str = None, spreadsheet_id: str = None, credentials_json: str = None):
        try:
            scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
            
            if credentials_json:
                creds = Credentials.from_service_account_info(json.loads(credentials_json), scopes=scope)
            elif credentials_path and os.path.exists(credentials_path):
                creds = Credentials.from_service_account_file(credentials_path, scopes=scope)
            else:
                creds_env = os.getenv("GOOGLE_CREDENTIALS_JSON")
                if not creds_env:
                    raise ValueError("Credentials not found")
                creds = Credentials.from_service_account_info(json.loads(creds_env), scopes=scope)
            
            self.client = gspread.authorize(creds)
            self.spreadsheet_id = spreadsheet_id or os.getenv("SPREADSHEET_ID")
            if not self.spreadsheet_id:
                raise ValueError("SPREADSHEET_ID missing")
            
            self.spreadsheet = self.client.open_by_key(self.spreadsheet_id)
            self._init_sheets()
            logger.info("Google Sheets connected")
        except Exception as e:
            logger.error(f"GSheets init error: {e}")
            raise

    def _init_sheets(self):
        """Ленивая или кэшированная инициализация листов."""
        self.log_sheet = self.spreadsheet.worksheet('LOG')
        self.exercises_sheet = self.spreadsheet.worksheet('EXERCISES')
        try:
            self.last_results_sheet = self.spreadsheet.worksheet('LAST_RESULTS')
        except:
            self.last_results_sheet = None

    def _get_log_records(self, exercise_filter: str = None) -> List[Dict]:
        """Получает и нормализует записи из LOG."""
        all_values = self.log_sheet.get_all_values()
        if len(all_values) < 2: 
            return []
            
        headers = [h.strip() for h in all_values[0]]
        col_map = {name: idx for idx, name in enumerate(headers)}
        
        # Проверка обязательных колонок
        required = ["Date", "Exercise", "Weight", "Reps"]
        if not all(k in col_map for k in required):
            logger.error(f"Missing headers in LOG. Found: {headers}")
            return []

        results = []
        for row in all_values[1:]:
            # Безопасное получение значения по индексу
            def get_val(col_name):
                idx = col_map.get(col_name)
                if idx is not None and idx < len(row):
                    return row[idx]
                return ""

            ex_name = get_val("Exercise")
            if exercise_filter and ex_name.strip() != exercise_filter.strip():
                continue

            results.append({
                "date_obj": DataParser.parse_date(get_val("Date")), # Для сортировки
                "date": get_val("Date"), # Оригинальная строка
                "exercise": ex_name,
                "weight": DataParser.to_float(get_val("Weight")),
                "reps": DataParser.to_int(get_val("Reps")),
                "rest": DataParser.parse_rest_to_minutes(get_val("Rest")),
                "order": DataParser.to_int(get_val("Order")),
                "set_group_id": get_val("Set_Group_ID"),
                "note": get_val("Note")  # Заметка
            })
        return results

    def get_muscle_groups(self) -> List[str]:
        try:
            groups = self.exercises_sheet.col_values(2)[1:]
            return sorted(list(set(g.strip() for g in groups if g.strip())))
        except Exception as e:
            logger.error(f"Get groups error: {e}")
            return []

    def get_exercises_by_group(self, muscle_group: str) -> List[Dict]:
        try:
            all_data = self.exercises_sheet.get_all_records()
            exercises = [
                {
                    'name': r.get('Exercise Name', ''),
                    'desc': r.get('Description', 'Описание отсутствует'),
                    'image': r.get('Image_URL', '')
                }
                for r in all_data
                if r.get('Muscle Group', '').strip() == muscle_group.strip()
            ]
            return sorted(exercises, key=lambda x: x['name'])
        except Exception as e:
            logger.error(f"Get exercises error: {e}")
            return []

    def save_workout_log(self, workout_data: List[Dict], set_group_id: str) -> bool:
        try:
            timestamp = datetime.now().strftime('%Y.%m.%d, %H:%M')
            rows = []
            
            for idx, item in enumerate(workout_data, 1):
                # Гарантируем, что отдых сохранен в минутах
                rest_mins = DataParser.parse_rest_to_minutes(item.get("rest", 0))
                
                # Если фронтенд прислал order, используем его. 
                # Если нет (старый режим), используем счетчик цикла.
                order_val = item.get("order")
                if not order_val:
                    order_val = idx
                
                # Получаем заметку
                note = item.get("note", "")
                
                rows.append([
                    timestamp,
                    order_val,  # Используем полученный или рассчитанный Order
                    item["exercise"],
                    item["weight"],
                    item["reps"],
                    rest_mins,
                    set_group_id,
                    note  # Записываем заметку в 8-ю колонку
                ])
            
            self.log_sheet.append_rows(rows)
            logger.info(f"Saved {len(rows)} records with notes")
            return True
        except Exception as e:
            logger.error(f"Save log error: {e}")
            return False

    def get_last_workout(self, exercise_name: str) -> Dict:
        """Возвращает сеты и заметку с последней тренировки."""
        try:
            records = self._get_log_records(exercise_name)
            if not records: 
                return {'sets': [], 'note': ''}  # Пустая заметка

            # Сортируем: свежие сверху
            records.sort(key=lambda x: x['date_obj'], reverse=True)
            
            last_date = records[0]['date_obj']
            last_group = records[0]['set_group_id']
            
            # Берем заметку из первой попавшейся записи этой сессии
            last_note = records[0].get('note', '')
            
            # Фильтруем только последнюю сессию
            last_session = [
                r for r in records 
                if r['date_obj'] == last_date and r['set_group_id'] == last_group
            ]
            
            # Сортируем по Order
            last_session.sort(key=lambda x: x['order'])
            
            sets = [{
                'weight': r['weight'],
                'reps': r['reps'],
                'rest': r['rest']
            } for r in last_session]
            
            return {'sets': sets, 'note': last_note}
            
        except Exception as e:
            logger.error(f"Get last workout error: {e}")
            return {'sets': [], 'note': ''}

    def get_exercise_history(self, exercise_name: str, limit: int = 20) -> List[Dict]:
        try:
            records = self._get_log_records()  # Загружаем всё без фильтра
            if not records: 
                return []

            # 1. Находим ID групп, в которых участвовало целевое упражнение
            # Сортируем записи от новых к старым, чтобы взять последние N тренировок
            records.sort(key=lambda x: x['date_obj'], reverse=True)
            
            target_group_ids = []
            seen_groups = set()
            
            for r in records:
                if r['exercise'] == exercise_name and r['set_group_id'] not in seen_groups:
                    target_group_ids.append(r['set_group_id'])
                    seen_groups.add(r['set_group_id'])
                    if len(target_group_ids) >= limit:
                        break
            
            # 2. Теперь собираем ВСЕ упражнения, которые входят в эти группы
            # (то есть само упражнение + его соседей по суперсету)
            history = [r for r in records if r['set_group_id'] in seen_groups]
            
            # Сортировка: Сначала по порядку (1, 2, 3...), потом по дате от новых к старым
            # (сортировка в Python стабильная, порядок внутри даты сохранится)
            history.sort(key=lambda x: x['order'])
            history.sort(key=lambda x: x['date_obj'], reverse=True)
            
            return [{
                "date": r["date"],
                "exercise": r["exercise"],  # Важно: теперь передаем имя упражнения
                "weight": r["weight"],
                "reps": r["reps"],
                "rest": r["rest"],
                "set_group_id": r["set_group_id"]
            } for r in history]
            
        except Exception as e:
            logger.error(f"Get history error: {e}")
            return []

    def add_exercise(self, name: str, group: str, photo_id: str = "") -> bool:
        try:
            self.exercises_sheet.append_row([name, group, photo_id])
            return True
        except Exception as e:
            logger.error(f"Add exercise error: {e}")
            return False
