import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const modules = new Map();
export async function moduleUrl(path) {
  const url = new URL(path, import.meta.url);
  if (modules.has(url.href)) return modules.get(url.href);
  let compiled = ts.transpileModule(await readFile(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  for (const match of [...compiled.matchAll(/from ['"]([^'"]+)['"]/g)]) {
    if (!match[1].startsWith('.')) continue;
    const dependency = new URL(match[1] + '.ts', url);
    compiled = compiled.replaceAll(match[0], `from '${await moduleUrl(dependency.href)}'`);
  }
  const result = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
  modules.set(url.href, result);
  return result;
}
export const loadTs = async path => import(await moduleUrl(path));
