import { useSyncExternalStore } from 'react';
import { RefreshCw } from 'lucide-react';
import type { LocalSnapshot } from '../localResource';

const subscribeNetwork = (changed: () => void) => {
  window.addEventListener('online', changed); window.addEventListener('offline', changed);
  return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); };
};
export function LocalDataStatus({ snapshot, onRefresh, label = 'История' }: {
  snapshot: LocalSnapshot<unknown>; onRefresh: () => void; label?: string;
}) {
  const online = useSyncExternalStore(subscribeNetwork, () => navigator.onLine);
  const saved = snapshot.data !== null;
  const updated = snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
  }) : '';
  const text = saved
    ? !snapshot.persisted ? 'Не удалось сохранить копию на устройстве'
      : !online ? `${label} на устройстве · без сети`
      : snapshot.error ? `${label} на устройстве · обновить не удалось`
      : snapshot.refreshing ? `${label} на устройстве · обновляется`
      : `${label} на устройстве${updated ? ` · ${updated}` : ''}`
    : !online ? 'Сохранённой копии пока нет. Подключитесь к интернету.'
      : snapshot.error ? 'Не удалось загрузить данные. Попробуйте обновить.' : 'Загружаю данные впервые…';
  return <div className="flex items-center justify-between gap-3 text-sm text-zinc-400">
    <p role="status" className="min-w-0">{text}</p>
    <button aria-label={`Обновить: ${label.toLowerCase()}`} title="Обновить данные" disabled={snapshot.refreshing || !online}
      onClick={onRefresh} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
      <RefreshCw className={`h-4 w-4 ${snapshot.refreshing ? 'animate-spin' : ''}`} />
    </button>
  </div>;
}
