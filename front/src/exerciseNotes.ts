/**
 * Two notes with different lifetimes.
 *
 * Техника belongs to the exercise and stays until it is edited. Сегодня belongs
 * to one workout: it is stored on that workout's sets, a new workout starts
 * empty, and the previous text is only ever shown as history with its date.
 */
export interface NotedSet {
  session_id?: string;
  date?: string;
  note?: string | null;
  order?: number;
}

/** Sets finished at different moments can differ; each text appears once. */
export function joinNotes(sets: NotedSet[]): string {
  const ordered = [...sets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const texts = ordered.map(set => String(set.note ?? '').trim()).filter(Boolean);
  return [...new Set(texts)].join(' · ');
}

/** `2026.10.28` and `2026-10-28` both read as `28.10`. */
export function shortNoteDate(date: unknown): string {
  const text = String(date ?? '');
  return /^\d{4}[.-]\d{2}[.-]\d{2}/.test(text) ? `${text.slice(8, 10)}.${text.slice(5, 7)}` : text;
}

/**
 * The note of the previous workout with this exercise, and only that one: an
 * older note is not shown once a later workout passed without one.
 */
export function lastSessionNote(
  history: NotedSet[] | null | undefined,
  currentSessionId?: string,
): { date: string; text: string } | null {
  const past = (Array.isArray(history) ? history : [])
    .filter(set => set?.date && !(currentSessionId && set.session_id === currentSessionId));
  if (!past.length) return null;
  const latest = past.reduce((best, set) => (String(set.date) > String(best.date) ? set : best));
  const sets = past.filter(set => (latest.session_id ? set.session_id === latest.session_id : set.date === latest.date));
  const text = joinNotes(sets);
  return text ? { date: shortNoteDate(latest.date), text } : null;
}

/** What to send when the note changes: only sets the server can already hold. */
export function noteUpdates(
  sets: { completed?: boolean; requestId?: string; order?: number }[],
  note: string,
  context: Record<string, unknown> = {},
) {
  return sets
    .filter(set => set.completed && set.requestId)
    .map(set => ({ ...context, client_request_id: set.requestId, order: set.order, note }));
}
