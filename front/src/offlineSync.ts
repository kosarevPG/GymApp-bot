/**
 * Durable offline queue.
 *
 * A set is written here before any network request. The queue survives page
 * reloads and every item carries a stable client_request_id so retrying a
 * request cannot create duplicate rows in Supabase.
 */

const QUEUE_KEY = 'gym_offline_queue_v2';
const LEGACY_QUEUE_KEY = 'gym_offline_queue';
export const QUEUE_CHANGED_EVENT = 'gym-offline-queue-changed';

export type QueueItemType = 'saveSet' | 'updateSet';

export interface QueuedItem {
  id: string;
  type: QueueItemType;
  data: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

function withStablePerformedAt(
  data: Record<string, unknown>,
  fallback?: unknown
): Record<string, unknown> {
  const performedAt = data.performed_at || fallback || new Date().toISOString();
  return { ...data, performed_at: String(performedAt) };
}

function persist(queue: QueuedItem[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  window.dispatchEvent(
    new CustomEvent(QUEUE_CHANGED_EVENT, { detail: { pending: queue.length } })
  );
}

export function addToQueue(type: QueueItemType, data: Record<string, unknown>): string {
  const id = String(data.client_request_id || crypto.randomUUID());
  const queue = getQueue();
  if (!queue.some((item) => item.id === id)) {
    const stableData = withStablePerformedAt(data);
    queue.push({
      id,
      type,
      data: { ...stableData, client_request_id: id },
      createdAt: Date.now(),
      attempts: 0,
    });
    persist(queue);
  }
  return id;
}

export function getQueue(): QueuedItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    if (Array.isArray(value) && value.length > 0) {
      let changed = false;
      const normalized: QueuedItem[] = value.map((item) => {
        if (item?.data?.performed_at) return item;
        changed = true;
        const createdAt = Number(item?.createdAt) || Date.now();
        return {
          ...item,
          createdAt,
          data: withStablePerformedAt(item?.data || {}, new Date(createdAt).toISOString()),
        };
      });
      if (changed) persist(normalized);
      return normalized;
    }

    const legacy = JSON.parse(localStorage.getItem(LEGACY_QUEUE_KEY) || '[]');
    if (!Array.isArray(legacy) || legacy.length === 0) return [];
    const migrated: QueuedItem[] = legacy.map((item) => {
      const id = String(item?.id || crypto.randomUUID());
      const createdAt = Number(item?.createdAt) || Date.now();
      return {
        id,
        type: item?.type === 'updateSet' ? 'updateSet' : 'saveSet',
        data: {
          ...withStablePerformedAt(item?.data || {}, new Date(createdAt).toISOString()),
          client_request_id: id,
        },
        createdAt,
        attempts: 0,
      };
    });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(migrated));
    localStorage.removeItem(LEGACY_QUEUE_KEY);
    return migrated;
  } catch {
    return [];
  }
}

export function upsertQueue(type: QueueItemType, data: Record<string, unknown>): string {
  const id = String(data.client_request_id || crypto.randomUUID());
  const queue = getQueue();
  const existing = queue.find((item) => item.id === id);
  if (existing) {
    // Строка ещё не ушла на сервер: обновляем данные на месте. Если это был
    // saveSet, тип сохраняем — строки в таблице ещё нет, update её не найдёт.
    existing.data = {
      ...existing.data,
      ...data,
      performed_at: String(existing.data.performed_at || data.performed_at || new Date(existing.createdAt).toISOString()),
      client_request_id: id,
    };
    existing.attempts = 0;
    existing.lastError = undefined;
    persist(queue);
    return id;
  }
  const createdAt = Date.now();
  queue.push({
    id,
    type,
    data: {
      ...withStablePerformedAt(data, new Date(createdAt).toISOString()),
      client_request_id: id,
    },
    createdAt,
    attempts: 0,
  });
  persist(queue);
  return id;
}

export function getPendingCount(): number {
  return getQueue().length;
}

export function markAttempt(id: string, error?: string): void {
  const queue = getQueue().map((item) =>
    item.id === id
      ? { ...item, attempts: item.attempts + 1, lastError: error }
      : item
  );
  persist(queue);
}

export function removeFromQueue(id: string): void {
  persist(getQueue().filter((item) => item.id !== id));
}

export function clearQueue(): void {
  persist([]);
}
