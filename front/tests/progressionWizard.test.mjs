import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import ts from 'typescript';

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;

const cfgUrl = dataUrl(compile(await readFile(new URL('../src/exerciseConfig.ts', import.meta.url), 'utf8')));
const progUrl = dataUrl(compile(
  (await readFile(new URL('../src/progression.ts', import.meta.url), 'utf8'))
    .replace("from './exerciseConfig'", `from '${cfgUrl}'`)
    .replace(/import type \{[^}]*\} from '\.\/types';?/, '')));
const wizardSource = (await readFile(new URL('../src/progressionWizard.ts', import.meta.url), 'utf8'))
  .replace("from './progression'", `from '${progUrl}'`)
  .replace(/import type \{[^}]*\} from '\.\/progression';?/, '')
  .replace(/import type \{[^}]*\} from '\.\/types';?/, '');
const {
  WIZARD_SINCE, buildWizardRows, initialDraft, normalizeDate, pendingChanges, validateDraft,
} = await import(dataUrl(compile(wizardSource)));

const EX = (id, over = {}) => ({ id, name: `Упр ${id}`, weightType: 'Barbell', weightMultiplier: 2, baseWeight: 20, ...over });
const S = (date, entries) => ({ id: `sess-${date}`, date, exercises: entries });
const E = (exerciseId, sets) => ({ exerciseId, name: `Упр ${exerciseId}`, sets });
const SET = (reps, input = 30) => ({ id: `s${Math.random()}`, weight: input * 2 + 20, input_weight: input, reps, rest: 1.5, order: 1, set_type: 'working' });

/* ── the cutoff ────────────────────────────────────────────────────────── */

test('dates arrive dotted from the API and normalise', () => {
  assert.equal(normalizeDate('2026.07.15'), '2026-07-15');
  assert.equal(normalizeDate('2026-07-15'), '2026-07-15');
  assert.equal(normalizeDate('2026-07-15T10:00:00Z'), '2026-07-15');
  assert.equal(normalizeDate('nonsense'), '');
  assert.equal(normalizeDate(null), '');
});

test('only exercises trained since the cutoff are offered', () => {
  const history = [
    S('2026.06.20', [E('old', [SET(10)])]),
    S('2026.07.02', [E('recent', [SET(10)])]),
    S('2026.08.19', [E('recent', [SET(11)])]),
  ];
  const rows = buildWizardRows(history, [EX('old'), EX('recent')]);
  assert.deepEqual(rows.map((r) => r.exerciseId), ['recent']);
  assert.equal(WIZARD_SINCE, '2026-07-01');
});

test('the cutoff on its exact day counts as inside', () => {
  const rows = buildWizardRows([S('2026.07.01', [E('a', [SET(10)])])], [EX('a')]);
  assert.equal(rows.length, 1);
  const before = buildWizardRows([S('2026.06.30', [E('a', [SET(10)])])], [EX('a')]);
  assert.equal(before.length, 0);
});

test('older sessions still feed the suggestion for a qualifying exercise', () => {
  // Appears once after the cutoff, but four sessions of history inform the range.
  const history = [
    S('2026.05.01', [E('a', [SET(8), SET(8)])]),
    S('2026.05.08', [E('a', [SET(9), SET(9)])]),
    S('2026.06.01', [E('a', [SET(10), SET(10)])]),
    S('2026.07.10', [E('a', [SET(10), SET(10)])]),
  ];
  const [row] = buildWizardRows(history, [EX('a')]);
  assert.equal(row.sessionCount, 1, 'only the post-cutoff session is counted as usage');
  assert.ok(row.suggested.basedOnSets >= 8, 'but the suggestion reads everything');
});

test('rows are ordered by how much the exercise is trained', () => {
  const history = [
    S('2026.07.05', [E('rare', [SET(10)]), E('often', [SET(10)])]),
    S('2026.07.12', [E('often', [SET(10)])]),
    S('2026.07.19', [E('often', [SET(10)])]),
  ];
  const rows = buildWizardRows(history, [EX('rare'), EX('often')]);
  assert.deepEqual(rows.map((r) => r.exerciseId), ['often', 'rare']);
  assert.equal(rows[0].sessionCount, 3);
});

test('a row carries recent weights and reps, newest first', () => {
  const history = [
    S('2026.07.05', [E('a', [SET(10, 30), SET(10, 30)])]),
    S('2026.08.19', [E('a', [SET(12, 32.5), SET(11, 32.5)])]),
  ];
  const [row] = buildWizardRows(history, [EX('a')]);
  assert.equal(row.lastDate, '2026-08-19');
  assert.match(row.recent[0], /08\.19/);
  assert.match(row.recent[0], /32\.5 × 12\/11/);
  assert.ok(row.recent.length <= 3);
});

test('an exercise missing from the catalogue still gets a row', () => {
  const [row] = buildWizardRows([S('2026.07.05', [E('ghost', [SET(10)])])], []);
  assert.equal(row.exerciseId, 'ghost');
  assert.equal(row.exercise, undefined);
  assert.equal(row.alreadyConfigured, false);
});

test('already-configured exercises are marked and keep their stored values', () => {
  const configured = EX('a', { repRangeLow: 8, repRangeHigh: 10, inputWeightStep: 2.5, targetWorkingSets: 4, rirTargetMax: 1 });
  const [row] = buildWizardRows([S('2026.07.05', [E('a', [SET(10)])])], [configured]);
  assert.equal(row.alreadyConfigured, true);
  assert.equal(row.current.repRangeLow, 8);
  assert.equal(row.current.targetWorkingSets, 4);
});

/* ── drafts start from stored values, else suggestions ─────────────────── */

test('an unconfigured row is prefilled from the suggestion', () => {
  const [row] = buildWizardRows([S('2026.07.05', [E('a', [SET(10), SET(11), SET(12)])])], [EX('a')]);
  const draft = initialDraft(row);
  assert.equal(draft.repRangeLow, String(row.suggested.repRangeLow));
  assert.equal(draft.inputWeightStep, '1.25', 'a barbell gets a plate-sized step');
  assert.equal(draft.rirTargetMax, '', 'RIR is never guessed');
});

test('a configured row is prefilled from what is stored, not the suggestion', () => {
  const configured = EX('a', { repRangeLow: 6, repRangeHigh: 8, inputWeightStep: 5, targetWorkingSets: 2, rirTargetMax: 3 });
  const [row] = buildWizardRows([S('2026.07.05', [E('a', [SET(12), SET(12)])])], [configured]);
  const draft = initialDraft(row);
  assert.equal(draft.repRangeLow, '6');
  assert.equal(draft.inputWeightStep, '5');
  assert.equal(draft.rirTargetMax, '3');
});

/* ── validation mirrors the server ─────────────────────────────────────── */

const rowFor = (over = {}) => buildWizardRows([S('2026.07.05', [E('a', [SET(10)])])], [EX('a', over)])[0];

test('valid drafts pass', () => {
  const v = validateDraft(rowFor(), { repRangeLow: '10', repRangeHigh: '12', inputWeightStep: '1.25', targetWorkingSets: '3', rirTargetMax: '2' });
  assert.equal(v.ok, true);
  assert.deepEqual(v.targets, { repRangeLow: 10, repRangeHigh: 12, inputWeightStep: 1.25, targetWorkingSets: 3, rirTargetMax: 2 });
});

test('an all-empty draft is valid and means "clear"', () => {
  const v = validateDraft(rowFor({ repRangeLow: 8, repRangeHigh: 10 }), { repRangeLow: '', repRangeHigh: '', inputWeightStep: '', targetWorkingSets: '', rirTargetMax: '' });
  assert.equal(v.ok, true);
  assert.equal(v.targets.repRangeLow, null);
  assert.equal(v.unchanged, false, 'clearing a stored value is a change');
});

test('the same rules the backend enforces, refused inline', () => {
  const row = rowFor();
  const bad = [
    [{ repRangeLow: '10', repRangeHigh: '' }, /целиком/],
    [{ repRangeLow: '', repRangeHigh: '12' }, /целиком/],
    [{ repRangeLow: '12', repRangeHigh: '10' }, /больше верха/],
    [{ repRangeLow: '0', repRangeHigh: '5' }, /вне 1–100/],
    [{ repRangeLow: '10', repRangeHigh: '200' }, /вне 1–100/],
    [{ inputWeightStep: '0' }, /больше 0/],
    [{ inputWeightStep: '-2' }, /больше 0/],
    [{ targetWorkingSets: '0' }, /1–20/],
    [{ targetWorkingSets: '2.5' }, /целое/],
    [{ rirTargetMax: '11' }, /вне 0–10/],
    [{ rirTargetMax: '-1' }, /вне 0–10/],
    [{ repRangeLow: 'десять', repRangeHigh: '12' }, /Не число/],
  ];
  for (const [patch, pattern] of bad) {
    const v = validateDraft(row, { repRangeLow: '', repRangeHigh: '', inputWeightStep: '', targetWorkingSets: '', rirTargetMax: '', ...patch });
    assert.equal(v.ok, false, JSON.stringify(patch));
    assert.match(v.error, pattern, JSON.stringify(patch));
  }
});

test('a comma decimal is accepted', () => {
  const v = validateDraft(rowFor(), { repRangeLow: '10', repRangeHigh: '12', inputWeightStep: '1,25', targetWorkingSets: '', rirTargetMax: '' });
  assert.equal(v.ok, true);
  assert.equal(v.targets.inputWeightStep, 1.25);
});

/* ── nothing is saved that the user did not change ─────────────────────── */

test('a draft equal to the stored values sends nothing', () => {
  const row = rowFor({ repRangeLow: 10, repRangeHigh: 12, inputWeightStep: 1.25, targetWorkingSets: 3, rirTargetMax: 2 });
  const v = validateDraft(row, initialDraft(row));
  assert.equal(v.unchanged, true);
  assert.deepEqual(pendingChanges([row], { a: initialDraft(row) }), []);
});

test('an untouched suggestion on an unconfigured row IS a change — it is the point', () => {
  const row = rowFor();
  const changes = pendingChanges([row], { a: initialDraft(row) });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].exerciseId, 'a');
});

test('invalid rows are skipped by a save, not sent', () => {
  const row = rowFor();
  const changes = pendingChanges([row], { a: { repRangeLow: '12', repRangeHigh: '10' } });
  assert.deepEqual(changes, []);
});

test('a row with no draft is never sent', () => {
  assert.deepEqual(pendingChanges([rowFor()], {}), []);
});

/* ── junk ──────────────────────────────────────────────────────────────── */

test('junk input never throws', () => {
  for (const junk of [null, undefined, 42, 'x', {}]) {
    assert.doesNotThrow(() => buildWizardRows(junk, junk));
    assert.deepEqual(buildWizardRows(junk, junk), []);
  }
  assert.deepEqual(buildWizardRows([{ date: null }], []), []);
  assert.deepEqual(buildWizardRows([S('2026.07.05', null)], []), []);
});
