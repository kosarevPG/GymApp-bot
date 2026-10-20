import { ACTIVE_WORKOUT_KEY } from './constants';
import { getPendingCount } from './offlineSync';

export const SHELL_UPDATE_EVENT = 'gym-shell-update';
let registration: ServiceWorkerRegistration | undefined;
let applying = false;
export const waitingShellUpdate = () => registration?.waiting || null;

export function registerOfflineShell() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' }).then(value => {
    registration = value;
    const changed = () => window.dispatchEvent(new Event(SHELL_UPDATE_EVENT));
    if (value.waiting) changed();
    value.addEventListener('updatefound', () => {
      const worker = value.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') changed(); });
    });
  }).catch(() => { /* An unavailable update must not stop a workout. */ });
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (applying) window.location.reload(); });
}
export function applyShellUpdate(canUpdate: boolean) {
  if (!canUpdate || !registration?.waiting || localStorage.getItem(ACTIVE_WORKOUT_KEY) || getPendingCount() > 0) return;
  applying = true;
  registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
}
