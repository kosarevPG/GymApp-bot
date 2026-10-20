import type { GlobalHistorySession } from './historyTypes';

export interface SyncedSession extends GlobalHistorySession { id: string; syncVersion?: string }
export function journalVersions(history: SyncedSession[]) {
  return Object.fromEntries(history.filter(row => typeof row.syncVersion === 'string').map(row => [row.id, row.syncVersion!]));
}

/** Versions travel inside each session, so a journal write is atomic with its versions. */
export function mergeJournalDelta<T extends SyncedSession>(cached: T[], response: any): T[] | null {
  if (response?.mode === 'full') return Array.isArray(response.history) ? response.history : null;
  if (response?.mode !== 'delta' || !response.manifest || typeof response.manifest !== 'object'
      || Array.isArray(response.manifest) || !Array.isArray(response.upserts) || !Array.isArray(response.changedIds)) return null;
  const changed = new Set(response.changedIds);
  for (const row of response.upserts) if (!row || typeof row.id !== 'string' || !Array.isArray(row.exercises)
    || typeof row.syncVersion !== 'string' || response.manifest[row.id] !== row.syncVersion || !changed.has(row.id)) return null;
  return [...cached.filter(row => Object.prototype.hasOwnProperty.call(response.manifest, row.id) && !changed.has(row.id)), ...response.upserts]
    .sort((a, b) => String(b.date).localeCompare(String(a.date))
      || String(b.started_at || '').localeCompare(String(a.started_at || '')) || a.id.localeCompare(b.id));
}
