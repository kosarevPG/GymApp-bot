// Local generated sw.js is temporarily versioned; the exact original is restored in finally.
const {chromium}=require(process.env.GYMAPP_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const SITE=process.env.GYMAPP_TEST_SITE||'http://127.0.0.1:5175/GymApp-bot/',FIXTURE='http://127.0.0.1:8766';
const OUTPUT=process.env.GYMAPP_TEST_OUTPUT||path.resolve('test-results/offline-update');
const workerFile=path.resolve('dist/sw.js'),original=fs.readFileSync(workerFile,'utf8');
assert.equal(new URL(SITE).hostname,'127.0.0.1');fs.mkdirSync(OUTPUT,{recursive:true});
const until=async fn=>{for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}assert.fail('Condition timed out');};
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  await fetch(FIXTURE+'/__reset',{method:'POST'});
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Moscow'});
  let holdWrites=false,navigations=0;const errors=[];
  await ctx.addInitScript(()=>{window.Telegram={WebApp:{initData:'fixture-only',initDataUnsafe:{},ready(){},expand(){},HapticFeedback:{impactOccurred(){},notificationOccurred(){}}}};});
  await ctx.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),endpoint=url.searchParams.get('url');
   if(endpoint?.startsWith('/api/')){
    if(holdWrites&&request.method()!=='GET')return route.fulfill({status:503,body:'{}',contentType:'application/json'});
    const response=await fetch(FIXTURE+'/?'+new URLSearchParams({url:endpoint}),{method:request.method(),headers:{'Content-Type':'application/json'},...(request.postData()?{body:request.postData()}:{})});
    return route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});
   }
   if(url.hostname==='127.0.0.1')return route.continue();return route.abort('blockedbyclient');
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  await page.goto(SITE);await page.evaluate(()=>navigator.serviceWorker.ready);
  await until(()=>page.evaluate(()=>!!navigator.serviceWorker.controller));
  await page.evaluate(async()=>{const cache=await caches.open('unrelated-app');await cache.put('/other-sentinel',new Response('preserve'));});
  await page.getByRole('button',{name:'Выбрать из истории',exact:true}).click();
  await page.getByText('2026.10.12',{exact:false}).first().click();await page.getByRole('button',{name:'Повторить тренировку',exact:true}).click();
  await page.getByRole('button',{name:'Начать подход',exact:true}).click();
  const since=await page.evaluate(()=>JSON.parse(localStorage.getItem('gym_workout_clock_v1')).since);
  const beforeNavigation=navigations;
  const replacement=original.replace(/const CACHE = PREFIX \+ "[^"]+";/,'const CACHE = PREFIX + "fixture-update";');
  assert.notEqual(replacement,original);fs.writeFileSync(workerFile,replacement);
  await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
  await until(()=>page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting));
  const update=()=>page.getByRole('button',{name:'Обновить приложение',exact:true});
  await update().waitFor();assert.ok(await update().isDisabled());
  await page.waitForTimeout(500);
  assert.equal(navigations,beforeNavigation,'installing a version never reloads a running workout');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('gym_workout_clock_v1')).since),since);
  holdWrites=true;
  await page.getByRole('button',{name:'Подход выполнен',exact:true}).click();await page.getByRole('button',{name:'Вся тренировка',exact:true}).click();
  await page.getByRole('button',{name:'Завершить тренировку',exact:true}).click();await page.getByRole('button',{name:'Да, закончить',exact:true}).click();
  await until(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('gym_offline_queue_v2')||'[]').length>0));
  assert.ok(await update().isDisabled(),'pending results also prevent activation');
  await page.getByText('Новая версия готова. Дождитесь отправки результатов.',{exact:true}).waitFor();
  holdWrites=false;await page.evaluate(()=>dispatchEvent(new Event('online')));
  await until(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('gym_offline_queue_v2')||'[]').length===0));
  await until(async()=>await update().isEnabled());
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),update().click()]);
  await page.getByRole('heading',{name:'Главная',exact:true}).waitFor();
  const cacheNames=await page.evaluate(()=>caches.keys());
  assert.ok(cacheNames.includes('unrelated-app'));
  assert.equal(cacheNames.filter(name=>name.startsWith('gymapp-shell:/GymApp-bot/:')).length,1);
  const state=await(await fetch(FIXTURE+'/__state')).json();assert.equal(state.gym_sets.length,24);
  assert.equal(new Set(state.gym_sets.map(row=>row.client_request_id)).size,24);
  assert.deepEqual(errors,[]);
  const result={noReloadDuringWorkout:true,timerUnchanged:true,updateWaitsForQueue:true,explicitUpdateReloads:true,
   unrelatedCachePreserved:true,oneActiveShellCache:true,recordedSets:24,noDuplicates:true,productionMutations:0,runtimeErrors:errors};
  fs.writeFileSync(path.join(OUTPUT,'results.json'),JSON.stringify(result,null,2));console.log(result);await ctx.close();
 }finally{fs.writeFileSync(workerFile,original);await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
