/**
 * Durable offline queue.
 *
 * A set is written here before any network request. The queue survives page
 * reloads and every item carries a stable client_request_id so retrying a
 * request cannot create duplicate rows in Google Sheets.
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
    queue.push({
      id,
      type,
      data: { ...data, client_request_id: id },
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
    if (Array.isArray(value) && value.length > 0) return value;

    const legacy = JSON.parse(localStorage.getItem(LEGACY_QUEUE_KEY) || '[]');
    if (!Array.isArray(legacy) || legacy.length === 0) return [];
    const migrated: QueuedItem[] = legacy.map((item) => {
      const id = String(item?.id || crypto.randomUUID());
      return {
        id,
        type: item?.type === 'updateSet' ? 'updateSet' : 'saveSet',
        data: { ...(item?.data || {}), client_request_id: id },
        createdAt: Date.now(),
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
