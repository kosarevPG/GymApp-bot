import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadTs } from './loadTs.mjs';
const { calculateLocalAnalytics, roundVolume } = await loadTs('../src/localAnalytics.ts');
const { computeWorkloadTrend, formatWorkloadTrend } = await loadTs('../src/workloadTrend.ts');

test('all pinned HealthOS workload fixtures match both values and wording', async () => {
  const fixture = JSON.parse(await readFile(new URL('../../docs/fixtures/workload-trend-v1.json',import.meta.url),'utf8'));
  for(const row of fixture.cases) {
    const result=computeWorkloadTrend(row.sessions,row.referenceDate);
    assert.deepEqual(result,row.expected,row.name);assert.equal(formatWorkloadTrend(result),row.expectedText,row.name);
  }
});

test('local periods match the real Python adapter for boundaries, exclusions, warmup, failure, two arms and two sessions on one date', () => {
  const input=JSON.parse(execFileSync('python',[fileURLToPath(new URL('../../scripts/tests/local_analytics_parity.py',import.meta.url))],{encoding:'utf8'}));
  for(const days of [7,14,28]) {
    const {volume,muscleVolume,muscleSets,workloadTrend}=input.analytics[days];
    assert.deepEqual(calculateLocalAnalytics(input.history,days,input.referenceDate),{volume,muscleVolume,muscleSets,workloadTrend});
  }
  const old=structuredClone(input.history); delete old.find(s=>s.date==='2026.08.22').exercises[0].sets[0].include_in_tonnage;
  assert.equal(calculateLocalAnalytics(old,7,input.referenceDate),null,'old copies fall back instead of guessing excluded sets');
  assert.equal(calculateLocalAnalytics([{...input.history[0],analyticsComplete:false}],7,input.referenceDate),null);
});

test('display rounding matches Python, including decimal and negative ties', () => {
  const values=[0,0.05,0.15,1.25,2.25,2.45,2.55,-0.05,-2.25,31.65,1e-20,12345.25,...Array.from({length:80},(_,i)=>(i-40)*1.125)];
  const expected=JSON.parse(execFileSync('python',['-c','import json,sys; print(json.dumps([round(x,1) for x in json.load(sys.stdin)]))'],{input:JSON.stringify(values),encoding:'utf8'}));
  assert.deepEqual(values.map(roundVolume),expected);
});

test('empty history is usable immediately and invalid dates do not invent sessions', () => {
  const data=calculateLocalAnalytics([],28,'2026-10-20');
  assert.equal(data.volume,0);assert.deepEqual(data.muscleSets,{});assert.equal(data.workloadTrend.status,'insufficient');
  assert.equal(calculateLocalAnalytics([],7,'2026-02-30'),null);
});
