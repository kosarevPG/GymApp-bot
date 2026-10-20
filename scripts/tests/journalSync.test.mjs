import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const owner='270665a4-6de1-42f6-9799-4d5ad054202b',other='11111111-1111-4111-8111-111111111111';
test('SQL snapshot is read-only, owner-scoped, selective, deletion-aware and inaccessible to browser roles',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table episodes(id bigint generated always as identity primary key,user_id uuid references auth.users(id),type text,start date,title text,note text,source text,metadata jsonb default '{}');`);
  await db.exec(await read('./fixtures/gym_baseline.sql'));
  await db.exec(await read('../../supabase/migrations/202609190001_gym_cardio_segments.sql'));
  await db.exec(await read('../../supabase/migrations/20261019152709_gym_session_metadata.sql'));
  await db.query('insert into auth.users values ($1),($2)',[owner,other]);
  const sessions=[];
  for(const user of [owner,other]){
   const ex=(await db.query(`insert into gym_exercises(user_id,source_key,name_ru,muscle_group) values($1,'test','Жим','Грудь') returning id`,[user])).rows[0].id;
   for(let i=0;i<2;i++){
    const session=(await db.query(`insert into gym_workout_sessions(user_id,workout_date,source_record_id) values($1,'2026-10-12',$2) returning id`,[user,'session-'+i])).rows[0].id;
    const group=(await db.query(`insert into gym_set_groups(user_id,session_id,position,source_record_id) values($1,$2,1,$3) returning id`,[user,session,'group-'+i])).rows[0].id;
    const set=(await db.query(`insert into gym_sets(user_id,session_id,set_group_id,exercise_id,position,reps,total_weight_kg,source_record_id) values($1,$2,$3,$4,1,10,20,$5) returning id`,[user,session,group,ex,'set-'+i])).rows[0].id;
    sessions.push({user,session,ex,set});
   }
  }
  const before=(await db.query('select to_jsonb(t) as row from gym_workout_projection t order by session_id')).rows;
  await db.exec(await read('../../supabase/migrations/20261020194920_gym_journal_snapshot_v1.sql'));
  assert.deepEqual((await db.query('select to_jsonb(t) as row from gym_workout_projection t order by session_id')).rows,before);
  const snapshot=async known=>(await db.query('select public.gym_journal_snapshot_v1($1,$2::jsonb) as data',[owner,JSON.stringify(known)])).rows[0].data;
  const initial=await snapshot({});assert.equal(Object.keys(initial.manifest).length,2);assert.equal(initial.changed.length,2);
  for(const row of initial.changed)for(const records of [[row.session],row.groups,row.sets,row.exercises,row.cardio])
   assert.ok(records.every(record=>record.user_id===owner));
  const identical=await snapshot(initial.manifest);assert.deepEqual(identical.changed,[]);
  assert.ok(JSON.stringify(identical).length<JSON.stringify(initial).length/5);
  await db.query('update gym_sets set reps=11 where id=$1',[sessions[0].set]);
  const edited=await snapshot(initial.manifest);assert.equal(edited.changed.length,1);assert.equal(edited.changed[0].session.id,sessions[0].session);
  await db.query('update gym_sets set include_in_tonnage=false where id=$1',[sessions[0].set]);
  const excluded=await snapshot(edited.manifest);assert.equal(excluded.changed.length,1);
  await db.query(`update gym_exercises set muscle_group='Спина' where id=$1`,[sessions[0].ex]);
  const renamed=await snapshot(excluded.manifest);assert.equal(renamed.changed.length,2,'exercise metadata invalidates its sessions');
  await db.query('delete from gym_workout_sessions where id=$1',[sessions[0].session]);
  const deleted=await snapshot(renamed.manifest);assert.equal(Object.keys(deleted.manifest).length,1);assert.deepEqual(deleted.changed,[]);
  assert.ok(!Object.hasOwn(deleted.manifest,sessions[0].session));
  const permissions=(await db.query(`select
    has_function_privilege('anon','public.gym_journal_snapshot_v1(uuid,jsonb)','execute') as anon,
    has_function_privilege('authenticated','public.gym_journal_snapshot_v1(uuid,jsonb)','execute') as authenticated,
    has_function_privilege('service_role','public.gym_journal_snapshot_v1(uuid,jsonb)','execute') as service`)).rows[0];
  assert.deepEqual(permissions,{anon:false,authenticated:false,service:true});
  const metadata=(await db.query(`select prosecdef,provolatile from pg_proc where oid='public.gym_journal_snapshot_v1(uuid,jsonb)'::regprocedure`)).rows[0];
  assert.equal(metadata.prosecdef,false);assert.equal(metadata.provolatile,'s');
  await db.exec('set role authenticated');
  await assert.rejects(()=>snapshot({}),/permission denied/);await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from gym_workout_sessions where user_id=$1',[other])).rows[0].n,2);
 }finally{await db.close();}
});
