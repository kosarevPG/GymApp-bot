/**
 * Офлайн-очередь для gymtracker.
 * Сохраняет save_set, update_set с полными данными (set_type, rpe, rir, session_id).
 */

const QUEUE_KEY = 'gym_offline_queue';

export interface QueuedItem {
  id: string;
  type: 'saveSet' | 'updateSet';
  data: Record<string, unknown>;
}

export function addToQueue(type: 'saveSet' | 'updateSet', data: Record<string, unknown>): string {
  const id = crypto.randomUUID();
  const queue = getQueue();
  queue.push({ id, type, data });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return id;
}

export function getQueue(): QueuedItem[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function removeFromQueue(id: string): void {
  const queue = getQueue().filter((q) => q.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function clearQueue(): void {
  localStorage.setItem(QUEUE_KEY, '[]');
}
