import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import ts from 'typescript';


const source = await readFile(new URL('../src/offlineSync.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const offlineSync = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);


class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.get(key) ?? null;
  }

  setItem(key, value) {
    this.#values.set(key, value);
  }

  removeItem(key) {
    this.#values.delete(key);
  }
}


function installEnv() {
  Object.assign(globalThis, {
    localStorage: new MemoryStorage(),
    window: { dispatchEvent: () => true },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.init = init;
      }
    },
  });
}


function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}


const SET_A = '22222222-2222-4222-8222-222222222222';
const SET_B = '33333333-3333-4333-8333-333333333333';
const SET_C = '44444444-4444-4444-8444-444444444444';


test('performed_at is created once and survives a next-day queue update', () => {
  const realDate = Date;
  let now = Date.parse('2026-08-22T20:00:00Z');
  class ControlledDate extends realDate {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }

    static now() {
      return now;
    }
  }

  installEnv();
  globalThis.Date = ControlledDate;

  try {
    offlineSync.clearQueue();
    const requestId = '22222222-2222-4222-8222-222222222222';
    offlineSync.addToQueue('saveSet', { client_request_id: requestId, reps: 10 });
    const original = String(offlineSync.getQueue()[0].data.performed_at);
    assert.equal(original, '2026-08-22T20:00:00.000Z');

    now = Date.parse('2026-08-23T09:00:00Z');
    offlineSync.upsertQueue('updateSet', { client_request_id: requestId, reps: 12 });
    const updated = offlineSync.getQueue()[0];
    assert.equal(updated.type, 'saveSet');
    assert.equal(updated.data.performed_at, original);
    assert.equal(updated.data.reps, 12);
  } finally {
    globalThis.Date = realDate;
  }
});


test('an edit made while the save is in flight is sent after it, not dropped', async () => {
  installEnv();
  offlineSync.addToQueue('saveSet', { client_request_id: SET_A, reps: 10 });
  const sent = [];
  const gate = deferred();
  const run = offlineSync.syncQueue(async (item) => {
    sent.push({ type: item.type, reps: item.data.reps });
    if (sent.length === 1) await gate.promise;
    return { ok: true };
  });

  assert.equal(offlineSync.getInFlightId(), SET_A);
  offlineSync.upsertQueue('updateSet', { client_request_id: SET_A, reps: 12 });
  gate.resolve();
  await run;

  // Ответ на первый запрос подтвердил reps=10; правка ушла отдельным update.
  assert.deepEqual(sent, [
    { type: 'saveSet', reps: 10 },
    { type: 'updateSet', reps: 12 },
  ]);
  assert.deepEqual(offlineSync.getQueue(), []);
  assert.equal(offlineSync.getInFlightId(), null);
});


test('a set queued during a pass is sent by the same run, not the next timer', async () => {
  installEnv();
  offlineSync.addToQueue('saveSet', { client_request_id: SET_A, reps: 10 });
  const sent = [];
  const gate = deferred();
  const send = async (item) => {
    sent.push(item.id);
    if (sent.length === 1) await gate.promise;
    return { ok: true };
  };
  const run = offlineSync.syncQueue(send);

  offlineSync.addToQueue('saveSet', { client_request_id: SET_B, reps: 8 });
  const second = offlineSync.syncQueue(send);
  gate.resolve();
  await Promise.all([run, second]);

  assert.deepEqual(sent, [SET_A, SET_B]);
  assert.deepEqual(offlineSync.getQueue(), []);
});


test('a request already on the wire cannot be discarded; a waiting one can', async () => {
  installEnv();
  offlineSync.addToQueue('saveSet', { client_request_id: SET_A, reps: 10 });
  offlineSync.addToQueue('saveSet', { client_request_id: SET_B, reps: 8 });
  const gate = deferred();
  const sent = [];
  const run = offlineSync.syncQueue(async (item) => {
    sent.push(item.id);
    await gate.promise;
    return { ok: true };
  });

  assert.equal(offlineSync.discardQueued(SET_A), false);
  assert.equal(offlineSync.discardQueued(SET_B), true);
  gate.resolve();
  await run;

  assert.deepEqual(sent, [SET_A]);
  assert.deepEqual(offlineSync.getQueue(), []);
});


test('a rejected set does not block the rest; a network failure stops the pass', async () => {
  installEnv();
  offlineSync.addToQueue('saveSet', { client_request_id: SET_A, reps: 10 });
  offlineSync.addToQueue('saveSet', { client_request_id: SET_B, reps: 8 });
  offlineSync.addToQueue('saveSet', { client_request_id: SET_C, reps: 6 });
  const sent = [];
  await offlineSync.syncQueue(async (item) => {
    sent.push(item.id);
    if (item.id === SET_A) return { ok: false, error: 'сервер отклонил: Unknown exercise_id', stop: false };
    return { ok: false, error: 'нет связи', stop: true };
  });

  assert.deepEqual(sent, [SET_A, SET_B]);
  const [a, b, c] = offlineSync.getQueue();
  assert.equal(a.lastError, 'сервер отклонил: Unknown exercise_id');
  assert.equal(a.rejected, true);
  assert.equal(b.lastError, 'нет связи');
  assert.equal(b.rejected, false);
  assert.equal(c.attempts, 0);
});


test('a throwing sender counts as a network failure and keeps the set', async () => {
  installEnv();
  offlineSync.addToQueue('saveSet', { client_request_id: SET_A, reps: 10 });
  await offlineSync.syncQueue(async () => { throw new Error('Failed to fetch'); });

  const [item] = offlineSync.getQueue();
  assert.equal(item.attempts, 1);
  assert.equal(item.lastError, 'Failed to fetch');
  assert.equal(offlineSync.getInFlightId(), null);
});


test('an edit resets a rejection so the set is retried as pending', () => {
  installEnv();
  offlineSync.addToQueue('saveSet', { client_request_id: SET_A, reps: 10 });
  offlineSync.markAttempt(SET_A, 'сервер отклонил: reps must be greater than zero', true);
  offlineSync.upsertQueue('updateSet', { client_request_id: SET_A, reps: 12 });

  const [item] = offlineSync.getQueue();
  assert.equal(item.rejected, false);
  assert.equal(item.lastError, undefined);
  assert.equal(item.rev, 1);
});


test('items stored before versioning are read as rev 0 and acknowledged', async () => {
  installEnv();
  localStorage.setItem('gym_offline_queue_v2', JSON.stringify([{
    id: SET_A, type: 'saveSet', createdAt: 1, attempts: 2,
    data: { client_request_id: SET_A, reps: 10, performed_at: '2026-09-18T10:00:00.000Z' },
  }]));
  assert.equal(offlineSync.getQueue()[0].rev, 0);
  await offlineSync.syncQueue(async () => ({ ok: true }));
  assert.deepEqual(offlineSync.getQueue(), []);
});


test('deleting a set that never left the phone just drops it', () => {
  installEnv();
  offlineSync.addToQueue('saveSet', { client_request_id: SET_A, reps: 10 });
  offlineSync.enqueueDelete({ client_request_id: SET_A });
  assert.deepEqual(offlineSync.getQueue(), []);
});


test('a delete made while the save is in flight goes out after it', async () => {
  installEnv();
  offlineSync.addToQueue('saveSet', { client_request_id: SET_A, reps: 10 });
  const sent = [];
  const gate = deferred();
  const run = offlineSync.syncQueue(async (item) => {
    sent.push(item.type);
    if (sent.length === 1) await gate.promise;
    return { ok: true };
  });

  offlineSync.enqueueDelete({ client_request_id: SET_A });
  gate.resolve();
  await run;

  // Ответ на save не снял удаление: строку, записанную этим save, убирает delete.
  assert.deepEqual(sent, ['saveSet', 'deleteSet']);
  assert.deepEqual(offlineSync.getQueue(), []);
});


test('a save that was sent without an answer is deleted on the server too', async () => {
  installEnv();
  offlineSync.addToQueue('saveSet', { client_request_id: SET_A, reps: 10 });
  await offlineSync.syncQueue(async () => ({ ok: false, error: 'сервер не ответил за 35 с', stop: true }));
  assert.equal(offlineSync.getQueue()[0].sent, true);

  offlineSync.enqueueDelete({ client_request_id: SET_A });
  const [item] = offlineSync.getQueue();
  assert.equal(item.type, 'deleteSet');
  assert.equal(item.attempts, 0);
});


test('the sent mark is stored before the request leaves', async () => {
  installEnv();
  offlineSync.addToQueue('saveSet', { client_request_id: SET_A, reps: 10 });
  const gate = deferred();
  const run = offlineSync.syncQueue(async () => { await gate.promise; return { ok: true }; });
  // Приложение убили посреди запроса: после перезапуска это должно быть видно.
  const stored = JSON.parse(localStorage.getItem('gym_offline_queue_v2'));
  assert.equal(stored[0].sent, true);
  gate.resolve();
  await run;
});


test('a pending edit becomes a delete, a synced set gets a new delete, a deleted set ignores edits', () => {
  installEnv();
  offlineSync.upsertQueue('updateSet', { client_request_id: SET_A, reps: 12 });
  offlineSync.enqueueDelete({ client_request_id: SET_A });
  offlineSync.enqueueDelete({ client_request_id: SET_B });
  offlineSync.upsertQueue('updateSet', { client_request_id: SET_B, reps: 9 });

  const queue = offlineSync.getQueue();
  assert.deepEqual(queue.map((item) => [item.id, item.type]), [
    [SET_A, 'deleteSet'],
    [SET_B, 'deleteSet'],
  ]);
  assert.equal(queue[1].data.reps, undefined);
});
