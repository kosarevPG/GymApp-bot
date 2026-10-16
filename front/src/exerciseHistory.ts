import type { CardioHistoryItem, HistoryItem } from './types';
import type { GlobalHistorySession } from './historyTypes';

export interface ExerciseHistory {
  history: HistoryItem[];
  cardio: CardioHistoryItem[];
  note: string;
}

/** Both the legacy flat response and the grouped API response remain readable. */
export function decodeHistory(raw: any): ExerciseHistory {
  const rows = Array.isArray(raw?.history) ? raw.history : [];
  return {
    history: rows.flatMap((day: any) => Array.isArray(day?.sets)
      ? day.sets.map((set: any) => ({ ...set, date: day.date, session_id: day.session_id }))
      : day?.date && !Array.isArray(day.cardio) ? [day] : []),
    cardio: rows.flatMap((day: any) => Array.isArray(day?.cardio)
      ? day.cardio.map((segment: any) => ({ ...segment, date: day.date, session_id: day.session_id })) : []),
    note: typeof raw?.note === 'string' ? raw.note : '',
  };
}

/** One background journal fetch prepares templates for the entire catalogue. */
export function historyFromJournal(exerciseId: string, journal: GlobalHistorySession[]): ExerciseHistory {
  return decodeHistory({ history: journal.flatMap(session => (session.exercises || [])
    .filter(exercise => exercise.exerciseId === exerciseId)
    .map(exercise => ({ ...exercise, date: session.date, session_id: session.id }))) });
}

export function createHistoryLoader(options: {
  read: (id: string) => ExerciseHistory;
  fetch: (id: string) => Promise<any>;
  write: (id: string, raw: any) => void;
  online: () => boolean;
}) {
  const pending = new Map<string, Promise<ExerciseHistory>>();
  return {
    peek: options.read,
    refresh(id: string): Promise<ExerciseHistory> {
      if (!options.online()) return Promise.resolve(options.read(id));
      const existing = pending.get(id);
      if (existing) return existing;
      const request = Promise.resolve().then(() => options.fetch(id)).then(raw => {
        if (raw) options.write(id, raw);
        return raw ? decodeHistory(raw) : options.read(id);
      }).catch(() => options.read(id)).finally(() => pending.delete(id));
      pending.set(id, request);
      return request;
    },
  };
}
