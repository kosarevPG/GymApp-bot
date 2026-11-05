// Run with the loopback MemoryClient fixture and a local Vite server. Never calls production APIs.
const { chromium } = require(process.env.GYMAPP_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SITE = process.env.GYMAPP_TEST_SITE || 'http://127.0.0.1:5174/GymApp-bot/';
const FIXTURE = 'http://127.0.0.1:8766';
const OUTPUT = process.env.GYMAPP_TEST_OUTPUT || path.resolve('test-results/exercise-notes');
const TECHNIQUE = 'Локти прижаты, корпус неподвижен';
const TODAY = 'Сегодня тяжеловато';
assert.ok(new URL(SITE).hostname === '127.0.0.1', 'Only a loopback UI is allowed');
fs.mkdirSync(OUTPUT, { recursive: true });
const state = async () => (await fetch(`${FIXTURE}/__state`)).json();
const waitFor = async (fn, label) => {
  for (let i = 0; i < 80; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); }
  assert.fail(`Timed out: ${label}`);
};

(async () => {
  await fetch(`${FIXTURE}/__reset`, { method: 'POST' });
  const browser = await chromium.launch({ headless: true });
  let offline = false;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Moscow' });
  ctx.setDefaultTimeout(15000);
  await ctx.route('**/*', async route => {
    const url = new URL(route.request().url());
    const endpoint = url.searchParams.get('url');
    if (endpoint?.startsWith('/api/')) {
      if (offline && endpoint.startsWith('/api/update_exercise')) return route.abort();
      const response = await fetch(`${FIXTURE}/?${new URLSearchParams({ url: endpoint })}`, {
        method: route.request().method(), headers: { 'Content-Type': 'application/json' },
        ...(route.request().postData() ? { body: route.request().postData() } : {}),
      });
      return route.fulfill({ status: response.status, body: await response.text(), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.hostname === '127.0.0.1') return route.continue();
    return route.fulfill({ status: 200, body: '', contentType: 'application/javascript' });
  });
  await ctx.addInitScript(() => { window.Telegram = { WebApp: { initData: 'fixture-only', initDataUnsafe: {}, ready() {}, expand() {}, HapticFeedback: { impactOccurred() {}, notificationOccurred() {}, selectionChanged() {} } } }; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const queueEmpty = () => page.evaluate(() => JSON.parse(localStorage.getItem('gym_offline_queue_v2') || '[]').length === 0);
  const repeatHomeWorkout = async () => {
    await page.getByRole('button', { name: 'Выбрать из истории', exact: true }).click();
    await page.getByText('2026.10.12', { exact: false }).first().click();
    await page.getByRole('button', { name: 'Повторить тренировку', exact: true }).click();
    await page.getByText('Упражнение 1 из 5', { exact: true }).waitFor();
  };
  const finish = async () => {
    await page.getByRole('button', { name: 'Завершить и перейти дальше', exact: true }).click();
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Пропустить оставшееся', exact: true }).click();
    await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
    await page.getByRole('button', { name: 'Да, закончить', exact: true }).click();
    await page.getByRole('heading', { name: 'История', exact: true }).waitFor();
    await waitFor(queueEmpty, 'queue drains after finish');
  };

  try {
    await page.goto(SITE);
    await repeatHomeWorkout();
    const exerciseName = (await page.getByRole('heading', { level: 2 }).first().textContent()).trim();

    // Техника: a failed save stays open and is not shown as saved.
    await page.getByRole('button', { name: 'Добавить технику', exact: true }).click();
    await page.getByLabel('Техника', { exact: true }).fill(TECHNIQUE);
    offline = true;
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.waitForTimeout(800);
    assert.equal(await page.getByLabel('Техника', { exact: true }).inputValue(), TECHNIQUE, 'text survives a failed save');
    offline = false;
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.getByText(TECHNIQUE, { exact: false }).waitFor();
    const exerciseRow = (await state()).gym_exercises.find(row => row.name_ru === exerciseName);
    assert.equal(exerciseRow.technique_note, TECHNIQUE);

    // Сегодня: a note typed after the set reaches that set with no further tap.
    await page.getByRole('button', { name: 'Отметить подход выполненным', exact: true }).first().click();
    await page.getByRole('button', { name: /^Сегодня/ }).click();
    await page.getByLabel('Заметка на сегодня', { exact: true }).fill(TODAY);
    await waitFor(async () => (await state()).gym_sets.some(row => row.note === TODAY), 'note reaches the completed set');
    let rows = (await state()).gym_sets.filter(row => row.note === TODAY);
    assert.equal(rows.length, 1, 'only the completed set holds the note so far');
    assert.equal(rows[0].exercise_id, exerciseRow.id);
    assert.equal(rows[0].source_payload.load !== undefined, true, 'a note edit keeps the load snapshot');

    // The next completed set carries it too.
    await page.getByRole('button', { name: 'Отметить подход выполненным', exact: true }).first().click();
    await waitFor(async () => (await state()).gym_sets.filter(row => row.note === TODAY).length === 2, 'next set carries the note');
    await page.screenshot({ path: path.join(OUTPUT, 'first-workout.png'), fullPage: true });
    await finish();

    // The history shows the note beside its exercise.
    await page.getByText(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }).replaceAll('-', '.'), { exact: false }).first().click();
    await page.getByText(TODAY, { exact: true }).first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUTPUT, 'history.png'), fullPage: true });

    // A new workout: technique stays, today is empty, last time is history.
    await page.goto(SITE);
    await repeatHomeWorkout();
    await page.getByText(TECHNIQUE, { exact: false }).waitFor();
    const lastTime = page.getByText(`: ${TODAY}`, { exact: false }).first();
    await lastTime.waitFor();
    assert.match(await lastTime.textContent(), new RegExp(`^\\d{2}\\.\\d{2}: ${TODAY}$`));
    assert.equal((await page.getByRole('button', { name: /^Сегодня/ }).first().textContent()).trim(), 'Сегодня', 'today starts collapsed and empty');
    await page.getByRole('button', { name: /^Сегодня/ }).first().click();
    assert.equal(await page.getByLabel('Заметка на сегодня', { exact: true }).inputValue(), '');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUTPUT, 'next-workout.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');

    // Technique never lands on sets of the new workout.
    await page.getByRole('button', { name: 'Отметить подход выполненным', exact: true }).first().click();
    await waitFor(queueEmpty, 'new set syncs');
    rows = (await state()).gym_sets.filter(row => row.exercise_id === exerciseRow.id);
    assert.equal(rows.filter(row => row.note === TECHNIQUE).length, 0);
    assert.equal(rows.filter(row => row.note === TODAY).length, 2, 'the new set did not inherit the old note');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ exerciseName, techniqueSaved: true, failedSaveKeptOpen: true, noteAfterSetSaved: true, nextWorkoutEmpty: true, lastTimeShown: true, runtimeErrors: errors }, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(OUTPUT, 'failure.png'), fullPage: true }).catch(() => {});
    console.error('page errors', errors);
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
