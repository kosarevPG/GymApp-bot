# Выполнение UPDATE в YDB

## Вариант 1: YDB CLI

Если установлен [YDB CLI](https://ydb.tech/docs/en/reference/ydb-cli/install) и настроен профиль:

```bash
ydb -p <ваш_профиль> table query execute -t data -f scripts/update_set_group.yql
```

Или одной строкой:

```bash
ydb -p <ваш_профиль> table query execute -t data -q "
UPDATE workout_logs
SET set_group_id = '30b42ccd-57de-4b45-945b-79ee24382ddc'
WHERE exercise_id = '6d50c565-e5f6-4895-bdf5-a2562ba68dd34'
  AND set_group_id = 'dea9a713-2f8a-408d-95a6-85543c41402e';
"
```

## Вариант 2: YDB Console (веб-интерфейс)

1. Откройте [Yandex Cloud Console](https://console.cloud.yandex.ru/) → YDB
2. Выберите вашу базу данных
3. Перейдите в раздел «Запросы» / «Query»
4. Вставьте и выполните:

```sql
UPDATE workout_logs
SET set_group_id = '30b42ccd-57de-4b45-945b-79ee24382ddc'
WHERE exercise_id = '6d50c565-e5f6-4895-bdf5-a2562ba68dd34'
  AND set_group_id = 'dea9a713-2f8a-408d-95a6-85543c41402e';
```

## Вариант 3: Python (ydb-python-sdk)

```bash
pip install ydb
```

```python
import ydb

driver = ydb.Driver(
    endpoint="grpcs://ydb.serverless.yandexcloud.net:2135",
    database="/ru-central1/b1g.../etn...",
    credentials=ydb.iam.MetadataUrlCredentials()
)
driver.wait(timeout=5)

with driver.table_client.session().create() as session:
    session.transaction().execute(
        """
        UPDATE workout_logs
        SET set_group_id = '30b42ccd-57de-4b45-945b-79ee24382ddc'
        WHERE exercise_id = '6d50c565-e5f6-4895-bdf5-a2562ba68dd34'
          AND set_group_id = 'dea9a713-2f8a-408d-95a6-85543c41402e';
        """,
        commit_tx=True
    )
```

---

**Примечание:** В `exercise_id` последний сегмент `a2562ba68dd34` содержит 13 символов (в UUID обычно 12). Если запрос не найдёт строки, проверьте значение — возможно, должно быть `a2562ba68dd3`.
