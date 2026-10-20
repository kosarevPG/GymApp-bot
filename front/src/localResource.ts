/** A shared persistent snapshot: rendering never waits for a network read. */
export interface LocalSnapshot<T> {
  data: T | null;
  updatedAt: number;
  refreshing: boolean;
  error: boolean;
  persisted: boolean;
}

export function createLocalResource<T>(options: {
  read: () => { data: T; updatedAt: number } | null;
  write: (value: { data: T; updatedAt: number }) => void;
  fetch: () => Promise<T | null>;
  online: () => boolean;
  valid: (value: unknown) => boolean;
  now?: () => number;
  ttl?: number;
}) {
  const now = options.now || Date.now;
  let saved: { data: T; updatedAt: number } | null = null;
  try { const value = options.read(); if (value && options.valid(value.data)) saved = value; } catch { /* Corrupt cache is replaceable. */ }
  let snapshot: LocalSnapshot<T> = { data: saved?.data ?? null, updatedAt: saved?.updatedAt || 0,
    refreshing: false, error: false, persisted: !!saved };
  const listeners = new Set<() => void>();
  let pending: Promise<T | null> | null = null;
  let revision = 0;
  let attemptedAt: number | null = null;
  const publish = (next: Partial<LocalSnapshot<T>>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach(listener => listener());
  };
  const store = (data: T, updatedAt: number) => {
    let persisted = true;
    try { options.write({ data, updatedAt }); } catch { persisted = false; }
    publish({ data, updatedAt, persisted, error: false });
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    observed: () => listeners.size > 0,
    update(change: (data: T | null) => T) { store(change(snapshot.data), snapshot.updatedAt); },
    invalidate() { revision++; attemptedAt = null; publish({ updatedAt: 0 }); },
    refresh(force = false): Promise<T | null> {
      if (pending) return pending;
      if (!options.online()) return Promise.resolve(snapshot.data);
      const fresh = snapshot.data !== null && snapshot.updatedAt > 0 && now() - snapshot.updatedAt < (options.ttl ?? 60_000);
      const coolingDown = attemptedAt !== null && now() - attemptedAt < 30_000;
      if (!force && (fresh || coolingDown)) return Promise.resolve(snapshot.data);
      publish({ refreshing: true });
      pending = Promise.resolve().then(async () => {
        // An acknowledgement arriving during a read invalidates that response.
        // Share one follow-up read instead of letting it erase newer local work.
        do {
          const startedRevision = revision;
          attemptedAt = now();
          let data: T | null = null;
          try { data = await options.fetch(); } catch { /* Keep the last good snapshot. */ }
          if (startedRevision !== revision) {
            if (options.online()) continue;
            break;
          }
          if (data !== null && options.valid(data)) store(data, now());
          else publish({ error: true });
          break;
        } while (options.online());
        return snapshot.data;
      }).finally(() => { pending = null; publish({ refreshing: false }); });
      return pending;
    },
  };
}
