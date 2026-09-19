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
  describeLoad, splitIntoPlates, DEFAULT_PLATES,
  carryOverInput, formatLoad, loadRulesOf, sameLoadRules, setLoadLabel,
} = await load('../src/exerciseConfig.ts');

test('splitIntoPlates набирает вес точно', () => {
  assert.deepEqual(splitIntoPlates(40).items, [25, 15]);
  assert.equal(splitIntoPlates(40).remainder, 0);
  assert.deepEqual(splitIntoPlates(20).items, [20]);
  assert.deepEqual(splitIntoPlates(3.75).items, [2.5, 1.25]);
});

test('splitIntoPlates не копит погрешность на дробных блинах', () => {
  const { items, remainder } = splitIntoPlates(11.25);
  assert.deepEqual(items, [10, 1.25]);
  assert.equal(remainder, 0);
});

test('splitIntoPlates сообщает недобор, если набор не позволяет', () => {
  const { items, remainder } = splitIntoPlates(4, [5, 2.5]);
  assert.deepEqual(items, [2.5]);
  assert.equal(remainder, 1.5);
});

test('splitIntoPlates уважает свой набор блинов', () => {
  assert.deepEqual(splitIntoPlates(40, [20, 10]).items, [20, 20]);
});

test('splitIntoPlates устойчив к пустому и нулевому вводу', () => {
  assert.deepEqual(splitIntoPlates(0).items, []);
  assert.deepEqual(splitIntoPlates(-5).items, []);
  assert.deepEqual(splitIntoPlates(10, []).items, []);
  assert.equal(splitIntoPlates(10, []).remainder, 10);
});

test('штанга с mult=2: число — это вес на сторону', () => {
  const plan = describeLoad({ weightType: 'Barbell', baseWeight: 20, weightMultiplier: 2 }, 40);
  assert.equal(plan.total, 100);
  assert.equal(plan.summary, 'Гриф 20 + по 40 на сторону = 100 кг');
  assert.deepEqual(plan.plates.items, [25, 15]);
});

test('штанга с mult=1: число — это блины целиком, на сторону идёт половина', () => {
  const plan = describeLoad({ weightType: 'Barbell', baseWeight: 20, weightMultiplier: 1 }, 40);
  assert.equal(plan.total, 60);
  assert.equal(plan.summary, 'Гриф 20 + 40 блинами = 60 кг');
  assert.deepEqual(plan.plates.items, [20]);
});

test('смит с грифом 15 считается от своей базы', () => {
  const plan = describeLoad({ weightType: 'Barbell', baseWeight: 15, weightMultiplier: 1 }, 30);
  assert.equal(plan.total, 45);
  assert.deepEqual(plan.plates.items, [15]);
});

test('каретка (Гакк): база прибавляется, блины делятся на две стороны', () => {
  const plan = describeLoad({ weightType: 'Plate_Loaded', baseWeight: 40, weightMultiplier: 1 }, 60);
  assert.equal(plan.total, 100);
  assert.equal(plan.summary, 'База 40 + 60 блинами = 100 кг');
  assert.deepEqual(plan.plates.items, [25, 5]);
});

test('блиновый тренажёр без каретки тоже делится пополам', () => {
  // «Тяга с упором в грудь»: записывается общий вес, вешается поровну.
  const plan = describeLoad({ weightType: 'Plate_Loaded', baseWeight: 0, weightMultiplier: 1 }, 30);
  assert.equal(plan.total, 30);
  assert.equal(plan.summary, '30 кг блинами');
  assert.deepEqual(plan.plates.items, [15]);   // 30 всего → по 15, одним блином
  assert.equal(plan.plates.remainder, 0);
});

test('тренажёр под блины с mult=2 считает вес на сторону', () => {
  const plan = describeLoad({ weightType: 'Plate_Loaded', baseWeight: 0, weightMultiplier: 2 }, 20);
  assert.equal(plan.total, 40);
  assert.equal(plan.summary, 'По 20 на сторону = 40 кг');
});

test('гантели: число — вес одной, итог за пару', () => {
  const plan = describeLoad({ weightType: 'Dumbbell', baseWeight: 0, weightMultiplier: 2 }, 22.5);
  assert.equal(plan.total, 45);
  assert.equal(plan.summary, 'Две гантели по 22.5 = 45 кг');
  assert.equal(plan.plates, null);
});

test('гравитрон: противовес переводится в рабочий вес', () => {
  const plan = describeLoad({ weightType: 'Assisted', baseWeight: 90, weightMultiplier: -1 }, 30, 90);
  assert.equal(plan.total, 60);
  assert.equal(plan.summary, 'Противовес 30 → рабочий вес 60 кг');
});

test('свой вес: показывает из чего сложился итог', () => {
  const plan = describeLoad({ weightType: 'Bodyweight', baseWeight: 0, weightMultiplier: 1 }, 5, 90);
  assert.equal(plan.total, 95);
  assert.equal(plan.summary, 'Свой вес 90 + 5 = 95 кг');
});

test('стек и пустой ввод не дают подсказки', () => {
  assert.equal(describeLoad({ weightType: 'Machine', baseWeight: 0, weightMultiplier: 1 }, 50), null);
  assert.equal(describeLoad({ weightType: 'Barbell', baseWeight: 20, weightMultiplier: 2 }, 0), null);
  assert.equal(describeLoad({ weightType: 'Barbell', baseWeight: 20, weightMultiplier: 2 }, NaN), null);
});

test('набор блинов по умолчанию отсортирован по убыванию и без дублей', () => {
  assert.deepEqual(DEFAULT_PLATES, [...new Set(DEFAULT_PLATES)]);
  assert.deepEqual(DEFAULT_PLATES, [...DEFAULT_PLATES].sort((a, b) => b - a));
});


/* ── снимок правил и единый показ веса ─────────────────────────────────── */

const MACHINE = { weightType: 'Machine', weightMultiplier: 1, baseWeight: 0 };
const PAIR = { weightType: 'Dumbbell', weightMultiplier: 2, baseWeight: 0 };
const BAR = { weightType: 'Barbell', weightMultiplier: 2, baseWeight: 20 };
const PULLUP = { weightType: 'Bodyweight', weightMultiplier: 1, baseWeight: 0 };
const GRAVITRON = { weightType: 'Assisted', weightMultiplier: -1, baseWeight: 90 };

test('вес показывается по смыслу типа нагрузки', () => {
  assert.equal(formatLoad(loadRulesOf(MACHINE), 40, 40), '40 кг');
  assert.equal(formatLoad(loadRulesOf(PAIR), 8, 16), '2×8 кг');
  assert.equal(formatLoad(loadRulesOf({ ...PAIR, weightMultiplier: 1 }), 8, 8), '8 кг');
  assert.equal(formatLoad(loadRulesOf(BAR), 20, 60), '60 кг');
  assert.equal(formatLoad(loadRulesOf(PULLUP), 10, 100), 'свой вес +10 кг');
  assert.equal(formatLoad(loadRulesOf(PULLUP), 0, 90), 'свой вес');
  assert.equal(formatLoad(loadRulesOf(GRAVITRON), 30, 60), 'помощь 30 кг');
  assert.equal(formatLoad(loadRulesOf(PAIR), 1.25, 2.5), '2×1.25 кг');
});

test('вес тела попадает в снимок только там, где входит в итог', () => {
  assert.equal(loadRulesOf(MACHINE, 84).bw, undefined);
  assert.equal(loadRulesOf(GRAVITRON, 84).bw, 84);
  assert.equal(loadRulesOf(PULLUP, 84).bw, 84);
  assert.equal(loadRulesOf(null).type, 'Other');
});

test('смена веса тела не считается сменой правил', () => {
  assert.ok(sameLoadRules(loadRulesOf(GRAVITRON, 90), loadRulesOf(GRAVITRON, 80)));
  assert.ok(!sameLoadRules(loadRulesOf(PAIR), loadRulesOf(MACHINE)));
});

test('старый подход без снимка читается по нынешним правилам', () => {
  assert.equal(setLoadLabel({ input_weight: 8, weight: 16 }, PAIR), '2×8 кг');
  assert.equal(carryOverInput({ input_weight: 8, weight: 16 }, PAIR), 8);
});

test('подставляется прошлое число, пока правила те же', () => {
  const set = { input_weight: 30, weight: 55, load: loadRulesOf(GRAVITRON, 85) };
  // Вес тела с тех пор другой, но противовес на тренажёре ставят тот же.
  assert.equal(carryOverInput(set, GRAVITRON, 90), 30);
});

test('после смены правил прошлый итог переводится в нынешний ввод', () => {
  // Раньше «Жим гантелей» вели как стек: 16 кг итогом. Теперь это пара гантелей.
  const set = { input_weight: 16, weight: 16, load: loadRulesOf(MACHINE) };
  assert.equal(carryOverInput(set, PAIR), 8);
  assert.equal(setLoadLabel(set, PAIR), '16 кг');
});
