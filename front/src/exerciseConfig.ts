/**
 * Конфигурация расчёта веса для gymtracker.
 * Поддержка bodyweight-упражнений с дробным multiplier (например 0.68 для отжиманий).
 */

export const USER_BODY_WEIGHT_DEFAULT = 90;

export const WEIGHT_FORMULAS = {
  bodyweight: {
    placeholder: '0',
    label: '+кг',
    toEffective: (
      input: number,
      bw: number = USER_BODY_WEIGHT_DEFAULT,
      base: number = 0,
      mult: number = 1
    ) => bw * mult + input + base,
    toInput: (
      effective: number,
      bw: number = USER_BODY_WEIGHT_DEFAULT,
      base: number = 0,
      mult: number = 1
    ) => Math.round(effective - bw * mult - base),
  },
  standard: {
    placeholder: '0',
    label: 'кг',
    toEffective: (_input: number, _bw?: number, base: number = 0) => _input + base,
    toInput: (effective: number, _bw?: number, base: number = 0) => Math.round(effective - base),
  },
};

export interface ExerciseForWeight {
  weightType?: string;
  baseWeight?: number;
  weightMultiplier?: number;
}

/**
 * Вычисляет эффективный вес (для отображения и 1RM).
 * Поддерживает дробный weightMultiplier (например 0.68 для отжиманий).
 */
export function calcEffectiveWeight(
  exercise: ExerciseForWeight | null | undefined,
  inputWeight: number,
  bodyWeight: number = USER_BODY_WEIGHT_DEFAULT
): number {
  if (!exercise) return inputWeight;
  const base = exercise.baseWeight ?? 0;
  const mult = exercise.weightMultiplier ?? 1;
  const isBodyweight = (exercise.weightType ?? '').toLowerCase() === 'bodyweight';
  if (isBodyweight) {
    return WEIGHT_FORMULAS.bodyweight.toEffective(inputWeight, bodyWeight, base, mult);
  }
  return WEIGHT_FORMULAS.standard.toEffective(inputWeight, bodyWeight, base);
}

/**
 * Преобразует эффективный вес в ввод для bodyweight (например +кг).
 */
export function toInputWeight(
  exercise: ExerciseForWeight | null | undefined,
  effectiveWeight: number,
  bodyWeight: number = USER_BODY_WEIGHT_DEFAULT
): number {
  if (!exercise) return Math.round(effectiveWeight);
  const base = exercise.baseWeight ?? 0;
  const mult = exercise.weightMultiplier ?? 1;
  const isBodyweight = (exercise.weightType ?? '').toLowerCase() === 'bodyweight';
  if (isBodyweight) {
    return WEIGHT_FORMULAS.bodyweight.toInput(effectiveWeight, bodyWeight, base, mult);
  }
  return WEIGHT_FORMULAS.standard.toInput(effectiveWeight, bodyWeight, base);
}
