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

const {
  normalizePreset, planFromPreset, planDefaultsFor, planTargetText, planItemDone,
} = await load('../src/workoutPlan.ts');
const { formatCardioSegment, formatCardioSegments, durationSeconds } = await load('../src/cardio.ts');

const PRESET = {
  warmup: { exerciseId: 'treadmill', minutes: 10 },
  abs: { exerciseId: 'crunch', sets: 3, reps: 20 },
  cooldown: { exerciseId: 'treadmill', minutes: 8 },
};

/* ── plan ──────────────────────────────────────────────────────────────── */

test('the plan follows the preset in workout order', () => {
  const plan = planFromPreset(PRESET);
  assert.deepEqual(plan.map((item) => [item.key, item.label, item.exerciseId]), [
    ['warmup', 'Разминка', 'treadmill'],
    ['abs', 'Пресс', 'crunch'],
    ['cooldown', 'Заминка', 'treadmill'],
  ]);
  assert.deepEqual(plan.map(planTargetText), ['10 мин', '3×20', '8 мин']);
});

test('an item without an exercise is left out, and an empty preset plans nothing', () => {
  assert.deepEqual(planFromPreset({ ...PRESET, abs: { exerciseId: '' } }).map((i) => i.key), ['warmup', 'cooldown']);
  assert.deepEqual(planFromPreset(null), []);
  assert.deepEqual(planFromPreset('junk'), []);
});

test('missing or broken numbers fall back to 10 minutes and 3×20', () => {
  const preset = normalizePreset({ warmup: { exerciseId: 't', minutes: 'x' }, abs: { exerciseId: 'c', sets: -1 } });
  assert.equal(preset.warmup.minutes, 10);
  assert.equal(preset.abs.sets, 3);
  assert.equal(preset.abs.reps, 20);
  assert.equal(preset.cooldown.exerciseId, '');
});

test('a cool-down on the warm-up machine adds a segment instead of reopening the warm-up', () => {
  const plan = planFromPreset(PRESET);
  assert.deepEqual(planDefaultsFor(plan[0], plan), { minutes: 10 });
  assert.deepEqual(planDefaultsFor(plan[1], plan), { sets: 3, reps: 20 });
  assert.deepEqual(planDefaultsFor(plan[2], plan), { minutes: 8, append: true });
  const bike = planFromPreset({ ...PRESET, cooldown: { exerciseId: 'bike', minutes: 8 } });
  assert.deepEqual(planDefaultsFor(bike[2], bike), { minutes: 8 });
});

test('an item is done only by rows the user ticked', () => {
  const plan = planFromPreset(PRESET);
  const draft = (treadmill, crunch) => ({
    exercises: {
      treadmill: { sets: treadmill.map((completed) => ({ completed })) },
      crunch: { sets: crunch.map((completed) => ({ completed })) },
    },
  });
  const done = (d) => plan.map((item) => planItemDone(item, plan, d));
  assert.deepEqual(done(null), [false, false, false]);
  assert.deepEqual(done(draft([false], [])), [false, false, false], 'a prefilled row is a plan, not a result');
  assert.deepEqual(done(draft([true], [true, true])), [true, false, false]);
  assert.deepEqual(done(draft([true, true], [true, true, true])), [true, true, true]);
});

/* ── cardio text ───────────────────────────────────────────────────────── */

test('a segment reads as minutes, speed and incline', () => {
  assert.equal(formatCardioSegment({ minutes: 10, speed: 6, incline: 5 }), '10 мин, 6 км/ч, наклон 5%');
  assert.equal(formatCardioSegment({ minutes: '12.5', speed: '5,5' }), '12.5 мин, 5.5 км/ч');
  assert.equal(formatCardioSegment({ minutes: 10, speed: 5, incline: 0 }), '10 мин, 5 км/ч');
  assert.equal(
    formatCardioSegments([{ minutes: 10, speed: 6, incline: 5 }, { minutes: 5, speed: 5 }]),
    '10 мин, 6 км/ч, наклон 5% · 5 мин, 5 км/ч',
  );
  assert.equal(formatCardioSegments(null), '');
});

test('minutes become whole seconds, and nothing else passes', () => {
  assert.equal(durationSeconds('10'), 600);
  assert.equal(durationSeconds('12,5'), 750);
  assert.equal(durationSeconds(''), null);
  assert.equal(durationSeconds('0'), null);
  assert.equal(durationSeconds('abc'), null);
});
