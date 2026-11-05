-- Журнал удалений gym-таблиц. Перед удалением любой строки (руками, через API,
-- каскадом от тренировки или от пользователя) её полная копия ложится в
-- public.gym_deleted_rows. Удалённую тренировку можно вернуть из журнала:
-- см. docs/BACKUPS_AND_DELETION_JOURNAL.md.
--
-- Только добавляет объекты; повторный запуск безопасен. Существующие таблицы,
-- данные, политики и представления не меняются.

create table if not exists public.gym_deleted_rows (
  id bigint generated always as identity primary key,
  deleted_at timestamptz not null default now(),
  table_name text not null,
  row_id text,
  user_id uuid,
  row_data jsonb not null
);

create index if not exists gym_deleted_rows_user_deleted_idx
  on public.gym_deleted_rows (user_id, deleted_at desc);

alter table public.gym_deleted_rows enable row level security;
revoke all on table public.gym_deleted_rows from anon, authenticated;
grant select, insert on table public.gym_deleted_rows to service_role;

-- SECURITY DEFINER: запись в журнал не зависит от прав того, кто удаляет.
create or replace function public.gym_log_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.gym_deleted_rows (table_name, row_id, user_id, row_data)
  values (tg_table_name, to_jsonb(old) ->> 'id', old.user_id, to_jsonb(old));
  return old;
end;
$$;

revoke all on function public.gym_log_deletion() from public, anon, authenticated;

drop trigger if exists gym_log_deletion on public.gym_workout_sessions;
create trigger gym_log_deletion before delete on public.gym_workout_sessions
  for each row execute function public.gym_log_deletion();

drop trigger if exists gym_log_deletion on public.gym_set_groups;
create trigger gym_log_deletion before delete on public.gym_set_groups
  for each row execute function public.gym_log_deletion();

drop trigger if exists gym_log_deletion on public.gym_sets;
create trigger gym_log_deletion before delete on public.gym_sets
  for each row execute function public.gym_log_deletion();

drop trigger if exists gym_log_deletion on public.gym_cardio_segments;
create trigger gym_log_deletion before delete on public.gym_cardio_segments
  for each row execute function public.gym_log_deletion();

drop trigger if exists gym_log_deletion on public.gym_exercises;
create trigger gym_log_deletion before delete on public.gym_exercises
  for each row execute function public.gym_log_deletion();

drop trigger if exists gym_log_deletion on public.gym_exercise_aliases;
create trigger gym_log_deletion before delete on public.gym_exercise_aliases
  for each row execute function public.gym_log_deletion();
