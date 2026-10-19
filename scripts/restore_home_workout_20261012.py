"""Generate a reviewed, atomic SQL restoration. Never connects to a database.

Usage (after confirming the exercise):
  python scripts/restore_home_workout_20261012.py --user-id <owner UUID> \
      --confirm-lateral-raises --output <reviewed.sql>
Apply the generated SQL separately, ONLY after production approval.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import uuid

OWNER = "270665a4-6de1-42f6-9799-4d5ad054202b"
NAMESPACE = uuid.UUID("fe34bb38-93e9-4ba6-8fe3-a0ac6a88a631")
MARKER = "restore-home-2026-10-12-v1"
DATE = "2026-10-12"


def stable(user_id: str, key: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"{user_id}:{MARKER}:{key}"))


def build_plan(user_id: str, *, confirmed_lateral_raises: bool) -> dict:
    if str(uuid.UUID(user_id)) != OWNER:
        raise ValueError("Owner does not match the reviewed exercise catalog")
    if not confirmed_lateral_raises:
        raise ValueError("Confirm that махи means lateral raises standing before generating SQL")
    specs = [
        ("6d50c565-e5f6-4895-bdf5-a2562ba68dd25", "Махи в стороны (стоя)", "Плечи", "Dumbbell", 2,
         [2, 2, 4, 4, 4], [20, 20, 15, 15, 15], [90, 90, 120, 120, 0]),
        ("adbad182-27f2-4bdd-8b77-0df259d789f5", "Протяжка гири", "Плечи", "Other", 1,
         [24] * 4, [15] * 4, [90, 90, 120, 0]),
        ("4267ab6c-26e2-4741-811a-de40a23f473e", "Сгибание рук с гантелями стоя", "Бицепс", "Dumbbell", 2,
         [8] * 4, [15] * 4, [120, 120, 120, 0]),
        (None, "Разгибание рук с гантелями на трицепс в наклоне", "Трицепс", "Dumbbell", 2,
         [4, 4, 8, 8], [15] * 4, [120, 120, 120, 0]),
        (None, "Концентрированный подъём на бицепс", "Бицепс", "Dumbbell", 2,
         [8] * 4, [12] * 4, [120, 120, 120, 0]),
    ]
    session_id = stable(user_id, "session")
    exercises, groups, sets = [], [], []
    for index, (key, name, muscle, kind, mult, weights, reps, rests) in enumerate(specs, 1):
        exercise_id = stable(user_id, f"exercise:{index}")
        per_side = index == 5
        exercises.append({"slot": index, "key": key, "id": exercise_id, "name": name,
                          "muscle": muscle, "kind": kind, "mult": mult, "per_side": per_side})
        group_id = stable(user_id, f"group:{index}")
        groups.append({"id": group_id, "user_id": user_id, "session_id": session_id,
                       "position": len(sets) + 1, "group_type": "single", "source": "gymapp",
                       "source_record_id": f"{MARKER}:group:{index}", "legacy_group_id": group_id,
                       "source_payload": {"restoration": MARKER}})
        for local_index, (weight, count, rest) in enumerate(zip(weights, reps, rests), 1):
            position = len(sets) + 1
            request_id = stable(user_id, f"request:{position}")
            load = {"v": 1, "type": kind, "mult": mult, "base": 0}
            if per_side:
                load["perSide"] = True
            note = None
            if per_side:
                note = {1: "Первый подход лёгкий.", 3: "Подходящая нагрузка.", 4: "Подходящая нагрузка."}.get(local_index)
            sets.append({"id": stable(user_id, f"set:{position}"), "user_id": user_id,
                         "session_id": session_id, "set_group_id": group_id, "exercise_slot": index,
                         "performed_at": None, "position": position, "input_weight_kg": weight,
                         # A bilateral round is one set, 12 reps EACH arm, not 24
                         # reps per arm or eight sets. Both sides count in volume.
                         "total_weight_kg": weight * mult, "reps": count, "rest_seconds": rest,
                         "set_type": "working", "rpe": None, "rir": None, "note": note,
                         "include_in_tonnage": True, "source": "gymapp",
                         "source_record_id": f"{MARKER}:set:{position}", "client_request_id": request_id,
                         "legacy_session_id": session_id, "source_payload": {"restoration": MARKER, "load": load}})
    return {"user_id": user_id, "session": {"id": session_id, "user_id": user_id, "workout_date": DATE,
            "started_at": None, "ended_at": None, "source": "gymapp", "source_record_id": MARKER,
            "location": "home", "duration_minutes": 60, "duration_is_approximate": True,
            "session_note": "Домашняя тренировка восстановлена по фактически выполненным подходам. Вес гантели указан для одной руки; концентрированный подъём — 12 повторений каждой рукой в каждом из четырёх подходов.",
            "source_payload": {"restoration": MARKER, "client_session_id": session_id}},
            "exercises": exercises, "groups": groups, "sets": sets,
            "reflection": {"id": -(int(uuid.UUID(stable(user_id, "reflection"))) % (2**62) or 1),
                           "user_id": user_id, "type": "workout_note", "start": DATE,
                           "title": "Домашняя тренировка 12.10.2026",
                           "note": "Протяжка гири: тяжеловато, небольшая раскачка, первое выполнение после долгого перерыва. Бицепс стоя: тяжеловато. Трицепс: 4 кг слишком легко, на 8 кг оставался запас. Концентрированный бицепс: первый подход лёгкий, третий и четвёртый — подходящая нагрузка.",
                           "source": "manual", "metadata": {"ingest": "gymapp_restoration_v1", "restoration": MARKER,
                           "workout_reflection": {"session_id": session_id}}}}


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def render_sql(plan: dict) -> str:
    encoded = sql_literal(json.dumps(plan, ensure_ascii=False, indent=2))
    return SQL_TEMPLATE.replace("__PLAN__", encoded)


SQL_TEMPLATE = """-- Generated restoration; review and approve before applying to HealthOS.
-- No network is used by the generator. All writes below form ONE transaction.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.gym_exercises, public.gym_workout_sessions, public.gym_set_groups,
  public.gym_sets, public.gym_cardio_segments, public.episodes in share row exclusive mode;
create temp table restore_plan on commit drop as select __PLAN__::jsonb as data;
-- Assert that unrelated training rows remain byte-for-byte identical.
create temp table restore_before on commit drop as
select 'sessions' as kind, id::text, to_jsonb(t) as data from public.gym_workout_sessions t
union all select 'groups',id::text,to_jsonb(t) from public.gym_set_groups t
union all select 'sets',id::text,to_jsonb(t) from public.gym_sets t
union all select 'cardio',id::text,to_jsonb(t) from public.gym_cardio_segments t;
do $restore$
declare
  p jsonb := (select data from restore_plan);
  owner_id uuid := (p->>'user_id')::uuid;
  sid uuid := (p->'session'->>'id')::uuid;
  e jsonb; row_data jsonb; expected jsonb; actual jsonb; eid uuid; n integer;
  exercise_ids uuid[] := '{}';
begin
  if not exists(select 1 from auth.users where id=owner_id) then
    raise exception 'Reviewed owner missing';
  end if;
  -- This task restores ONE missing session. Never merge a different session by date.
  if exists(select 1 from public.gym_workout_sessions where user_id=owner_id
            and workout_date='2026-10-12' and id<>sid) then
    raise exception 'Another session exists on 2026-10-12; manual review required';
  end if;
  for e in select value from jsonb_array_elements(p->'exercises') loop
    if e->>'key' is not null then
      select count(*), (array_agg(id))[1] into n,eid from public.gym_exercises
        where user_id=owner_id and (id::text=e->>'key' or source_key=e->>'key');
    else
      -- Include known spelling/name variants and aliases; ambiguous matches abort.
      select count(distinct ge.id), (array_agg(distinct ge.id))[1] into n,eid
      from public.gym_exercises ge left join public.gym_exercise_aliases a
        on a.user_id=ge.user_id and a.exercise_id=ge.id
      where ge.user_id=owner_id and (
        lower(replace(ge.name_ru,'ё','е'))=lower(replace(e->>'name','ё','е'))
        or lower(replace(a.alias_value,'ё','е'))=lower(replace(e->>'name','ё','е'))
        or ((e->>'slot')::int=4 and ge.name_ru ilike '%разгибан%'
            and ge.name_ru ilike '%наклон%' and ge.weight_type='Dumbbell')
        or ((e->>'slot')::int=5 and ge.name_ru ilike '%концентр%'
            and (ge.name_ru ilike '%бицеп%' or ge.name_ru ilike '%сгибан%')));
    end if;
    if n>1 or (n=0 and e->>'key' is not null) then
      raise exception 'Missing or ambiguous exercise: %',e->>'name';
    end if;
    if n=0 then
      eid := (e->>'id')::uuid;
      insert into public.gym_exercises(id,user_id,source,source_key,name_ru,muscle_group,
        weight_type,base_weight_kg,multiplier,tonnage_mode,source_payload,description)
      values(eid,owner_id,'gymapp',eid::text,e->>'name',e->>'muscle',e->>'kind',0,
        (e->>'mult')::numeric,'external_load',jsonb_build_object('restoration',p->'session'->>'source_record_id',
        'reps_per_side',(e->>'per_side')::boolean),
        case when (e->>'per_side')::boolean then
        'Одностороннее выполнение: один подход включает обе руки. Повторения указываются на каждую руку; вес — одной гантели. Множитель 2 учитывает обе руки в тоннаже.'
        else 'Вес одной гантели; выполнение двумя гантелями.' end);
    end if;
    if (e->>'slot')::int=2 then
      -- Catalog correction ONLY; historical total_weight/tonnage stays intact.
      update public.gym_exercises set weight_type='Other',base_weight_kg=0,multiplier=1
        where user_id=owner_id and id=eid and
        (weight_type<>'Other' or base_weight_kg<>0 or multiplier<>1);
    end if;
    if not exists(select 1 from public.gym_exercises where id=eid and user_id=owner_id
      and is_active and weight_type=e->>'kind' and base_weight_kg=0
      and multiplier=(e->>'mult')::numeric and tonnage_mode='external_load'
      and ((e->>'slot')::int<>5 or source_payload @> '{"reps_per_side":true}')) then
      raise exception 'Exercise rules differ; review instead of overwriting: %',e->>'name';
    end if;
    exercise_ids := array_append(exercise_ids,eid);
  end loop;
  -- Insert-only; a retry must match, never overwrite manual changes.
  expected := p->'session';
  insert into public.gym_workout_sessions
    (id,user_id,workout_date,started_at,ended_at,source,source_record_id,location,
     duration_minutes,duration_is_approximate,session_note,source_payload)
  select id,user_id,workout_date,started_at,ended_at,source,source_record_id,location,
    duration_minutes,duration_is_approximate,session_note,source_payload
  from jsonb_populate_record(null::public.gym_workout_sessions,expected)
  on conflict do nothing;
  select to_jsonb(t) into actual from public.gym_workout_sessions t where id=sid and user_id=owner_id;
  if actual is null or not actual @> expected then raise exception 'Session conflict'; end if;
  for expected in select value from jsonb_array_elements(p->'groups') loop
    insert into public.gym_set_groups(id,user_id,session_id,position,group_type,source,
      source_record_id,legacy_group_id,source_payload)
    select id,user_id,session_id,position,group_type,source,source_record_id,legacy_group_id,source_payload
      from jsonb_populate_record(null::public.gym_set_groups,expected) on conflict do nothing;
    select to_jsonb(t) into actual from public.gym_set_groups t where id=(expected->>'id')::uuid and user_id=owner_id;
    if actual is null or not actual @> expected then raise exception 'Group conflict'; end if;
  end loop;
  for row_data in select value from jsonb_array_elements(p->'sets') loop
    expected := (row_data - 'exercise_slot') || jsonb_build_object('exercise_id',exercise_ids[(row_data->>'exercise_slot')::int]);
    insert into public.gym_sets(id,user_id,session_id,set_group_id,exercise_id,performed_at,position,
      input_weight_kg,total_weight_kg,reps,rest_seconds,set_type,rpe,rir,note,include_in_tonnage,
      source,source_record_id,client_request_id,legacy_session_id,source_payload)
    select id,user_id,session_id,set_group_id,exercise_id,performed_at,position,
      input_weight_kg,total_weight_kg,reps,rest_seconds,set_type,rpe,rir,note,include_in_tonnage,
      source,source_record_id,client_request_id,legacy_session_id,source_payload
    from jsonb_populate_record(null::public.gym_sets,expected) on conflict do nothing;
    select to_jsonb(t) into actual from public.gym_sets t where id=(expected->>'id')::uuid and user_id=owner_id;
    if actual is null or not actual @> expected then raise exception 'Set conflict'; end if;
  end loop;
  expected := p->'reflection';
  insert into public.episodes(id,user_id,type,start,title,note,source,metadata)
    overriding system value
    select id,user_id,type,start,title,note,source,metadata
    from jsonb_populate_record(null::public.episodes,expected) on conflict do nothing;
  select to_jsonb(t) into actual from public.episodes t where id=(expected->>'id')::bigint and user_id=owner_id;
  if actual is null or not actual @> expected then raise exception 'Reflection conflict'; end if;
  if (select count(*) from public.gym_sets where user_id=owner_id and session_id=sid)<>21
    or (select count(distinct exercise_id) from public.gym_sets where user_id=owner_id and session_id=sid)<>5
    or (select sum(tonnage_kg) from public.gym_sets where user_id=owner_id and session_id=sid)<>4408
    or exists(select 1 from public.gym_cardio_segments where user_id=owner_id and session_id=sid) then
    raise exception 'Restoration totals differ';
  end if;
  if exists(select 1 from restore_before b left join (
    select 'sessions' as kind,id::text,to_jsonb(t) as data from public.gym_workout_sessions t
    union all select 'groups',id::text,to_jsonb(t) from public.gym_set_groups t
    union all select 'sets',id::text,to_jsonb(t) from public.gym_sets t
    union all select 'cardio',id::text,to_jsonb(t) from public.gym_cardio_segments t
  ) a using(kind,id) where a.data is distinct from b.data) then
    raise exception 'An existing training record changed';
  end if;
end $restore$;
select session_id,date,exercise_count,total_sets,total_volume_kg,data->>'location' as location,
  data->>'duration_minutes' as duration_minutes
from public.gym_workout_projection where session_id=((select data from restore_plan)->'session'->>'id')::uuid;
commit;
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--confirm-lateral-raises", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    plan = build_plan(args.user_id, confirmed_lateral_raises=args.confirm_lateral_raises)
    args.output.write_text(render_sql(plan), encoding="utf-8")
    print(f"SQL prepared: {args.output}; session={plan['session']['id']}; 5 exercises, 21 sets. No database connection.")


if __name__ == "__main__":
    main()
