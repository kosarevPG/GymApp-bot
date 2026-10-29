/* Generated at build time. Only the public app shell is cached here. */
const BASE = "/GymApp-bot/";
const PREFIX = `gymapp-shell:${BASE}:`;
const CACHE = PREFIX + "4ceeb15b78edaffad9c6";
const URLS = ["/GymApp-bot/","/GymApp-bot/assets/AnalyticsVolumeChart-DrliPBFP.js","/GymApp-bot/assets/App-CBGh7QDW.js","/GymApp-bot/assets/index-BhhQkvBR.css","/GymApp-bot/assets/index-CdCqxk5f.js","/GymApp-bot/icons/zal-180.png","/GymApp-bot/icons/zal-192.png","/GymApp-bot/icons/zal-512.png","/GymApp-bot/index.html","/GymApp-bot/manifest.json"];
const PUBLIC_PATHS = new Set(URLS);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await cache.addAll(URLS.map(url => new Request(url, { cache: 'reload', credentials: 'same-origin' })));
    } catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)
    || url.searchParams.has('url') || request.headers.has('Authorization')) return;
  const navigation = request.mode === 'navigate';
  if (!navigation && !PUBLIC_PATHS.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(navigation ? BASE : url.pathname) || fetch(request);
  })());
});
