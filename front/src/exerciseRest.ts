export interface ExerciseRest {
  startedAt: number;
  sessionId: string;
}

export function readExerciseRest(raw: string | null, sessionId: string, now = Date.now()): ExerciseRest | null {
  try {
    const rest = JSON.parse(raw || 'null');
    return rest?.sessionId === sessionId && Number.isFinite(rest.startedAt)
      && rest.startedAt <= now && now - rest.startedAt < 14_400_000 ? rest : null;
  } catch { return null; }
}

export const formatRestTime = (milliseconds: number): string => {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
