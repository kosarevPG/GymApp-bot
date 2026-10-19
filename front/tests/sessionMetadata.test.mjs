import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(await readFile(new URL('../src/sessionMetadata.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020},
}).outputText;
const { pendingSessionMetadata } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('pending location overlays stale/offline history without changing other sessions', () => {
  const history = [{id:'a',location:null,duration:'2м'},{id:'b',location:'gym',duration:'4м'}];
  const queue = [
    {type:'saveSet',data:{session_id:'a',location:'gym'}},
    {type:'updateSession',data:{session_id:'a',location:'home'}},
  ];
  assert.deepEqual(pendingSessionMetadata(history,queue),[{id:'a',location:'home',duration:'2м'},history[1]]);
  assert.equal(history[0].location,null);
  assert.equal(pendingSessionMetadata(history,[...queue,{type:'updateSession',data:{session_id:'a',location:null}}])[0].location,null);
});
