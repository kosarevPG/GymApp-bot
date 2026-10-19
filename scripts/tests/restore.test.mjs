import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const root = fileURLToPath(new URL('../../', import.meta.url));
const owner = '270665a4-6de1-42f6-9799-4d5ad054202b';
const other = '11111111-1111-4111-8111-111111111111';
const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const plan = JSON.parse(execFileSync(py, ['-c', `import json; from scripts.restore_home_workout_20261012 import build_plan; print(json.dumps(build_plan('${owner}', confirmed_lateral_raises=True)))`], { cwd: root, encoding: 'utf8' }));
const sql = execFileSync(py, ['-c', `from scripts.restore_home_workout_20261012 import build_plan,render_sql; import sys; sys.stdout.buffer.write(render_sql(build_plan('${owner}', confirmed_lateral_raises=True)).encode('utf-8'))`], { cwd: root, encoding: 'utf8' });
const read = path => readFile(new URL(path, import.meta.url), 'utf8');

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table episodes(id bigint generated always as identity primary key,user_id uuid references auth.users(id),type text,start date,
      title text,note text,source text,metadata jsonb default '{}');`);
  await db.exec(await read('./fixtures/gym_baseline.sql'));
  await db.exec(await read('../../supabase/migrations/202609190001_gym_cardio_segments.sql'));
  await db.query('insert into auth.users values ($1),($2)', [owner, other]);
  // Existing records include a different user's workout and legacy unknown location.
  for (const user of [owner, other]) {
    await db.query(`insert into gym_workout_sessions(id,user_id,workout_date,source_record_id)
      values(gen_random_uuid(),$1,'2026-10-10','previous')`, [user]);
  }
  const prior = (await db.query('select to_jsonb(t) as row from gym_workout_projection t order by user_id')).rows;
  const files = await readdir(new URL('../../supabase/migrations/', import.meta.url));
  await db.exec(await read(`../../supabase/migrations/${files.find(f => f.endsWith('_gym_session_metadata.sql'))}`));
  // Existing projected keys and values survive. The sole new non-null JSON key is false.
  const after = (await db.query('select to_jsonb(t) as row from gym_workout_projection t order by user_id')).rows;
  assert.deepEqual(after.map(({row}) => { delete row.data.duration_is_approximate; return {row}; }), prior);
  for (const e of plan.exercises.slice(0, 3)) {
    await db.query(`insert into gym_exercises(id,user_id,source_key,name_ru,muscle_group,weight_type,multiplier)
      values(gen_random_uuid(),$1,$2,$3,$4,$5,$6)`, [owner,e.key,e.name,e.muscle,e.slot === 2 ? 'Machine' : e.kind,e.mult]);
  }
  for (const user of [owner,other]) {
    await db.query(`insert into gym_exercises(id,user_id,source_key,name_ru) values(gen_random_uuid(),$1,'old','Старое упражнение')`,[user]);
    await db.query(`insert into gym_set_groups(user_id,session_id,position,source_record_id)
      select $1,id,1,'old' from gym_workout_sessions where user_id=$1`,[user]);
    await db.query(`insert into gym_sets(user_id,session_id,set_group_id,exercise_id,position,reps,total_weight_kg,source_record_id)
      select $1,s.id,g.id,e.id,1,10,20,'old' from gym_workout_sessions s
      join gym_set_groups g on g.session_id=s.id join gym_exercises e on e.user_id=s.user_id and e.source_key='old'
      where s.user_id=$1`,[user]);
  }
  return db;
}

async function snapshot(db) {
  const result = {};
  for (const table of ['gym_exercises','gym_workout_sessions','gym_set_groups','gym_sets','gym_cardio_segments','episodes']) {
    result[table] = (await db.query(`select to_jsonb(t) as row from ${table} t order by id`)).rows;
  }
  return result;
}

test('restoration is atomic, repeatable, owned and visible in both HealthOS views', async () => {
  const db = await setup();
  try {
    const before = await snapshot(db);
    await db.exec(sql);
    const first = await snapshot(db);
    for (const table of ['gym_workout_sessions','gym_set_groups','gym_sets','gym_cardio_segments','episodes']) {
      assert.deepEqual(first[table].filter(r => before[table].some(b => b.row.id===r.row.id)),before[table]);
    }
    await db.exec(sql);
    assert.deepEqual(await snapshot(db), first, 'second import is byte-for-byte unchanged');
    const projection = (await db.query('select * from gym_workout_projection where session_id=$1', [plan.session.id])).rows[0];
    assert.equal(projection.total_sets,21);
    assert.equal(projection.exercise_count,5);
    assert.equal(Number(projection.total_volume_kg),4408);
    assert.equal(projection.data.location,'home');
    assert.equal(projection.data.duration_minutes,60);
    assert.equal(projection.data.duration_est_min,60);
    assert.equal(projection.data.duration_is_approximate,true);
    const history = (await db.query('select * from gym_exercise_history where session_id=$1 order by position',[plan.session.id])).rows;
    assert.equal(history.length,21);
    assert.deepEqual(history.map(s => s.position),Array.from({length:21},(_,i)=>i+1));
    assert.deepEqual(history.map(s => [Number(s.input_weight_kg),s.reps,s.rest_seconds]),plan.sets.map(s => [s.input_weight_kg,s.reps,s.rest_seconds]));
    assert.ok(history.every(s => s.user_id===owner && s.rpe===null && s.rir===null && s.performed_at===null));
    assert.equal(first.gym_set_groups.filter(g => g.row.session_id===plan.session.id).length,5);
    assert.equal(first.episodes.length,1);
    assert.equal(first.episodes[0].row.metadata.workout_reflection.session_id,plan.session.id);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';`);
    const owned = (await db.query('select distinct user_id from gym_workout_projection')).rows;
    assert.deepEqual(owned,[{user_id:owner}]);
    await assert.rejects(db.query('update gym_workout_sessions set location=$1 where id=$2',['other',plan.session.id]), /permission denied/);
    await db.exec('reset role');
    const arms = history.slice(-4);
    assert.ok(arms.every(s => s.reps===12 && Number(s.total_weight_kg)===16));
    // Changed user's data is neither overwritten nor silently accepted on rerun.
    await db.query('update gym_sets set reps=13 where session_id=$1 and position=21',[plan.session.id]);
    const edited = await snapshot(db);
    await assert.rejects(db.exec(sql), /Set conflict/);
    await db.exec('rollback');
    assert.deepEqual(await snapshot(db),edited);
  } finally { await db.close(); }
});

test('same date conflict aborts before catalog changes; another user cannot supply a required exercise', async () => {
  const db = await setup();
  try {
    await db.query(`insert into gym_workout_sessions(user_id,workout_date,source_record_id) values($1,'2026-10-12','manual')`,[owner]);
    const before = await snapshot(db);
    await assert.rejects(db.exec(sql), /Another session exists/);
    await db.exec('rollback');
    assert.deepEqual(await snapshot(db),before);
    await db.query(`delete from gym_workout_sessions where source_record_id='manual'`);
    await db.query(`update gym_exercises set user_id=$1 where source_key=$2`,[other,plan.exercises[0].key]);
    const wrongOwner = await snapshot(db);
    await assert.rejects(db.exec(sql), /Missing or ambiguous exercise/);
    await db.exec('rollback');
    assert.deepEqual(await snapshot(db),wrongOwner);
  } finally { await db.close(); }
});

test('generator refuses wrong owner and unconfirmed movement', () => {
  for (const args of [`'${other}', confirmed_lateral_raises=True`, `'${owner}', confirmed_lateral_raises=False`]) {
    assert.throws(() => execFileSync(py,['-c',`from scripts.restore_home_workout_20261012 import build_plan; build_plan(${args})`],{cwd:root,stdio:'pipe'}));
  }
});

test('reviewed SQL matches the deterministic generator', async () => {
  assert.equal((await read('../../supabase/restorations/20261012_home_workout.sql')).replace(/\r\n/g,'\n'),sql);
});
