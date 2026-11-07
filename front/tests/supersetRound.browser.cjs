// Loopback-only: a superset runs as a round — start once, tick each exercise, rest after the last.
const { chromium } = require(process.env.GYMAPP_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SITE = process.env.GYMAPP_TEST_SITE || 'http://127.0.0.1:5174/GymApp-bot/';
const FIXTURE = 'http://127.0.0.1:8766';
const OUTPUT = process.env.GYMAPP_TEST_OUTPUT || path.resolve('test-results/superset-round');
assert.equal(new URL(SITE).hostname, '127.0.0.1');
fs.mkdirSync(OUTPUT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await fetch(FIXTURE + '/__reset', { method: 'POST' });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { window.Telegram = { WebApp: { initData: 'fixture-only', initDataUnsafe: {}, ready() {}, expand() {} } }; });
    await ctx.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), endpoint = url.searchParams.get('url');
      if (endpoint?.startsWith('/api/')) {
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
    const dock = () => page.getByLabel('Управление подходом', { exact: true });
    const action = label => dock().getByRole('button', { name: label, exact: true });
    const clock = () => page.evaluate(() => JSON.parse(localStorage.getItem('gym_workout_clock_v1')));
    const queue = () => page.evaluate(() => JSON.parse(localStorage.getItem('gym_offline_queue_v2') || '[]'));
    await page.goto(SITE);
    await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
    await page.getByText('Жим штанги', { exact: true }).click();
    await page.getByRole('button', { name: 'Сет', exact: true }).click();
    await page.getByRole('dialog').getByText('Махи в стороны (стоя)', { exact: true }).click();
    await page.getByLabel('Вес подхода').nth(1).waitFor();
    const fill = async (i, weight, reps, rest) => {
      await page.getByLabel('Вес подхода').nth(i).fill(weight);
      await page.getByLabel('Повторения подхода').nth(i).fill(reps);
      await page.getByLabel('Отдых после подхода в минутах').nth(i).fill(rest);
    };
    await fill(0, '40', '10', '0');
    await fill(1, '5', '15', '2');
    await action('Начать подход').click();
    await page.getByRole('timer', { name: 'Подход идёт · Жим штанги', exact: true }).waitFor();
    await action('Подход выполнен').click();
    await page.getByRole('timer', { name: 'Подход идёт · Махи в стороны (стоя)', exact: true }).waitFor();
    assert.equal((await clock()).kind, 'set', 'the partner starts at once, no rest inside the round');
    await page.screenshot({ path: path.join(OUTPUT, 'partner-running.png'), fullPage: true });
    await action('Подход выполнен').click();
    await action('Начать подход').waitFor();
    const rest = await clock();
    assert.equal(rest.kind, 'rest', 'rest begins after the last exercise of the round');
    assert.equal(rest.restTargetSeconds, 120, 'rest target comes from the last exercise');
    // Подходы уходят на фикстуру сразу; проверяем то, что записал сервер.
    let sets = [];
    for (let i = 0; i < 100 && sets.length < 2; i++) {
      if ((await queue()).length === 0) {
        const journal = await (await fetch(FIXTURE + '/?' + new URLSearchParams({ url: '/api/global_history' }))).json();
        sets = (journal[0]?.exercises || []).flatMap(ex => ex.sets.map(s => ({ name: ex.name, ...s })));
      }
      if (sets.length < 2) await page.waitForTimeout(100);
    }
    assert.deepEqual(sets.map(s => s.name), ['Жим штанги', 'Махи в стороны (стоя)']);
    assert.ok(sets.every(s => Number.isFinite(s.timing?.duration_seconds)), 'both sets are timed');
    assert.equal(sets[1].timing.rest_before_seconds, undefined, 'no fake rest between the two exercises');
    await page.screenshot({ path: path.join(OUTPUT, 'round-rest.png'), fullPage: true });
    // Место в истории — те же значки, что на главной, и тот же переключатель.
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'История', exact: true }).click();
    await page.getByText('2026.10.12', { exact: false }).first().click();
    const place = page.getByRole('group', { name: 'Место тренировки 2026.10.12', exact: true });
    await place.waitFor();
    assert.equal(await place.getByRole('button', { name: 'Дома', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByText(/🏋|🏠|📍/).count(), 0, 'no emoji place icons left');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUTPUT, 'history-place.png') });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ round: true, restAfterLast: true, partnerTimed: true, runtimeErrors: errors }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
