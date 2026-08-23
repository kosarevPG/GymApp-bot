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

  Object.assign(globalThis, {
    Date: ControlledDate,
    localStorage: new MemoryStorage(),
    window: { dispatchEvent: () => true },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.init = init;
      }
    },
  });

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
