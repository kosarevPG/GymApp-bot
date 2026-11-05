import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/exerciseNotes.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const { joinNotes, lastSessionNote, noteUpdates, shortNoteDate } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('the previous workout note is shown with its date', () => {
  const history = [
    { session_id: 'b', date: '2026.10.28', order: 2, note: 'тяжеловато' },
    { session_id: 'b', date: '2026.10.28', order: 1 },
    { session_id: 'a', date: '2026.10.14', order: 1, note: 'старое' },
  ];
  assert.deepEqual(lastSessionNote(history), { date: '28.10', text: 'тяжеловато' });
});

test('an older note does not resurface when the last workout had none', () => {
  const history = [
    { session_id: 'b', date: '2026.10.28', order: 1 },
    { session_id: 'a', date: '2026.10.14', order: 1, note: 'тяжеловато' },
  ];
  assert.equal(lastSessionNote(history), null);
});

test('the current workout is not its own previous workout', () => {
  const history = [
    { session_id: 'now', date: '2026.11.06', order: 1, note: 'сегодня' },
    { session_id: 'b', date: '2026.10.28', order: 1, note: 'тогда' },
  ];
  assert.deepEqual(lastSessionNote(history, 'now'), { date: '28.10', text: 'тогда' });
  assert.equal(lastSessionNote([{ session_id: 'now', date: '2026.11.06', note: 'сегодня' }], 'now'), null);
  assert.equal(lastSessionNote(null), null);
});

test('two workouts on one date do not mix their notes', () => {
  const history = [
    { session_id: 'late', date: '2026.10.28', order: 1 },
    { session_id: 'early', date: '2026.10.28', order: 1, note: 'утром' },
  ];
  assert.equal(lastSessionNote(history), null);
});

test('repeated text on sets reads once, in set order', () => {
  assert.equal(joinNotes([
    { order: 3, note: 'плечо' }, { order: 1, note: ' лёгкий ' }, { order: 2, note: 'плечо' }, { order: 4, note: '' },
  ]), 'лёгкий · плечо');
});

test('dates read as day and month in both stored formats', () => {
  assert.equal(shortNoteDate('2026.10.28'), '28.10');
  assert.equal(shortNoteDate('2026-10-28'), '28.10');
  assert.equal(shortNoteDate(''), '');
});

test('a note edit reaches completed sets only and sends nothing else about them', () => {
  const updates = noteUpdates([
    { completed: true, requestId: 'r1', order: 1, weight: '40' },
    { completed: false, requestId: 'r2', order: 2 },
    { completed: true, order: 3 },
  ], 'тяжеловато', { exercise_id: 'e' });
  assert.deepEqual(updates, [{ exercise_id: 'e', client_request_id: 'r1', order: 1, note: 'тяжеловато' }]);
});
