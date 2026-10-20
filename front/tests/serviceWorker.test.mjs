import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source=(await readFile(new URL('../scripts/service-worker.template.js',import.meta.url),'utf8'))
 .replaceAll('__BASE__',JSON.stringify('/GymApp-bot/')).replaceAll('__VERSION__',JSON.stringify('test'))
 .replaceAll('__PRECACHE__',JSON.stringify(['/GymApp-bot/','/GymApp-bot/assets/app.js']));
function worker() {
 const events={},deleted=[],opened=[];
 const cached=new Response('cached');
 const context={URL,Request,Set,self:{location:{origin:'https://example.test'},addEventListener:(name,fn)=>events[name]=fn,
  clients:{claim:async()=>{}},skipWaiting(){throw Error('automatic activation is forbidden');}},
 caches:{open:async name=>{opened.push(name);return{match:async()=>cached,addAll:async()=>{}};},
  keys:async()=>['unrelated-site','gymapp-shell:/Other/:old','gymapp-shell:/GymApp-bot/:old','gymapp-shell:/GymApp-bot/:test'],
  delete:async name=>{deleted.push(name);return true;}},fetch(){throw Error('cached shell must not wait for network');}};
 vm.runInNewContext(source,context);
 return{events,deleted,opened,cached};
}
test('worker bypasses APIs, authorization, writes, third parties and unrelated sites',()=>{
 const w=worker();
 for(const request of [new Request('https://api.test/?url=/api/global_history'),
  new Request('https://example.test/GymApp-bot/?url=/api/init'),
  new Request('https://example.test/GymApp-bot/assets/app.js',{headers:{Authorization:'Bearer private'}}),
  new Request('https://example.test/GymApp-bot/assets/app.js',{method:'POST',body:'private'}),
  new Request('https://example.test/Other/'),new Request('https://example.test/GymApp-bot/private.json')])
  w.events.fetch({request,respondWith(){assert.fail('private or unrelated request was intercepted');}});
});
test('cached app code and deep-linked navigation do not request the network',async()=>{
 const w=worker();
 for(const request of [new Request('https://example.test/GymApp-bot/assets/app.js'),
  {url:'https://example.test/GymApp-bot/?session=id',method:'GET',mode:'navigate',headers:new Headers()}]) {
  let response;w.events.fetch({request,respondWith:value=>response=value});assert.equal(await response,w.cached);
 }
});
test('activation cleans only older versions of this app and preserves other sites',async()=>{
 const w=worker();let pending;w.events.activate({waitUntil:value=>pending=value});await pending;
 assert.deepEqual(w.deleted,['gymapp-shell:/GymApp-bot/:old']);
});
