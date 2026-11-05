import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './loadTs.mjs';

const { evictableKeys, removeLegacyCopies, setItemFreeingSpace } = await loadTs('../src/storageSpace.ts');

/** localStorage с ограничением по числу символов, как в браузере. */
class LimitedStorage {
  constructor(limit) { this.limit = limit; this.map = new Map(); }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  removeItem(k) { this.map.delete(k); }
  used(except) { let n = 0; for (const [k, v] of this.map) if (k !== except) n += k.length + v.length; return n; }
  setItem(k, v) {
    if (this.used(k) + k.length + v.length > this.limit) {
      const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error;
    }
    this.map.set(k, String(v));
  }
}

const OWNER = 'telegram:1';
const cache = name => `gym_read_cache_v1:${OWNER}:${name}`;

function filled() {
  // Заполнено на 1054 символа из 1150 (с ключами).
  const storage = new LimitedStorage(1150);
  storage.setItem('gym_offline_queue_v2', '[]');
  storage.setItem(cache('journal'), 'j'.repeat(300));
  storage.setItem(cache('exercise:press'), 'e'.repeat(200));
  storage.setItem(cache('analytics:14'), 'a'.repeat(100));
  storage.setItem('gym_global_history_cache', 'g'.repeat(150));
  storage.setItem(cache('catalogue'), 'c'.repeat(100));
  return storage;
}

test('read copies are given up cheapest first; the catalogue and the queue never are', () => {
  assert.deepEqual(evictableKeys(filled()), [
    'gym_global_history_cache', cache('analytics:14'), cache('exercise:press'), cache('journal'),
  ]);
});

test('a queue write that does not fit frees just enough read copies', () => {
  const storage = filled();
  // Нужно ещё 328 символов: хватает старой копии истории и аналитики.
  setItemFreeingSpace(storage, 'gym_offline_queue_v2', 'q'.repeat(330));
  assert.equal(storage.getItem('gym_offline_queue_v2').length, 330);
  assert.equal(storage.getItem('gym_global_history_cache'), null);
  assert.equal(storage.getItem(cache('analytics:14')), null);
  assert.notEqual(storage.getItem(cache('journal')), null, 'the journal survives when it is not needed');
  assert.notEqual(storage.getItem(cache('catalogue')), null);
});

test('a write too big even without read copies still fails, without touching the queue', () => {
  const storage = filled();
  assert.throws(() => setItemFreeingSpace(storage, 'gym_active_workout', 'x'.repeat(2000)), { name: 'QuotaExceededError' });
  assert.equal(storage.getItem('gym_offline_queue_v2'), '[]');
});

test('other errors are not mistaken for a full storage', () => {
  const storage = filled();
  storage.setItem = () => { throw new TypeError('broken'); };
  assert.throws(() => setItemFreeingSpace(storage, 'k', 'v'), TypeError);
  assert.notEqual(storage.getItem(cache('journal')), null);
});

test('legacy shared copies are removed; the old finished list only once the owner has its own', () => {
  const storage = filled();
  storage.setItem('gym_exercises_cache', '{}');
  storage.setItem('gym_finished_local', '[]');
  removeLegacyCopies(storage, OWNER);
  assert.equal(storage.getItem('gym_global_history_cache'), null);
  assert.equal(storage.getItem('gym_exercises_cache'), null);
  assert.equal(storage.getItem('gym_finished_local'), '[]');
  storage.setItem(cache('finished'), '[]');
  removeLegacyCopies(storage, OWNER);
  assert.equal(storage.getItem('gym_finished_local'), null);
});
