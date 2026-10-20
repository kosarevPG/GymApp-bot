/** Account-scoped read caches; the durable workout queue is stored separately. */
export const localCacheKey = (owner: string, name: string) => `gym_read_cache_v1:${owner}:${name}`;

export function readLocalCache<T>(storage: Pick<Storage, 'getItem'>, owner: string, name: string) {
  if (!owner) return null;
  try {
    const saved = JSON.parse(storage.getItem(localCacheKey(owner, name)) || 'null');
    return saved?.owner === owner && Number.isFinite(saved.updatedAt)
      ? { data: saved.data as T, updatedAt: saved.updatedAt as number } : null;
  } catch { return null; }
}

export function writeLocalCache<T>(storage: Pick<Storage, 'setItem'>, owner: string, name: string,
  saved: { data: T; updatedAt: number }) {
  if (!owner) throw new Error('Cache owner is not known');
  storage.setItem(localCacheKey(owner, name), JSON.stringify({ owner, ...saved }));
}
