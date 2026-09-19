/**
 * Durable offline queue.
 *
 * A set is written here before any network request. The queue survives page
 * reloads and every item carries a stable client_request_id so retrying a
 * request cannot create duplicate rows in Supabase.
 *
 * Items are sent one at a time by a single runner. Every local change to an
 * item bumps its rev, and a server answer acknowledges only the rev that was
 * sent: an edit made while the request was in flight stays in the queue and
 * goes out next instead of being dropped together with the acknowledged item.
 *
 * A deletion is queued the same way and goes out after whatever request for
 * that set is already on the wire, so a late save cannot bring the row back.
 */

const QUEUE_KEY = 'gym_offline_queue_v2';
const LEGACY_QUEUE_KEY = 'gym_offline_queue';
export const QUEUE_CHANGED_EVENT = 'gym-offline-queue-changed';

export type QueueItemType = 'saveSet' | 'updateSet' | 'deleteSet';

export interface QueuedItem {
  id: string;
  type: QueueItemType;
  data: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  lastError?: string;
  /** Сервер отклонил элемент по существу; сетевые сбои сюда не относятся. */
  rejected?: boolean;
  /**
   * Запрос уходил в сеть хотя бы раз. Пишется до отправки: если приложение
   * убили посреди запроса, строка на сервере могла появиться без ответа.
   */
  sent?: boolean;
  /** Номер локальной версии данных; растёт при каждой правке элемента. */
  rev: number;
}

/**
 * Итог одной отправки. stop=true — сеть, сервер или авторизация: проход
 * прерывается, чтобы не перепрыгивать через неотправленные подходы. stop=false —
 * сервер отклонил именно этот элемент, остальные можно отправлять дальше.
 */
export type SendOutcome =
  | { ok: true }
  | { ok: false; error: string; stop: boolean };

let inFlightId: string | null = null;
let running: Promise<void> | null = null;
let rerunRequested = false;

function withStablePerformedAt(
  data: Record<string, unknown>,
  fallback?: unknown
): Record<string, unknown> {
  const performedAt = data.performed_at || fallback || new Date().toISOString();
  return { ...data, performed_at: String(performedAt) };
}

function notifyChanged(pending: number): void {
  window.dispatchEvent(
    new CustomEvent(QUEUE_CHANGED_EVENT, { detail: { pending, inFlight: inFlightId } })
  );
}

function persist(queue: QueuedItem[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  notifyChanged(queue.length);
}

function setInFlight(id: string | null): void {
  inFlightId = id;
  notifyChanged(getQueue().length);
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
      rev: 0,
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
        const rev = Number(item?.rev) || 0;
        if (item?.data?.performed_at) return { ...item, rev };
        changed = true;
        const createdAt = Number(item?.createdAt) || Date.now();
        return {
          ...item,
          createdAt,
          rev,
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
        rev: 0,
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
  // Удалённый подход не правят: правка воскресила бы то, что удаление убирает.
  if (existing?.type === 'deleteSet') return id;
  if (existing) {
    // Строка ещё не подтверждена сервером: обновляем данные на месте. Если это
    // был saveSet, тип сохраняем — строки в таблице может ещё не быть, update
    // её не найдёт. Новая версия не даст ответу на старый запрос убрать правку.
    existing.data = {
      ...existing.data,
      ...data,
      performed_at: String(existing.data.performed_at || data.performed_at || new Date(existing.createdAt).toISOString()),
      client_request_id: id,
    };
    existing.attempts = 0;
    existing.lastError = undefined;
    existing.rejected = false;
    existing.rev += 1;
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
    rev: 0,
  });
  persist(queue);
  return id;
}

/**
 * Ставит в очередь удаление подхода. Подход, который ни разу не уходил на
 * сервер, просто исчезает из очереди. Иначе элемент становится удалением:
 * оно уйдёт после запроса, который по этому подходу уже в пути, а ответ на
 * тот запрос удаление не снимет. Бросает исключение, если localStorage
 * запись не принял.
 */
export function enqueueDelete(data: Record<string, unknown>): string {
  const id = String(data.client_request_id || '');
  if (!id) throw new Error('client_request_id is required to delete a set');
  const queue = getQueue();
  const existing = queue.find((item) => item.id === id);
  if (existing?.type === 'saveSet' && !existing.sent && inFlightId !== id) {
    persist(queue.filter((item) => item.id !== id));
    return id;
  }
  if (existing) {
    existing.type = 'deleteSet';
    existing.data = { ...existing.data, ...data, client_request_id: id };
    existing.attempts = 0;
    existing.lastError = undefined;
    existing.rejected = false;
    existing.rev += 1;
    persist(queue);
    return id;
  }
  queue.push({
    id,
    type: 'deleteSet',
    data: { ...data, client_request_id: id },
    createdAt: Date.now(),
    attempts: 0,
    rev: 0,
  });
  persist(queue);
  return id;
}

export function getPendingCount(): number {
  return getQueue().length;
}

/** Id элемента, запрос по которому сейчас в сети, либо null. */
export function getInFlightId(): string | null {
  return inFlightId;
}

export function markAttempt(id: string, error?: string, rejected = false): void {
  const queue = getQueue().map((item) =>
    item.id === id
      ? { ...item, attempts: item.attempts + 1, lastError: error, rejected }
      : item
  );
  persist(queue);
}

export function removeFromQueue(id: string): void {
  persist(getQueue().filter((item) => item.id !== id));
}

/**
 * Убирает элемент, пока его запрос не отправлен. Отправленный уже не отозвать:
 * сервер может записать его и после тайм-аута, поэтому такой элемент не
 * трогаем и возвращаем false.
 */
export function discardQueued(id: string): boolean {
  if (inFlightId === id) return false;
  removeFromQueue(id);
  return true;
}

export function clearQueue(): void {
  persist([]);
}

/**
 * Сервер подтвердил версию sentRev. Если с тех пор элемент не меняли, он
 * отправлен целиком. Иначе строка уже есть в таблице, а свежие данные ещё нет —
 * элемент остаётся правкой. Возвращает true, если элемент остался в очереди.
 */
function acknowledge(id: string, sentRev: number): boolean {
  const queue = getQueue();
  const item = queue.find((entry) => entry.id === id);
  if (!item) return false;
  if (item.rev === sentRev) {
    persist(queue.filter((entry) => entry.id !== id));
    return false;
  }
  // Сохранённая строка с более свежими данными — это правка. Удаление так и
  // остаётся удалением.
  if (item.type === 'saveSet') item.type = 'updateSet';
  item.attempts = 0;
  item.lastError = undefined;
  item.rejected = false;
  persist(queue);
  return true;
}

/** Один проход по очереди. Возвращает true, если проход прерван. */
async function runPass(send: (item: QueuedItem) => Promise<SendOutcome>): Promise<boolean> {
  for (const { id } of getQueue()) {
    // Данные читаем заново перед каждой отправкой: пока шёл предыдущий
    // запрос, элемент могли поправить или удалить.
    const queue = getQueue();
    const item = queue.find((entry) => entry.id === id);
    if (!item) continue;
    if (!item.sent) {
      item.sent = true;
      persist(queue);
    }
    setInFlight(id);
    let outcome: SendOutcome;
    try {
      outcome = await send(item);
    } catch (error) {
      outcome = { ok: false, error: error instanceof Error ? error.message : 'network', stop: true };
    } finally {
      setInFlight(null);
    }
    if (outcome.ok) {
      if (acknowledge(id, item.rev)) rerunRequested = true;
      continue;
    }
    markAttempt(id, outcome.error, !outcome.stop);
    if (outcome.stop) return true;
  }
  return false;
}

/**
 * Отправляет очередь по одному элементу. Вызов во время идущей отправки не
 * теряется: текущий прогон сделает ещё один проход и заберёт новые подходы,
 * а не оставит их ждать следующего таймера.
 */
export function syncQueue(send: (item: QueuedItem) => Promise<SendOutcome>): Promise<void> {
  if (running) {
    rerunRequested = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        rerunRequested = false;
        if (await runPass(send)) break;
      } while (rerunRequested);
    } finally {
      running = null;
    }
  })();
  return running;
}
