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
  const updates = queue.filter(q => ['saveSet', 'updateSet'].includes(q.type) && Object.prototype.hasOwnProperty.call(q.data, 'timing'));
  return history.map((raw: any) => ({ ...raw, exercises: raw.exercises?.map((ex: any) => ({ ...ex,
    sets: ex.sets?.map((set: any) => updates.reduce((row, q) => q.data.client_request_id === set.id
      ? { ...row, timing: q.data.timing ?? undefined } : row, set)) })) }));
}
