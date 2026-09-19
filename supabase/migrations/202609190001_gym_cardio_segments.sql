-- Cardio results: one row per segment of steady work (a treadmill warm-up,
-- a cool-down). A change of speed or incline mid-way is a second segment.
--
-- Strictly additive. One new table and one column with a default on
-- public.gym_exercises; nothing existing is rewritten. Cardio never enters
-- gym_sets, so it cannot leak into set counts, reps or tonnage in
-- gym_workout_projection or anywhere else that reads sets.
--
-- Re-runnable: every statement is IF NOT EXISTS / dropped-then-created.

alter table public.gym_exercises
  add column if not exists measure text not null default 'strength';

alter table public.gym_exercises
  drop constraint if exists gym_exercises_measure_kind;
alter table public.gym_exercises
  add constraint gym_exercises_measure_kind
  check (measure in ('strength', 'cardio'));

comment on column public.gym_exercises.measure is
  'How a result is recorded: strength = sets of reps and load in gym_sets, '
  'cardio = timed segments in gym_cardio_segments.';

create table if not exists public.gym_cardio_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  exercise_id uuid not null,
  performed_at timestamptz not null,
  -- Shares the session's order with gym_sets: a warm-up before the first set
  -- and a cool-down after the last one keep their place in the workout.
  position integer not null check (position > 0),
  duration_seconds integer not null check (duration_seconds > 0 and duration_seconds <= 21600),
  speed_kmh numeric(4,1) check (speed_kmh is null or (speed_kmh >= 0 and speed_kmh <= 40)),
  incline_pct numeric(4,1) check (incline_pct is null or (incline_pct >= -15 and incline_pct <= 40)),
  note text,
  source text not null default 'gymapp' check (length(btrim(source)) > 0),
  client_request_id uuid not null default gen_random_uuid(),
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_request_id),
  foreign key (user_id, session_id)
    references public.gym_workout_sessions (user_id, id)
    on delete cascade,
  foreign key (user_id, exercise_id)
    references public.gym_exercises (user_id, id)
    on delete restrict
);

comment on table public.gym_cardio_segments is
  'Timed cardio work, one row per segment with constant parameters. Never '
  'counted as sets, reps or tonnage.';

create index if not exists gym_cardio_session_position_idx
  on public.gym_cardio_segments (session_id, position);

create index if not exists gym_cardio_exercise_history_idx
  on public.gym_cardio_segments (user_id, exercise_id, performed_at desc);

drop trigger if exists gym_cardio_touch_updated_at on public.gym_cardio_segments;
create trigger gym_cardio_touch_updated_at
before update on public.gym_cardio_segments
for each row execute function public.gym_touch_updated_at();

alter table public.gym_cardio_segments enable row level security;

drop policy if exists gym_cardio_owner_select on public.gym_cardio_segments;
create policy gym_cardio_owner_select on public.gym_cardio_segments
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.gym_cardio_segments from anon, authenticated;
grant select on table public.gym_cardio_segments to authenticated;
grant all on table public.gym_cardio_segments to service_role;
