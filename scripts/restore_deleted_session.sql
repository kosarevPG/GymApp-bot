-- Возвращает удалённую тренировку из журнала public.gym_deleted_rows.
--
-- 1. Найти тренировку:
--      select row_id, deleted_at, row_data->>'workout_date' as date
--      from public.gym_deleted_rows
--      where table_name = 'gym_workout_sessions'
--      order by deleted_at desc limit 20;
-- 2. Подставить её id вместо __SESSION_ID__ и выполнить файл целиком.
--
-- Каскад удаления идёт в одной транзакции, поэтому у тренировки, её групп,
-- подходов и кардио одинаковое deleted_at. Берётся последнее удаление этой
-- тренировки. Вычисляемые колонки база пересчитает сама. Если строка уже
-- вернулась (повторный запуск), вставка упадёт на первичном ключе, и вся
-- транзакция откатится — ничего не задвоится.

do $$
declare
  target text := '__SESSION_ID__';
  stamp timestamptz;
  t text;
  cols text;
  source_cols text;
begin
  select deleted_at into stamp
  from public.gym_deleted_rows
  where table_name = 'gym_workout_sessions' and row_id = target
  order by deleted_at desc
  limit 1;
  if stamp is null then
    raise exception 'В журнале нет удалённой тренировки %', target;
  end if;

  foreach t in array array['gym_workout_sessions', 'gym_set_groups', 'gym_sets', 'gym_cardio_segments'] loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
           string_agg('r.' || quote_ident(column_name), ', ' order by ordinal_position)
      into cols, source_cols
    from information_schema.columns
    where table_schema = 'public' and table_name = t and is_generated = 'NEVER';

    execute format(
      'insert into public.%I (%s)
       select %s
       from public.gym_deleted_rows d
       cross join lateral jsonb_populate_record(null::public.%I, d.row_data) r
       where d.table_name = %L and d.deleted_at = %L
         and (d.row_id = %L or d.row_data ->> ''session_id'' = %L)
       order by d.id',
      t, cols, source_cols, t, t, stamp, target, target);
  end loop;
end
$$;
