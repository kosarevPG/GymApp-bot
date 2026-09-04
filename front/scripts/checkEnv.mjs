/**
 * Не даёт выложить фронт, собранный без переменных окружения.
 *
 * Vite подставляет import.meta.env на этапе сборки: отсутствующая переменная
 * не ломает ни сборку, ни типы — она превращается в пустую строку, и приложение
 * уезжает в прод молча сломанным. Так уже терялся вход: сборка с неполным
 * .env.local дала supabaseAuth === null и экран «Supabase Auth не настроен».
 *
 * Проверка висит на predeploy, а не на build: CI собирает фронт без секретов,
 * и падать там незачем — важен именно путь публикации.
 */

export const REQUIRED_ENV = [
  'VITE_API_BASE_URL',
  'VITE_STANDALONE_API_BASE_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
];

/** Возвращает имена переменных, которых нет или которые пусты. */
export function findMissing(env, required = REQUIRED_ENV) {
  const source = env || {};
  return required.filter((name) => !String(source[name] ?? '').trim());
}

// Запуск как скрипта: проверяем то же окружение, что увидит Vite.
// Сравниваем реальные пути, а не строки URL — на Windows разделители разные.
const entry = process.argv[1];
let runAsScript = false;
if (entry) {
  const { realpathSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  try {
    runAsScript = realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    runAsScript = false;
  }
}

if (runAsScript) {
  const { loadEnv } = await import('vite');
  const env = loadEnv('production', process.cwd(), '');
  const missing = findMissing(env);
  if (missing.length) {
    console.error('');
    console.error('Сборка остановлена: не заданы переменные окружения');
    for (const name of missing) console.error(`  - ${name}`);
    console.error('');
    console.error('Заполни front/.env.local по образцу front/.env.example и повтори.');
    console.error('Без них приложение соберётся, но молча потеряет вход и доступ к API.');
    process.exit(1);
  }
  console.log(`Переменные окружения на месте (${REQUIRED_ENV.length} шт.)`);
}
