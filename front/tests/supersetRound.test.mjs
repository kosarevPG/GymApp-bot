import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTs } from './loadTs.mjs';

const { nextInRound, continueRound } = await loadTs('../src/workoutTiming.ts');

const block = (exId, done, total) => ({ exId, sets: Array.from({ length: total }, (_, i) => ({ id: `${exId}${i + 1}`, completed: i < done })) });

test('a superset alternates its exercises round by round', () => {
  assert.equal(nextInRound([block('A', 0, 3), block('B', 0, 3)]).set.id, 'A1');
  assert.equal(nextInRound([block('A', 1, 3), block('B', 0, 3)]).set.id, 'B1');
  assert.equal(nextInRound([block('A', 1, 3), block('B', 1, 3)]).set.id, 'A2');
  assert.equal(nextInRound([block('A', 3, 3), block('B', 2, 3)]).set.id, 'B3');
  assert.equal(nextInRound([block('A', 3, 3), block('B', 3, 3)]), null);
});

test('a single exercise keeps its plain order', () => {
  assert.equal(nextInRound([block('A', 2, 4)]).set.id, 'A3');
  assert.equal(continueRound([block('A', 0, 4)], 'A', 'A1'), null);
});

test('the first exercise of a round leads straight into the next one, the last one into rest', () => {
  assert.equal(continueRound([block('A', 0, 3), block('B', 0, 3)], 'A', 'A1').set.id, 'B1');
  assert.equal(continueRound([block('A', 1, 3), block('B', 0, 3)], 'B', 'B1'), null);
  assert.equal(continueRound([block('A', 1, 3), block('B', 1, 3), block('C', 1, 3)], 'A', 'A2').set.id, 'B2');
  assert.equal(continueRound([block('A', 2, 3), block('B', 2, 3), block('C', 1, 3)], 'C', 'C2'), null);
});

test('when the partner has run out of sets the round ends with rest', () => {
  assert.equal(continueRound([block('A', 2, 4), block('B', 2, 2)], 'A', 'A3'), null);
});
