import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const { decodeHistory, historyFromJournal, createHistoryLoader } = await load('../src/exerciseHistory.ts');
const { isRepeatableTreadmill, shouldAppendCardio } = await load('../src/cardio.ts');
const { readExerciseRest, formatRestTime } = await load('../src/exerciseRest.ts');

test('treadmill repeat preserves warm-up and resumes an unfinished cool-down', () => {
  const treadmill = { name: 'Беговая дорожка', measure: 'cardio' };
  assert.equal(isRepeatableTreadmill(treadmill), true);
  assert.equal(isRepeatableTreadmill({ name: 'Жим', measure: 'strength' }), false);
  assert.equal(isRepeatableTreadmill({ name: 'Велотренажёр', measure: 'cardio' }), false);
  assert.equal(shouldAppendCardio(treadmill, [{ completed: true }], true), true);
  assert.equal(shouldAppendCardio(treadmill, [{ completed: true }, { completed: false }], true), false);
  assert.equal(shouldAppendCardio(treadmill, [{ completed: true }], false), false, 'reloading or opening a done plan item adds nothing');
  assert.equal(shouldAppendCardio(treadmill, [], true), false);
  assert.equal(shouldAppendCardio({ measure: 'strength' }, [{ completed: true }], true), false);
});

test('grouped and legacy history keep session identity, order and cardio separate', () => {
  const data = decodeHistory({ note: 'Сиденье 3', history: [{ date: '2026.10.15', session_id: 's1',
    sets: [{ weight: 40, reps: 10, rest: 1, order: 2 }], cardio: [{ minutes: 10, order: 1 }],
  }] });
  assert.equal(data.note, 'Сиденье 3');
  assert.deepEqual(data.history, [{ weight: 40, reps: 10, rest: 1, order: 2, date: '2026.10.15', session_id: 's1' }]);
  assert.equal(data.cardio[0].minutes, 10);
  const flat = [{ date: '2026.10.14', weight: 20, reps: 10, rest: 1 }];
  assert.deepEqual(decodeHistory({ history: flat }).history, flat);
  assert.deepEqual(decodeHistory(null), { history: [], cardio: [], note: '' });
});

test('the cached journal supplies templates even for a never-opened exercise', () => {
  const journal = [{ id: 's1', date: '2026.10.15', exercises: [
    { exerciseId: 't', cardio: [{ minutes: 10, order: 1 }, { minutes: 8, order: 8 }], sets: [] },
    { exerciseId: 'press', sets: [{ weight: 40, reps: 10, rest: 1 }] },
  ] }];
  assert.equal(historyFromJournal('t', journal).cardio.length, 2);
  assert.equal(historyFromJournal('press', journal).history[0].weight, 40);
  assert.equal(historyFromJournal('missing', journal).history.length, 0);
});

test('cached exercise data is immediate while one shared background request is pending', async () => {
  const cached = decodeHistory({ history: [{ date: '2026.10.14', weight: 20 }] });
  let calls = 0;
  let complete;
  let saved;
  const loader = createHistoryLoader({ read: () => cached, online: () => true,
    fetch: () => { calls++; return new Promise(resolve => { complete = resolve; }); },
    write: (id, raw) => { saved = { id, raw }; },
  });
  const background = loader.refresh('press');
  assert.equal(loader.peek('press'), cached);
  assert.equal(loader.refresh('press'), background);
  await Promise.resolve();
  assert.equal(calls, 1);
  const raw = { history: [{ date: '2026.10.15', weight: 40 }] };
  complete(raw);
  assert.equal((await background).history[0].weight, 40);
  assert.deepEqual(saved, { id: 'press', raw });
});

test('offline and failed requests retain local history without waiting for a network timeout', async () => {
  const cached = decodeHistory({ history: [{ date: '2026.10.15', weight: 40 }] });
  let calls = 0;
  const loader = createHistoryLoader({ read: () => cached, online: () => false,
    fetch: () => { calls++; throw Error('offline'); }, write: () => assert.fail('must not write'),
  });
  assert.equal(await loader.refresh('press'), cached);
  assert.equal(calls, 0);
  const failed = createHistoryLoader({ read: () => cached, online: () => true,
    fetch: async () => { throw Error('connection lost'); }, write: () => assert.fail('must not write'),
  });
  assert.equal(await failed.refresh('press'), cached);
});

test('inter-exercise rest survives reload for its session and expires with the session', () => {
  const now = 1_000_000;
  const rest = { sessionId: 'session-a', startedAt: now - 65_000 };
  assert.deepEqual(readExerciseRest(JSON.stringify(rest), 'session-a', now), rest);
  assert.equal(formatRestTime(now - rest.startedAt), '01:05');
  assert.equal(formatRestTime(3_600_000), '60:00');
  assert.equal(formatRestTime(-1000), '00:00');
  assert.equal(readExerciseRest(JSON.stringify(rest), 'other-session', now), null);
  assert.equal(readExerciseRest(JSON.stringify(rest), 'session-a', now + 14_400_000), null);
  assert.equal(readExerciseRest('{broken', 'session-a', now), null);
  assert.equal(readExerciseRest(JSON.stringify({ sessionId: 'session-a', startedAt: now + 1 }), 'session-a', now), null);
});
