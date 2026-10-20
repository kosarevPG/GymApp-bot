import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './loadTs.mjs';
const { createLocalResource } = await loadTs('../src/localResource.ts');
const { readLocalCache, writeLocalCache, localCacheKey } = await loadTs('../src/cacheStorage.ts');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(extra = {}) {
  let now = 100_000, saved = { data: ['saved'], updatedAt: 1 }, calls = 0;
  const response = deferred();
  const resource = createLocalResource({ read: () => saved, write: value => { saved = value; },
    fetch: () => { calls++; return response.promise; }, online: () => true, valid: Array.isArray, now: () => now, ...extra });
  return { resource, response, get calls() { return calls; }, get saved() { return saved; }, advance: ms => { now += ms; } };
}
test('cached rows are synchronous while concurrent screens share one background request', async () => {
  const f = fixture();
  assert.deepEqual(f.resource.getSnapshot().data, ['saved']);
  const first = f.resource.refresh();
  assert.equal(f.resource.refresh(), first);
  await tick(); assert.equal(f.calls, 1);
  assert.equal(f.resource.getSnapshot().refreshing, true);
  f.response.resolve(['new']); await first;
  assert.deepEqual(f.resource.getSnapshot().data, ['new']);
  await f.resource.refresh(); assert.equal(f.calls, 1, 'fresh data does not trigger another request');
});
test('offline cache remains visible without any fetch and without rewriting the saved timestamp', async () => {
  const f = fixture({ online: () => false });
  assert.deepEqual(await f.resource.refresh(), ['saved']);
  assert.equal(f.calls, 0); assert.equal(f.resource.getSnapshot().updatedAt, 1);
});
test('failed or malformed refresh never erases the last good history, and retries have a cooldown', async () => {
  for (const result of [null, { error:'unavailable' }]) {
    let calls = 0;
    const f = fixture({ fetch: async () => { calls++; return result; } });
    await f.resource.refresh();
    assert.deepEqual(f.resource.getSnapshot().data, ['saved']); assert.equal(f.resource.getSnapshot().error, true);
    await f.resource.refresh(); assert.equal(calls, 1);
    await f.resource.refresh(true); assert.equal(calls, 2, 'explicit retry is permitted');
  }
});
test('an authoritative empty journal clears synchronized history', async () => {
  const f = fixture({ fetch: async () => [] }); await f.resource.refresh();
  assert.deepEqual(f.resource.getSnapshot().data, []); assert.deepEqual(f.saved.data, []);
});
test('cache quota failure keeps new data in memory and preserves the existing disk copy', async () => {
  const f = fixture({ write: () => { throw Error('quota'); } });
  const pending = f.resource.refresh(); f.response.resolve(['new']); await pending;
  assert.deepEqual(f.resource.getSnapshot().data, ['new']); assert.equal(f.resource.getSnapshot().persisted, false);
  assert.deepEqual(f.saved.data, ['saved']);
});
test('acknowledgement during a fetch discards the stale response and shares one follow-up', async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const f = fixture({ fetch: () => (++calls === 1 ? first.promise : second.promise) });
  const pending = f.resource.refresh(); await tick();
  f.resource.invalidate(); assert.equal(f.resource.refresh(), pending);
  first.resolve(['stale']); await tick();
  assert.deepEqual(f.resource.getSnapshot().data, ['saved']); assert.equal(calls, 2);
  second.resolve(['after-ack']); await pending;
  assert.deepEqual(f.resource.getSnapshot().data, ['after-ack']);
});
test('an optimistic update does not pretend the server snapshot was just synchronized', () => {
  const f = fixture(); f.resource.update(rows => [...rows, 'pending']);
  assert.equal(f.resource.getSnapshot().updatedAt, 1); assert.deepEqual(f.resource.getSnapshot().data, ['saved','pending']);
});
test('a late stale response cannot replace local work after the connection drops', async () => {
  let online = true;
  const f = fixture({ online: () => online });
  const pending = f.resource.refresh(); await tick();
  f.resource.invalidate(); f.resource.update(() => ['local-after-ack']); online = false;
  f.response.resolve(['stale-before-ack']); await pending;
  assert.deepEqual(f.resource.getSnapshot().data, ['local-after-ack']);
});
test('subscribers receive fresh snapshots and unsubscribe without leaving observers', async () => {
  const f = fixture(); const snapshots = [];
  const stop = f.resource.subscribe(() => snapshots.push(f.resource.getSnapshot()));
  const pending = f.resource.refresh(); f.response.resolve(['new']); await pending;
  assert.ok(snapshots.some(s => s.refreshing)); assert.equal(snapshots.at(-1).refreshing, false);
  stop(); assert.equal(f.resource.observed(), false);
});
test('account and analytics-period keys are isolated, and corrupt entries are ignored', () => {
  const values = new Map(); const storage = { getItem: k => values.get(k) || null, setItem: (k,v) => values.set(k,v) };
  writeLocalCache(storage, 'a', 'journal', { data:['private-a'], updatedAt:123 });
  assert.equal(readLocalCache(storage,'b','journal'), null);
  assert.deepEqual(readLocalCache(storage,'a','journal').data, ['private-a']);
  assert.equal(readLocalCache(storage,'a','analytics:7'), null);
  values.set(localCacheKey('b','journal'), values.get(localCacheKey('a','journal')));
  assert.equal(readLocalCache(storage,'b','journal'), null, 'owner inside the envelope is checked');
  values.set(localCacheKey('a','journal'), '{broken'); assert.equal(readLocalCache(storage,'a','journal'), null);
});
