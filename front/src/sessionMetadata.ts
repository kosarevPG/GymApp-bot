export type WorkoutLocation = 'gym' | 'home' | 'other';
export const LOCATION_LABELS: Record<WorkoutLocation, string> = {
  gym: '🏋️ Зал', home: '🏠 Дома', other: '📍 Другое',
};

export function pendingSessionMetadata<T extends { id: string }>(
  history: T[], queue: { type: string; data: Record<string, unknown> }[],
): T[] {
  return history.map(session => {
    const updates = queue.filter(item => item.type === 'updateSession' && item.data.session_id === session.id);
    return updates.reduce((row, item) => ({ ...row, location: item.data.location }), session);
  });
}

/** Timing corrections use the same durable queue and remain visible offline. */
export function pendingTimingEdits<T>(history: T[], queue: { type: string; data: Record<string, any> }[]): T[] {
  return pendingSetEdits(history, queue);
}

/** The durable queue overlays stale reads; cached results remain after an acknowledgement. */
export function pendingSetEdits<T>(history: T[], queue: { type: string; data: Record<string, any> }[]): T[] {
  return history.flatMap((raw: any) => {
    if (queue.some(item => item.type === 'deleteWorkout' && [raw.id, raw.clientSessionId].includes(item.data.session_id))) return [];
    let changed = false;
    const exercises = raw.exercises?.flatMap((ex: any) => {
      const sets = ex.sets?.flatMap((set: any) => {
        let row = { ...set };
        for (const item of queue) {
          const data = item.data;
          if (data.kind === 'cardio' || data.client_request_id !== set.id) continue;
          if (item.type === 'deleteSet') { changed = true; return []; }
          if (!['saveSet', 'updateSet'].includes(item.type)) continue;
          changed = true;
          for (const key of ['input_weight', 'weight', 'reps', 'rest', 'load', 'set_type', 'rpe', 'rir'])
            if (Object.prototype.hasOwnProperty.call(data, key)) row[key] = data[key];
          if (Object.prototype.hasOwnProperty.call(data, 'timing')) row.timing = data.timing ?? undefined;
        }
        return [row];
      });
      return sets?.length === 0 && (ex.sets?.length || 0) > 0 && !ex.cardio?.length ? [] : [{ ...ex, sets }];
    });
    if (changed && exercises?.length === 0) return [];
    const duration = changed && raw.duration_source === 'estimated'
      ? `${exercises.reduce((n: number, ex: any) => n + (ex.sets?.length || 0) * 2, 0)
          + Math.round(exercises.reduce((n: number, ex: any) => n + (ex.cardio || []).reduce((v: number, row: any) => v + Number(row.minutes || 0), 0), 0))}м`
      : raw.duration;
    return [{ ...raw, exercises, ...(changed ? { pendingChanges: true, duration } : { pendingChanges: false }) }];
  });
}
