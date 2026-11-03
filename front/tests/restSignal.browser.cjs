// MemoryClient only. Optional public smoke mode allows static GETs, never production API calls.
const { chromium } = require(process.env.GYMAPP_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const SITE = process.env.GYMAPP_TEST_SITE || 'http://127.0.0.1:5174/GymApp-bot/';
const FIXTURE = 'http://127.0.0.1:8766';
const OUTPUT = process.env.GYMAPP_TEST_OUTPUT || path.resolve('test-results/rest-signal');
assert.ok(new URL(SITE).hostname === '127.0.0.1' || (process.env.GYMAPP_PUBLIC_SMOKE === '1' && SITE === 'https://kosarevpg.github.io/GymApp-bot/'));
fs.mkdirSync(OUTPUT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true }), results = [];
  try {
    for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }], ['compact', { width: 320, height: 720 }]]) {
      await fetch(FIXTURE + '/__reset', { method: 'POST' });
      const ctx = await browser.newContext({ viewport, isMobile: name !== 'desktop', hasTouch: name !== 'desktop', serviceWorkers: 'block' });
      await ctx.addInitScript(() => {
        window.__restWarnings = 0;
        window.Telegram = { WebApp: { initData: 'fixture-only', initDataUnsafe: {}, ready() {}, expand() {}, HapticFeedback: {
          impactOccurred() {}, notificationOccurred(kind) { if (kind === 'warning') window.__restWarnings++; },
        } } };
      });
      await ctx.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), endpoint = url.searchParams.get('url');
        if (endpoint?.startsWith('/api/')) {
          const response = await fetch(FIXTURE + '/?' + new URLSearchParams({ url: endpoint }), { method: request.method(), headers: { 'Content-Type': 'application/json' }, ...(request.postData() ? { body: request.postData() } : {}) });
          return route.fulfill({ status: response.status, body: await response.text(), contentType: 'application/json' });
        }
        if (request.method() === 'GET' && url.origin === new URL(SITE).origin) return route.continue();
        return route.abort('blockedbyclient');
      });
      const page = await ctx.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.clock.install({ time: new Date() });
      await page.goto(SITE);
      await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click();
      await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
      await page.getByText('Жим штанги', { exact: true }).click();
      await page.getByRole('button', { name: 'Подход', exact: true }).click();
      await page.getByLabel('Отдых после подхода в минутах', { exact: true }).first().fill('0.05');
      await page.getByRole('button', { name: 'Отметить подход выполненным', exact: true }).first().click();
      const dock = page.getByLabel('Управление подходом', { exact: true });
      const action = dock.getByRole('button', { name: 'Начать подход', exact: true });
      const before = await action.boundingBox();
      const beforeWarnings = await page.evaluate(() => window.__restWarnings);
      const rest = await page.evaluate(() => JSON.parse(localStorage.getItem('gym_workout_clock_v1')));
      const elapsed = async seconds => { await page.clock.setFixedTime(new Date(rest.since + seconds * 1000)); await page.clock.runFor(1000); };
      await elapsed(2);
      const restTimer = dock.getByRole('timer', { name: 'Отдых между подходами', exact: true });
      assert.equal(await restTimer.innerText(), '00:01');
      assert.equal(await restTimer.evaluate(el => getComputedStyle(el).color), 'rgb(250, 250, 250)');
      assert.equal(await action.evaluate(el => getComputedStyle(el).animationName), 'none');
      await page.screenshot({ path: path.join(OUTPUT, `${name}-countdown.png`) });
      await elapsed(3);
      const expired = () => dock.getByRole('timer', { name: 'Отдых окончен', exact: true });
      assert.equal(await expired().innerText(), '+00:00');
      assert.equal(await expired().evaluate(el => getComputedStyle(el).color), 'rgb(252, 211, 77)');
      assert.match(await dock.getByRole('status').innerText(), /Запланированное время отдыха вышло/);
      const animation = await action.evaluate(el => ({ name: getComputedStyle(el).animationName, iterations: getComputedStyle(el).animationIterationCount }));
      assert.deepEqual(animation, { name: 'rest-ready-pulse', iterations: '2' });
      assert.deepEqual(await action.boundingBox(), before, 'deadline must not move the main action');
      assert.equal(await page.evaluate(() => window.__restWarnings), beforeWarnings + 1);
      await elapsed(18);
      assert.equal(await expired().innerText(), '+00:15');
      assert.equal(await page.evaluate(() => window.__restWarnings), beforeWarnings + 1, 'one warning per rest interval');
      const fit = await dock.evaluate(el => ({ height: el.getBoundingClientRect().height, overflow: document.documentElement.scrollWidth > innerWidth }));
      const label = dock.getByLabel('Действия с таймером', { exact: true }).getByText('Отдых окончен', { exact: true });
      assert.ok(await label.evaluate(el => el.scrollWidth <= el.clientWidth), 'the entire status fits even at 320px');
      assert.ok(fit.height <= 88 && !fit.overflow);
      await page.screenshot({ path: path.join(OUTPUT, `${name}-expired.png`) });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await action.evaluate(el => getComputedStyle(el).animationName), 'none');
      assert.equal(await expired().evaluate(el => getComputedStyle(el).color), 'rgb(252, 211, 77)', 'reduced motion keeps the visual signal');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.getByRole('button', { name: 'Вся тренировка', exact: true }).click();
      assert.equal(await page.getByRole('timer', { name: 'Отдых окончен', exact: true }).innerText(), '+00:15', 'home retains the same overdue rest');
      await page.getByRole('button', { name: 'Продолжить тренировку', exact: true }).click();
      // Starting a set clears the cue. Cancelling restores the original overdue rest.
      await action.click();
      await dock.getByRole('timer', { name: 'Подход идёт', exact: true }).waitFor();
      assert.equal(await dock.getByRole('button', { name: 'Подход выполнен', exact: true }).evaluate(el => getComputedStyle(el).animationName), 'none');
      await dock.getByLabel('Действия с таймером', { exact: true }).click();
      await dock.getByRole('button', { name: 'Отменить замер', exact: true }).click();
      assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('gym_workout_clock_v1')))).since, rest.since);
      assert.equal(await expired().innerText(), '+00:15');
      // Cold reload retains the deadline and shows how far past it we are.
      await page.reload(); await expired().waitFor();
      assert.equal(await expired().innerText(), '+00:15');
      // Inter-exercise rest has no planned countdown and must not become overdue.
      await page.evaluate(() => {
        const clock = JSON.parse(localStorage.getItem('gym_workout_clock_v1'));
        clock.betweenExercises = true;
        localStorage.setItem('gym_workout_clock_v1', JSON.stringify(clock));
      });
      await page.reload();
      assert.equal(await dock.getByRole('timer', { name: 'Отдых между упражнениями', exact: true }).innerText(), '00:18');
      assert.equal(await action.evaluate(el => getComputedStyle(el).animationName), 'none');
      await page.evaluate(() => {
        const clock = JSON.parse(localStorage.getItem('gym_workout_clock_v1'));
        delete clock.betweenExercises;
        localStorage.setItem('gym_workout_clock_v1', JSON.stringify(clock));
      });
      await page.reload(); await expired().waitFor();
      await action.click();
      await page.getByLabel('Отдых после подхода в минутах', { exact: true }).last().fill('0');
      await dock.getByRole('button', { name: 'Подход выполнен', exact: true }).click();
      await page.getByRole('button', { name: 'Подход', exact: true }).click();
      await page.clock.setFixedTime(new Date(rest.since + 23000));
      await page.clock.runFor(1000);
      assert.equal(await dock.getByRole('timer', { name: 'Отдых между подходами', exact: true }).innerText(), '00:05');
      assert.equal(await action.evaluate(el => getComputedStyle(el).animationName), 'none', 'zero rest is not an expired countdown');
      assert.deepEqual(errors, []);
      results.push({ viewport: name, deadline: true, overtime: '+00:15', amber: true, pulseCount: 2, stableAction: true, reducedMotion: true, singleWarning: true, cancelAndReload: true, home: true, untimedInterExerciseRest: true, zeroRest: true, dockHeight: fit.height, runtimeErrors: errors });
      await ctx.close();
    }
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
