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

/* ── Снимок правил и единый показ веса ─────────────────────────────────── */

export const LOAD_RULES_VERSION = 1;

/**
 * Правила, по которым из введённого числа получился итоговый вес подхода.
 * Пишется в подход при сохранении: смена настроек упражнения потом не
 * переиначивает старые числа ни в показе, ни при правке.
 */
export interface LoadRules {
  v: number;
  type: string;
  mult: number;
  base: number;
  /** Вес тела — только там, где он входит в итог: свой вес и гравитрон. */
  bw?: number;
}

/** Подход в том виде, в каком его отдаёт история. */
export interface LoggedLoad {
  input_weight?: number | string | null;
  weight?: number | string | null;
  load?: LoadRules | null;
}

const usesBodyWeight = (type: string): boolean => type === 'bodyweight' || type === 'assisted';

const toNum = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const fmtKg = (value: number): string => String(round2(value));

/** Правила упражнения на сейчас — то, что уйдёт в снимок нового подхода. */
export function loadRulesOf(
  exercise: ExerciseForWeight | null | undefined,
  bodyWeight: number = USER_BODY_WEIGHT_DEFAULT
): LoadRules {
  const type = (exercise?.weightType ?? '').trim() || 'Other';
  const rules: LoadRules = {
    v: LOAD_RULES_VERSION,
    type,
    mult: exercise?.weightMultiplier ?? 1,
    base: exercise?.baseWeight ?? 0,
  };
  if (usesBodyWeight(type.toLowerCase())) rules.bw = bodyWeight;
  return rules;
}

export const rulesAsExercise = (rules: LoadRules): ExerciseForWeight => ({
  weightType: rules.type,
  weightMultiplier: rules.mult,
  baseWeight: rules.base,
});

/** Одинаково ли толкуется введённое число. Вес тела не в счёт — он меняется сам. */
export function sameLoadRules(a: LoadRules, b: LoadRules): boolean {
  return a.type.trim().toLowerCase() === b.type.trim().toLowerCase()
    && Number(a.mult) === Number(b.mult)
    && Number(a.base) === Number(b.base);
}

/** Снимок подхода, а для старых подходов без снимка — нынешние правила упражнения. */
export function rulesForSet(
  set: LoggedLoad | null | undefined,
  exercise: ExerciseForWeight | null | undefined,
  bodyWeight: number = USER_BODY_WEIGHT_DEFAULT
): LoadRules {
  return set?.load && typeof set.load === 'object' && set.load.type
    ? set.load
    : loadRulesOf(exercise, bodyWeight);
}

/** Введённое число и итог подхода; недостающее досчитывается по правилам. */
function inputAndTotal(set: LoggedLoad | null | undefined, rules: LoadRules, bodyWeight: number) {
  const asExercise = rulesAsExercise(rules);
  const bw = rules.bw ?? bodyWeight;
  const total = toNum(set?.weight);
  const input = toNum(set?.input_weight) ?? (total !== null ? toInputWeight(asExercise, total, bw) : 0);
  return { input, total: total ?? calcEffectiveWeight(asExercise, input, bw) };
}

/**
 * Вес подхода словами — одинаково в истории, «Прошлом разе», PR и сводке.
 * Итоговые типы показывают общий вес, гантели — вес одной и сколько их,
 * свой вес — добавку, гравитрон — помощь: от веса тела в тот день эти два
 * числа не зависят.
 */
export function formatLoad(rules: LoadRules, input: number, total: number): string {
  switch (rules.type.trim().toLowerCase()) {
    case 'dumbbell':
      return Number(rules.mult) === 1 ? `${fmtKg(input)} кг` : `${fmtKg(Number(rules.mult))}×${fmtKg(input)} кг`;
    case 'bodyweight':
      return input > 0 ? `свой вес +${fmtKg(input)} кг` : 'свой вес';
    case 'assisted':
      return `помощь ${fmtKg(input)} кг`;
    default:
      return `${fmtKg(total)} кг`;
  }
}

export function setLoadLabel(
  set: LoggedLoad | null | undefined,
  exercise: ExerciseForWeight | null | undefined,
  bodyWeight: number = USER_BODY_WEIGHT_DEFAULT
): string {
  const rules = rulesForSet(set, exercise, bodyWeight);
  const { input, total } = inputAndTotal(set, rules, bodyWeight);
  return formatLoad(rules, input, total);
}

/**
 * Число, которое растёт, когда подход тяжелее, в тех же единицах, что и
 * показ: итог, вес гантели, добавка — или помощь со знаком минус.
 */
export function loadProgress(
  set: LoggedLoad | null | undefined,
  exercise: ExerciseForWeight | null | undefined,
  bodyWeight: number = USER_BODY_WEIGHT_DEFAULT
): number {
  const rules = rulesForSet(set, exercise, bodyWeight);
  const { input, total } = inputAndTotal(set, rules, bodyWeight);
  switch (rules.type.trim().toLowerCase()) {
    case 'dumbbell':
    case 'bodyweight':
      return input;
    case 'assisted':
      return -input;
    default:
      return total;
  }
}

/** Как назвать изменение `loadProgress` в тексте: «вес +2.5», «помощь −5». */
export function describeLoadChange(rules: LoadRules, delta: number): string {
  const sign = (value: number) => (value > 0 ? `+${fmtKg(value)}` : `−${fmtKg(-value)}`);
  switch (rules.type.trim().toLowerCase()) {
    case 'assisted':
      return `помощь ${sign(-delta)}`;
    case 'bodyweight':
      return `добавка ${sign(delta)}`;
    default:
      return `вес ${sign(delta)}`;
  }
}

/**
 * Что подставить в поле ввода из прошлого подхода. Если правила с тех пор не
 * менялись (или снимка нет), подставляется то же число. Если поменялись —
 * сохранённый итог переводится в нынешние единицы ввода, а не копируется
 * число, которое теперь значит другое.
 */
export function carryOverInput(
  set: LoggedLoad | null | undefined,
  exercise: ExerciseForWeight | null | undefined,
  bodyWeight: number = USER_BODY_WEIGHT_DEFAULT
): number {
  const input = toNum(set?.input_weight);
  const total = toNum(set?.weight);
  const snapshot = set?.load && typeof set.load === 'object' && set.load.type ? set.load : null;
  if (!snapshot || sameLoadRules(snapshot, loadRulesOf(exercise, bodyWeight))) {
    return input ?? (total !== null ? toInputWeight(exercise, total, bodyWeight) : 0);
  }
  const was = inputAndTotal(set, snapshot, bodyWeight);
  return Math.max(0, toInputWeight(exercise, was.total, bodyWeight));
}

/**
 * Подходы строкой: одинаковый вес подряд схлопывается, повторы через «/».
 * «60 кг × 10/10 · 65 кг × 8».
 */
export function formatSetSequence(items: { label: string; reps: number }[]): string {
  const groups: { label: string; reps: number[] }[] = [];
  for (const { label, reps } of items) {
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.reps.push(reps);
    else groups.push({ label, reps: [reps] });
  }
  return groups.map((group) => `${group.label} × ${group.reps.join('/')}`).join(' · ');
}
