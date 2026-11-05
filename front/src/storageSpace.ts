/**
 * Место в localStorage делят очередь подходов, черновик тренировки и копии для
 * чтения. Когда место кончается, жертвовать надо копиями: их можно скачать заново,
 * а подход, не попавший в очередь, потерян. Порядок — от самого дешёвого.
 */

const READ_CACHE = 'gym_read_cache_v1:';
/** Старые общие копии: новые сборки их не читают, но прежние их писали. */
export const LEGACY_COPIES = ['gym_global_history_cache', 'gym_exercises_cache'];

type KeyedStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function keys(storage: KeyedStorage): string[] {
  const result: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key !== null) result.push(key);
  }
  return result;
}

/** Что можно стереть ради записи, в порядке очереди на удаление. */
export function evictableKeys(storage: KeyedStorage): string[] {
  const all = keys(storage);
  const cache = (suffix: RegExp) => all.filter(key => key.startsWith(READ_CACHE) && suffix.test(key));
  return [
    ...LEGACY_COPIES.filter(key => all.includes(key)),
    ...cache(/:analytics:\d+$/),
    ...cache(/:exercise:/),
    ...cache(/:journal$/),
  ];
}

export function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error) && !(typeof error === 'object' && error)) return false;
  const { name, code } = error as { name?: string; code?: number };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

/**
 * Запись, ради которой при нехватке места стираются копии для чтения — по одной,
 * пока запись не поместится. Не поместилась и без них — исключение, как раньше.
 */
export function setItemFreeingSpace(storage: KeyedStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
    return;
  } catch (error) {
    if (!isQuotaError(error)) throw error;
  }
  for (const victim of evictableKeys(storage)) {
    if (victim === key) continue;
    storage.removeItem(victim);
    try {
      storage.setItem(key, value);
      return;
    } catch (error) {
      if (!isQuotaError(error)) throw error;
    }
  }
  storage.setItem(key, value);
}

/** Стирает старые общие копии истории и каталога: у каждой есть копия владельца. */
export function removeLegacyCopies(storage: KeyedStorage, owner: string): void {
  for (const key of LEGACY_COPIES) storage.removeItem(key);
  // Старый список завершённых тренировок нужен, только пока нет списка владельца.
  if (owner && storage.getItem(`${READ_CACHE}${owner}:finished`) !== null) storage.removeItem('gym_finished_local');
}
