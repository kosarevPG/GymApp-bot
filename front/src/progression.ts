/**
 * Release B MVP — double progression, expressed as a suggestion.
 *
 * The shape is always the same three lines: what happened last time, what the
 * target is today, and what the rule suggests. Nothing here decides anything on
 * its own: an exercise without a configured range produces a `setup` outcome
 * and the UI shows a configure button rather than staying silent.
 *
 * Two things this deliberately does not do:
 *  - it never suggests lowering the weight. A bad session has too many causes
 *    for a rule this thin to attribute, so a regression produces "hold", not a
 *    cut;
 *  - it never invents targets. Suggested values may be shown, but only a
 *    person's confirmation writes them.
 */
import { calcEffectiveWeight, toInputWeight, USER_BODY_WEIGHT_DEFAULT } from './exerciseConfig';
import type { Exercise, HistoryItem, SetType } from './types';

export interface ExerciseTargets {
  repRangeLow?: number | null;
  repRangeHigh?: number | null;
  inputWeightStep?: number | null;
  targetWorkingSets?: number | null;
  rirTargetMax?: number | null;
}

export type ProgressionOutcome = 'setup' | 'no-history' | 'increase' | 'add-rep' | 'hold';

export interface ProgressionAdvice {
  outcome: ProgressionOutcome;
  /** Line 1 — what actually happened last time. */
  previous: string | null;
  /** Line 2 — the target for today. */
  target: string | null;
  /** Line 3 — the suggestion itself. */
  suggestion: string;
  /** True when the decision rests on reps alone because RIR was never logged. */
  rirMissing: boolean;
  /** Suggested next input weight, in the units the user types. */
  nextInputWeight?: number;
  previousInputWeight?: number;
}

const num = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

/** Round half away from zero — matches the workload-trend contract's rule. */
function roundHalfAwayFromZero(value: number, digits = 0): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const rounded = scaled < 0 ? -Math.floor(-scaled + 0.5) : Math.floor(scaled + 0.5);
  return rounded / factor;
}

/**
 * Round an input-unit weight onto the exercise's step grid.
 *
 * The step is stored in the units the user types, never in effective
 * kilograms — for a barbell with multiplier 2, one 1.25 kg plate per side is a
 * step of 1.25 here and 2.5 kg of load. Rounding in effective kilograms would
 * hand back weights that cannot be loaded.
 */
export function roundToStep(inputWeight: number, step: number | null | undefined): number {
  const s = num(step);
  if (!s || s <= 0) return roundHalfAwayFromZero(inputWeight, 2);
  return roundHalfAwayFromZero(roundHalfAwayFromZero(inputWeight / s, 0) * s, 3);
}

/**
 * +1 when typing a larger number makes the set harder, −1 when it makes it
 * easier.
 *
 * Assisted machines are the whole reason this exists: the input is the
 * counterweight, so progress means typing *less*. The same holds for any
 * exercise configured with a negative multiplier.
 */
export function progressionDirection(exercise: Exercise | null | undefined): 1 | -1 {
  const type = String(exercise?.weightType ?? '').trim().toLowerCase();
  if (type === 'assisted') return -1;
  const mult = num(exercise?.weightMultiplier);
  if (mult !== null && mult < 0) return -1;
  return 1;
}

/**
 * The next input weight, one step in the harder direction. Never below zero.
 *
 * The step is added to what was actually lifted rather than to a grid-snapped
 * version of it. Snapping first would assume the logged weight was a mistake —
 * a rack whose bells run 22.5, 24.5, 26.5 is on a perfectly good 2 kg grid that
 * simply does not start at an even number, and rounding it to 22 would hand
 * back a weight the user does not own. `roundToStep` stays available for
 * callers that genuinely have an arbitrary number to place.
 */
export function nextInputWeight(
  exercise: Exercise | null | undefined,
  currentInput: number,
  step: number | null | undefined,
): number {
  const s = num(step);
  const current = num(currentInput) ?? 0;
  if (!s || s <= 0) return roundHalfAwayFromZero(current, 2);
  const next = roundHalfAwayFromZero(current + progressionDirection(exercise) * s, 3);
  // 0 is the physical floor: on an assisted machine it means no counterweight,
  // which is the hardest the machine offers.
  return next < 0 ? 0 : next;
}

const isWorking = (set: { set_type?: string | SetType }) =>
  String(set?.set_type ?? 'working').toLowerCase() === 'working';

/**
 * The sets a progression decision should read: the last `targetWorkingSets`
 * working sets of the most recent session.
 *
 * Warm-ups are dropped when they are marked. Production data has `set_type` on
 * every row as `working` because the Sheets backfill had no such column, so the
 * count-based tail is the fallback that actually runs today.
 */
export function lastSessionWorkingSets(
  history: HistoryItem[] | null | undefined,
  targetWorkingSets: number | null | undefined,
): HistoryItem[] {
  const rows = Array.isArray(history) ? history.filter(Boolean) : [];
  if (!rows.length) return [];
  const latestDate = rows.reduce((acc, row) => (String(row.date) > acc ? String(row.date) : acc), '');
  const sameSession = rows.filter((row) => String(row.date) === latestDate);
  const marked = sameSession.filter(isWorking);
  const pool = marked.length ? marked : sameSession;
  const ordered = [...pool].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const want = num(targetWorkingSets);
  if (!want || want <= 0 || ordered.length <= want) return ordered;
  return ordered.slice(-want);
}

const fmt = (value: number) => (Number.isInteger(value) ? String(value) : String(roundHalfAwayFromZero(value, 3)));

/**
 * Build the three-line advice for one exercise.
 */
export function buildProgressionAdvice(
  exercise: Exercise | null | undefined,
  targets: ExerciseTargets | null | undefined,
  history: HistoryItem[] | null | undefined,
  bodyWeight: number = USER_BODY_WEIGHT_DEFAULT,
): ProgressionAdvice {
  const low = num(targets?.repRangeLow);
  const high = num(targets?.repRangeHigh);
  const step = num(targets?.inputWeightStep);
  const wantSets = num(targets?.targetWorkingSets);
  const rirMax = num(targets?.rirTargetMax);

  if (low === null || high === null) {
    return {
      outcome: 'setup',
      previous: null,
      target: null,
      suggestion: 'Диапазон повторов не задан.',
      rirMissing: false,
    };
  }

  const targetLine = `${low}–${high} повт.${wantSets ? ` × ${wantSets} подх.` : ''}`
    + `${rirMax !== null ? `, RIR ≤ ${fmt(rirMax)}` : ''}`;

  const sets = lastSessionWorkingSets(history, wantSets);
  if (!sets.length) {
    return {
      outcome: 'no-history',
      previous: null,
      target: targetLine,
      suggestion: 'Прошлых подходов нет — выбери рабочий вес сам.',
      rirMissing: false,
    };
  }

  const prevInputRaw = num(sets[0].input_weight);
  const prevInput = prevInputRaw !== null
    ? prevInputRaw
    : toInputWeight(exercise, num(sets[0].weight) ?? 0, bodyWeight);
  const reps = sets.map((s) => num(s.reps) ?? 0);
  const previousLine = `${fmt(prevInput)} × ${reps.join('/')}`;

  const consideredRir = sets.map((s) => num(s.rir)).filter((v): v is number => v !== null);
  const rirMissing = consideredRir.length === 0;

  const allAtTop = reps.length > 0 && reps.every((r) => r >= high);
  const enoughSets = !wantSets || sets.length >= wantSets;

  // Rule 1 — top of the range across every target set. With RIR configured and
  // logged, it also has to say there was something left in reserve.
  if (allAtTop && enoughSets) {
    const rirSaysReady = rirMax === null || rirMissing
      ? true
      : consideredRir.every((value) => value >= 0 && value <= rirMax)
        ? consideredRir.some((value) => value >= 1)
        : false;

    if (rirSaysReady) {
      const next = nextInputWeight(exercise, prevInput, step);
      const effective = calcEffectiveWeight(exercise, next, bodyWeight);
      const stepNote = step ? '' : ' (шаг веса не задан — округление не применено)';
      return {
        outcome: 'increase',
        previous: previousLine,
        target: targetLine,
        suggestion: `Верх диапазона взят везде — попробуй ${fmt(next)}`
          + `${effective !== next ? ` (итог ${fmt(effective)} кг)` : ''}`
          + `, повторы с ${low}.${stepNote}`,
        rirMissing,
        nextInputWeight: next,
        previousInputWeight: prevInput,
      };
    }
    return {
      outcome: 'hold',
      previous: previousLine,
      target: targetLine,
      suggestion: `Повторы на верху, но RIR ${consideredRir.join('/')} — вес оставь, добери запас.`,
      rirMissing,
      previousInputWeight: prevInput,
    };
  }

  // Rule 2 — inside the range: same weight, one more rep.
  const weakest = Math.min(...reps);
  if (weakest >= low) {
    return {
      outcome: 'add-rep',
      previous: previousLine,
      target: targetLine,
      suggestion: `Вес оставь ${fmt(prevInput)} — добавь повтор там, где было ${weakest}.`,
      rirMissing,
      previousInputWeight: prevInput,
    };
  }

  // Rule 3 — below the range. Hold; the MVP never suggests cutting weight.
  return {
    outcome: 'hold',
    previous: previousLine,
    target: targetLine,
    suggestion: `Ниже диапазона (${weakest} < ${low}) — вес тот же, добери повторы.`,
    rirMissing,
    previousInputWeight: prevInput,
  };
}

/**
 * Values to offer in the editor, computed from history. Shown as a suggestion
 * only — nothing is written without confirmation.
 */
export function suggestTargets(
  exercise: Exercise | null | undefined,
  history: HistoryItem[] | null | undefined,
): ExerciseTargets & { basedOnSets: number } {
  const rows = Array.isArray(history) ? history.filter(Boolean) : [];
  const working = rows.filter(isWorking);
  const pool = working.length ? working : rows;
  const reps = pool.map((r) => num(r.reps)).filter((v): v is number => v !== null && v > 0);

  const bySession = new Map<string, number>();
  for (const row of pool) {
    const key = String(row.session_id || row.date || '');
    if (key) bySession.set(key, (bySession.get(key) || 0) + 1);
  }
  const setCounts = [...bySession.values()].sort((a, b) => a - b);
  const medianSets = setCounts.length ? setCounts[Math.floor(setCounts.length / 2)] : null;

  const type = String(exercise?.weightType ?? '').trim().toLowerCase();
  const defaultStep = type === 'barbell' || type === 'plate_loaded' ? 1.25
    : type === 'dumbbell' ? 2
    : 2.5;

  if (!reps.length) {
    return { inputWeightStep: defaultStep, basedOnSets: 0 };
  }
  const sorted = [...reps].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const lowSuggest = Math.max(1, at(0.25));
  const highSuggest = Math.max(lowSuggest, at(0.75));

  return {
    repRangeLow: lowSuggest,
    repRangeHigh: highSuggest,
    inputWeightStep: defaultStep,
    targetWorkingSets: medianSets,
    basedOnSets: pool.length,
  };
}
