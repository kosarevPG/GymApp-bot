-- Test-only snapshot of HealthOS normalized gym schema (202608230001).
-- pgcrypto extension omitted: gen_random_uuid is built into this Postgres.
-- Normalized strength-training storage for GymApp -> HealthOS.
-- This migration is additive: the legacy public.workouts JSONB table is untouched.



create table if not exists public.gym_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null default 'gymapp' check (length(btrim(source)) > 0),
  source_key text not null check (length(btrim(source_key)) > 0),
  name_ru text not null check (length(btrim(name_ru)) > 0),
  name_en text,
  muscle_group text,
  description text,
  image_url text,
  image_url_2 text,
  weight_type text not null default 'Machine' check (
    weight_type in ('Machine', 'Plate_Loaded', 'Dumbbell', 'Barbell', 'Bodyweight', 'Assisted', 'Other')
  ),
  base_weight_kg numeric(8,2) not null default 0 check (base_weight_kg >= 0),
  multiplier numeric(8,3) not null default 1 check (multiplier <> 0),
  tonnage_mode text not null default 'external_load' check (
    tonnage_mode in ('external_load', 'excluded', 'estimated')
  ),
  technique_note text,
  is_active boolean not null default true,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, source_key),
  unique (user_id, id)
);

create table if not exists public.gym_exercise_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id uuid not null,
  source text not null default 'gymapp' check (length(btrim(source)) > 0),
  alias_type text not null check (alias_type in ('legacy_id', 'name_ru', 'name_en')),
  alias_value text not null check (length(btrim(alias_value)) > 0),
  created_at timestamptz not null default now(),
  unique (user_id, source, alias_type, alias_value),
  foreign key (user_id, exercise_id)
    references public.gym_exercises (user_id, id)
    on delete cascade
);

create table if not exists public.gym_workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workout_date date not null,
  started_at timestamptz,
  ended_at timestamptz,
  name text,
  source text not null default 'gymapp' check (length(btrim(source)) > 0),
  source_record_id text not null check (length(btrim(source_record_id)) > 0),
  session_note text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or started_at is null or ended_at >= started_at),
  unique (user_id, source, source_record_id),
  unique (user_id, id)
);

create table if not exists public.gym_set_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  position integer not null check (position > 0),
  group_type text not null default 'single' check (
    group_type in ('single', 'superset', 'circuit')
  ),
  source text not null default 'gymapp' check (length(btrim(source)) > 0),
  source_record_id text not null check (length(btrim(source_record_id)) > 0),
  legacy_group_id text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, source, source_record_id),
  unique (user_id, id),
  unique (user_id, session_id, id),
  foreign key (user_id, session_id)
    references public.gym_workout_sessions (user_id, id)
    on delete cascade
);

create table if not exists public.gym_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  set_group_id uuid,
  exercise_id uuid not null,
  performed_at timestamptz,
  position integer not null check (position > 0),
  input_weight_kg numeric(8,2) not null default 0 check (input_weight_kg >= 0),
  total_weight_kg numeric(8,2) not null default 0 check (total_weight_kg >= 0),
  reps integer not null check (reps > 0),
  rest_seconds integer not null default 0 check (rest_seconds >= 0),
  set_type text not null default 'working' check (
    set_type in ('warmup', 'working', 'drop', 'failure', 'other')
  ),
  rpe numeric(3,1) check (rpe between 1 and 10),
  rir numeric(3,1) check (rir between 0 and 10),
  include_in_tonnage boolean not null default true,
  tonnage_kg numeric(12,2) generated always as (
    case
      when include_in_tonnage then round(total_weight_kg * reps, 2)
      else null
    end
  ) stored,
  note text,
  legacy_note text,
  source text not null default 'gymapp' check (length(btrim(source)) > 0),
  source_record_id text not null check (length(btrim(source_record_id)) > 0),
  client_request_id uuid not null default gen_random_uuid(),
  legacy_client_request_id text,
  legacy_session_id text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, source_record_id),
  unique (user_id, client_request_id),
  foreign key (user_id, session_id)
    references public.gym_workout_sessions (user_id, id)
    on delete cascade,
  foreign key (user_id, session_id, set_group_id)
    references public.gym_set_groups (user_id, session_id, id)
    on delete set null (set_group_id),
  foreign key (user_id, exercise_id)
    references public.gym_exercises (user_id, id)
    on delete restrict
);

create index if not exists gym_exercises_history_lookup_idx
  on public.gym_exercises (user_id, source_key);

create index if not exists gym_exercise_aliases_exercise_idx
  on public.gym_exercise_aliases (user_id, exercise_id);

create index if not exists gym_sessions_date_idx
  on public.gym_workout_sessions (user_id, workout_date desc, started_at desc);

create index if not exists gym_groups_session_position_idx
  on public.gym_set_groups (session_id, position);

create index if not exists gym_sets_session_position_idx
  on public.gym_sets (session_id, position);

create index if not exists gym_sets_group_fk_idx
  on public.gym_sets (user_id, session_id, set_group_id)
  where set_group_id is not null;

create index if not exists gym_sets_exercise_history_idx
  on public.gym_sets (user_id, exercise_id, performed_at desc, position desc);

create or replace function public.gym_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists gym_exercises_touch_updated_at on public.gym_exercises;
create trigger gym_exercises_touch_updated_at
before update on public.gym_exercises
for each row execute function public.gym_touch_updated_at();

drop trigger if exists gym_sessions_touch_updated_at on public.gym_workout_sessions;
create trigger gym_sessions_touch_updated_at
before update on public.gym_workout_sessions
for each row execute function public.gym_touch_updated_at();

drop trigger if exists gym_sets_touch_updated_at on public.gym_sets;
create trigger gym_sets_touch_updated_at
before update on public.gym_sets
for each row execute function public.gym_touch_updated_at();

alter table public.gym_exercises enable row level security;
alter table public.gym_exercise_aliases enable row level security;
alter table public.gym_workout_sessions enable row level security;
alter table public.gym_set_groups enable row level security;
alter table public.gym_sets enable row level security;

drop policy if exists gym_exercises_owner_all on public.gym_exercises;
drop policy if exists gym_exercises_owner_select on public.gym_exercises;
create policy gym_exercises_owner_select on public.gym_exercises
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists gym_exercise_aliases_owner_all on public.gym_exercise_aliases;
drop policy if exists gym_exercise_aliases_owner_select on public.gym_exercise_aliases;
create policy gym_exercise_aliases_owner_select on public.gym_exercise_aliases
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists gym_sessions_owner_all on public.gym_workout_sessions;
drop policy if exists gym_sessions_owner_select on public.gym_workout_sessions;
create policy gym_sessions_owner_select on public.gym_workout_sessions
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists gym_set_groups_owner_all on public.gym_set_groups;
drop policy if exists gym_set_groups_owner_select on public.gym_set_groups;
create policy gym_set_groups_owner_select on public.gym_set_groups
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists gym_sets_owner_all on public.gym_sets;
drop policy if exists gym_sets_owner_select on public.gym_sets;
create policy gym_sets_owner_select on public.gym_sets
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table
  public.gym_exercises,
  public.gym_exercise_aliases,
  public.gym_workout_sessions,
  public.gym_set_groups,
  public.gym_sets
from anon, authenticated;

grant select on table
  public.gym_exercises,
  public.gym_exercise_aliases,
  public.gym_workout_sessions,
  public.gym_set_groups,
  public.gym_sets
to authenticated;

grant all on table
  public.gym_exercises,
  public.gym_exercise_aliases,
  public.gym_workout_sessions,
  public.gym_set_groups,
  public.gym_sets
to service_role;

revoke all on function public.gym_touch_updated_at() from public, anon, authenticated;
grant execute on function public.gym_touch_updated_at() to service_role;

create or replace view public.gym_exercise_history
with (security_invoker = true) as
select
  gs.user_id,
  ge.id as exercise_id,
  ge.id as canonical_exercise_id,
  ge.source_key as legacy_exercise_id,
  ge.name_ru,
  ge.name_en,
  ge.technique_note,
  gws.id as session_id,
  gws.workout_date,
  gs.performed_at,
  gs.position,
  gs.input_weight_kg,
  gs.total_weight_kg,
  gs.reps,
  gs.rest_seconds,
  gs.set_type,
  gs.rpe,
  gs.rir,
  gs.tonnage_kg,
  gs.note
from public.gym_sets gs
join public.gym_exercises ge
  on ge.user_id = gs.user_id and ge.id = gs.exercise_id
join public.gym_workout_sessions gws
  on gws.user_id = gs.user_id and gws.id = gs.session_id;

revoke all on public.gym_exercise_history from public, anon, authenticated, service_role;
grant select on public.gym_exercise_history to authenticated, service_role;

create or replace view public.gym_workout_projection
with (security_invoker = true) as
with exercise_rollup as (
  select
    gs.user_id,
    gs.session_id,
    gs.exercise_id,
    min(gs.position) as first_position,
    count(*)::integer as sets_count,
    sum(gs.reps)::integer as total_reps,
    coalesce(sum(gs.tonnage_kg), 0)::numeric as volume,
    max(gs.total_weight_kg) filter (where gs.include_in_tonnage) as max_weight,
    coalesce(sum(gs.rest_seconds), 0)::integer as total_rest_seconds,
    coalesce(bool_or(gsg.group_type <> 'single'), false) as is_superset,
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'id', gs.id,
        'order', gs.position,
        'input_weight', gs.input_weight_kg,
        'weight', gs.total_weight_kg,
        'reps', gs.reps,
        'rest_min', round(gs.rest_seconds::numeric / 60, 2),
        'set_type', gs.set_type,
        'rpe', gs.rpe,
        'rir', gs.rir,
        'set_group_id', gs.set_group_id,
        'include_in_tonnage', gs.include_in_tonnage,
        'note', gs.note
      )) order by gs.position
    ) as sets
  from public.gym_sets gs
  left join public.gym_set_groups gsg
    on gsg.user_id = gs.user_id and gsg.id = gs.set_group_id
  group by gs.user_id, gs.session_id, gs.exercise_id
)
select
  gws.user_id,
  gws.id as session_id,
  gws.workout_date as date,
  coalesce(gws.name, string_agg(distinct ge.muscle_group, ' · ' order by ge.muscle_group), 'Тренировка') as name,
  coalesce(sum(er.volume), 0)::numeric as total_volume_kg,
  count(er.exercise_id)::integer as exercise_count,
  coalesce(sum(er.sets_count), 0)::integer as total_sets,
  jsonb_strip_nulls(jsonb_build_object(
    'session_id', gws.id,
    'date', gws.workout_date,
    'name', coalesce(gws.name, string_agg(distinct ge.muscle_group, ' · ' order by ge.muscle_group), 'Тренировка'),
    'source', gws.source,
    'started_at', gws.started_at,
    'ended_at', gws.ended_at,
    'total_volume_kg', coalesce(sum(er.volume), 0),
    'exercise_count', count(er.exercise_id),
    'total_sets', coalesce(sum(er.sets_count), 0),
    'total_reps', coalesce(sum(er.total_reps), 0),
    'duration_est_min', ceil(coalesce(sum(er.total_rest_seconds), 0)::numeric / 60)::integer,
    'muscle_groups', to_jsonb(array_remove(array_agg(distinct ge.muscle_group order by ge.muscle_group), null)),
    'exercises', coalesce(jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'exercise_id', ge.id,
        'canonical_exercise_id', ge.id,
        'legacy_exercise_id', ge.source_key,
        'name_ru', ge.name_ru,
        'name_en', ge.name_en,
        'muscle_group', ge.muscle_group,
        'weight_type', ge.weight_type,
        'multiplier', ge.multiplier,
        'tonnage_mode', ge.tonnage_mode,
        'technique_note', ge.technique_note,
        'sets_count', er.sets_count,
        'total_reps', er.total_reps,
        'volume', er.volume,
        'max_weight', er.max_weight,
        'total_rest_min', round(er.total_rest_seconds::numeric / 60, 2),
        'is_superset', er.is_superset,
        'sets', er.sets
      )) order by er.first_position
    ) filter (where er.exercise_id is not null), '[]'::jsonb)
  )) as data
from public.gym_workout_sessions gws
left join exercise_rollup er
  on er.user_id = gws.user_id and er.session_id = gws.id
left join public.gym_exercises ge
  on ge.user_id = er.user_id and ge.id = er.exercise_id
group by gws.user_id, gws.id, gws.workout_date, gws.name, gws.source, gws.started_at, gws.ended_at;

revoke all on public.gym_workout_projection from public, anon, authenticated, service_role;
grant select on public.gym_workout_projection to authenticated, service_role;
