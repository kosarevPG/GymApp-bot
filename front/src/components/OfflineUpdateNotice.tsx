import { useSyncExternalStore } from 'react';
import { applyShellUpdate, SHELL_UPDATE_EVENT, waitingShellUpdate } from '../offlineShell';

const subscribe = (changed: () => void) => {
  window.addEventListener(SHELL_UPDATE_EVENT, changed);
  return () => window.removeEventListener(SHELL_UPDATE_EVENT, changed);
};
export function OfflineUpdateNotice({ workoutActive, pendingCount }: { workoutActive: boolean; pendingCount: number }) {
  const waiting = useSyncExternalStore(subscribe, waitingShellUpdate);
  if (!waiting) return null;
  const ready = !workoutActive && pendingCount === 0;
  return <div role="status" className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-zinc-300">
    <p>{ready ? 'Доступна новая версия приложения.' : workoutActive ? 'Новая версия готова. Можно обновить после тренировки.' : 'Новая версия готова. Дождитесь отправки результатов.'}</p>
    <button type="button" disabled={!ready} onClick={() => applyShellUpdate(ready)} className="min-h-11 rounded-xl bg-zinc-800 px-4 text-zinc-100 hover:bg-zinc-700 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">Обновить приложение</button>
  </div>;
}
