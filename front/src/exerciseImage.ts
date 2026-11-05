const CATALOGUE_GIF = /^(https:\/\/storage\.yandexcloud\.net\/gymapp-kpg-photos\/exercises\/catalogue\/[^?#]+)\.gif$/;

/**
 * Адрес миниатюры для списка. У GIF каталога рядом с файлом лежит статичный кадр
 * (scripts/build_exercise_thumbnails.py): целая анимация весит в сотню раз больше
 * и в списке из десятков упражнений не нужна. Остальные картинки — как есть.
 */
export function exerciseThumbnailUrl(imageUrl: string): string {
  return imageUrl.replace(CATALOGUE_GIF, '$1.thumb.webp');
}
