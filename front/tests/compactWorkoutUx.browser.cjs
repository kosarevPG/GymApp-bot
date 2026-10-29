// Real UI with an isolated MemoryClient. Public smoke mode allows only static GETs.
const { chromium } = require(process.env.GYMAPP_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const SITE = process.env.GYMAPP_TEST_SITE || 'http://127.0.0.1:5174/GymApp-bot/';
const FIXTURE = 'http://127.0.0.1:8766';
const OUTPUT = process.env.GYMAPP_TEST_OUTPUT || path.resolve('test-results/compact-ux');
assert.ok(new URL(SITE).hostname === '127.0.0.1' || (process.env.GYMAPP_PUBLIC_SMOKE === '1' && SITE === 'https://kosarevpg.github.io/GymApp-bot/'));
fs.mkdirSync(OUTPUT, { recursive: true });
const until = async fn => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); } assert.fail('Condition timed out'); };
const OWNER = '11111111-1111-4111-8111-111111111111';
const expires = Math.floor(Date.now() / 1000) + 3600;
const session = { access_token: ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', Buffer.from(JSON.stringify({ sub: OWNER, aud: 'authenticated', role: 'authenticated', exp: expires })).toString('base64url'), 'fixture-signature'].join('.'),
  refresh_token: 'fixture-refresh', token_type: 'bearer', expires_at: expires, expires_in: 3600,
  user: { id: OWNER, aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: '2026-01-01T00:00:00Z' } };
(async () => {
  const browser = await chromium.launch({ headless: true }), results = [];
  try {
    for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }], ['compact', { width: 320, height: 720 }]]) {
      await fetch(FIXTURE + '/__reset', { method: 'POST' });
      const ctx = await browser.newContext({ viewport, isMobile: name !== 'desktop', hasTouch: name !== 'desktop', serviceWorkers: 'block' });
      await ctx.addInitScript(seed => { if (!localStorage.getItem('__ux_seeded')) { localStorage.setItem('__ux_seeded', '1'); localStorage.setItem('sb-yafpqobpgqffkahvwwki-auth-token', JSON.stringify(seed)); } }, session);
      let apiWrites = 0;
      await ctx.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url()), endpoint = url.searchParams.get('url');
        if (endpoint?.startsWith('/api/')) {
          if (req.method() !== 'GET') apiWrites++;
          const res = await fetch(FIXTURE + '/?' + new URLSearchParams({ url: endpoint }), { method: req.method(), headers: { 'Content-Type': 'application/json' }, ...(req.postData() ? { body: req.postData() } : {}) });
          return route.fulfill({ status: res.status, body: await res.text(), contentType: 'application/json' });
        }
        if (url.pathname.startsWith('/auth/v1/')) return route.fulfill({ status: 200, body: JSON.stringify(url.pathname.endsWith('/user') ? session.user : session), contentType: 'application/json' });
        if (req.method() === 'GET' && url.origin === new URL(SITE).origin) return route.continue();
        return route.abort('blockedbyclient');
      });
      const page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      const nav = () => page.getByRole('navigation', { name: 'Основная навигация' });
      const settings = () => page.getByRole('dialog', { name: 'Настройки', exact: true });
      const shot = async state => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(OUTPUT, `${name}-${state}.png`), fullPage: true }); };
      await page.goto(SITE);
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      for (const text of ['Экспорт (упражнения + тренировки)', 'Импорт из файла', 'Выйти из HealthOS']) assert.ok(await settings().getByRole('button', { name: text, exact: true }).isVisible());
      for (const label of ['Разминка', 'Пресс', 'Заминка']) assert.equal(await settings().getByLabel(label, { exact: true }).count(), 1);
      await settings().getByLabel('Вес тела, кг', { exact: true }).fill('82');
      await settings().getByRole('button', { name: '15', exact: true }).click();
      await shot('settings');
      const download = page.waitForEvent('download');
      await settings().getByRole('button', { name: 'Экспорт (упражнения + тренировки)', exact: true }).click();
      const backup = await download;
      const backupPath = path.join(OUTPUT, `${name}-fixture-backup.json`); await backup.saveAs(backupPath);
      assert.ok(JSON.parse(fs.readFileSync(backupPath, 'utf8')));
      await settings().locator('input[type=file]').setInputFiles(backupPath);
      // The existing HealthOS adapter deliberately rejects direct backup imports.
      // Exercise the real rejection and preserve that server policy.
      await settings().getByText('Импорт не удался — проверь файл и сеть.', { exact: true }).waitFor();
      assert.equal((await (await fetch(FIXTURE + '/__state')).json()).gym_sets.length, 23, 'rejected import does not modify existing sets');
      await settings().getByRole('button', { name: 'Сохранить', exact: true }).click();
      await until(() => page.evaluate(() => localStorage.getItem('gym_body_weight') === '82'));
      assert.ok(!(await page.evaluate(() => JSON.parse(localStorage.getItem('gym_plates')))).includes(15));
      await nav().getByRole('button', { name: 'Библиотека', exact: true }).click();
      await page.getByRole('heading', { name: 'Библиотека', exact: true }).waitFor();
      await page.getByRole('searchbox', { name: 'Поиск упражнений' }).fill('жим');
      await page.getByLabel('Техника упражнения: Жим штанги', { exact: true }).click();
      const info = page.getByRole('dialog', { name: 'Жим штанги', exact: true });
      assert.ok(await info.isVisible());
      await info.getByLabel('Закрыть окно', { exact: true }).click();
      await page.getByLabel('Создать упражнение', { exact: true }).click();
      await page.getByRole('dialog', { name: 'Новое упражнение', exact: true }).getByLabel('Закрыть окно', { exact: true }).click();
      await nav().getByRole('button', { name: 'Главная', exact: true }).click();
      await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click();
      await page.getByRole('group', { name: 'Место новой тренировки', exact: true }).getByRole('button', { name: 'Дома', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Дома', exact: true }).getAttribute('aria-pressed'), 'true');
      await shot('home');
      await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
      await page.getByText('Жим штанги', { exact: true }).click();
      const weight = () => page.getByLabel('Вес подхода', { exact: true }).first();
      await weight().fill('50');
      const hint = () => page.locator('.compact-load-hint').first();
      assert.match(await hint().locator('summary').innerText(), /Гриф 20 · на сторону:/);
      assert.match(await hint().locator('summary').innerText(), /10[\s\S]*5/);
      assert.ok((await hint().locator('summary').boundingBox()).height <= 30, 'plate hint occupies one compact line');
      await page.getByText('Σ 50 кг', { exact: true }).waitFor();
      await hint().locator('summary').click();
      await hint().getByText('Общий вес: 50 кг', { exact: true }).waitFor();
      await hint().locator('summary').click();
      await page.getByLabel('Параметры подхода 1', { exact: true }).click();
      await page.getByLabel('Тип подхода 1', { exact: true }).selectOption('drop');
      await page.getByRole('button', { name: 'RIR 2', exact: true }).click();
      await page.getByLabel('RPE подхода 1', { exact: true }).fill('8');
      await page.getByLabel('Параметры подхода 1', { exact: true }).click();
      await page.getByText('RIR 2', { exact: true }).last().waitFor();
      await page.getByText('RPE 8', { exact: true }).waitFor();
      const dock = page.getByLabel('Управление подходом', { exact: true });
      const before = await dock.boundingBox(); assert.ok(before.height <= 88);
      const field = await weight().boundingBox(), touch = await weight().locator('..').boundingBox();
      assert.ok(field.height === 36 && touch.width >= 44 && touch.height >= 44);
      await shot('weight-hint');
      await page.getByRole('button', { name: 'Начать подход', exact: true }).click();
      const running = await dock.getByRole('button', { name: 'Подход выполнен', exact: true }).boundingBox();
      assert.equal((await dock.boundingBox()).y, before.y);
      await page.getByRole('button', { name: 'Вся тренировка', exact: true }).click();
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await settings().getByLabel('Закрыть окно', { exact: true }).click();
      await page.getByRole('button', { name: 'К начатому подходу', exact: true }).click();
      assert.equal((await dock.getByRole('button', { name: 'Подход выполнен', exact: true }).boundingBox()).y, running.y);
      await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }));
      await page.getByRole('button', { name: 'Подход выполнен', exact: true }).click();
      await nav().getByRole('button', { name: /Очередь синхронизации:/ }).waitFor();
      assert.equal(await nav().getByRole('button').count(), 5);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('gym_offline_queue_v2')).find(q => q.type === 'saveSet'));
      assert.equal(queued.data.weight, 50); assert.equal(queued.data.rir, 2); assert.equal(queued.data.rpe, 8); assert.equal(queued.data.set_type, 'drop');
      assert.deepEqual(errors, []);
      results.push({ viewport: name, settingsComplete: true, export: true, existingImportRejection: true, library: true, touchTarget: touch, dockHeight: before.height, compactPlates: true, total: 50, rirRpeAndType: true, location: true, pendingNavigationFits: true, apiWrites, runtimeErrors: errors });
      await ctx.close();
    }
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
