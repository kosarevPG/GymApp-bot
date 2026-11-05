const RPE_MIN = 1;
const RPE_MAX = 10;

/** Новое содержимое поля RPE. Клавиша, уводящая значение за 10, не срабатывает. */
export function acceptRpeInput(next: string, current: string): string {
  if (next === '') return '';
  const value = Number(next);
  return Number.isFinite(value) && value >= 0 && value <= RPE_MAX ? next : current;
}

/** RPE для отправки: необязательное поле, недопустимое значение просто не уходит. */
export function rpeForSave(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const rpe = parseFloat(String(value));
  return rpe >= RPE_MIN && rpe <= RPE_MAX ? rpe : undefined;
}

/** Вес и повторы, с которыми подход можно отметить выполненным. */
export function completableSet(weight: string, reps: string): boolean {
  return parseFloat(weight) >= 0 && parseInt(reps, 10) > 0;
}
