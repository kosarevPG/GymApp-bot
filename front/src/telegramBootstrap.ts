/** Standalone cold starts never wait for a third-party Telegram script. */
export async function prepareTelegram() {
  if ((window as any).Telegram?.WebApp?.initData) return;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const initData = params.get('tgWebAppData') || query.get('tgWebAppData');
  if (!initData) return;
  // The signed launch data survives an unavailable SDK. The API verifies its signature.
  const signed = new URLSearchParams(initData);
  let user; try { user = JSON.parse(signed.get('user') || 'null'); } catch { /* Malformed launch is rejected by the API. */ }
  (window as any).Telegram = { WebApp: { initData, initDataUnsafe: { user, start_param: signed.get('start_param') || '' }, ready() {}, expand() {} } };
  if (!navigator.onLine) return;
  await new Promise<void>(resolve => {
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-web-app.js'; script.async = true;
    const done = () => { window.clearTimeout(timer); resolve(); };
    const timer = window.setTimeout(done, 1500);
    script.onload = done; script.onerror = done; document.head.appendChild(script);
  });
}
