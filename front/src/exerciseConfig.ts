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

/**
 * Ходовой набор блинов в зале. Переопределяется в настройках: наборы
 * отличаются от зала к залу, а неверный список делает подсказку бесполезной.
 */
export const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

/**
 * Что можно отметить в настройках как имеющееся в зале. Шире набора по
 * умолчанию: 30-килограммовые блины есть не везде, но встречаются.
 */
export const PLATE_CHOICES = [30, 25, 20, 15, 10, 5, 2.5, 1.25];

/** Блины на ОДНУ сторону и сколько из них не удалось набрать. */
export interface PlateAdvice {
  items: number[];
  remainder: number;
}

export interface LoadPlan {
  /** Расшифровка: что означает введённое число и сколько выходит всего. */
  summary: string;
  total: number;
  plates: PlateAdvice | null;
}

const MAX_PLATES_PER_SIDE = 12;
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Жадно раскладывает вес на блины. Считает в сотых долях килограмма, потому
 * что 1.25 и 2.5 в double дают накопленную погрешность на длинных наборах.
 */
export function splitIntoPlates(
  target: number,
  available: number[] = DEFAULT_PLATES
): { items: number[]; remainder: number } {
  const sorted = Array.from(new Set(available))
    .filter((plate) => Number.isFinite(plate) && plate > 0)
    .sort((a, b) => b - a);
  let left = Math.round(target * 100);
  const items: number[] = [];
  if (left <= 0) return { items, remainder: 0 };
  for (const plate of sorted) {
    const unit = Math.round(plate * 100);
    while (left >= unit && items.length < MAX_PLATES_PER_SIDE) {
      left -= unit;
      items.push(plate);
    }
  }
  return { items, remainder: round2(left / 100) };
}

/**
 * Объясняет введённое число словами и, где это применимо, раскладывает его
 * на блины. Нужно потому, что смысл числа зависит от множителя: у «Жим штанги»
 * (mult=2) это вес на сторону, а у «Тяга штанги к поясу» (mult=1) — блины
 * целиком, хотя тип нагрузки у обоих «Штанга».
 */
export function describeLoad(
  exercise: ExerciseForWeight | null | undefined,
  inputWeight: number,
  bodyWeight: number = USER_BODY_WEIGHT_DEFAULT,
  available: number[] = DEFAULT_PLATES
): LoadPlan | null {
  if (!Number.isFinite(inputWeight) || inputWeight <= 0) return null;
  const type = normType(exercise);
  const base = exercise?.baseWeight ?? 0;
  const mult = exercise?.weightMultiplier ?? 1;
  const total = calcEffectiveWeight(exercise, inputWeight, bodyWeight);
  const n = (value: number): string => String(round1(value));

  if (type === 'assisted') {
    return { summary: `Противовес ${n(inputWeight)} → рабочий вес ${n(total)} кг`, total, plates: null };
  }
  if (type === 'bodyweight') {
    return {
      summary: `Свой вес ${n(round1(bodyWeight * mult + base))} + ${n(inputWeight)} = ${n(total)} кг`,
      total,
      plates: null,
    };
  }
  if (type === 'dumbbell') {
    return {
      summary:
        mult === 2
          ? `Две гантели по ${n(inputWeight)} = ${n(total)} кг`
          : `Одна гантель ${n(inputWeight)} кг`,
      total,
      plates: null,
    };
  }
  if (type === 'barbell' || type === 'plate_loaded') {
    // Штанга и блиновый тренажёр всегда грузятся с двух сторон: при mult=2
    // вводят вес одной стороны, при mult=1 — все блины, и на сторону идёт
    // половина. Снаряд, который держат целиком, к этим типам не относится:
    // у него тип нагрузки «Блок/стек», и подсказка по блинам ему не нужна.
    const perSideTarget = mult === 2 ? inputWeight : inputWeight / 2;
    const baseName = type === 'barbell' ? 'Гриф' : 'База';
    let summary: string;
    if (mult === 2) {
      summary = base > 0
        ? `${baseName} ${n(base)} + по ${n(inputWeight)} на сторону = ${n(total)} кг`
        : `По ${n(inputWeight)} на сторону = ${n(total)} кг`;
    } else {
      summary = base > 0
        ? `${baseName} ${n(base)} + ${n(inputWeight)} блинами = ${n(total)} кг`
        : `${n(inputWeight)} кг блинами`;
    }
    return { summary, total, plates: splitIntoPlates(perSideTarget, available) };
  }
  // Стек и всё, где введённое число уже итоговое: пояснять нечего.
  return null;
}
