// MemoryClient only; public smoke mode permits static GETs and redirects every API call.
const { chromium } = require(process.env.GYMAPP_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const SITE = process.env.GYMAPP_TEST_SITE || 'http://127.0.0.1:5174/GymApp-bot/';
const FIXTURE = 'http://127.0.0.1:8766';
const OUTPUT = process.env.GYMAPP_TEST_OUTPUT || path.resolve('test-results/top-notice');
assert.ok(new URL(SITE).hostname === '127.0.0.1' || (process.env.GYMAPP_PUBLIC_SMOKE === '1' && SITE === 'https://kosarevpg.github.io/GymApp-bot/'));
fs.mkdirSync(OUTPUT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true }), results = [];
  try {
    for (const [name, viewport, safeTop] of [['desktop', { width: 1280, height: 900 }, 0], ['iphone', { width: 393, height: 852 }, 59], ['compact', { width: 320, height: 720 }, 20], ['telegram', { width: 390, height: 844 }, 0]]) {
      await fetch(FIXTURE + '/__reset', { method: 'POST' });
      const ctx = await browser.newContext({ viewport, isMobile: name !== 'desktop', hasTouch: name !== 'desktop', serviceWorkers: 'block' });
      await ctx.addInitScript(() => { window.Telegram = { WebApp: { initData: 'fixture-only', initDataUnsafe: {}, ready() {}, expand() {} } }; });
      await ctx.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url()), endpoint = url.searchParams.get('url');
        if (endpoint?.startsWith('/api/')) {
          const response = await fetch(FIXTURE + '/?' + new URLSearchParams({ url: endpoint }), { method: req.method(), headers: { 'Content-Type': 'application/json' }, ...(req.postData() ? { body: req.postData() } : {}) });
          return route.fulfill({ status: response.status, body: await response.text(), contentType: 'application/json' });
        }
        if (req.method() === 'GET' && url.origin === new URL(SITE).origin) return route.continue();
        return route.abort('blockedbyclient');
      });
      const page = await ctx.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(SITE);
      // Chromium headless has no physical status bar: supply its inset through
      // the same CSS token that resolves env(safe-area-inset-top) on the device.
      await page.evaluate(top => document.documentElement.style.setProperty('--safe-area-top', `${top}px`), safeTop);
      await page.getByRole('button', { name: 'Новая тренировка', exact: true }).waitFor();
      const notices = page.locator('.app-top-notices');
      assert.equal(await notices.evaluate(el => el.getBoundingClientRect().height), 0, 'no unused safe-area gap without a notice');
      await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click();
      await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
      await page.getByText('Жим штанги', { exact: true }).click();
      await page.getByRole('button', { name: 'Начать подход', exact: true }).click();
      await page.getByRole('button', { name: 'Заменить упражнение', exact: true }).click();
      const alert = page.getByRole('alert');
      await alert.getByText('Завершите начатый подход или отмените его замер перед заменой.', { exact: true }).waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      const check = async () => {
        await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
        const box = await alert.boundingBox(), close = await alert.getByLabel('Закрыть сообщение').boundingBox();
        const text = await alert.locator('span').first().boundingBox();
        assert.ok(box.y >= safeTop, 'notice border stays below the system status area');
        assert.ok(text.y >= safeTop && close.y >= safeTop);
        assert.ok(text.x + text.width <= close.x, 'message wraps before its close button');
        assert.ok(close.width >= 44 && close.height >= 44 && close.x + close.width <= viewport.width);
        assert.ok(await alert.locator('span').first().evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        return { top: box.y, height: box.height, closeSize: [close.width, close.height] };
      };
      await check();
      const nav = page.getByRole('navigation', { name: 'Основная навигация' });
      await nav.getByRole('button', { name: 'Главная', exact: true }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      const home = await check();
      await page.screenshot({ path: path.join(OUTPUT, `${name}-home.png`) });
      await nav.getByRole('button', { name: 'История', exact: true }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      const history = await check();
      await page.screenshot({ path: path.join(OUTPUT, `${name}-history.png`) });
      // Text enlargement must grow the notice, rather than clip it or cover X.
      await page.evaluate(() => { document.querySelector('[role=alert]').style.fontSize = '24px'; });
      const enlarged = await check(); assert.ok(enlarged.height >= history.height);
      await alert.getByLabel('Закрыть сообщение', { exact: true }).click();
      assert.equal(await alert.count(), 0);
      assert.equal(await notices.evaluate(el => el.getBoundingClientRect().height), 0, 'dismissing the notice removes its safe-area spacer');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('gym_workout_clock_v1')).kind), 'set', 'dismissing the notice preserves the active measurement');
      assert.deepEqual(errors, []);
      results.push({ viewport: name, emulatedSafeTop: safeTop, home, history, enlarged, dismiss: true, activeClockPreserved: true, runtimeErrors: errors });
      await ctx.close();
    }
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
