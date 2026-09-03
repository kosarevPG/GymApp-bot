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

const { describeLoad, splitIntoPlates, DEFAULT_PLATES } = await load('../src/exerciseConfig.ts');

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
  assert.equal(plan.plates.perSide, true);
  assert.deepEqual(plan.plates.items, [25, 15]);
});

test('штанга с mult=1: число — это блины целиком, на сторону идёт половина', () => {
  const plan = describeLoad({ weightType: 'Barbell', baseWeight: 20, weightMultiplier: 1 }, 40);
  assert.equal(plan.total, 60);
  assert.equal(plan.summary, 'Гриф 20 + 40 блинами = 60 кг');
  assert.equal(plan.plates.perSide, true);
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

test('одиночный блин в руках не делится на стороны', () => {
  const plan = describeLoad({ weightType: 'Plate_Loaded', baseWeight: 0, weightMultiplier: 1 }, 15);
  assert.equal(plan.total, 15);
  assert.equal(plan.plates.perSide, false);
  assert.deepEqual(plan.plates.items, [15]);
});

test('тренажёр под блины с mult=2 считает вес на сторону', () => {
  const plan = describeLoad({ weightType: 'Plate_Loaded', baseWeight: 0, weightMultiplier: 2 }, 20);
  assert.equal(plan.total, 40);
  assert.equal(plan.summary, 'По 20 на сторону = 40 кг');
  assert.equal(plan.plates.perSide, true);
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
