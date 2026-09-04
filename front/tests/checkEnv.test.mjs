import assert from 'node:assert/strict';
import test from 'node:test';

import { REQUIRED_ENV, findMissing } from '../scripts/checkEnv.mjs';

const full = Object.fromEntries(REQUIRED_ENV.map((name) => [name, 'значение']));

test('полный набор переменных проходит', () => {
  assert.deepEqual(findMissing(full), []);
});

test('отсутствующая переменная называется поимённо', () => {
  const { VITE_SUPABASE_URL, ...rest } = full;
  assert.deepEqual(findMissing(rest), ['VITE_SUPABASE_URL']);
});

test('пустая строка и пробелы считаются отсутствием', () => {
  assert.deepEqual(findMissing({ ...full, VITE_API_BASE_URL: '' }), ['VITE_API_BASE_URL']);
  assert.deepEqual(findMissing({ ...full, VITE_API_BASE_URL: '   ' }), ['VITE_API_BASE_URL']);
});

test('перечисляются все недостающие сразу', () => {
  assert.deepEqual(findMissing({}), REQUIRED_ENV);
});

test('пустое окружение не роняет проверку', () => {
  assert.deepEqual(findMissing(null), REQUIRED_ENV);
  assert.deepEqual(findMissing(undefined), REQUIRED_ENV);
});

test('в списке обязательных есть ключи Supabase — из-за них ломался вход', () => {
  assert.ok(REQUIRED_ENV.includes('VITE_SUPABASE_URL'));
  assert.ok(REQUIRED_ENV.includes('VITE_SUPABASE_PUBLISHABLE_KEY'));
});
