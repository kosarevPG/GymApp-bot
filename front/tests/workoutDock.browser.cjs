// Loopback-only integration checks: all writes stay in the MemoryClient fixture.
const { chromium } = require(process.env.GYMAPP_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SITE = process.env.GYMAPP_TEST_SITE || 'http://127.0.0.1:5174/GymApp-bot/';
const FIXTURE = 'http://127.0.0.1:8766';
const OUTPUT = process.env.GYMAPP_TEST_OUTPUT || path.resolve('test-results/workout-dock');
assert.equal(new URL(SITE).hostname, '127.0.0.1');
fs.mkdirSync(OUTPUT, { recursive: true });
const until = async fn => {
  for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); }
  assert.fail('Condition timed out');
};
(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }],
      ['mobile', { width: 390, height: 844 }], ['compact', { width: 320, height: 720 }]]) {
      await fetch(FIXTURE + '/__reset', { method: 'POST' });
      const ctx = await browser.newContext({ viewport, isMobile: name !== 'desktop', hasTouch: name !== 'desktop' });
      await ctx.addInitScript(() => {
        window.Telegram = { WebApp: { initData: 'fixture-only', initDataUnsafe: {}, ready() {}, expand() {} } };
        Object.defineProperty(navigator, 'onLine', { get: () => !localStorage.getItem('__dock_offline'), configurable: true });
      });
      await ctx.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), endpoint = url.searchParams.get('url');
        if (endpoint?.startsWith('/api/')) {
          if (await route.request().frame().evaluate(() => !!localStorage.getItem('__dock_offline'))) return route.abort();
          const response = await fetch(FIXTURE + '/?' + new URLSearchParams({ url: endpoint }), {
            method: request.method(), headers: { 'Content-Type': 'application/json' },
            ...(request.postData() ? { body: request.postData() } : {}),
          });
          return route.fulfill({ status: response.status, body: await response.text(), contentType: 'application/json' });
        }
        if (url.hostname === '127.0.0.1') return route.continue();
        return route.abort('blockedbyclient');
      });
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(SITE);
      await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click();
      await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
      await page.getByText('Беговая дорожка', { exact: true }).click();
      const dock = () => page.getByLabel('Управление подходом', { exact: true });
      const action = label => dock().getByRole('button', { name: label, exact: true });
      const queue = () => page.evaluate(() => JSON.parse(localStorage.getItem('gym_offline_queue_v2') || '[]'));
      const clock = () => page.evaluate(() => JSON.parse(localStorage.getItem('gym_workout_clock_v1')));
      await action('Начать подход').waitFor();
      await page.getByLabel('Длительность кардио в минутах').fill('10');
      await page.getByLabel('Скорость кардио в км/ч').fill('5');
      const startBox = await action('Начать подход').boundingBox();
      await action('Начать подход').click();
      await page.getByRole('timer', { name: 'Кардио идёт', exact: true }).waitFor();
      assert.equal((await clock()).kind, 'set');
      const completeBox = await action('Подход выполнен').boundingBox();
      assert.equal(completeBox.y, startBox.y, 'start and finish stay under the same finger');
      const navBox = await page.getByRole('navigation', { name: 'Основная навигация' }).boundingBox();
      assert.ok(completeBox.height >= 56 && completeBox.y + completeBox.height <= navBox.y);
      // Backdate only the local test clock, then reload: no real waiting or production writes.
      await page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('gym_workout_clock_v1'));
        saved.since = Date.now() - 65000;
        localStorage.setItem('gym_workout_clock_v1', JSON.stringify(saved));
        localStorage.setItem('__dock_offline', '1');
      });
      const since = (await clock()).since;
      await page.reload();
      await action('Подход выполнен').waitFor();
      assert.equal((await clock()).since, since, 'cardio start survives reload offline');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      assert.equal((await action('Подход выполнен').boundingBox()).y, completeBox.y);
      await page.screenshot({ path: path.join(OUTPUT, `${name}-cardio-running.png`), fullPage: true });
      await action('Подход выполнен').click();
      await action('Завершить и перейти дальше').waitFor();
      const items = (await queue()).filter(q => q.data.kind === 'cardio');
      assert.equal(items.length, 1);
      assert.ok(items[0].data.duration_seconds >= 65 && items[0].data.duration_seconds <= 85);
      assert.equal(items[0].data.speed_kmh, 5);
      assert.equal((await clock()).kind, 'rest');
      assert.equal((await action('Завершить и перейти дальше').boundingBox()).y, startBox.y);
      // Explicitly entered minutes still work without marking a start.
      await page.getByRole('button', { name: 'Отрезок', exact: true }).click();
      await page.getByLabel('Длительность кардио в минутах').last().fill('7');
      const restSince = (await clock()).since;
      await action('Начать подход').click();
      await dock().getByRole('button', { name: 'Отменить замер' }).click();
      assert.equal((await clock()).since, restSince, 'cancel restores original rest');
      await page.getByRole('button', { name: 'Отметить кардиоотрезок выполненным', exact: true }).click();
      assert.equal((await queue()).filter(q => q.data.kind === 'cardio').length, 2);
      assert.equal((await queue()).find(q => q.data.kind === 'cardio' && q.data.duration_seconds === 420).data.speed_kmh, 5);
      await action('Завершить и перейти дальше').click();
      await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
      await page.getByText('Жим штанги', { exact: true }).click();
      await action('Начать подход').waitFor();
      const strengthBox = await action('Начать подход').boundingBox();
      await action('Начать подход').click();
      assert.equal((await action('Подход выполнен').boundingBox()).y, strengthBox.y);
      await action('Подход выполнен').click();
      await action('Завершить и перейти дальше').waitFor();
      await page.getByRole('button', { name: 'Подход', exact: true }).click();
      await action('Начать подход').waitFor();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      assert.equal((await action('Начать подход').boundingBox()).y, strengthBox.y);
      // Bottom content is scrollable above the dock instead of being hidden behind it.
      const last = await page.getByRole('button', { name: 'Пропустить оставшееся', exact: true }).boundingBox();
      const dockBox = await dock().boundingBox();
      assert.ok(last.y + last.height <= dockBox.y);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(OUTPUT, `${name}-strength-dock.png`), fullPage: true });
      // Flush queued cardio through the real Python adapter backed by MemoryClient.
      await page.evaluate(() => { localStorage.removeItem('__dock_offline'); window.dispatchEvent(new Event('online')); });
      await until(async () => (await queue()).length === 0);
      const state = await (await fetch(FIXTURE + '/__state')).json();
      assert.equal(state.gym_cardio_segments.length, 2);
      assert.ok(state.gym_cardio_segments.some(r => r.duration_seconds === 420));
      assert.ok(state.gym_cardio_segments.some(r => r.duration_seconds >= 65 && r.duration_seconds <= 85));
      assert.deepEqual(errors, []);
      results.push({ viewport: name, cardioStart: true, fixedPrimary: true, reload: true, cancel: true, manualDuration: true, offlineQueue: true, memoryStore: true });
      await ctx.close();
    }
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
