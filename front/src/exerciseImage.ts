const BUCKET = 'https://storage.yandexcloud.net/gymapp-kpg-photos';
const CATALOGUE_GIF = /^(https:\/\/storage\.yandexcloud\.net\/gymapp-kpg-photos\/exercises\/catalogue\/[^?#]+)\.gif$/;

/**
 * Адрес миниатюры для списка. Каждый GIF весит от сотен килобайт до мегабайт и в
 * списке из десятков упражнений не нужен: рядом лежит статичный кадр, который
 * делает scripts/build_exercise_thumbnails.py (правило адреса там то же).
 * - GIF каталога в бакете — `<имя>.thumb.webp` рядом с файлом;
 * - GIF с других сайтов — `exercises/thumbs/<хост><путь>.thumb.webp` в бакете.
 * Остальные картинки — как есть. Если кадра нет, список покажет сам файл.
 */
export function exerciseThumbnailUrl(imageUrl: string): string {
  if (CATALOGUE_GIF.test(imageUrl)) return imageUrl.replace(CATALOGUE_GIF, '$1.thumb.webp');
  let url: URL;
  try { url = new URL(imageUrl); } catch { return imageUrl; }
  if (url.protocol !== 'https:' || url.search || url.hash || !/\.gif$/i.test(url.pathname)) return imageUrl;
  return `${BUCKET}/exercises/thumbs/${url.hostname}${url.pathname.replace(/\.gif$/i, '')}.thumb.webp`;
}
