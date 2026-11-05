import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const owner = '270665a4-6de1-42f6-9799-4d5ad054202b';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const MIGRATION = '../../supabase/migrations/20261105200000_gym_deletion_journal.sql';

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  await db.exec(await read('./fixtures/gym_baseline.sql'));
  await db.exec(await read('../../supabase/migrations/202609190001_gym_cardio_segments.sql'));
  await db.query('insert into auth.users values ($1)', [owner]);
  await db.query(`insert into gym_exercises(id,user_id,source_key,name_ru) values(gen_random_uuid(),$1,'press','Жим')`, [owner]);
  await db.query(`insert into gym_workout_sessions(id,user_id,workout_date,source_record_id) values(gen_random_uuid(),$1,'2026-11-01','live:a')`, [owner]);
  await db.query(`insert into gym_set_groups(user_id,session_id,position,source_record_id)
    select $1,id,1,'g' from gym_workout_sessions where user_id=$1`, [owner]);
  for (const position of [1, 2]) {
    await db.query(`insert into gym_sets(user_id,session_id,set_group_id,exercise_id,position,reps,total_weight_kg,source_record_id)
      select $1,s.id,g.id,e.id,$2::int,8,60,'s'||$2::text from gym_workout_sessions s join gym_set_groups g on g.session_id=s.id
      join gym_exercises e on e.user_id=s.user_id where s.user_id=$1`, [owner, position]);
  }
  return db;
}

const journal = async db => (await db.query('select table_name, user_id, row_data from gym_deleted_rows order by id')).rows;

test('deleting a workout keeps a copy of the session, its groups and every set', async () => {
  const db = await setup();
  const migration = await read(MIGRATION);
  await db.exec(migration);
  await db.exec(migration); // повторный запуск безопасен
  const before = (await db.query('select to_jsonb(s) as row from gym_sets s order by position')).rows.map(r => r.row);

  await db.query('delete from gym_workout_sessions where user_id=$1', [owner]);

  const rows = await journal(db);
  assert.deepEqual(rows.map(r => r.table_name).sort(), ['gym_set_groups', 'gym_sets', 'gym_sets', 'gym_workout_sessions']);
  assert.ok(rows.every(r => r.user_id === owner));
  const savedSets = rows.filter(r => r.table_name === 'gym_sets').map(r => r.row_data).sort((a, b) => a.position - b.position);
  assert.deepEqual(savedSets, before);
});

test('the restore script brings a deleted workout back exactly, and only once', async () => {
  const db = await setup();
  await db.exec(await read(MIGRATION));
  const tables = ['gym_workout_sessions', 'gym_set_groups', 'gym_sets'];
  const dump = async () => Object.fromEntries(await Promise.all(tables.map(async t =>
    [t, (await db.query(`select to_jsonb(x) as row from ${t} x order by id`)).rows.map(r => r.row)])));
  const before = await dump();
  const sessionId = before.gym_workout_sessions[0].id;

  await db.query('delete from gym_workout_sessions where id=$1', [sessionId]);
  assert.equal((await db.query('select count(*)::int as n from gym_sets')).rows[0].n, 0);

  const script = (await read('../restore_deleted_session.sql')).replaceAll('__SESSION_ID__', sessionId);
  await db.exec(script);
  assert.deepEqual(await dump(), before);
  await assert.rejects(db.exec(script), /duplicate key/);
  assert.deepEqual(await dump(), before);
});

test('a single set deletion is journaled and the copy restores the row exactly', async () => {
  const db = await setup();
  await db.exec(await read(MIGRATION));
  const [set] = (await db.query('select to_jsonb(s) as row from gym_sets s where position=1')).rows.map(r => r.row);
  await db.query('delete from gym_sets where position=1');

  const [entry] = await journal(db);
  assert.equal(entry.table_name, 'gym_sets');
  // Возврат по инструкции из docs/BACKUPS_AND_DELETION_JOURNAL.md: только обычные
  // колонки, вычисляемый tonnage_kg база пересчитает сама.
  const columns = (await db.query(`select string_agg(quote_ident(column_name), ',' order by ordinal_position) as list
    from information_schema.columns where table_schema='public' and table_name='gym_sets' and is_generated='NEVER'`)).rows[0].list;
  await db.query(`insert into gym_sets (${columns}) select ${columns} from jsonb_populate_record(null::gym_sets, $1::jsonb)`, [entry.row_data]);
  const [restored] = (await db.query('select to_jsonb(s) as row from gym_sets s where position=1')).rows.map(r => r.row);
  assert.deepEqual(restored, set);
});

test('browser roles cannot read or write the journal, the backend role can read it', async () => {
  const db = await setup();
  await db.exec(await read(MIGRATION));
  const grants = (await db.query(`select grantee, privilege_type from information_schema.role_table_grants
    where table_name='gym_deleted_rows' order by grantee, privilege_type`)).rows.map(r => `${r.grantee}:${r.privilege_type}`);
  assert.ok(!grants.some(g => g.startsWith('anon:') || g.startsWith('authenticated:')));
  assert.ok(grants.includes('service_role:SELECT'));
  const rls = (await db.query(`select relrowsecurity from pg_class where relname='gym_deleted_rows'`)).rows[0].relrowsecurity;
  assert.equal(rls, true);
});
