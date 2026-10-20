// Only a loopback preview and the memory-only API fixture are permitted.
const { chromium } = require(process.env.GYMAPP_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SITE = process.env.GYMAPP_TEST_SITE || 'http://127.0.0.1:5175/GymApp-bot/';
const FIXTURE = 'http://127.0.0.1:8766';
const OUTPUT = process.env.GYMAPP_TEST_OUTPUT || path.resolve('test-results/local-history');
assert.equal(new URL(SITE).hostname, '127.0.0.1');
fs.mkdirSync(OUTPUT, {recursive:true});
const until = async fn => { for(let i=0;i<80;i++){ if(await fn())return; await new Promise(r=>setTimeout(r,50)); } assert.fail('Condition timed out'); };
(async()=>{
 const browser=await chromium.launch({headless:true}); const results=[];
 try{
  for(const [name,viewport] of [['desktop',{width:1280,height:900}],['mobile',{width:390,height:844}]]){
   await fetch(FIXTURE+'/__reset',{method:'POST'});
   const ctx=await browser.newContext({viewport,isMobile:name==='mobile',hasTouch:name==='mobile',timezoneId:'Europe/Moscow'});
   let mode='normal', globalRequests=0, analyticsRequests=0, releases=[];
   await ctx.addInitScript(()=>{
    window.Telegram={WebApp:{initData:'fixture-only',initDataUnsafe:{},ready(){},expand(){},HapticFeedback:{impactOccurred(){},notificationOccurred(){}}}};
    Object.defineProperty(navigator,'onLine',{get:()=>!localStorage.getItem('__test_offline'),configurable:true});
   });
   await ctx.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),endpoint=url.searchParams.get('url');
    if(endpoint?.startsWith('/api/')){
     if(endpoint==='/api/global_history')globalRequests++;
     if(endpoint.startsWith('/api/analytics'))analyticsRequests++;
     if(mode==='hold' && (endpoint==='/api/global_history'||endpoint.startsWith('/api/analytics')))
      await new Promise(resolve=>releases.push(resolve));
     if(mode==='fail')return route.fulfill({status:503,body:'{}',contentType:'application/json'});
     const response=await fetch(FIXTURE+'/?'+new URLSearchParams({url:endpoint}),{method:request.method(),headers:{'Content-Type':'application/json'},...(request.postData()?{body:request.postData()}:{})});
     const body=await response.text();
     const data=endpoint==='/api/global_history'?JSON.parse(body).map(s=>s.date==='2026.10.12'?{...s,duration:'≈61м'}:s):null;
     return route.fulfill({status:response.status,body:data?JSON.stringify(data):body,contentType:'application/json'});
    }
    if(url.hostname==='127.0.0.1')return route.continue();
    return route.fulfill({status:200,body:'',contentType:'application/javascript'});
   });
   const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const nav=()=>page.getByRole('navigation',{name:'Основная навигация'});
   const hasCache=kind=>page.evaluate(kind=>!!localStorage.getItem('gym_read_cache_v1:telegram:unknown:'+kind),kind);
   await page.goto(SITE);await until(()=>hasCache('journal'));
   await nav().getByRole('button',{name:'Аналитика',exact:true}).click();
   await page.getByRole('heading',{name:'Подходы по мышцам',exact:true}).waitFor();
   await until(()=>hasCache('analytics:14'));
   assert.equal(globalRequests,1,'startup, home and analytics do not duplicate journal reads');
   mode='hold';globalRequests=0;analyticsRequests=0;
   await page.evaluate(()=>{for(const key of Object.keys(localStorage)){if(key.startsWith('gym_read_cache_v1:')){const value=JSON.parse(localStorage.getItem(key));value.updatedAt=1;localStorage.setItem(key,JSON.stringify(value));}}});
   await page.reload();await page.getByRole('heading',{name:'Главная',exact:true}).waitFor();
   await page.waitForTimeout(300);await page.screenshot({path:path.join(OUTPUT,`${name}-home.png`),fullPage:true});
   const start=Date.now();await nav().getByRole('button',{name:'История',exact:true}).click();
   await page.getByText('2026.10.12',{exact:false}).first().waitFor({timeout:1200});
   const historyMs=Date.now()-start;assert.ok(historyMs<1200);
   assert.equal(globalRequests,1,'one background request is shared while the API is stalled');
   await page.getByText('2026.10.12',{exact:false}).first().click();
   await page.getByLabel('Место тренировки 2026.10.12').waitFor();
   assert.equal(await page.getByLabel('Место тренировки 2026.10.12').inputValue(),'home');
   await page.waitForTimeout(300);await page.screenshot({path:path.join(OUTPUT,`${name}-history.png`),fullPage:true});
   await nav().getByRole('button',{name:'Главная',exact:true}).click();
   await page.getByRole('button',{name:'Сводка для тренера',exact:false}).click();
   await page.getByRole('button',{name:'14 дн.',exact:true}).click();
   await page.getByText('12.10 · 🏠 Дома · ≈61м',{exact:true}).waitFor({timeout:1200});
   const analyticsStart=Date.now();await nav().getByRole('button',{name:'Аналитика',exact:true}).click();
   await page.getByRole('heading',{name:'Подходы по мышцам',exact:true}).waitFor({timeout:1200});
   const analyticsMs=Date.now()-analyticsStart;assert.ok(analyticsMs<1200);
   assert.equal(globalRequests,1);
   await page.waitForTimeout(300);await page.screenshot({path:path.join(OUTPUT,`${name}-analytics.png`),fullPage:true});
   mode='normal';releases.splice(0).forEach(resolve=>resolve());
   await until(()=>page.evaluate(()=>!document.querySelector('[aria-label="Обновить: аналитика"]')?.disabled));
   mode='fail';await page.evaluate(()=>{const key='gym_read_cache_v1:telegram:unknown:journal';const value=JSON.parse(localStorage.getItem(key));value.updatedAt=1;localStorage.setItem(key,JSON.stringify(value));});
   await page.reload();await nav().getByRole('button',{name:'История',exact:true}).click();
   await page.getByText('2026.10.12',{exact:false}).first().waitFor({timeout:1200});
   await page.getByText('История на устройстве · обновить не удалось',{exact:true}).waitFor();
   await page.evaluate(()=>{localStorage.setItem('__test_offline','1');dispatchEvent(new Event('offline'));});
   await page.reload();const beforeOffline=globalRequests;
   await nav().getByRole('button',{name:'История',exact:true}).click();
   await page.getByText('2026.10.12',{exact:false}).first().click();
   await page.getByRole('button',{name:'Повторить тренировку',exact:true}).click();
   await page.getByText('Упражнение 1 из 5',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Отметить подход выполненным',exact:true}).first().click();
   const queued=await page.evaluate(()=>JSON.parse(localStorage.getItem('gym_offline_queue_v2')).map(q=>q.id));
   assert.equal(queued.length,2);
   await page.reload();await nav().getByRole('button',{name:'Главная',exact:true}).click();
   await page.getByRole('heading',{name:'Текущая тренировка',exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('gym_offline_queue_v2')).map(q=>q.id)),queued);
   assert.equal(globalRequests,beforeOffline);
   assert.ok(await nav().getByRole('button',{name:'Очередь синхронизации: 2',exact:true}).isVisible());
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual(errors,[]);
   results.push({viewport:name,historyVisibleMs:historyMs,cachedAnalyticsVisibleMs:analyticsMs,
    sharedBackgroundReads:1,failedRefreshKeptHistory:true,offlineRepeat:true,stableQueueAcrossReload:true,runtimeErrors:errors});
   console.log(results.at(-1));await ctx.close();
  }
  fs.writeFileSync(path.join(OUTPUT,'results.json'),JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
