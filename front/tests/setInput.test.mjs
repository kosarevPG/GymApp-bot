import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './loadTs.mjs';

const { acceptRpeInput, completableSet, rpeForSave } = await loadTs('../src/setInput.ts');

test('a keystroke that takes RPE above 10 is ignored', () => {
  assert.equal(acceptRpeInput('8', ''), '8');
  assert.equal(acceptRpeInput('85', '8'), '8');
  assert.equal(acceptRpeInput('10', '1'), '10');
  assert.equal(acceptRpeInput('8.5', '8.'), '8.5');
  assert.equal(acceptRpeInput('', '8'), '');
});

test('only an RPE the database accepts is sent', () => {
  assert.equal(rpeForSave('8.5'), 8.5);
  assert.equal(rpeForSave(10), 10);
  assert.equal(rpeForSave(''), undefined);
  assert.equal(rpeForSave(undefined), undefined);
  assert.equal(rpeForSave('0'), undefined);
  assert.equal(rpeForSave('85'), undefined);
  assert.equal(rpeForSave('abc'), undefined);
});

test('a set needs a real weight and at least one rep', () => {
  assert.equal(completableSet('60', '8'), true);
  assert.equal(completableSet('0', '8'), true);
  assert.equal(completableSet('', '8'), false);
  assert.equal(completableSet('.', '8'), false);
  assert.equal(completableSet('60', ''), false);
  assert.equal(completableSet('60', '0'), false);
});
