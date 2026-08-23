/**
 * Конфигурация расчёта веса для gymtracker.
 *
 * Формулы согласованы с колонкой Real_Load_Kg в Google-таблице:
 * Real_Load_Kg = Input_Weight × Multiplier + Base_Wt (VLOOKUP в EXERCISES).
 *
 * Weight_Type в каталоге:
 *  - Machine       — вес стека: ввод = итог (mult=1, base=0)
 *  - Barbell       — mult=2: ввод «блины с одной стороны», base = гриф;
 *                    mult=1: ввод «блины всего», base = гриф
 *  - Dumbbell      — mult=2: ввод = вес одной гантели, итог за пару
 *  - Plate_Loaded  — ввод «блины всего», base = вес каретки/базы
 *  - Bodyweight    — ввод «+кг», итог = вес тела × mult + ввод + base
 *  - Assisted      — ввод = противовес гравитрона, итог = вес тела − ввод
 *                    (в таблице то же выражено через Multiplier=−1, Base_Wt=90)
 */

export const USER_BODY_WEIGHT_DEFAULT = 90;

export interface ExerciseForWeight {
  weightType?: string;
  baseWeight?: number;
  weightMultiplier?: number;
}

const normType = (exercise: ExerciseForWeight | null | undefined): string =>
  (exercise?.weightType ?? '').trim().toLowerCase();

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Вычисляет эффективный (общий) вес — он пишется в Total_Weight,
 * по нему считаются 1RM, PR, тоннаж и графики.
 */
export function calcEffectiveWeight(
  exercise: ExerciseForWeight | null | undefined,
  inputWeight: number,
  bodyWeight: number = USER_BODY_WEIGHT_DEFAULT
): number {
  if (!exercise) return inputWeight;
  const base = exercise.baseWeight ?? 0;
  const mult = exercise.weightMultiplier ?? 1;
  const type = normType(exercise);
  if (type === 'bodyweight') return round1(bodyWeight * mult + inputWeight + base);
  if (type === 'assisted') return round1(bodyWeight - inputWeight);
  return round1(inputWeight * mult + base);
}

/**
 * Обратное преобразование: эффективный вес → значение для поля ввода.
 */
export function toInputWeight(
  exercise: ExerciseForWeight | null | undefined,
  effectiveWeight: number,
  bodyWeight: number = USER_BODY_WEIGHT_DEFAULT
): number {
  if (!exercise) return round1(effectiveWeight);
  const base = exercise.baseWeight ?? 0;
  const mult = exercise.weightMultiplier ?? 1;
  const type = normType(exercise);
  if (type === 'bodyweight') return round1(effectiveWeight - bodyWeight * mult - base);
  if (type === 'assisted') return round1(bodyWeight - effectiveWeight);
  return round1(mult ? (effectiveWeight - base) / mult : effectiveWeight - base);
}

/**
 * Подпись колонки веса: подсказывает, ЧТО вводить для этого упражнения.
 */
export function weightInputLabel(exercise: ExerciseForWeight | null | undefined): string {
  const mult = exercise?.weightMultiplier ?? 1;
  const base = exercise?.baseWeight ?? 0;
  switch (normType(exercise)) {
    case 'assisted':
      return 'ПРОТИВОВЕС';
    case 'bodyweight':
      return '+КГ';
    case 'barbell':
      return mult === 2 ? 'КГ/СТОРОНА' : 'БЛИНЫ, КГ';
    case 'dumbbell':
      return mult === 2 ? 'КГ, 1 ГАНТ' : 'КГ';
    case 'plate_loaded':
      return base > 0 ? 'БЛИНЫ, КГ' : 'КГ';
    default:
      return 'КГ';
  }
}

/** Варианты типа нагрузки для редактора упражнения. */
export const WEIGHT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'Machine', label: 'Блок/стек' },
  { value: 'Barbell', label: 'Штанга' },
  { value: 'Dumbbell', label: 'Гантели' },
  { value: 'Plate_Loaded', label: 'Блины' },
  { value: 'Bodyweight', label: 'Свой вес' },
  { value: 'Assisted', label: 'Гравитрон' },
];
