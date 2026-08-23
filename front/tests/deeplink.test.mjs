import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import ts from 'typescript';


const source = await readFile(new URL('../src/deeplink.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const { normalizeSessionId, readSessionDeeplink, stripSessionParam } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

const UUID = 'e96b22f8-695a-40b0-916a-57f3a33db4f1';

test('accepts a well-formed session id', () => {
  assert.equal(normalizeSessionId(UUID), UUID);
  assert.equal(normalizeSessionId(`  ${UUID}  `), UUID);
  assert.equal(normalizeSessionId(UUID.toUpperCase()), UUID);
});

test('rejects anything that is not a session id', () => {
  for (const junk of ['', '   ', 'not-a-uuid', '1234', null, undefined, {}, [],
    `${UUID}extra`, `../${UUID}`, "'; drop table gym_sets; --"]) {
    assert.equal(normalizeSessionId(junk), null, `should reject ${JSON.stringify(junk)}`);
  }
});

test('reads ?session= from a standalone URL', () => {
  assert.equal(readSessionDeeplink(`?session=${UUID}`), UUID);
  assert.equal(readSessionDeeplink(`?foo=1&session=${UUID}&bar=2`), UUID);
  assert.equal(readSessionDeeplink('?session=nope'), null);
  assert.equal(readSessionDeeplink('?other=1'), null);
  assert.equal(readSessionDeeplink(''), null);
});

test('reads the Telegram start_param, with or without the session_ prefix', () => {
  assert.equal(readSessionDeeplink('', `session_${UUID}`), UUID);
  assert.equal(readSessionDeeplink('', UUID), UUID);
  assert.equal(readSessionDeeplink('', 'session_garbage'), null);
  assert.equal(readSessionDeeplink('', undefined), null);
});

test('an explicit query param wins over start_param', () => {
  const other = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.equal(readSessionDeeplink(`?session=${UUID}`, `session_${other}`), UUID);
  // …and start_param still applies when the query carries nothing usable.
  assert.equal(readSessionDeeplink('?session=broken', `session_${other}`), other);
});

test('junk input never throws', () => {
  for (const junk of [null, undefined, 42, {}, []]) {
    assert.doesNotThrow(() => readSessionDeeplink(junk, junk));
  }
});

test('stripSessionParam removes only the session param', () => {
  assert.equal(
    stripSessionParam(`https://app.example/gym/?session=${UUID}`),
    'https://app.example/gym/',
  );
  assert.equal(
    stripSessionParam(`https://app.example/gym/?a=1&session=${UUID}&b=2`),
    'https://app.example/gym/?a=1&b=2',
  );
  // Nothing to strip: returned unchanged, including the hash.
  assert.equal(
    stripSessionParam('https://app.example/gym/?a=1#x'),
    'https://app.example/gym/?a=1#x',
  );
  assert.equal(stripSessionParam('not a url'), 'not a url');
  assert.equal(stripSessionParam(null), '');
});
