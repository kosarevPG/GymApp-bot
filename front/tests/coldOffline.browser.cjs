// Loopback build and MemoryClient only. The browser is truly disconnected after installation.
const {chromium}=require(process.env.GYMAPP_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const SITE=process.env.GYMAPP_TEST_SITE||'http://127.0.0.1:5175/GymApp-bot/';
const FIXTURE='http://127.0.0.1:8766',OWNER='11111111-1111-4111-8111-111111111111';
const OUTPUT=process.env.GYMAPP_TEST_OUTPUT||path.resolve('test-results/cold-offline');
assert.equal(new URL(SITE).hostname,'127.0.0.1');fs.mkdirSync(OUTPUT,{recursive:true});
const until=async fn=>{for(let i=0;i<120;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}assert.fail('Condition timed out');};
const jwt=expires=>['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',Buffer.from(JSON.stringify({sub:OWNER,aud:'authenticated',role:'authenticated',exp:expires})).toString('base64url'),'fixture-signature'].join('.');
const session=()=>{const expires=Math.floor(Date.now()/1000)+3600;return {access_token:jwt(expires),refresh_token:'fixture-refresh',token_type:'bearer',expires_at:expires,expires_in:3600,
 user:{id:OWNER,aud:'authenticated',role:'authenticated',email:'fixture@example.test',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:'2026-01-01T00:00:00Z'}};};
(async()=>{
 const browser=await chromium.launch({headless:true}),results=[];
 try{
  for(const [name,viewport] of [['desktop',{width:1280,height:900}],['mobile',{width:390,height:844}]]){
   await fetch(FIXTURE+'/__reset',{method:'POST'});
   const ctx=await browser.newContext({viewport,isMobile:name==='mobile',hasTouch:name==='mobile',timezoneId:'Europe/Moscow'});
   let offline=false,apiReads=0,apiWrites=0,analyticsReads=0;const errors=[];
   await ctx.addInitScript(seed=>{
    if(localStorage.getItem('__cold_seeded'))return;
    localStorage.setItem('__cold_seeded','1');localStorage.setItem('sb-yafpqobpgqffkahvwwki-auth-token',JSON.stringify(seed));
   },session());
   await ctx.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),endpoint=url.searchParams.get('url');
    if(endpoint?.startsWith('/api/')){
     if(request.method()==='GET')apiReads++;else apiWrites++;
     if(endpoint.startsWith('/api/analytics'))analyticsReads++;
     if(offline)return route.abort('internetdisconnected');
     const response=await fetch(FIXTURE+'/?'+new URLSearchParams({url:endpoint}),{method:request.method(),headers:{'Content-Type':'application/json'},...(request.postData()?{body:request.postData()}:{})});
     return route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});
    }
    if(url.pathname.startsWith('/auth/v1/')){
     if(offline)return route.abort('internetdisconnected');
     return route.fulfill({status:200,body:JSON.stringify(url.pathname.endsWith('/user')?session().user:session()),contentType:'application/json'});
    }
    if(url.hostname==='127.0.0.1')return route.continue();
    return route.abort('blockedbyclient');
   });
   let page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(SITE);await page.getByRole('heading',{name:'Главная',exact:true}).waitFor();
   await until(()=>page.evaluate(()=>!!localStorage.getItem('gym_read_cache_v1:supabase:11111111-1111-4111-8111-111111111111:journal')&&!!localStorage.getItem('gym_offline_account_v1')));
   await page.evaluate(()=>navigator.serviceWorker.ready);
   await until(()=>page.evaluate(()=>!!navigator.serviceWorker.controller));
   assert.equal(analyticsReads,0,'warming the home page never fetches analytics');
   await page.evaluate(()=>{
    const key='sb-yafpqobpgqffkahvwwki-auth-token',value=JSON.parse(localStorage.getItem(key));
    value.expires_at=Math.floor(Date.now()/1000)-600;localStorage.setItem(key,JSON.stringify(value));
   });
   await page.close();offline=true;await ctx.setOffline(true);
   const beforeReads=apiReads,beforeWrites=apiWrites,start=Date.now();
   page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(SITE,{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Главная',exact:true}).waitFor({timeout:5000});
   const coldStartMs=Date.now()-start;
   const nav=()=>page.getByRole('navigation',{name:'Основная навигация'});
   await nav().getByRole('button',{name:'Аналитика',exact:true}).click();
   await page.getByRole('heading',{name:'Подходы по мышцам',exact:true}).waitFor({timeout:1200});
   for(const label of ['Неделя','2 недели','4 недели']){
    await page.getByRole('button',{name:label,exact:true}).click();
    await page.getByRole('heading',{name:'Подходы по мышцам',exact:true}).waitFor({timeout:1200});
   }
   assert.equal(apiReads,beforeReads);assert.equal(apiWrites,beforeWrites);assert.equal(analyticsReads,0);
   await page.getByRole('button',{name:'2 недели',exact:true}).click();
   const cacheKey='gym_read_cache_v1:supabase:'+OWNER+':analytics:14';
   await until(()=>page.evaluate(key=>!!localStorage.getItem(key),cacheKey));
   const baseline=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).data.volume,cacheKey);
   await page.waitForTimeout(350);await page.screenshot({path:path.join(OUTPUT,`${name}-offline-analytics.png`),fullPage:true});
   await nav().getByRole('button',{name:'История',exact:true}).click();
   await page.getByText('2026.10.12',{exact:false}).first().click();
   await page.getByRole('button',{name:'Повторить тренировку',exact:true}).click();
   await page.getByRole('button',{name:'Начать подход',exact:true}).click();
   const clock=await page.evaluate(()=>JSON.parse(localStorage.getItem('gym_workout_clock_v1')));
   await page.close();page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(SITE,{waitUntil:'domcontentloaded'});await page.getByText('Подход идёт',{exact:true}).waitFor();
   assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('gym_workout_clock_v1')))).since,clock.since);
   await page.getByRole('button',{name:'Подход выполнен',exact:true}).click();
   await page.getByRole('button',{name:'Вся тренировка',exact:true}).click();
   await page.getByRole('button',{name:'Завершить тренировку',exact:true}).click();
   await page.getByRole('button',{name:'Да, закончить',exact:true}).click();
   const queuedIds=await page.evaluate(()=>JSON.parse(localStorage.getItem('gym_offline_queue_v2')).map(q=>q.id));
   await nav().getByRole('button',{name:'Аналитика',exact:true}).click();
   await page.getByRole('button',{name:'2 недели',exact:true}).click();
   await until(()=>page.evaluate(({key,expected})=>JSON.parse(localStorage.getItem(key)).data.volume===expected,{key:cacheKey,expected:baseline+80}));
   assert.equal(apiReads,beforeReads);assert.equal(apiWrites,beforeWrites);
   const cacheURLs=await page.evaluate(async()=>{const urls=[];for(const key of await caches.keys())for(const request of await(await caches.open(key)).keys())urls.push(request.url);return urls;});
   assert.ok(cacheURLs.length>=7);assert.ok(cacheURLs.every(url=>url.startsWith(new URL(SITE).origin+new URL(SITE).pathname)));
   await nav().getByRole('button',{name:'Главная',exact:true}).click();
   await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:'Выйти из HealthOS',exact:true}).click();
   await page.getByRole('button',{name:'Войти',exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('gym_offline_queue_v2')).map(q=>q.id)),queuedIds);
   await page.close();page=await ctx.newPage();await page.goto(SITE,{waitUntil:'domcontentloaded'});
   await page.getByRole('button',{name:'Войти',exact:true}).waitFor({timeout:3000});
   assert.equal(await page.getByRole('heading',{name:'Главная',exact:true}).count(),0,'explicit offline logout remains locked across a cold start');
   assert.deepEqual(errors,[]);
   results.push({viewport:name,coldStartMs,trueOfflineColdStart:true,expiredSessionDoesNotBlockLocalUI:true,allAnalyticsPeriodsOffline:true,
    analyticsIncludesUnsyncedWorkout:true,timerSurvivesClosedPage:true,queuedIdsPreserved:true,explicitOfflineLogoutLocksCopies:true,analyticsRequests:0,productionMutations:0,runtimeErrors:errors});
   console.log(results.at(-1));await ctx.close();
  }
  fs.writeFileSync(path.join(OUTPUT,'results.json'),JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
