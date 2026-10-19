import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './loadTs.mjs';
const flow = await loadTs('../src/workoutRepeat.ts');
const weights = await loadTs('../src/exerciseConfig.ts');
const timing = await loadTs('../src/workoutTiming.ts');
const journal = await loadTs('../src/workoutJournal.ts');
let id = 0;
const uuid = () => `new-${++id}`;
const bar = { id: 'bar', name: 'Жим', weightType: 'Barbell', weightMultiplier: 2, baseWeight: 20 };
const hack = { id: 'hack', name: 'Гакк', weightType: 'Plate_Loaded', weightMultiplier: 2, baseWeight: 40 };
const dumbbell = { id: 'db', name: 'Махи', weightType: 'Dumbbell', weightMultiplier: 2, baseWeight: 0 };
const sample = { id:'old-request', input_weight:20, weight:60, reps:12, rest:1.5, order:1, rpe:9, rir:1,
  load:{v:1,type:'Barbell',mult:2,base:20}, timing:{ended_at:'2026-10-12T10:00:00Z',duration_seconds:40} };

test('new barbell entry is total weight; legacy history and editing keep their units', () => {
  const current = weights.forNewEntry(bar);
  assert.equal(weights.calcEffectiveWeight(current,60),60);
  assert.equal(weights.weightInputLabel(current),'ВСЕГО, КГ');
  assert.equal(weights.calcEffectiveWeight(bar,20),60);
  assert.equal(weights.carryOverInput(sample,current),60);
  assert.equal(weights.carryOverInput({...sample,load:undefined},current),60);
  assert.equal(weights.setLoadLabel(sample,current),'60 кг');
  assert.equal(weights.rulesForSet({...sample,load:undefined},current).inputMode,undefined);
  assert.equal(weights.calcEffectiveWeight(weights.rulesAsExercise(weights.rulesForSet(sample,current)),20),60);
  assert.deepEqual(weights.describeLoad(current,60).plates.items,[20]);
  assert.equal(weights.loadRulesOf(current).inputMode,'total');
  const snapshot=weights.loadRulesOf(current);
  assert.deepEqual([snapshot.mult,snapshot.base,snapshot.equipmentBase],[1,0,20]);
  assert.equal(60*snapshot.mult+snapshot.base,60,'old clients still compute the same total');
  assert.deepEqual(weights.describeLoad(weights.rulesAsExercise(snapshot),60).plates.items,[20]);
});

test('plate machines accept the sum of plates without doubling; catalogue base is preserved', () => {
  const current=weights.forNewEntry(hack);
  assert.equal(weights.calcEffectiveWeight(current,30),70);
  assert.equal(weights.carryOverInput({input_weight:15,weight:70,load:{v:1,type:'Plate_Loaded',mult:2,base:40}},current),30);
  assert.equal(weights.weightInputLabel(current),'БЛИНЫ ВСЕГО, КГ');
  assert.deepEqual(weights.describeLoad(current,30).plates.items,[15]);
  assert.equal(weights.calcEffectiveWeight(weights.forNewEntry({...hack,baseWeight:0}),70),70);
});

test('dumbbell pairs, one kettlebell and unilateral rounds keep their intended loads', () => {
  assert.equal(weights.calcEffectiveWeight(weights.forNewEntry(dumbbell),8),16);
  assert.equal(weights.calcEffectiveWeight(weights.forNewEntry({weightType:'Other',weightMultiplier:1}),24),24);
  assert.equal(weights.setLoadLabel({input_weight:8,weight:16,load:weights.loadRulesOf({...dumbbell,unilateral:true})},null),'8 кг/рука');
});

test('repeat copies all 21 sets into five independent blocks with no completed or invented effort', () => {
  const source={id:'old',date:'2026.10.12',location:'home',exercises:[5,4,4,4,4].map((count,i)=>({exerciseId:String(i),name:`ex${i}`,sets:Array.from({length:count},(_,j)=>({...sample,order:i*5+j}))}))};
  const before=structuredClone(source);
  const plan=flow.repeatPlan(source,uuid);
  assert.equal(plan.length,5);
  assert.equal(new Set(plan.map(p=>p.blockId)).size,5);
  const rows=plan.flatMap(p=>flow.templateSets(p.templates[0],bar,90,uuid));
  assert.equal(rows.length,21);
  for(const row of rows){assert.equal(row.completed,false);assert.equal(row.weight,'60');assert.equal(row.requestId,undefined);assert.equal(row.rpe,undefined);assert.equal(row.rir,undefined);assert.equal(row.timing,undefined);}
  assert.deepEqual(source,before);
  assert.equal(new Set(rows.map(s=>s.id)).size,21);
  assert.notEqual(flow.repeatPlan(source,uuid)[0].blockId,plan[0].blockId);
});

test('supersets stay together, repeated exercise blocks stay distinct, cardio preserves both positions', () => {
  const source={exercises:[
    {exerciseId:'t',name:'Дорожка',cardio:[{minutes:8,order:30},{minutes:10,order:1}]},
    {exerciseId:'bar',sets:[{...sample,order:5}],supersetId:'ss'},
    {exerciseId:'db',sets:[{...sample,order:6}],supersetId:'ss'},
    {exerciseId:'bar',sets:[{...sample,order:20}]},
  ]};
  const plan=flow.repeatPlan(source,uuid);
  assert.equal(plan.length,4);
  assert.deepEqual(plan.map(p=>p.exerciseId),['t','bar','bar','t']);
  assert.equal(plan[1].templates.length,2);
  assert.notEqual(flow.draftKey('bar',plan[1].blockId),flow.draftKey('bar',plan[2].blockId));
  assert.equal(plan[0].templates[0].cardio[0].minutes,10);
});

test('replacement after partial completion preserves original work; an untouched step is replaced in place', () => {
  const [old,replacement]=flow.repeatPlan({exercises:[{exerciseId:'bar',sets:[sample]},{exerciseId:'db',sets:[sample]}]},uuid);
  const draft={exercises:{[flow.draftKey('bar',old.blockId)]:{sets:[{completed:true,requestId:'saved'}]}}};
  const before=structuredClone(draft);
  const result=flow.replaceStep([old],old.key,replacement,draft);
  assert.equal(result.length,2); assert.equal(result[0].status,'done');assert.equal(result[1],replacement);
  assert.deepEqual(draft,before);
  assert.deepEqual(flow.replaceStep([old],old.key,replacement,{}),[replacement]);
  assert.equal(flow.nextStep(result,old.key),replacement);
  assert.equal(flow.nextStep(result.map(p=>({...p,status:'skipped'}))),undefined);
});

test('manual clock separates set time and actual rest and survives reload with no millisecond display', () => {
  const t=Date.parse('2026-10-20T10:00:00Z');
  const rest=timing.nextRestClock('s',1.5,t);
  const changed=timing.betweenExercises(rest);
  assert.equal(changed.since,t);
  const working=timing.startSetClock(changed,'s','block','db','set',t+100000);
  const restored=timing.readClock(JSON.stringify(working),'s',t+115000);
  assert.deepEqual(restored,working);
  const recorded=timing.completeSetTiming(restored,'s','block','set',t+145000);
  assert.equal(recorded.duration_seconds,45);assert.equal(recorded.rest_before_seconds,100);
  assert.equal(timing.formatSeconds(145.99),'02:25');
  assert.equal(timing.formatSeconds(3600),'60:00');
  assert.equal(timing.readClock(JSON.stringify(working),'different',t+115000),null);
  assert.deepEqual(timing.cancelSetClock(working),changed);
  assert.equal(timing.cancelSetClock(timing.startSetClock(null,'s','block','db','set',t)),null);
});

test('missing starts and other sets never acquire invented durations; incomplete timing remains unknown', () => {
  const clock=timing.startSetClock(null,'s','a','db','set',1000);
  assert.deepEqual(timing.completeSetTiming(clock,'s','other','set',41000),{ended_at:new Date(41000).toISOString()});
  const unknown=timing.completeSetTiming(null,'s','a','set',41000);
  assert.equal(unknown.duration_seconds,undefined);
  assert.deepEqual(timing.measuredTime([{timing:unknown},{timing:{duration_seconds:40}},{timing:{duration_seconds:0}}]),{seconds:40,measured:2,total:3});
});

test('local finished history includes only recorded work, not untouched templates; pending entries keep source identifiers', () => {
  const entry=journal.finishedSession({exercises:{'block:db':{exerciseId:'db',setGroupId:'b',entryRules:weights.loadRulesOf(dumbbell),sets:[
    {id:'row1',requestId:'request',weight:'8',reps:'12',rest:'2',order:1,completed:true,timing:{duration_seconds:40}},
    {id:'row2',weight:'8',reps:'12',completed:false},
  ]}}},[dumbbell],'client','home',1000,3601000,90);
  assert.equal(entry.id,'client');assert.equal(entry.clientSessionId,'client');
  assert.equal(entry.exercises[0].sets.length,1);assert.equal(entry.exercises[0].sets[0].weight,16);
  assert.equal(entry.exercises[0].sets[0].timing.duration_seconds,40);
  assert.equal(journal.finishedSession({},[dumbbell],'client','home',1000,2000,90),null);
});

test('a partly acknowledged session keeps its complete local history until all pending work is acknowledged', () => {
  const local={id:'client',clientSessionId:'client',exercises:[{sets:[1,2,3]}]};
  const remote={id:'server',clientSessionId:'client',exercises:[{sets:[1]}]};
  assert.deepEqual(journal.reconcileFinished([local],[remote],[{data:{session_id:'client'}}]),{remaining:[local],history:[local]});
  assert.deepEqual(journal.reconcileFinished([local],[remote],[]),{remaining:[],history:[remote]});
});
