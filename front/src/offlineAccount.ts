import { readLocalCache } from './cacheStorage';

export const OFFLINE_ACCOUNT_KEY = 'gym_offline_account_v1';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Chooses a local copy only. Every remote request still requires real API authentication. */
export function readOfflineOwner(storage: Store): string {
  try {
    const owner = JSON.parse(storage.getItem(OFFLINE_ACCOUNT_KEY) || 'null')?.owner;
    if (typeof owner !== 'string' || !/^supabase:[0-9a-f-]{36}$/i.test(owner)) return '';
    return readLocalCache(storage, owner, 'catalogue') || readLocalCache(storage, owner, 'journal') ? owner : '';
  } catch { return ''; }
}
export function rememberOfflineOwner(storage: Store, owner: string) {
  if (/^supabase:[0-9a-f-]{36}$/i.test(owner)) storage.setItem(OFFLINE_ACCOUNT_KEY, JSON.stringify({ owner }));
}
export function offlineAccessLocked(storage: Store): boolean {
  try { return JSON.parse(storage.getItem(OFFLINE_ACCOUNT_KEY) || 'null')?.signedOut === true; } catch { return false; }
}
export function forgetOfflineOwner(storage: Store) { storage.setItem(OFFLINE_ACCOUNT_KEY, JSON.stringify({ signedOut: true })); }
