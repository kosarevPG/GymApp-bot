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
