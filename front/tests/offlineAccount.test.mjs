import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './loadTs.mjs';
const { readOfflineOwner, rememberOfflineOwner, forgetOfflineOwner, OFFLINE_ACCOUNT_KEY }=await loadTs('../src/offlineAccount.ts');
const { writeLocalCache }=await loadTs('../src/cacheStorage.ts');
const OWNER='supabase:11111111-1111-4111-8111-111111111111';
const store=()=>{ const rows=new Map();return{getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)}; };
test('offline identity requires the matching account copy and carries no API credentials',()=>{
 const storage=store();rememberOfflineOwner(storage,OWNER);assert.equal(readOfflineOwner(storage),'');
 writeLocalCache(storage,OWNER,'journal',{data:[],updatedAt:1});assert.equal(readOfflineOwner(storage),OWNER);
 assert.deepEqual(JSON.parse(storage.getItem(OFFLINE_ACCOUNT_KEY)),{owner:OWNER});
 storage.setItem(OFFLINE_ACCOUNT_KEY,JSON.stringify({owner:'supabase:22222222-2222-4222-8222-222222222222'}));
 assert.equal(readOfflineOwner(storage),'');
});
test('explicit logout locks local access without erasing the queue or draft',()=>{
 const storage=store();rememberOfflineOwner(storage,OWNER);writeLocalCache(storage,OWNER,'journal',{data:[],updatedAt:1});
 storage.setItem('gym_offline_queue_v2','pending');storage.setItem('gym_workout_state_v2','draft');
 forgetOfflineOwner(storage);assert.equal(readOfflineOwner(storage),'');
 assert.equal(storage.getItem('gym_offline_queue_v2'),'pending');assert.equal(storage.getItem('gym_workout_state_v2'),'draft');
});
