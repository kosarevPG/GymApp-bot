// Run with the loopback MemoryClient fixture and a local Vite server. Never calls production APIs.
const { chromium } = require(process.env.GYMAPP_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SITE = process.env.GYMAPP_TEST_SITE || 'http://127.0.0.1:5174/GymApp-bot/';
const FIXTURE = 'http://127.0.0.1:8766';
const OUTPUT = process.env.GYMAPP_TEST_OUTPUT || path.resolve('test-results/workout-flow');
const SOURCE = 'aad8ddfc-925c-58f7-b1eb-35108e9ee9ff';
assert.ok(new URL(SITE).hostname === '127.0.0.1', 'Only a loopback UI is allowed');
fs.mkdirSync(OUTPUT, { recursive: true });
const state = async () => (await fetch(FIXTURE + '/__state')).json();
const reset = () => fetch(FIXTURE + '/__reset', { method: 'POST' });
const waitFor = async fn => { for(let i=0;i<60;i++){ if(await fn()) return; await new Promise(r=>setTimeout(r,100)); } assert.fail('Condition timed out'); };

(async () => {
  const browser = await chromium.launch({headless:true});
  const results = [];
  try {
    for (const [name, viewport] of [['desktop',{width:1280,height:900}],['mobile',{width:390,height:844}]]) {
      await reset();
      const original = await state();
      const ctx = await browser.newContext({viewport, isMobile:name==='mobile', hasTouch:name==='mobile', timezoneId:'Europe/Moscow'});
      await ctx.route('**/*', async route => {
        const url = new URL(route.request().url());
        const endpoint = url.searchParams.get('url');
        if (endpoint?.startsWith('/api/')) {
          const response = await fetch(FIXTURE+'/?'+new URLSearchParams({url:endpoint}), {method:route.request().method(),
            headers:{'Content-Type':'application/json'}, ...(route.request().postData() ? {body:route.request().postData()} : {})});
          return route.fulfill({status:response.status,body:await response.text(),contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'}});
        }
        if (url.hostname === '127.0.0.1') return route.continue();
        // No third-party calls, including auth, images or scripts, escape this fixture.
        return route.fulfill({status:200,body:'',contentType:'application/javascript'});
      });
      await ctx.addInitScript(() => { window.Telegram={WebApp:{initData:'fixture-only',initDataUnsafe:{},ready(){},expand(){},HapticFeedback:{impactOccurred(){},notificationOccurred(){}}}}; });
      const page = await ctx.newPage(); const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(SITE);
      await page.getByRole('button',{name:'Выбрать из истории',exact:true}).click();
      await page.getByText('2026.10.12',{exact:false}).first().click();
      await page.getByRole('button',{name:'Повторить тренировку',exact:true}).click();
      await page.getByText('Упражнение 1 из 5',{exact:true}).waitFor();
      assert.equal(await page.getByLabel('Вес подхода',{exact:true}).first().inputValue(),'2');
      await page.getByRole('button',{name:'Начать подход',exact:true}).click();
      const clockBefore = await page.evaluate(()=>JSON.parse(localStorage.getItem('gym_workout_clock_v1')));
      await page.waitForTimeout(1100);
      await page.reload();
      await page.getByText('Подход идёт',{exact:true}).waitFor();
      assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('gym_workout_clock_v1')))).since,clockBefore.since);
      await page.getByRole('button',{name:'Подход выполнен',exact:true}).click();
      await page.getByText(/Время подхода 00:/).waitFor();
      const rest = await page.evaluate(()=>JSON.parse(localStorage.getItem('gym_workout_clock_v1')));
      await page.waitForTimeout(600); // Let row/accordion transitions settle before visual evidence.
      await page.screenshot({path:path.join(OUTPUT,`${name}-set.png`),fullPage:true});
      await page.getByRole('button',{name:'Завершить и перейти дальше',exact:true}).click();
      await page.getByText('Упражнение 2 из 5',{exact:true}).waitFor();
      assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('gym_workout_clock_v1')))).since,rest.since);
      await page.getByRole('button',{name:'Заменить упражнение',exact:true}).click();
      await page.getByText('Жим штанги',{exact:true}).click();
      await page.getByText('ВСЕГО, КГ',{exact:true}).waitFor();
      assert.equal(await page.getByLabel('Вес подхода',{exact:true}).first().inputValue(),'60');
      await page.getByRole('button',{name:'Отметить подход выполненным',exact:true}).first().click();
      await page.getByRole('button',{name:'Заменить упражнение',exact:true}).click();
      await page.getByText('Приседания в Гакк',{exact:true}).click();
      await page.getByText('Упражнение 3 из 6',{exact:true}).waitFor();
      await page.getByText('БЛИНЫ ВСЕГО, КГ',{exact:true}).waitFor();
      assert.equal(await page.getByLabel('Вес подхода',{exact:true}).first().inputValue(),'30');
      await page.getByRole('button',{name:'Отметить подход выполненным',exact:true}).first().click();
      await page.getByRole('button',{name:'Завершить и перейти дальше',exact:true}).click();
      for(let i=0;i<3;i++) await page.getByRole('button',{name:'Пропустить оставшееся',exact:true}).click();
      await page.getByRole('heading',{name:'Текущая тренировка',exact:true}).waitFor();
      await page.waitForTimeout(600);
      await page.screenshot({path:path.join(OUTPUT,`${name}-sequence.png`),fullPage:true});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.getByRole('button',{name:'Завершить тренировку',exact:true}).click();
      await page.getByRole('button',{name:'Да, закончить',exact:true}).click();
      await page.getByRole('heading',{name:'История',exact:true}).waitFor();
      await waitFor(async()=>await page.evaluate(()=>JSON.parse(localStorage.getItem('gym_offline_queue_v2')||'[]').length===0));
      const after=await state();
      assert.deepEqual(after.gym_sets.filter(s=>s.session_id===SOURCE),original.gym_sets.filter(s=>s.session_id===SOURCE));
      const newSession=after.gym_workout_sessions.find(s=>s.source_payload?.repeated_from_session_id===SOURCE);
      assert.ok(newSession); assert.equal(newSession.location,'home');
      const performed=after.gym_sets.filter(s=>s.session_id===newSession.id);
      assert.equal(performed.length,3);
      assert.equal(performed.filter(s=>s.source_payload.timing?.duration_seconds!==undefined).length,1);
      assert.deepEqual(performed.map(s=>[s.input_weight_kg,s.total_weight_kg]),[[2,4],[60,60],[30,70]]);
      assert.equal(new Set(performed.map(s=>s.client_request_id)).size,3);
      await page.getByText(new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'}).replaceAll('-','.'),{exact:false}).first().click();
      await page.getByText(/Подход 00:/).waitFor();
      await page.waitForTimeout(600);
      await page.screenshot({path:path.join(OUTPUT,`${name}-history.png`),fullPage:true});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.deepEqual(errors,[]);
      results.push({viewport:name,repeatFromOlderHistory:true,reloadTiming:true,restOriginPreserved:true,partialReplacement:true,
        preservedSource:true,sets:performed.length,inputTotals:[[2,4],[60,60],[30,70]],runtimeErrors:errors});
      await ctx.close();
    }
    await reset();
    let apiOffline=false;
    const offlineCtx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Moscow'});
    await offlineCtx.route('**/*',async route=>{
      const url=new URL(route.request().url());const endpoint=url.searchParams.get('url');
      if(endpoint?.startsWith('/api/')) {
        if(apiOffline) return route.fulfill({status:503,body:'{}',contentType:'application/json'});
        const response=await fetch(FIXTURE+'/?'+new URLSearchParams({url:endpoint}),{method:route.request().method(),headers:{'Content-Type':'application/json'},...(route.request().postData()?{body:route.request().postData()}:{})});
        return route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});
      }
      if(url.hostname==='127.0.0.1')return route.continue();
      return route.fulfill({status:200,body:'',contentType:'application/javascript'});
    });
    await offlineCtx.addInitScript(()=>{
      window.Telegram={WebApp:{initData:'fixture-only',initDataUnsafe:{},ready(){},expand(){},HapticFeedback:{impactOccurred(){},notificationOccurred(){}}}};
      Object.defineProperty(navigator,'onLine',{get:()=>!localStorage.getItem('__fixture_offline'),configurable:true});
    });
    const offlinePage=await offlineCtx.newPage();const offlineErrors=[];
    offlinePage.on('pageerror',e=>offlineErrors.push(e.message));
    await offlinePage.goto(SITE);
    await offlinePage.getByRole('button',{name:'Выбрать из истории',exact:true}).click();
    await offlinePage.getByText('2026.10.12',{exact:false}).first().click();
    apiOffline=true;
    await offlinePage.evaluate(()=>{localStorage.setItem('__fixture_offline','1');dispatchEvent(new Event('offline'));});
    await offlinePage.getByRole('button',{name:'Повторить тренировку',exact:true}).click();
    await offlinePage.getByText('Упражнение 1 из 5',{exact:true}).waitFor();
    const firstClient=await offlinePage.evaluate(()=>localStorage.getItem('gym_session_id'));
    await offlinePage.getByRole('button',{name:'Начать подход',exact:true}).click();
    await offlinePage.evaluate(()=>localStorage.setItem('gym_last_active',String(Date.now()-5*3600000)));
    await offlinePage.reload();
    await offlinePage.getByText('Подход идёт',{exact:true}).waitFor();
    assert.equal(await offlinePage.evaluate(()=>localStorage.getItem('gym_session_id')),firstClient);
    await offlinePage.getByRole('button',{name:'Подход выполнен',exact:true}).click();
    const queued=await offlinePage.evaluate(()=>JSON.parse(localStorage.getItem('gym_offline_queue_v2')));
    assert.equal(queued.filter(q=>q.type==='saveSet').length,1);
    await offlinePage.getByRole('button',{name:'Вся тренировка',exact:true}).click();
    await offlinePage.getByRole('button',{name:'Завершить тренировку',exact:true}).click();
    await offlinePage.getByRole('button',{name:'Да, закончить',exact:true}).click();
    const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'}).replaceAll('-','.');
    await offlinePage.getByText(today,{exact:false}).first().click();
    await offlinePage.getByText('Сохранено на устройстве.',{exact:false}).waitFor();
    await offlinePage.getByRole('button',{name:'Повторить тренировку',exact:true}).click();
    await offlinePage.getByText('Упражнение 1 из 1',{exact:true}).waitFor();
    await offlinePage.getByRole('button',{name:'Отметить подход выполненным',exact:true}).first().click();
    await offlinePage.getByRole('button',{name:'Вся тренировка',exact:true}).click();
    await offlinePage.getByRole('button',{name:'Завершить тренировку',exact:true}).click();
    await offlinePage.getByRole('button',{name:'Да, закончить',exact:true}).click();
    apiOffline=false;
    await offlinePage.evaluate(()=>{localStorage.removeItem('__fixture_offline');dispatchEvent(new Event('online'));});
    await waitFor(async()=>offlinePage.evaluate(()=>JSON.parse(localStorage.getItem('gym_offline_queue_v2')||'[]').length===0));
    const offlineState=await state();
    assert.equal(offlineState.gym_sets.length,25);
    const parent=offlineState.gym_workout_sessions.find(s=>s.source_payload?.client_session_id===firstClient);
    assert.ok(parent);
    assert.ok(offlineState.gym_workout_sessions.some(s=>s.source_payload?.repeated_from_session_id===parent.id));
    assert.equal(new Set(offlineState.gym_sets.map(s=>s.client_request_id)).size,25);
    assert.deepEqual(offlineErrors,[]);
    results.push({viewport:'mobile',offlineRepeat:true,activeSessionSurvivesFiveHourGap:true,offlineReload:true,
      repeatOfUnsyncedSession:true,reconnectedWithoutDuplicates:true,originalSets:23,addedSets:2,runtimeErrors:offlineErrors});
    await offlineCtx.close();
    await reset();
    const legacyCtx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Moscow'});
    await legacyCtx.route('**/*',async route=>{
      const url=new URL(route.request().url());const endpoint=url.searchParams.get('url');
      if(endpoint?.startsWith('/api/')) {
        const response=await fetch(FIXTURE+'/?'+new URLSearchParams({url:endpoint}),{method:route.request().method(),headers:{'Content-Type':'application/json'},...(route.request().postData()?{body:route.request().postData()}:{})});
        return route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});
      }
      if(url.hostname==='127.0.0.1')return route.continue();
      return route.fulfill({status:200,body:'',contentType:'application/javascript'});
    });
    await legacyCtx.addInitScript(()=>{
      window.Telegram={WebApp:{initData:'fixture-only',initDataUnsafe:{},ready(){},expand(){},HapticFeedback:{impactOccurred(){},notificationOccurred(){}}}};
      if(localStorage.getItem('__legacy_seeded'))return;
      const sid='77777777-7777-4777-8777-777777777777';
      const request='88888888-8888-4888-8888-888888888888';
      const row='99999999-9999-4999-8999-999999999999';
      const started=Date.now()-5*3600000;
      localStorage.setItem('__legacy_seeded','1');localStorage.setItem('gym_session_id',sid);
      localStorage.setItem('gym_order_counter','1');localStorage.setItem('gym_session_location','gym');
      localStorage.setItem('gym_last_active',String(started));
      localStorage.setItem('gym_active_workout',JSON.stringify({startedAt:started}));
      localStorage.setItem('gym_workout_state_v2',JSON.stringify({timestamp:started,activeExercises:['bar'],setGroupId:'legacy-group',exercises:{bar:{setGroupId:'legacy-group',sets:[
        {id:request,requestId:request,order:1,weight:'20',reps:'12',rest:'2',completed:true},
        {id:row,weight:'25',reps:'10',rest:'2',completed:false},
      ]}}}));
      localStorage.setItem('gym_offline_queue_v2',JSON.stringify([{id:request,type:'saveSet',rev:0,attempts:0,createdAt:started,data:{
        client_request_id:request,session_id:sid,set_group_id:'legacy-group',exercise_id:'bar',exercise_name:'Жим штанги',
        input_weight:20,weight:60,reps:12,rest:2,order:1,performed_at:'2026-10-19T10:00:00+03:00',
      }}]));
    });
    const legacyPage=await legacyCtx.newPage();const legacyErrors=[];
    legacyPage.on('pageerror',e=>legacyErrors.push(e.message));
    await legacyPage.goto(SITE);
    await legacyPage.getByText('КГ/СТОРОНА',{exact:true}).waitFor();
    assert.equal(await legacyPage.getByLabel('Вес подхода',{exact:true}).nth(1).inputValue(),'25');
    assert.equal(await legacyPage.evaluate(()=>localStorage.getItem('gym_session_id')),'77777777-7777-4777-8777-777777777777');
    await legacyPage.getByRole('button',{name:'Отметить подход выполненным',exact:true}).click();
    await waitFor(async()=>legacyPage.evaluate(()=>JSON.parse(localStorage.getItem('gym_offline_queue_v2')||'[]').length===0));
    const legacyState=await state();
    const old=legacyState.gym_sets.find(s=>s.client_request_id==='88888888-8888-4888-8888-888888888888');
    const added=legacyState.gym_sets.find(s=>s.client_request_id==='99999999-9999-4999-8999-999999999999');
    assert.deepEqual([old.input_weight_kg,old.total_weight_kg],[20,60]);
    assert.deepEqual([added.input_weight_kg,added.total_weight_kg],[25,70]);
    assert.equal(added.source_payload.load.inputMode,undefined);
    assert.equal(legacyState.gym_sets.length,25);assert.deepEqual(legacyErrors,[]);
    results.push({viewport:'mobile',legacyDraftUnitsPreserved:true,preexistingQueuePreserved:true,stableRequestIds:true,runtimeErrors:legacyErrors});
    await legacyCtx.close();
    fs.writeFileSync(path.join(OUTPUT,'results.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify(results));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
