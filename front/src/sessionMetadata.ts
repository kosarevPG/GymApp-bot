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
