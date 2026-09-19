import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import ts from 'typescript';

// trainerSummary.ts imports exerciseConfig.ts, which the data: URL cannot
// resolve, so the import is rewritten to an inlined data module first.
const cfgCompiled = ts.transpileModule(
  await readFile(new URL('../src/exerciseConfig.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } },
).outputText;
const cfgUrl = `data:text/javascript;base64,${Buffer.from(cfgCompiled).toString('base64')}`;
const source = (await readFile(new URL('../src/trainerSummary.ts', import.meta.url), 'utf8'))
  .replace(/import type \{[^}]*\} from '\.\/historyTypes';?/, '')
  .replace("from './exerciseConfig'", `from '${cfgUrl}'`);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const { buildTrainerSummary, formatTrainerSummaryText, isoDaysAgo, normalizeDate } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const SET = (reps, input, order = 1) => ({ input_weight: input, weight: input * 2, reps, order, set_type: 'working' });
// The sets above are dumbbell pairs (total = 2 × input), so the catalog says so.
const DUMBBELL = { weightType: 'Dumbbell', weightMultiplier: 2, baseWeight: 0 };
const CATALOG = { a: DUMBBELL, b: DUMBBELL, new: DUMBBELL };
const build = (history, since, until) => buildTrainerSummary(history, since, until, CATALOG);
const E = (id, sets, name) => ({ exerciseId: id, name: name || `Упр ${id}`, sets });
const S = (date, entries) => ({ id: `s-${date}`, date, exercises: entries });

/* ── dates ─────────────────────────────────────────────────────────────── */

test('dotted and ISO dates both normalise', () => {
  assert.equal(normalizeDate('2026.08.19'), '2026-08-19');
  assert.equal(normalizeDate('2026-08-19'), '2026-08-19');
  assert.equal(normalizeDate('rubbish'), '');
});

test('isoDaysAgo counts today as day one', () => {
  assert.equal(isoDaysAgo('2026-08-24', 7), '2026-08-18');
  assert.equal(isoDaysAgo('2026-08-24', 1), '2026-08-24');
});

/* ── what was actually done ────────────────────────────────────────────── */

test('a session lists each exercise as weight x reps', () => {
  const history = [S('2026.08.19', [E('a', [SET(12, 22.5, 1), SET(12, 22.5, 2), SET(10, 22.5, 3)], 'Жим')])];
  const summary = build(history, '2026-08-18', '2026-08-24');
  assert.equal(summary.sessionCount, 1);
  const [line] = summary.sessions[0].exercises;
  assert.equal(line.name, 'Жим');
  assert.equal(line.text, '2×22.5 кг × 12/12/10');
  assert.equal(line.totalReps, 34);
  assert.equal(line.setCount, 3);
  assert.equal(summary.sessions[0].totalSets, 3);
});

test('mixed weights inside one exercise are all shown', () => {
  const history = [S('2026.08.19', [E('a', [SET(20, 2, 1), SET(15, 3, 2)])])];
  const [line] = build(history, '2026-08-18', '2026-08-24').sessions[0].exercises;
  assert.equal(line.text, '2×2 кг × 20 · 2×3 кг × 15');
});

test('sets are read in their recorded order, not array order', () => {
  const history = [S('2026.08.19', [E('a', [SET(8, 30, 3), SET(12, 30, 1), SET(10, 30, 2)])])];
  const [line] = build(history, '2026-08-18', '2026-08-24').sessions[0].exercises;
  assert.equal(line.text, '2×30 кг × 12/10/8');
});

test('sessions come back newest first', () => {
  const history = [
    S('2026.08.19', [E('a', [SET(10, 30)])]),
    S('2026.08.21', [E('a', [SET(10, 30)])]),
  ];
  const summary = build(history, '2026-08-18', '2026-08-24');
  assert.deepEqual(summary.sessions.map((s) => s.date), ['2026-08-21', '2026-08-19']);
});

/* ── the window ────────────────────────────────────────────────────────── */

test('only sessions inside the window are reported', () => {
  const history = [
    S('2026.08.01', [E('a', [SET(10, 30)])]),
    S('2026.08.19', [E('a', [SET(10, 30)])]),
    S('2026.09.01', [E('a', [SET(10, 30)])]),
  ];
  const summary = build(history, '2026-08-18', '2026-08-24');
  assert.deepEqual(summary.sessions.map((s) => s.date), ['2026-08-19']);
});

test('both window edges are inclusive', () => {
  const history = [S('2026.08.18', [E('a', [SET(10, 30)])]), S('2026.08.24', [E('a', [SET(10, 30)])])];
  assert.equal(build(history, '2026-08-18', '2026-08-24').sessionCount, 2);
});

test('a session before the window still provides the comparison', () => {
  const history = [
    S('2026.08.01', [E('a', [SET(12, 30), SET(12, 30)])]),
    S('2026.08.19', [E('a', [SET(12, 32.5), SET(12, 32.5)])]),
  ];
  const summary = build(history, '2026-08-18', '2026-08-24');
  const [line] = summary.sessions[0].exercises;
  assert.equal(line.change.previousDate, '2026-08-01');
  assert.equal(line.change.weightDelta, 2.5);
  assert.equal(line.change.down, false);
  assert.equal(summary.firstTime.length, 0, 'it is not a first time — the history is just older');
});

/* ── where it sagged ───────────────────────────────────────────────────── */

test('less weight is a drop', () => {
  const history = [
    S('2026.08.12', [E('a', [SET(12, 32.5), SET(12, 32.5)], 'Жим')]),
    S('2026.08.19', [E('a', [SET(12, 30), SET(12, 30)], 'Жим')]),
  ];
  const summary = build(history, '2026-08-18', '2026-08-24');
  assert.equal(summary.drops.length, 1);
  assert.equal(summary.drops[0].name, 'Жим');
  assert.equal(summary.sessions[0].exercises[0].change.down, true);
  assert.equal(summary.sessions[0].exercises[0].change.weightDelta, -2.5);
});

test('same weight but fewer reps is a drop', () => {
  const history = [
    S('2026.08.12', [E('a', [SET(12, 30), SET(12, 30)])]),
    S('2026.08.19', [E('a', [SET(10, 30), SET(9, 30)])]),
  ];
  const summary = build(history, '2026-08-18', '2026-08-24');
  assert.equal(summary.drops.length, 1);
  assert.equal(summary.sessions[0].exercises[0].change.repsDelta, -5);
});

test('more weight with fewer reps is NOT reported as a drop', () => {
  // Heavier for fewer reps is a normal way to train, not a regression.
  const history = [
    S('2026.08.12', [E('a', [SET(12, 30), SET(12, 30)])]),
    S('2026.08.19', [E('a', [SET(8, 35), SET(8, 35)])]),
  ];
  const summary = build(history, '2026-08-18', '2026-08-24');
  assert.deepEqual(summary.drops, []);
  assert.equal(summary.sessions[0].exercises[0].change.down, false);
});

test('an unchanged session is neither a drop nor a first time', () => {
  const history = [
    S('2026.08.12', [E('a', [SET(12, 30)])]),
    S('2026.08.19', [E('a', [SET(12, 30)])]),
  ];
  const summary = build(history, '2026-08-18', '2026-08-24');
  assert.deepEqual(summary.drops, []);
  assert.equal(summary.sessions[0].exercises[0].change.weightDelta, 0);
  assert.equal(summary.sessions[0].exercises[0].change.repsDelta, 0);
});

test('an exercise with no earlier session is marked as first time', () => {
  const summary = build([S('2026.08.19', [E('new', [SET(10, 20)], 'Новое')])], '2026-08-18', '2026-08-24');
  assert.deepEqual(summary.firstTime, [{ date: '2026-08-19', name: 'Новое' }]);
  assert.equal(summary.sessions[0].exercises[0].change, null);
});

/* ── the text a coach reads ────────────────────────────────────────────── */

test('the text carries every session, the deltas and the drops', () => {
  const history = [
    S('2026.08.12', [E('a', [SET(12, 32.5), SET(12, 32.5)], 'Жим')]),
    S('2026.08.19', [E('a', [SET(12, 30), SET(12, 30)], 'Жим'), E('b', [SET(15, 2)], 'Махи')]),
  ];
  const text = formatTrainerSummaryText(build(history, '2026-08-18', '2026-08-24'));
  assert.match(text, /Тренировки 18\.08–24\.08 · 1/);
  assert.match(text, /Жим: 2×30 кг × 12\/12/);
  assert.match(text, /было 2×32\.5 кг × 12\/12/);
  assert.match(text, /вес −2\.5/);
  assert.match(text, /Махи: 2×2 кг × 15\s+\(впервые\)/);
  assert.match(text, /Просело:/);
});

test('no drops says so explicitly', () => {
  const history = [S('2026.08.19', [E('a', [SET(10, 30)])])];
  const text = formatTrainerSummaryText(build(history, '2026-08-18', '2026-08-24'));
  assert.match(text, /Просевших упражнений нет\./);
});

test('an empty period says so instead of printing a blank report', () => {
  const text = formatTrainerSummaryText(build([], '2026-08-18', '2026-08-24'));
  assert.match(text, /Тренировок с 18\.08 по 24\.08 нет\./);
});

test('the text contains no advice', () => {
  const history = [
    S('2026.08.12', [E('a', [SET(12, 32.5)], 'Жим')]),
    S('2026.08.19', [E('a', [SET(10, 30)], 'Жим')]),
  ];
  const text = formatTrainerSummaryText(build(history, '2026-08-18', '2026-08-24')).toLowerCase();
  for (const word of ['попробуй', 'рекоменд', 'следует', 'нужно', 'снизь', 'добавь', 'риск', 'перетрен']) {
    assert.ok(!text.includes(word), `"${word}" must not appear in a report meant for a coach`);
  }
});

/* ── weight rules ──────────────────────────────────────────────────────── */

test('less help on the assisted machine is progress, and is named as help', () => {
  const ASSISTED = { weightType: 'Assisted', weightMultiplier: -1, baseWeight: 90 };
  const help = (input) => ({ input_weight: input, weight: 90 - input, reps: 8, order: 1, set_type: 'working' });
  const history = [
    S('2026.08.12', [E('g', [help(30)], 'Гравитрон')]),
    S('2026.08.19', [E('g', [help(25)], 'Гравитрон')]),
  ];
  const summary = buildTrainerSummary(history, '2026-08-18', '2026-08-24', { g: ASSISTED });
  const [line] = summary.sessions[0].exercises;
  assert.equal(line.text, 'помощь 25 кг × 8');
  assert.equal(line.change.down, false);
  assert.match(formatTrainerSummaryText(summary), /помощь −5/);
});

test('a set keeps the rules it was saved with', () => {
  // Упражнение с тех пор перевели на гантели; старый подход остаётся стеком.
  const stack = { input_weight: 40, weight: 40, reps: 10, order: 1, set_type: 'working', load: { v: 1, type: 'Machine', mult: 1, base: 0 } };
  const summary = build([S('2026.08.19', [E('a', [stack])])], '2026-08-18', '2026-08-24');
  assert.equal(summary.sessions[0].exercises[0].text, '40 кг × 10');
});

/* ── junk ──────────────────────────────────────────────────────────────── */

test('junk input never throws', () => {
  for (const junk of [null, undefined, 42, 'x', {}]) {
    assert.doesNotThrow(() => buildTrainerSummary(junk, '2026-08-18', '2026-08-24'));
    assert.equal(buildTrainerSummary(junk, '2026-08-18', '2026-08-24').sessionCount, 0);
  }
  assert.doesNotThrow(() => formatTrainerSummaryText(null));
  assert.equal(buildTrainerSummary([S('2026.08.19', [E('a', [])])], '2026-08-18', '2026-08-24').sessionCount, 0,
    'an exercise with no sets does not make a session');
});
