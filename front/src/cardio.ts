/**
 * Кардио — отрезки с постоянными параметрами: минуты, скорость, наклон.
 * Сменил скорость по ходу — это второй отрезок. В силовые подходы, повторы
 * и тоннаж кардио не попадает нигде.
 */

export interface CardioSegmentValues {
  minutes?: number | string | null;
  speed?: number | string | null;
  incline?: number | string | null;
}

/** Быстрый выбор длительности на активном отрезке. */
export const CARDIO_QUICK_MINUTES = [10, 15, 20];

export const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const fmt = (value: number): string => String(Math.round(value * 10) / 10);

/** «10 мин, 6 км/ч, наклон 5%». Незаданные скорость и наклон не пишутся. */
export function formatCardioSegment(segment: CardioSegmentValues | null | undefined): string {
  const minutes = toNumber(segment?.minutes) ?? 0;
  const parts = [`${fmt(minutes)} мин`];
  const speed = toNumber(segment?.speed);
  if (speed !== null) parts.push(`${fmt(speed)} км/ч`);
  const incline = toNumber(segment?.incline);
  if (incline !== null && incline !== 0) parts.push(`наклон ${fmt(incline)}%`);
  return parts.join(', ');
}

/** Отрезки подряд: «10 мин, 6 км/ч · 10 мин, 5 км/ч». */
export function formatCardioSegments(segments: CardioSegmentValues[] | null | undefined): string {
  return (Array.isArray(segments) ? segments.filter(Boolean) : []).map(formatCardioSegment).join(' · ');
}

/** Секунды для сервера из того, что введено в поле минут; null — не число. */
export function durationSeconds(minutes: unknown): number | null {
  const value = toNumber(minutes);
  return value !== null && value > 0 ? Math.round(value * 60) : null;
}
