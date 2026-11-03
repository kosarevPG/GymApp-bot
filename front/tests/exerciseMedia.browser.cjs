// Catalogue snapshots contain exercise metadata only. All app API calls are intercepted.
// Images are read with GET from exactly the URLs in the supplied catalogue.
const { chromium } = require(process.env.GYMAPP_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const SITE = process.env.GYMAPP_TEST_SITE || 'http://127.0.0.1:5174/GymApp-bot/';
assert.ok(new URL(SITE).hostname === '127.0.0.1' || (process.env.GYMAPP_PUBLIC_SMOKE === '1' && SITE === 'https://kosarevpg.github.io/GymApp-bot/'));
assert.ok(process.env.GYMAPP_MEDIA_INIT, 'Set GYMAPP_MEDIA_INIT to the read-only catalogue snapshot JSON');
const init = JSON.parse(fs.readFileSync(process.env.GYMAPP_MEDIA_INIT, 'utf8'));
const OUTPUT = process.env.GYMAPP_TEST_OUTPUT || path.resolve('test-results/exercise-media');
fs.mkdirSync(OUTPUT, { recursive: true });
const assetUrls = new Set(init.exercises.flatMap(e => [e.imageUrl, e.imageUrl2]).filter(Boolean));
const loaded = new Set();
(async () => {
  const browser = await chromium.launch({ headless: true }), results = [];
  try {
    for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['iphone', { width: 393, height: 852 }], ['compact', { width: 320, height: 720 }]]) {
      const ctx = await browser.newContext({ viewport, isMobile: name !== 'desktop', hasTouch: name !== 'desktop', serviceWorkers: 'block' });
      await ctx.addInitScript(() => { window.Telegram = { WebApp: { initData: 'fixture-only', initDataUnsafe: {}, ready() {}, expand() {} } }; });
      let unexpectedWrites = 0;
      await ctx.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url()), endpoint = url.searchParams.get('url');
        if (endpoint?.startsWith('/api/')) {
          if (endpoint.startsWith('/api/init')) return route.fulfill({ status: 200, json: init });
          if (endpoint === '/api/journal_sync') return route.fulfill({ status: 200, json: { mode: 'delta', manifest: {}, changedIds: [], upserts: [] } });
          if (endpoint === '/api/ping') return route.fulfill({ status: 200, json: { ok: true } });
          if (req.method() !== 'GET') unexpectedWrites++;
          return route.fulfill({ status: 200, json: [] });
        }
        if (req.method() === 'GET' && (url.origin === new URL(SITE).origin || assetUrls.has(req.url()))) return route.continue();
        return route.abort('blockedbyclient');
      });
      const page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      page.on('response', response => { if (assetUrls.has(response.url()) && response.status() === 200) loaded.add(response.url()); });
      await page.goto(SITE);
      await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Библиотека', exact: true }).click();
      await page.getByRole('heading', { name: 'Библиотека', exact: true }).waitFor();
      assert.equal(init.exercises.filter(e => e.imageUrl?.startsWith('https://storage.yandexcloud.net/gymapp-kpg-photos/exercises/catalogue/20261104/')).length, 39);
      const exercise = 'Махи в стороны (сидя)';
      await page.getByLabel(`Техника упражнения: ${exercise}`, { exact: true }).click();
      const dialog = page.getByRole('dialog', { name: exercise, exact: true });
      const image = dialog.getByRole('img', { name: `Техника: ${exercise}`, exact: true });
      await page.waitForFunction(alt => [...document.images].some(im => im.alt === alt && im.complete && im.naturalWidth > 0), `Техника: ${exercise}`);
      assert.equal(await image.evaluate(el => getComputedStyle(el).objectFit), 'contain');
      const initial = await image.boundingBox();
      assert.ok(initial.height > 150 && initial.height <= viewport.height / 2 + 1);
      await dialog.getByText('Фото тренажёра / дополнительное изображение', { exact: true }).click();
      const photo = dialog.getByRole('img', { name: `Дополнительное изображение: ${exercise}`, exact: true });
      await photo.scrollIntoViewIfNeeded();
      await page.waitForFunction(alt => [...document.images].some(im => im.alt === alt && im.complete && im.naturalWidth > 0), `Дополнительное изображение: ${exercise}`);
      assert.equal(await photo.getAttribute('src'), init.exercises.find(e => e.name === exercise).imageUrl2);
      assert.equal(await photo.evaluate(el => getComputedStyle(el).objectFit), 'contain');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(OUTPUT, `${name}-animation-and-photo.png`) });
      await dialog.getByText('Фото тренажёра / дополнительное изображение', { exact: true }).click();
      await image.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUTPUT, `${name}-animation.png`) });
      await dialog.getByLabel('Закрыть окно', { exact: true }).click();
      await page.getByLabel('Техника упражнения: Разогрев спины длинная косичка', { exact: true }).click();
      const rope = page.getByRole('img', { name: 'Техника: Разогрев спины длинная косичка', exact: true });
      await page.waitForFunction(() => [...document.images].some(im => im.alt === 'Техника: Разогрев спины длинная косичка' && im.complete && im.naturalWidth > 0));
      assert.ok((await rope.getAttribute('src')).startsWith('https://storage.yandexcloud.net/gymapp-kpg-photos/'));
      assert.equal(unexpectedWrites, 0); assert.deepEqual(errors, []);
      results.push({ viewport: name, updatedImages: 39, animationContained: true, preservedPhotoVisible: true, ropeCandidate: true, productionApiWrites: 0, runtimeErrors: errors });
      await ctx.close();
    }
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify({ results, imagesLoadedWith200: [...loaded] }, null, 2)); console.log(JSON.stringify(results));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
