import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import ts from 'typescript';

async function load(rel) {
  const source = await readFile(new URL(rel, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

// progression.ts imports exerciseConfig.ts, which the data: URL cannot resolve,
// so the import is rewritten to an inlined data module first.
const cfgSource = await readFile(new URL('../src/exerciseConfig.ts', import.meta.url), 'utf8');
const cfgCompiled = ts.transpileModule(cfgSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const cfgUrl = `data:text/javascript;base64,${Buffer.from(cfgCompiled).toString('base64')}`;

const progSource = (await readFile(new URL('../src/progression.ts', import.meta.url), 'utf8'))
  .replace("from './exerciseConfig'", `from '${cfgUrl}'`)
  .replace(/import type \{[^}]*\} from '\.\/types';?/, '');
const progCompiled = ts.transpileModule(progSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const {
  buildProgressionAdvice, formatLastSessionSets, lastSessionWorkingSets, nextInputWeight,
  progressionDirection, roundToStep, suggestTargets,
} = await import(`data:text/javascript;base64,${Buffer.from(progCompiled).toString('base64')}`);
const { calcEffectiveWeight } = await import(cfgUrl);

/* ── weight types: the step lives in INPUT units ───────────────────────── */

const DUMBBELL = { weightType: 'Dumbbell', weightMultiplier: 2, baseWeight: 0 };
const BARBELL = { weightType: 'Barbell', weightMultiplier: 2, baseWeight: 20 };
const ASSISTED = { weightType: 'Assisted', weightMultiplier: -1, baseWeight: 90 };
const PLATE = { weightType: 'Plate_Loaded', weightMultiplier: 2, baseWeight: 15 };
const MACHINE = { weightType: 'Machine', weightMultiplier: 1, baseWeight: 0 };

test('dumbbell: input is one bell, a step moves both', () => {
  // 22.5 typed = 45 kg of load. One step of 2 = 24.5 typed = 49 kg.
  assert.equal(calcEffectiveWeight(DUMBBELL, 22.5), 45);
  assert.equal(nextInputWeight(DUMBBELL, 22.5, 2), 24.5);
  assert.equal(calcEffectiveWeight(DUMBBELL, 24.5), 49);
  assert.equal(roundToStep(23.4, 2), 24);
  assert.equal(roundToStep(23, 2), 24, 'exactly half a step rounds away from zero');
});

test('barbell x2: a 1.25 plate per side is 1.25 of input and 2.5 of load', () => {
  assert.equal(calcEffectiveWeight(BARBELL, 30), 80); // 30*2 + 20
  const next = nextInputWeight(BARBELL, 30, 1.25);
  assert.equal(next, 31.25);
  assert.equal(calcEffectiveWeight(BARBELL, next), 82.5);
  assert.equal(
    calcEffectiveWeight(BARBELL, next) - calcEffectiveWeight(BARBELL, 30), 2.5,
    'one input step must equal exactly two plates of load',
  );
  assert.equal(roundToStep(31.7, 1.25), 31.25);
  assert.equal(roundToStep(31.9, 1.25), 32.5);
});

test('assisted with a negative multiplier: progress means typing LESS', () => {
  assert.equal(progressionDirection(ASSISTED), -1);
  // Input is the counterweight, so effective load = bodyweight − input.
  assert.equal(calcEffectiveWeight(ASSISTED, 40, 90), 50);
  const next = nextInputWeight(ASSISTED, 40, 5);
  assert.equal(next, 35, 'the counterweight goes down, not up');
  assert.equal(calcEffectiveWeight(ASSISTED, next, 90), 55, 'and the load goes up');
  assert.ok(
    calcEffectiveWeight(ASSISTED, next, 90) > calcEffectiveWeight(ASSISTED, 40, 90),
    'a step must always make the set harder',
  );
});

test('assisted never suggests a negative counterweight', () => {
  assert.equal(nextInputWeight(ASSISTED, 2, 5), 0, 'clamped, not negative');
  assert.equal(nextInputWeight(ASSISTED, 0, 5), 0);
});

test('a negative multiplier alone flips the direction, whatever the type', () => {
  assert.equal(progressionDirection({ weightType: 'Other', weightMultiplier: -1 }), -1);
  assert.equal(progressionDirection({ weightType: 'Machine', weightMultiplier: 1 }), 1);
  assert.equal(progressionDirection(null), 1);
});

test('plate-loaded: input is plates one side, base is the carriage', () => {
  assert.equal(calcEffectiveWeight(PLATE, 20), 55); // 20*2 + 15
  const next = nextInputWeight(PLATE, 20, 1.25);
  assert.equal(next, 21.25);
  assert.equal(calcEffectiveWeight(PLATE, next), 57.5);
  assert.equal(roundToStep(21.3, 1.25), 21.25);
  // The base weight must never leak into the step arithmetic.
  assert.equal(nextInputWeight(PLATE, 0, 1.25), 1.25);
  assert.equal(calcEffectiveWeight(PLATE, 0), 15, 'empty carriage still weighs its base');
});

test('no step configured: the weight is passed through, not invented', () => {
  assert.equal(nextInputWeight(MACHINE, 47.3, null), 47.3);
  assert.equal(roundToStep(47.345, null), 47.35);
});

/* ── which sets the rule reads ─────────────────────────────────────────── */

const set = (over) => ({ date: '2026-08-20', reps: 10, weight: 40, input_weight: 20, order: 1, set_type: 'working', ...over });

test('warm-ups are dropped when they are marked', () => {
  const rows = [
    set({ order: 1, set_type: 'warmup', reps: 15 }),
    set({ order: 2, reps: 12 }),
    set({ order: 3, reps: 12 }),
  ];
  const picked = lastSessionWorkingSets(rows, 3);
  assert.equal(picked.length, 2);
  assert.ok(picked.every((r) => r.set_type === 'working'));
});

test('unmarked types fall back to the last target_working_sets', () => {
  // Production has set_type = 'working' on everything, so this is the path that
  // actually runs.
  const rows = [1, 2, 3, 4, 5].map((i) => set({ order: i, reps: 10 + i }));
  const picked = lastSessionWorkingSets(rows, 3);
  assert.deepEqual(picked.map((r) => r.order), [3, 4, 5]);
});

test('only the most recent session is read', () => {
  const rows = [
    set({ date: '2026-08-13', reps: 20, order: 1 }),
    set({ date: '2026-08-20', reps: 10, order: 1 }),
    set({ date: '2026-08-20', reps: 10, order: 2 }),
  ];
  const picked = lastSessionWorkingSets(rows, 5);
  assert.equal(picked.length, 2);
  assert.ok(picked.every((r) => r.date === '2026-08-20'));
});

/* ── the rule ──────────────────────────────────────────────────────────── */

const T = { repRangeLow: 10, repRangeHigh: 12, inputWeightStep: 2, targetWorkingSets: 3, rirTargetMax: null };

test('no range configured: a setup prompt, never silence', () => {
  const a = buildProgressionAdvice(DUMBBELL, {}, [set({})]);
  assert.equal(a.outcome, 'setup');
  assert.ok(a.suggestion.includes('не задан'));
  assert.equal(a.target, null);
});

test('a half-configured range is still setup', () => {
  assert.equal(buildProgressionAdvice(DUMBBELL, { repRangeLow: 10 }, [set({})]).outcome, 'setup');
  assert.equal(buildProgressionAdvice(DUMBBELL, { repRangeHigh: 12 }, [set({})]).outcome, 'setup');
});

test('no history: the target is shown, the weight is left to the user', () => {
  const a = buildProgressionAdvice(DUMBBELL, T, []);
  assert.equal(a.outcome, 'no-history');
  assert.match(a.target, /10–12/);
});

test('top of the range everywhere with no RIR: increase, flagged as reps-only', () => {
  const rows = [1, 2, 3].map((i) => set({ order: i, reps: 12, input_weight: 22.5 }));
  const a = buildProgressionAdvice(DUMBBELL, T, rows);
  assert.equal(a.outcome, 'increase');
  assert.equal(a.rirMissing, true);
  assert.equal(a.nextInputWeight, 24.5);
  assert.equal(a.previous, '22.5 × 12/12/12');
  assert.match(a.suggestion, /24\.5/);
});

test('inside the range: same weight, one more rep', () => {
  const rows = [set({ order: 1, reps: 12 }), set({ order: 2, reps: 11 }), set({ order: 3, reps: 10 })];
  const a = buildProgressionAdvice(DUMBBELL, T, rows);
  assert.equal(a.outcome, 'add-rep');
  assert.match(a.suggestion, /добавь повтор/);
  assert.equal(a.nextInputWeight, undefined);
});

test('below the range: hold — the MVP never suggests cutting weight', () => {
  const rows = [set({ order: 1, reps: 8 }), set({ order: 2, reps: 7 }), set({ order: 3, reps: 6 })];
  const a = buildProgressionAdvice(DUMBBELL, T, rows);
  assert.equal(a.outcome, 'hold');
  assert.ok(!/снизь|уменьш|сбрось/i.test(a.suggestion), 'no weight reduction may be suggested');
});

test('fewer sets than the target does not trigger an increase', () => {
  const rows = [set({ order: 1, reps: 12 }), set({ order: 2, reps: 12 })];
  const a = buildProgressionAdvice(DUMBBELL, T, rows);
  assert.notEqual(a.outcome, 'increase');
});

test('with RIR configured and in reserve, the increase is confirmed', () => {
  const withRir = { ...T, rirTargetMax: 2 };
  const rows = [1, 2, 3].map((i) => set({ order: i, reps: 12, input_weight: 22.5, rir: 2 }));
  const a = buildProgressionAdvice(DUMBBELL, withRir, rows);
  assert.equal(a.outcome, 'increase');
  assert.equal(a.rirMissing, false);
  assert.match(a.target, /RIR ≤ 2/);
});

test('with RIR at zero the weight is held even at the top of the range', () => {
  const withRir = { ...T, rirTargetMax: 2 };
  const rows = [1, 2, 3].map((i) => set({ order: i, reps: 12, rir: 0 }));
  const a = buildProgressionAdvice(DUMBBELL, withRir, rows);
  assert.equal(a.outcome, 'hold');
  assert.match(a.suggestion, /RIR/);
});

test('RIR above the configured ceiling also holds', () => {
  const withRir = { ...T, rirTargetMax: 2 };
  const rows = [1, 2, 3].map((i) => set({ order: i, reps: 12, rir: 4 }));
  assert.equal(buildProgressionAdvice(DUMBBELL, withRir, rows).outcome, 'hold');
});

test('RIR configured but never logged falls back to reps, still flagged', () => {
  const withRir = { ...T, rirTargetMax: 2 };
  const rows = [1, 2, 3].map((i) => set({ order: i, reps: 12, input_weight: 22.5 }));
  const a = buildProgressionAdvice(DUMBBELL, withRir, rows);
  assert.equal(a.outcome, 'increase');
  assert.equal(a.rirMissing, true);
});

test('assisted progresses downward through the full advice path', () => {
  const rows = [1, 2, 3].map((i) => set({ order: i, reps: 12, input_weight: 40 }));
  const a = buildProgressionAdvice(ASSISTED, { ...T, inputWeightStep: 5 }, rows);
  assert.equal(a.outcome, 'increase');
  assert.equal(a.nextInputWeight, 35);
});

test('a missing step still advises, and says the rounding was skipped', () => {
  const rows = [1, 2, 3].map((i) => set({ order: i, reps: 12, input_weight: 22.5 }));
  const a = buildProgressionAdvice(DUMBBELL, { ...T, inputWeightStep: null }, rows);
  assert.equal(a.outcome, 'increase');
  assert.match(a.suggestion, /шаг веса не задан/);
});

test('input weight is derived when only the effective weight was stored', () => {
  const rows = [1, 2, 3].map((i) => set({ order: i, reps: 12, input_weight: undefined, weight: 45 }));
  const a = buildProgressionAdvice(DUMBBELL, T, rows);
  assert.equal(a.previousInputWeight, 22.5, '45 kg of dumbbells is 22.5 typed');
});

/* ── suggestions are offers, not writes ────────────────────────────────── */

test('suggestTargets reads history and never returns a range from nothing', () => {
  const empty = suggestTargets(BARBELL, []);
  assert.equal(empty.basedOnSets, 0);
  assert.equal(empty.repRangeLow, undefined);
  assert.equal(empty.inputWeightStep, 1.25, 'a barbell still gets a plausible step');

  const rows = [10, 11, 12, 10, 12, 11].map((reps, i) =>
    set({ order: i + 1, reps, session_id: `s${i % 2}` }));
  const s = suggestTargets(BARBELL, rows);
  assert.ok(s.repRangeLow >= 10 && s.repRangeHigh <= 12);
  assert.ok(s.repRangeLow <= s.repRangeHigh);
  assert.equal(s.basedOnSets, 6);
  assert.ok(s.targetWorkingSets >= 1);
});

test('junk input never throws', () => {
  for (const junk of [null, undefined, 42, 'x', {}]) {
    assert.doesNotThrow(() => buildProgressionAdvice(junk, junk, junk));
    assert.doesNotThrow(() => suggestTargets(junk, junk));
    assert.doesNotThrow(() => lastSessionWorkingSets(junk, junk));
  }
  assert.equal(buildProgressionAdvice(null, null, null).outcome, 'setup');
});

const setOf = (weight, reps) => ({ input_weight: weight, reps, date: '2026-02-28' });

test('лесенка показывается парами, а не одним весом', () => {
  const line = formatLastSessionSets([
    setOf(0, 15), setOf(5, 15), setOf(10, 12), setOf(15, 12), setOf(20, 12), setOf(25, 9),
  ]);
  assert.equal(line, '0×15 · 5×15 · 10×12 · 15×12 · 20×12 · 25×9');
});

test('прямые подходы схлопываются в один вес', () => {
  const line = formatLastSessionSets([setOf(20, 12), setOf(20, 12), setOf(20, 10)]);
  assert.equal(line, '20×12/12/10');
});

test('схлопываются только подряд идущие одинаковые веса', () => {
  const line = formatLastSessionSets([setOf(20, 12), setOf(25, 8), setOf(20, 10)]);
  assert.equal(line, '20×12 · 25×8 · 20×10');
});

test('вес берётся из input_weight, а при его отсутствии из weight', () => {
  const line = formatLastSessionSets([{ weight: 40, reps: 10 }, { input_weight: 0, weight: 20, reps: 15 }]);
  assert.equal(line, '40×10 · 0×15');
});

test('пустой ввод даёт пустую строку и не бросает', () => {
  assert.equal(formatLastSessionSets([]), '');
  assert.equal(formatLastSessionSets(null), '');
  assert.equal(formatLastSessionSets(undefined), '');
  assert.equal(formatLastSessionSets([null, undefined]), '');
});

test('мусор в весах и повторах не роняет строку', () => {
  const line = formatLastSessionSets([{ input_weight: 'ерунда', reps: null }, setOf(10, 5)]);
  assert.equal(line, '0×0 · 10×5');
});
