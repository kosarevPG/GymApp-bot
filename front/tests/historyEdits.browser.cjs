// Only loopback fixture writes; delayed transport must never delay local edits.
const {chromium}=require(process.env.GYMAPP_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const SITE=process.env.GYMAPP_TEST_SITE||'http://127.0.0.1:5175/GymApp-bot/',FIXTURE='http://127.0.0.1:8766';
const OUTPUT=process.env.GYMAPP_TEST_OUTPUT||path.resolve('test-results/history-edits');
const SID='aad8ddfc-925c-58f7-b1eb-35108e9ee9ff';
const until=async fn=>{for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}assert.fail('Condition timed out');};
assert.equal(new URL(SITE).hostname,'127.0.0.1');fs.mkdirSync(OUTPUT,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true}),results=[];
 try{
  for(const [name,viewport] of [['desktop',{width:1280,height:900}],['mobile',{width:390,height:844}]]){
   await fetch(FIXTURE+'/__reset',{method:'POST'});
   const ctx=await browser.newContext({viewport,isMobile:name==='mobile',hasTouch:name==='mobile',timezoneId:'Europe/Moscow'});
   const deltas=[],errors=[];let mode='normal',held=[];
   await ctx.addInitScript(()=>{
    window.Telegram={WebApp:{initData:'fixture-only',initDataUnsafe:{},ready(){},expand(){},HapticFeedback:{impactOccurred(){},notificationOccurred(){}}}};
    Object.defineProperty(navigator,'onLine',{get:()=>!localStorage.getItem('__edit_offline'),configurable:true});
   });
   await ctx.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),endpoint=url.searchParams.get('url');
    if(endpoint?.startsWith('/api/')){
     const write=request.method()!=='GET'&&endpoint!=='/api/journal_sync';
     if(write&&mode==='hold')await new Promise(resolve=>held.push(resolve));
     if(write&&mode==='fail')return route.fulfill({status:503,body:'{}',contentType:'application/json'});
     const response=await fetch(FIXTURE+'/?'+new URLSearchParams({url:endpoint}),{method:request.method(),headers:{'Content-Type':'application/json'},...(request.postData()?{body:request.postData()}:{})});
     const body=await response.text();if(endpoint==='/api/journal_sync')deltas.push(JSON.parse(body));
     return route.fulfill({status:response.status,body,contentType:'application/json'});
    }
    if(url.hostname==='127.0.0.1')return route.continue();return route.abort('blockedbyclient');
   });
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(SITE);
   const cached=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('gym_read_cache_v1:telegram:unknown:journal')||'null')?.data||[]);
   const row=async()=>(await cached()).find(s=>s.id===SID).exercises[0].sets[0];
   const nav=()=>page.getByRole('navigation',{name:'Основная навигация'});
   await nav().getByRole('button',{name:'История',exact:true}).click();await page.getByText('2026.10.12',{exact:false}).first().waitFor();
   await page.getByRole('button',{name:'Обновить: история',exact:true}).click();await until(()=>deltas.length>0);
   await until(async()=>(await cached()).every(s=>!!s.syncVersion));
   const prior=deltas.length;await until(async()=>await page.getByRole('button',{name:'Обновить: история',exact:true}).isEnabled());
   await page.getByRole('button',{name:'Обновить: история',exact:true}).click();await until(()=>deltas.length>prior);
   assert.equal(deltas.at(-1).upserts.length,0,'unchanged history sends no workout bodies');
   const original=await row();const setId=original.id;
   await page.getByText('2026.10.12',{exact:false}).first().click();
   const openFirst=async()=>{await page.getByText('Махи в стороны (стоя)',{exact:true}).locator('..').getByRole('button').first().click();await page.getByLabel('Вес сохранённого подхода').waitFor();};
   mode='hold';await openFirst();await page.getByLabel('Вес сохранённого подхода').fill('3');await page.getByLabel('Повторения сохранённого подхода').fill('18');
   const save=page.getByRole('button',{name:'Сохранить',exact:true});await save.hover();
   const start=Date.now();await save.click();await until(async()=>(await row()).weight===6);
   const editVisibleMs=Date.now()-start;assert.ok(editVisibleMs<500,`local save took ${editVisibleMs}ms`);
   await page.getByRole('heading',{name:'Правка подхода',exact:true}).waitFor({state:'hidden',timeout:2000});
   assert.equal((await row()).reps,18);
   await openFirst();await page.getByLabel('Вес сохранённого подхода').fill('3.5');await page.getByLabel('Повторения сохранённого подхода').fill('17');await page.getByLabel('Отдых сохранённого подхода').fill('1.75');
   await page.getByRole('button',{name:'Сохранить',exact:true}).click();await until(async()=>(await row()).reps===17);
   const queued=await page.evaluate(()=>JSON.parse(localStorage.getItem('gym_offline_queue_v2')));assert.equal(queued.length,1);assert.equal(queued[0].id,setId);
   mode='fail';held.splice(0).forEach(resolve=>resolve());await page.waitForTimeout(200);
   await page.evaluate(()=>localStorage.setItem('__edit_offline','1'));await page.reload();
   await nav().getByRole('button',{name:'История',exact:true}).click();await page.getByText('2026.10.12',{exact:false}).first().click();await openFirst();
   assert.equal(await page.getByLabel('Вес сохранённого подхода').inputValue(),'3.5');assert.equal(await page.getByLabel('Повторения сохранённого подхода').inputValue(),'17');
   await page.getByRole('button',{name:'Закрыть окно',exact:true}).click();
   mode='normal';const beforeAck=deltas.length;await page.evaluate(()=>{localStorage.removeItem('__edit_offline');dispatchEvent(new Event('online'));});
   await until(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('gym_offline_queue_v2')||'[]').length===0));
   await until(()=>deltas.length>beforeAck);assert.equal(deltas.at(-1).upserts.length,1,'one edited set transfers one workout');
   let state=await(await fetch(FIXTURE+'/__state')).json();const saved=state.gym_sets.find(s=>s.client_request_id===setId);
   assert.deepEqual([saved.input_weight_kg,saved.total_weight_kg,saved.reps,saved.rest_seconds],[3.5,7,17,105]);assert.equal(state.gym_sets.length,23);
   await page.evaluate(()=>localStorage.setItem('__edit_offline','1'));await openFirst();await page.getByRole('button',{name:'Удалить подход',exact:true}).click();
   await until(async()=>(await cached()).find(s=>s.id===SID).exercises[0].sets.length===4);
   assert.equal((await cached()).find(s=>s.id===SID).duration,'≈60м');
   await page.waitForTimeout(300);await page.screenshot({path:path.join(OUTPUT,`${name}-pending-history.png`),fullPage:true});
   await page.getByRole('button',{name:'Удалить тренировку',exact:true}).click();await page.getByRole('button',{name:'Да, удалить',exact:true}).click();
   await until(async()=>!(await cached()).some(s=>s.id===SID));
   await page.evaluate(()=>{localStorage.removeItem('__edit_offline');dispatchEvent(new Event('online'));});
   await until(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('gym_offline_queue_v2')||'[]').length===0));
   state=await(await fetch(FIXTURE+'/__state')).json();assert.equal(state.gym_workout_sessions.length,1);assert.equal(state.gym_sets.length,2);
   assert.deepEqual(errors,[]);
   results.push({viewport:name,editVisibleMs,editDoesNotWaitForAPI:true,repeatedEditKeepsRequestId:true,offlineReloadPreservesEdit:true,
    singleWorkoutDeltaAfterEdit:true,noWorkoutPayloadWhenUnchanged:true,reportedDurationPreserved:true,offlineDeletion:true,remainingUnrelatedSets:2,productionMutations:0,runtimeErrors:errors});
   console.log(results.at(-1));await ctx.close();
  }
  fs.writeFileSync(path.join(OUTPUT,'results.json'),JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
