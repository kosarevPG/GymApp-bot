-- Read-only, one-statement snapshot. No row triggers, backfills or view changes.
-- Only the authenticated GymApp backend may choose p_user_id.
create or replace function public.gym_journal_snapshot_v1(p_user_id uuid, p_known jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path = '' as $function$
  with snapshots as materialized (
    select s.id, jsonb_build_object(
      'session', to_jsonb(s),
      'groups', coalesce((select jsonb_agg(to_jsonb(g) order by g.id)
        from public.gym_set_groups g where g.user_id = p_user_id and g.session_id = s.id), '[]'::jsonb),
      'sets', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
        from public.gym_sets t where t.user_id = p_user_id and t.session_id = s.id), '[]'::jsonb),
      'cardio', coalesce((select jsonb_agg(to_jsonb(c) order by c.id)
        from public.gym_cardio_segments c where c.user_id = p_user_id and c.session_id = s.id), '[]'::jsonb),
      'exercises', coalesce((select jsonb_agg(to_jsonb(e) order by e.id)
        from public.gym_exercises e where e.user_id = p_user_id and e.id in (
          select t.exercise_id from public.gym_sets t where t.user_id = p_user_id and t.session_id = s.id
          union
          select c.exercise_id from public.gym_cardio_segments c where c.user_id = p_user_id and c.session_id = s.id
        )), '[]'::jsonb)
    ) as snapshot
    from public.gym_workout_sessions s where s.user_id = p_user_id
  ), versions as materialized (
    select id, snapshot, md5(snapshot::text) as revision from snapshots
  )
  select jsonb_build_object(
    'manifest', coalesce(jsonb_object_agg(id::text, revision), '{}'::jsonb),
    'changed', coalesce(jsonb_agg(snapshot || jsonb_build_object('revision', revision) order by id)
      filter (where (p_known ->> id::text) is distinct from revision), '[]'::jsonb)
  ) from versions;
$function$;

revoke all on function public.gym_journal_snapshot_v1(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.gym_journal_snapshot_v1(uuid, jsonb) to service_role;
comment on function public.gym_journal_snapshot_v1(uuid, jsonb) is
  'GymApp backend-only journal delta; owner filtered, stable statement snapshot, no mutation of HealthOS records.';
