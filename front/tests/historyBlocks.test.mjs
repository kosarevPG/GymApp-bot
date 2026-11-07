import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTs } from './loadTs.mjs';

const { historyBlocks } = await loadTs('../src/historyBlocks.ts');
const { forgetWorkout } = await loadTs('../src/workoutJournal.ts');

const strength = (name, ...orders) => ({ name, sets: orders.map(order => ({ order })) });
const cardio = (name, ...orders) => ({ name, sets: [], cardio: orders.map(order => ({ order, minutes: order })) });

test('warm-up and cool-down on the treadmill stand where they were done', () => {
  const blocks = historyBlocks([cardio('Дорожка', 1, 9), strength('Тяга', 2, 3), strength('Жим', 4, 8)]);
  assert.deepEqual(blocks.map(b => [b.name, ...[...b.sets, ...(b.cardio || [])].map(i => i.order)]), [
    ['Дорожка', 1], ['Тяга', 2, 3], ['Жим', 4, 8], ['Дорожка', 9],
  ]);
});

test('segments in a row stay one visit', () => {
  const blocks = historyBlocks([cardio('Дорожка', 1, 2, 10), strength('Тяга', 3, 4)]);
  assert.deepEqual(blocks.map(b => (b.cardio || b.sets).map(i => i.order)), [[1, 2], [3, 4], [10]]);
});

test('a workout without cardio is left as it is', () => {
  const exercises = [strength('А', 0), strength('Б', 0)];
  assert.deepEqual(historyBlocks(exercises), exercises);
});

test('deleting a workout drops its local copy and everything queued for it', () => {
  const local = [{ id: 'phone-1', clientSessionId: 'phone-1' }, { id: 'phone-2', clientSessionId: 'phone-2' }];
  const queue = [
    { id: 'a', type: 'saveSet', data: { session_id: 'phone-1' } },
    { id: 'b', type: 'saveSet', data: { session_id: 'phone-2' } },
    { id: 'workout:x', type: 'deleteWorkout', data: { session_id: 'phone-1' } },
  ];
  const byServerId = forgetWorkout(local, queue, 'server-uuid', 'phone-1');
  assert.deepEqual(byServerId.local.map(s => s.id), ['phone-2']);
  assert.deepEqual(byServerId.discard, ['a']);
  const localOnly = forgetWorkout(local, queue, 'phone-2', 'phone-2');
  assert.deepEqual(localOnly.local.map(s => s.id), ['phone-1']);
  assert.deepEqual(localOnly.discard, ['b']);
});
