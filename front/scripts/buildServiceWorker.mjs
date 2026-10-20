import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), dist = resolve(root, 'dist');
const html = await readFile(resolve(dist, 'index.html'), 'utf8');
const moduleUrl = html.match(/<script[^>]+src="([^"]*\/assets\/[^"?]+\.js)"/)?.[1];
if (!moduleUrl?.startsWith('/')) throw new Error('Cannot determine the built app base URL');
const base = moduleUrl.slice(0, moduleUrl.lastIndexOf('/assets/') + 1);
async function walk(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? walk(resolve(folder, entry.name)) : [resolve(folder, entry.name)]))).flat();
}
const files = (await walk(dist)).filter(file => !file.endsWith('/sw.js') && !file.endsWith('\\sw.js') && !file.endsWith('.map')).sort();
const template = await readFile(resolve(root, 'scripts/service-worker.template.js'), 'utf8');
const digest = createHash('sha256').update(template);
for (const file of files) { digest.update(relative(dist, file)); digest.update(await readFile(file)); }
const version = digest.digest('hex').slice(0, 20);
const urls = [base, ...files.map(file => base + relative(dist, file).replaceAll('\\', '/'))];
const worker = template.replaceAll('__VERSION__', JSON.stringify(version))
  .replaceAll('__BASE__', JSON.stringify(base)).replaceAll('__PRECACHE__', JSON.stringify(urls));
await writeFile(resolve(dist, 'sw.js'), worker);
console.log(`Offline shell: ${urls.length} files, version ${version}`);
