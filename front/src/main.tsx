import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { prepareTelegram } from './telegramBootstrap';
import { registerOfflineShell } from './offlineShell';

void prepareTelegram().then(async () => {
  const { default: App } = await import('./App');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  registerOfflineShell();
}).catch(() => {
  const root = document.getElementById('root')!;
  root.className = 'min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-zinc-100';
  const message = document.createElement('p'); message.textContent = 'Не удалось открыть приложение. Попробуйте ещё раз.';
  const retry = document.createElement('button'); retry.textContent = 'Открыть снова';
  retry.className = 'min-h-12 rounded-xl bg-blue-600 px-6 text-white'; retry.onclick = () => window.location.reload();
  root.replaceChildren(message, retry);
});
