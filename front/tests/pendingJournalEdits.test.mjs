import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './loadTs.mjs';
const {pendingSetEdits}=await loadTs('../src/sessionMetadata.ts');
const history=[{id:'workout',duration:'4м',duration_source:'estimated',exercises:[{exerciseId:'ex',sets:[{id:'a',weight:60,input_weight:20,reps:10,rest:2},{id:'b',weight:70,input_weight:25,reps:10,rest:2}]}]}];
test('queued edits preserve historical units and update stale reads without changing the source',()=>{
 const result=pendingSetEdits(history,[{type:'updateSet',data:{client_request_id:'a',reps:12,rest:1.5}}]);
 assert.deepEqual(result[0].exercises[0].sets[0],{id:'a',weight:60,input_weight:20,reps:12,rest:1.5});
 assert.equal(history[0].exercises[0].sets[0].reps,10);assert.equal(result[0].pendingChanges,true);
});
test('queued removals hide sets, empty blocks and deleted sessions while preserving reported duration',()=>{
 const queue=[{type:'deleteSet',data:{client_request_id:'a'}}];
 assert.equal(pendingSetEdits(history,queue)[0].duration,'2м');
 assert.equal(pendingSetEdits([{...history[0],duration_source:'reported',duration:'≈60м'}],queue)[0].duration,'≈60м');
 assert.deepEqual(pendingSetEdits(history,[...queue,{type:'deleteSet',data:{client_request_id:'b'}}]),[]);
 assert.deepEqual(pendingSetEdits(history,[{type:'deleteWorkout',data:{session_id:'workout'}}]),[]);
});
