// Regression checks use only the loopback MemoryClient and an isolated browser.
const {chromium}=require(process.env.GYMAPP_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const SITE=process.env.GYMAPP_TEST_SITE||'http://127.0.0.1:5175/GymApp-bot/',FIXTURE='http://127.0.0.1:8766';
const OUTPUT=process.env.GYMAPP_TEST_OUTPUT||path.resolve('test-results/exercise-catalogue');
assert.equal(new URL(SITE).hostname,'127.0.0.1');fs.mkdirSync(OUTPUT,{recursive:true});
const until=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}assert.fail('Condition timed out');};
(async()=>{
 const browser=await chromium.launch({headless:true}),results=[];
 try{
  for(const [name,viewport] of [['desktop',{width:1280,height:900}],['mobile',{width:390,height:844}],['compact',{width:320,height:720}]]){
   await fetch(FIXTURE+'/__reset',{method:'POST'});
   const ctx=await browser.newContext({viewport,isMobile:name!=='desktop',hasTouch:name!=='desktop',timezoneId:'Europe/Moscow'});
   const errors=[];let apiReads=0;
   await ctx.addInitScript(()=>{
    window.Telegram={WebApp:{initData:'fixture-only',initDataUnsafe:{},ready(){},expand(){},HapticFeedback:{impactOccurred(){},notificationOccurred(){}}}};
    Object.defineProperty(navigator,'onLine',{get:()=>!localStorage.getItem('__catalogue_offline'),configurable:true});
   });
   await ctx.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),endpoint=url.searchParams.get('url');
    if(endpoint?.startsWith('/api/')){
     apiReads++;
     const response=await fetch(FIXTURE+'/?'+new URLSearchParams({url:endpoint}),{method:request.method(),headers:{'Content-Type':'application/json'},...(request.postData()?{body:request.postData()}:{})});
     return route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});
    }
    if(url.hostname==='127.0.0.1')return route.continue();return route.abort('blockedbyclient');
   });
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(SITE);await until(()=>page.evaluate(()=>!!localStorage.getItem('gym_read_cache_v1:telegram:unknown:catalogue')&&!!localStorage.getItem('gym_read_cache_v1:telegram:unknown:journal')));
   await page.evaluate(()=>localStorage.setItem('__catalogue_offline','1'));const beforeReads=apiReads;
   const nav=()=>page.getByRole('navigation',{name:'Основная навигация'});
   const search=()=>page.getByRole('searchbox',{name:'Поиск упражнений',exact:true});
   const groups=()=>page.getByRole('group',{name:'Группы мышц',exact:true});
   await page.getByRole('button',{name:'Справочник упражнений',exact:false}).click();
   await search().waitFor();assert.equal(await search().inputValue(),'');
   assert.equal(await groups().getByRole('button',{name:'Все',exact:true}).getAttribute('aria-pressed'),'true');
   assert.ok(await page.getByRole('region',{name:'Упражнения: Грудь',exact:true}).isVisible());
   await page.waitForTimeout(250);await page.screenshot({path:path.join(OUTPUT,`${name}-catalogue.png`),fullPage:true});
   await search().fill('  ЖИМ  ');await page.getByText('Жим штанги',{exact:true}).waitFor();
   assert.equal(await page.getByText('Приседания в Гакк',{exact:true}).count(),0);assert.ok(await search().evaluate(el=>el===document.activeElement));
   await groups().getByRole('button',{name:'Ноги',exact:true}).click();
   await page.getByText('Упражнения не найдены. Измените название или выберите другую группу.',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Очистить поиск',exact:true}).click();await search().waitFor();
   assert.equal(await search().inputValue(),'');await page.getByText('Приседания в Гакк',{exact:true}).waitFor();
   assert.equal(await page.getByText('Жим штанги',{exact:true}).count(),0);
   await search().fill('ничего такого');await page.getByRole('button',{name:'Сбросить поиск и группу',exact:true}).click();
   assert.equal(await search().inputValue(),'');assert.equal(await groups().getByRole('button',{name:'Все',exact:true}).getAttribute('aria-pressed'),'true');
   await nav().getByRole('button',{name:'Главная',exact:true}).click();await page.getByRole('button',{name:'Новая тренировка',exact:true}).click();
   await page.getByRole('button',{name:'Добавить упражнение',exact:true}).click();
   await page.getByRole('heading',{name:'Добавить упражнение',exact:true}).waitFor();await search().waitFor();
   await groups().getByRole('button',{name:'Грудь',exact:true}).click();await search().fill('жим');
   await page.getByText('Жим штанги',{exact:true}).click();await page.getByRole('button',{name:'Начать подход',exact:true}).click();
   await page.getByRole('button',{name:'Подход выполнен',exact:true}).click();await page.getByRole('button',{name:'Вся тренировка',exact:true}).click();
   const queueIds=await page.evaluate(()=>JSON.parse(localStorage.getItem('gym_offline_queue_v2')).map(q=>q.id));
   await page.getByRole('button',{name:'Заменить',exact:true}).first().click();
   await page.getByRole('heading',{name:'Заменить упражнение',exact:true}).waitFor();assert.equal(await search().inputValue(),'');
   await groups().getByRole('button',{name:'Ноги',exact:true}).click();await search().fill('гАкК');await page.getByText('Приседания в Гакк',{exact:true}).click();
   await page.getByText('Приседания в Гакк',{exact:true}).first().waitFor();
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('gym_offline_queue_v2')).map(q=>q.id)),queueIds);
   await page.reload();await page.getByRole('button',{name:'Вся тренировка',exact:true}).click();await page.getByRole('button',{name:'Добавить упражнение',exact:true}).click();
   await search().waitFor();assert.equal(await search().inputValue(),'');await groups().getByRole('button',{name:'Все',exact:true}).waitFor();
   await until(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)); // The spring entrance must settle before measuring.
   const bounds=await search().boundingBox();assert.ok(bounds.height>=44&&bounds.x>=0&&bounds.x+bounds.width<=viewport.width);
   const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    overflowing:[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right})).filter(el=>el.right>innerWidth+0.5).slice(0,6)}));
   assert.ok(layout.scrollWidth<=layout.width,JSON.stringify(layout));
   assert.equal(apiReads,beforeReads,'local searching, choosing and offline edits never request API data');
   const state=await(await fetch(FIXTURE+'/__state')).json();assert.equal(state.gym_sets.length,23);assert.deepEqual(errors,[]);
   const result={viewport:name,emptySearchVisible:true,groupedCatalogue:true,combinedSearchAndGroup:true,caseAndWhitespace:true,clearAndEmptyRecovery:true,
    addAndReplaceWithSearch:true,queuePreserved:true,offlineReload:true,localReads:0,sourceSetsPreserved:23,runtimeErrors:errors};
   results.push(result);console.log(result);await ctx.close();
  }
  fs.writeFileSync(path.join(OUTPUT,'results.json'),JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
