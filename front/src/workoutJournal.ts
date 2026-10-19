import type { Exercise, WorkoutSet } from './types';
import { calcEffectiveWeight, loadRulesOf, rulesAsExercise } from './exerciseConfig';

/** Keep the full local result while only part of its queue has reached the server. */
export function reconcileFinished(local: any[], remote: any[], queue: { data: Record<string, unknown> }[]) {
  const same = (a: any, b: any) => a.id === b.id || (a.clientSessionId && a.clientSessionId === b.clientSessionId);
  const remaining = local.filter(s => queue.some(q => q.data.session_id === s.clientSessionId)
    || !remote.some(r => same(s, r)));
  return { remaining, history: [...remaining, ...remote.filter(r => !remaining.some(s => same(s, r)))] };
}

/** A local history entry exists only for work that was actually recorded. */
export function finishedSession(draft: any, catalogue: Exercise[], sessionId: string, location: string | null,
  startedAt: number, endedAt: number, bodyWeight: number) {
  const blocks = Object.entries(draft?.exercises || {}) as [string, any][];
  const groupCounts = new Map<string, number>();
  blocks.forEach(([, b]) => groupCounts.set(b.setGroupId, (groupCounts.get(b.setGroupId) || 0) + 1));
  const exercises = blocks.flatMap(([key, block]) => {
    const id = block.exerciseId || key;
    const ex = catalogue.find(e => e.id === id);
    const completed: WorkoutSet[] = (block.sets || []).filter((s: WorkoutSet) => s.completed);
    if (!ex || !completed.length) return [];
    const rules = block.entryRules || loadRulesOf(ex, bodyWeight);
    const rows = completed.map(s => ({ id: s.requestId, input_weight: Number(s.weight || 0),
      weight: calcEffectiveWeight(rulesAsExercise(s.load || rules), Number(s.weight || 0), bodyWeight),
      reps: Number(s.reps), rest: Number(s.rest || 0), set_type: s.setType || 'working', order: s.order || 0,
      load: s.load || rules, timing: s.timing, rpe: s.rpe, rir: s.rir, setGroupId: block.setGroupId }));
    return [{ exerciseId: id, name: ex.name, supersetId: (groupCounts.get(block.setGroupId) || 0) > 1 ? block.setGroupId : null,
      sets: ex.measure === 'cardio' ? [] : rows,
      ...(ex.measure === 'cardio' ? { cardio: completed.map(s => ({ minutes: Number(s.minutes), speed: s.speed ? Number(s.speed) : undefined,
        incline: s.incline ? Number(s.incline) : undefined, order: s.order || 0 })) } : {}) }];
  });
  if (!exercises.length) return null;
  exercises.sort((a, b) => Math.min(...[...a.sets, ...(a.cardio || [])].map(s => s.order))
    - Math.min(...[...b.sets, ...(b.cardio || [])].map(s => s.order)));
  return { id: sessionId, clientSessionId: sessionId, pendingLocal: true, location,
    date: new Date(startedAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }).replace(/-/g, '.'),
    muscleGroups: [...new Set(exercises.map(e => catalogue.find(c => c.id === e.exerciseId)?.muscleGroup).filter(Boolean))],
    duration: `${Math.max(0, Math.round((endedAt - startedAt) / 60000))}м`, exercises };
}
