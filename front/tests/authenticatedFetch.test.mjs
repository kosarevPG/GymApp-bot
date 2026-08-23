import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import ts from 'typescript';


async function importTypescript(relativeUrl) {
  const source = await readFile(new URL(relativeUrl, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const authModule = await importTypescript('../src/authenticatedFetch.ts');
const offlineSync = await importTypescript('../src/offlineSync.ts');


class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, value); }
  removeItem(key) { this.#values.delete(key); }
}


test('Telegram mode keeps signed initData and never uses bearer fallback', async () => {
  let tokenCalls = 0;
  let captured;
  const request = authModule.createAuthenticatedFetch({
    getTelegramInitData: () => 'signed-init-data',
    getStandaloneAccessToken: async () => { tokenCalls += 1; return 'wrong-token'; },
    onStandaloneAuthRequired: () => assert.fail('standalone login must not be used'),
    fetchImpl: async (_input, init) => {
      captured = new Headers(init.headers);
      return new Response('{}', { status: 200 });
    },
  });

  await request('https://api.test/init');
  assert.equal(tokenCalls, 0);
  assert.equal(captured.get('X-Telegram-Init-Data'), 'signed-init-data');
  assert.equal(captured.get('Authorization'), null);
});


test('standalone mode refreshes an expired token once', async () => {
  const refreshCalls = [];
  const bearerValues = [];
  let requests = 0;
  const request = authModule.createAuthenticatedFetch({
    getTelegramInitData: () => '',
    getStandaloneAccessToken: async (refresh = false) => {
      refreshCalls.push(refresh);
      return refresh ? 'fresh-token' : 'expired-token';
    },
    getStandaloneApiKey: () => 'publishable-test-key',
    onStandaloneAuthRequired: () => assert.fail('refresh should recover the session'),
    fetchImpl: async (_input, init) => {
      requests += 1;
      bearerValues.push(new Headers(init.headers).get('Authorization'));
      return new Response('{}', { status: requests === 1 ? 401 : 200 });
    },
  });

  const response = await request('https://api.test/init');
  assert.equal(response.status, 200);
  assert.deepEqual(refreshCalls, [false, true]);
  assert.deepEqual(bearerValues, ['Bearer expired-token', 'Bearer fresh-token']);
});


test('failed refresh pauses behind login instead of blind retry', async () => {
  let requests = 0;
  let authRequired = 0;
  const request = authModule.createAuthenticatedFetch({
    getTelegramInitData: () => '',
    getStandaloneAccessToken: async (refresh = false) => refresh ? null : 'expired-token',
    onStandaloneAuthRequired: () => { authRequired += 1; },
    fetchImpl: async () => {
      requests += 1;
      return new Response('{}', { status: 401 });
    },
  });

  await assert.rejects(
    request('https://api.test/init'),
    (error) => error instanceof authModule.AuthRequiredError,
  );
  assert.equal(requests, 1);
  assert.equal(authRequired, 1);
});


test('a pre-existing offline item syncs unchanged after standalone login', async () => {
  Object.assign(globalThis, {
    localStorage: new MemoryStorage(),
    window: { dispatchEvent: () => true },
    CustomEvent: class {
      constructor(type, init) { this.type = type; this.init = init; }
    },
  });
  offlineSync.clearQueue();
  const requestId = '22222222-2222-4222-8222-222222222222';
  const performedAt = '2026-08-23T06:15:00.000Z';
  offlineSync.addToQueue('saveSet', {
    client_request_id: requestId,
    performed_at: performedAt,
    user_id: 'client-owner-must-be-ignored',
    reps: 10,
  });

  let sentBody;
  const request = authModule.createAuthenticatedFetch({
    getTelegramInitData: () => '',
    getStandaloneAccessToken: async () => 'valid-access-token',
    onStandaloneAuthRequired: () => assert.fail('session is valid'),
    fetchImpl: async (_input, init) => {
      sentBody = JSON.parse(String(init.body));
      return new Response('{"status":"success"}', { status: 200 });
    },
  });
  const queued = offlineSync.getQueue()[0];
  const response = await request('https://api.test/save_set', {
    method: 'POST',
    body: JSON.stringify(queued.data),
  });
  if (response.ok) offlineSync.removeFromQueue(queued.id);

  assert.equal(sentBody.client_request_id, requestId);
  assert.equal(sentBody.performed_at, performedAt);
  assert.equal(offlineSync.getQueue().length, 0);
});
