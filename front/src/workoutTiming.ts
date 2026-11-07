import type { SetTiming } from './types';

export const WORKOUT_CLOCK_KEY = 'gym_workout_clock_v1';

export interface WorkoutClock {
  sessionId: string;
  kind: 'rest' | 'set';
  since: number;
  blockKey?: string;
  exerciseId?: string;
  setId?: string;
  restTargetSeconds?: number;
  restBeforeSeconds?: number;
  restSince?: number;
  betweenExercises?: boolean;
}

export function readClock(raw: string | null, sessionId: string, now = Date.now()): WorkoutClock | null {
  try {
    const value = JSON.parse(raw || 'null');
    return value?.sessionId === sessionId && ['rest', 'set'].includes(value.kind)
      && Number.isFinite(value.since) && value.since <= now ? value : null;
  } catch { return null; }
}

export function startSetClock(previous: WorkoutClock | null, sessionId: string, blockKey: string,
  exerciseId: string, setId: string, now = Date.now()): WorkoutClock {
  return { sessionId, kind: 'set', since: now, blockKey, exerciseId, setId,
    ...(previous?.sessionId === sessionId && previous.kind === 'rest'
      ? { restBeforeSeconds: Math.max(0, Math.round((now - previous.since) / 1000)), restSince: previous.since,
          restTargetSeconds: previous.restTargetSeconds, betweenExercises: previous.betweenExercises } : {}) };
}

export function cancelSetClock(clock: WorkoutClock | null): WorkoutClock | null {
  return clock?.kind === 'set' && clock.restSince !== undefined
    ? { sessionId: clock.sessionId, kind: 'rest', since: clock.restSince,
        restTargetSeconds: clock.restTargetSeconds, betweenExercises: clock.betweenExercises } : null;
}

export function completeSetTiming(clock: WorkoutClock | null, sessionId: string,
  blockKey: string, setId: string, now = Date.now()): SetTiming {
  const matches = clock?.sessionId === sessionId && clock.kind === 'set'
    && clock.blockKey === blockKey && clock.setId === setId;
  return { ended_at: new Date(now).toISOString(), ...(matches ? {
    started_at: new Date(clock.since).toISOString(),
    duration_seconds: Math.max(0, Math.round((now - clock.since) / 1000)),
    ...(clock.restBeforeSeconds !== undefined ? { rest_before_seconds: clock.restBeforeSeconds } : {}),
  } : {}) };
}

/**
 * Следующий подход. Суперсет идёт кругами: подход за упражнением, которое
 * сделало меньше всех (при равенстве — первое по порядку): А1 → Б1 → А2 → Б2.
 * Для одного упражнения это просто его первый невыполненный подход.
 */
export function nextInRound<T extends { completed?: boolean }>(blocks: { exId: string; sets: T[] }[]) {
  let next: { exId: string; set: T; done: number } | null = null;
  for (const block of blocks) {
    const set = block.sets.find(s => !s.completed);
    if (!set) continue;
    const done = block.sets.filter(s => s.completed).length;
    if (!next || done < next.done) next = { exId: block.exId, set, done };
  }
  return next;
}

/**
 * После галочки в суперсете: если в этом круге ещё есть упражнение, сразу
 * идёт его подход, без отдыха. Иначе круг закончен — начинается отдых.
 */
export function continueRound<T extends { id: string; completed?: boolean }>(blocks: { exId: string; sets: T[] }[],
  exId: string, setId: string) {
  if (blocks.length < 2) return null;
  const doneBefore = blocks.find(b => b.exId === exId)?.sets.filter(s => s.completed).length ?? 0;
  const next = nextInRound(blocks.map(b => b.exId === exId
    ? { ...b, sets: b.sets.map(s => s.id === setId ? { ...s, completed: true } : s) } : b));
  return next && next.exId !== exId && next.done <= doneBefore ? next : null;
}

export function nextRestClock(sessionId: string, restMinutes: number, now = Date.now()): WorkoutClock {
  return { sessionId, kind: 'rest', since: now, restTargetSeconds: Math.max(0, restMinutes * 60) };
}

/** Changing screens changes the context, never the origin of a rest interval. */
export function betweenExercises(clock: WorkoutClock | null): WorkoutClock | null {
  return clock?.kind === 'rest' ? { ...clock, betweenExercises: true } : clock;
}

export function formatSeconds(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function measuredTime(sets: { timing?: SetTiming }[]): { seconds: number; measured: number; total: number } {
  const recorded = sets.filter(s => Number.isFinite(s.timing?.duration_seconds));
  return { seconds: recorded.reduce((sum, s) => sum + s.timing!.duration_seconds!, 0), measured: recorded.length, total: sets.length };
}
