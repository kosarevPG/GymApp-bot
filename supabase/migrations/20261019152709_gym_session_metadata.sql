-- Additive metadata only. No historical backfill, new grants or auth changes.
begin;
alter table public.gym_workout_sessions
  add column location text check (location in ('gym', 'home', 'other')),
  add column duration_minutes numeric(8,2) check (duration_minutes > 0 and duration_minutes <= 1440),
  add column duration_is_approximate boolean not null default false;
comment on column public.gym_workout_sessions.location is 'Unknown for historical sessions; default gym belongs to the new-workout UI.';
comment on column public.gym_workout_sessions.duration_minutes is 'Reported duration, independent of unknown started_at/ended_at. NULL keeps legacy estimates.';
-- Same columns/security_invoker and existing grants; only JSON data is extended.
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
    'duration_est_min', coalesce(gws.duration_minutes, ceil(coalesce(sum(er.total_rest_seconds), 0)::numeric / 60)) ,
    'location', gws.location,
    'duration_minutes', gws.duration_minutes,
    'duration_is_approximate', gws.duration_is_approximate,
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

commit;
