import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './loadTs.mjs';
const {journalVersions,mergeJournalDelta}=await loadTs('../src/journalSync.ts');
const session=(id,date,version='v1')=>({id,date,exercises:[],syncVersion:version});
test('unchanged sessions stay local; only changed sessions replace them and missing IDs are removed',()=>{
 const a=session('a','2026.10.12'),b=session('b','2026.10.16'),c=session('c','2026.10.20','v2');
 const result=mergeJournalDelta([a,b],{mode:'delta',manifest:{a:'v1',c:'v2'},changedIds:['c'],upserts:[c]});
 assert.deepEqual(result,[c,a]);assert.equal(result[1],a);assert.deepEqual(journalVersions(result),{c:'v2',a:'v1'});
 assert.deepEqual(mergeJournalDelta(result,{mode:'delta',manifest:{},changedIds:[],upserts:[]}),[]);
});
test('a changed but now empty session is removed even if its parent record remains',()=>{
 assert.deepEqual(mergeJournalDelta([session('a','2026.10.12')],{mode:'delta',manifest:{a:'v2'},changedIds:['a'],upserts:[]}),[]);
});
test('full fallback and malformed deltas preserve a safe rollout',()=>{
 const rows=[session('a','2026.10.12')];assert.equal(mergeJournalDelta([],{mode:'full',history:rows}),rows);
 assert.equal(mergeJournalDelta(rows,{mode:'delta',manifest:{},changedIds:['a'],upserts:rows}),null);
 assert.equal(mergeJournalDelta(rows,null),null);
});
