/**
 * Release B.1 — the "Настроить прогрессию" wizard.
 *
 * Configuring 60 exercises one card at a time is not something anyone does, so
 * this collects the ones actually being trained, computes a suggestion for each
 * from their own history, and puts them in one editable list.
 *
 * The rule that matters: **nothing here writes**. Every value is an offer,
 * prefilled into an input the user can change or clear. Only an explicit save
 * sends anything, and only the rows the user actually touched or accepted.
 */
import { suggestTargets } from './progression';
import type { ExerciseTargets } from './progression';
import type { Exercise, HistoryItem } from './types';

/** Only exercises trained on or after this date are offered. */
export const WIZARD_SINCE = '2026-07-01';

export interface GlobalHistorySet {
  id?: string;
  weight?: number;
  input_weight?: number;
  reps?: number;
  rest?: number;
  order?: number;
  set_type?: string;
  rpe?: number;
  rir?: number;
}

export interface GlobalHistoryExercise {
  name?: string;
  exerciseId?: string;
  supersetId?: string | null;
  sets?: GlobalHistorySet[];
}

export interface GlobalHistorySession {
  id?: string;
  /** `_api_date` emits YYYY.MM.DD, but ISO shows up too. Both are handled. */
  date?: string;
  exercises?: GlobalHistoryExercise[];
}

export interface WizardRow {
  exerciseId: string;
  name: string;
  exercise?: Exercise;
  /** Sessions this exercise appeared in since the cutoff. */
  sessionCount: number;
  setCount: number;
  lastDate: string;
  /** Recent weight x reps lines, newest first, for "last weights and reps". */
  recent: string[];
  /** Values already stored on the exercise, if any. */
  current: ExerciseTargets;
  /** Computed from history. An offer, never written on its own. */
  suggested: ExerciseTargets;
  /** True when the exercise already carries a configured range. */
  alreadyConfigured: boolean;
}

/** `2026.07.15` and `2026-07-15` both normalise to `2026-07-15`. */
export function normalizeDate(value: unknown): string {
  const text = String(value ?? '').trim().slice(0, 10).replace(/\./g, '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

const num = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const fmt = (value: number) => (Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000));

/**
 * Turn the global history into one row per exercise trained since the cutoff.
 *
 * Sessions older than the cutoff still feed the *suggestion* for an exercise
 * that qualifies — a rep range built from six weeks of data is better than one
 * built from two. The cutoff decides who appears in the list, not how far back
 * their numbers are read.
 */
export function buildWizardRows(
  history: GlobalHistorySession[] | null | undefined,
  allExercises: Exercise[] | null | undefined,
  since: string = WIZARD_SINCE,
): WizardRow[] {
  const sessions = (Array.isArray(history) ? history : [])
    .map((session) => ({ ...session, iso: normalizeDate(session?.date) }))
    .filter((session) => session.iso);

  const catalogue = new Map<string, Exercise>();
  for (const exercise of Array.isArray(allExercises) ? allExercises : []) {
    if (exercise?.id) catalogue.set(String(exercise.id), exercise);
  }

  const recentIds = new Set<string>();
  for (const session of sessions) {
    if (session.iso < since) continue;
    for (const entry of session.exercises || []) {
      if (entry?.exerciseId) recentIds.add(String(entry.exerciseId));
    }
  }

  const rows: WizardRow[] = [];
  for (const exerciseId of recentIds) {
    const exercise = catalogue.get(exerciseId);

    // Every appearance, not only those after the cutoff — more history makes a
    // better suggestion.
    const flat: HistoryItem[] = [];
    let sessionCount = 0;
    let setCount = 0;
    let lastDate = '';
    let name = '';
    const recent: string[] = [];

    const ordered = [...sessions].sort((a, b) => b.iso.localeCompare(a.iso));
    for (const session of ordered) {
      const entry = (session.exercises || []).find((x) => String(x?.exerciseId) === exerciseId);
      if (!entry) continue;
      name = name || String(entry.name || '');
      const sets = entry.sets || [];
      if (session.iso >= since) {
        sessionCount += 1;
        setCount += sets.length;
        if (!lastDate) lastDate = session.iso;
      }
      for (const set of sets) {
        flat.push({
          session_id: session.id,
          date: session.iso,
          weight: num(set.weight) ?? 0,
          input_weight: num(set.input_weight) ?? undefined,
          reps: num(set.reps) ?? 0,
          rest: num(set.rest) ?? 0,
          order: num(set.order) ?? undefined,
          set_type: set.set_type,
          rpe: num(set.rpe) ?? undefined,
          rir: num(set.rir) ?? undefined,
        } as HistoryItem);
      }
      if (recent.length < 3 && sets.length) {
        const w = num(sets[0].input_weight) ?? num(sets[0].weight) ?? 0;
        const reps = sets.map((s) => num(s.reps) ?? 0).join('/');
        recent.push(`${session.iso.slice(5).replace('-', '.')} · ${fmt(w)} × ${reps}`);
      }
    }

    rows.push({
      exerciseId,
      name: name || exercise?.name || exerciseId,
      exercise,
      sessionCount,
      setCount,
      lastDate,
      recent,
      current: {
        repRangeLow: exercise?.repRangeLow ?? null,
        repRangeHigh: exercise?.repRangeHigh ?? null,
        inputWeightStep: exercise?.inputWeightStep ?? null,
        targetWorkingSets: exercise?.targetWorkingSets ?? null,
        rirTargetMax: exercise?.rirTargetMax ?? null,
      },
      suggested: suggestTargets(exercise, flat),
      alreadyConfigured: exercise?.repRangeLow != null && exercise?.repRangeHigh != null,
    });
  }

  // Most-trained first: those are the ones worth configuring.
  return rows.sort((a, b) =>
    b.sessionCount - a.sessionCount
    || b.setCount - a.setCount
    || a.name.localeCompare(b.name, 'ru'));
}

/** The values a row starts with in the form: what is stored, else the offer. */
export function initialDraft(row: WizardRow): Record<string, string> {
  const pick = (key: keyof ExerciseTargets) => {
    const stored = row.current[key];
    if (stored !== null && stored !== undefined) return String(stored);
    const offered = row.suggested[key];
    return offered !== null && offered !== undefined ? String(offered) : '';
  };
  return {
    repRangeLow: pick('repRangeLow'),
    repRangeHigh: pick('repRangeHigh'),
    inputWeightStep: pick('inputWeightStep'),
    targetWorkingSets: pick('targetWorkingSets'),
    rirTargetMax: pick('rirTargetMax'),
  };
}

export interface DraftValidation {
  ok: boolean;
  error: string | null;
  targets: ExerciseTargets | null;
  /** True when the draft equals what is already stored — nothing to send. */
  unchanged: boolean;
}

/** Validate one row's draft. Mirrors the server's rules so errors show inline. */
export function validateDraft(row: WizardRow, draft: Record<string, string>): DraftValidation {
  const parse = (value: string) => (String(value ?? '').trim() === '' ? null : num(value));
  const low = parse(draft.repRangeLow);
  const high = parse(draft.repRangeHigh);
  const step = parse(draft.inputWeightStep);
  const sets = parse(draft.targetWorkingSets);
  const rir = parse(draft.rirTargetMax);

  const fail = (error: string): DraftValidation => ({ ok: false, error, targets: null, unchanged: false });

  if ([draft.repRangeLow, draft.repRangeHigh, draft.inputWeightStep, draft.targetWorkingSets, draft.rirTargetMax]
    .some((value) => String(value ?? '').trim() !== '' && parse(value) === null)) {
    return fail('Не число');
  }
  if ((low === null) !== (high === null)) return fail('Диапазон нужен целиком');
  if (low !== null && high !== null && low > high) return fail('Низ больше верха');
  if (low !== null && (low < 1 || low > 100)) return fail('Повторы вне 1–100');
  if (high !== null && (high < 1 || high > 100)) return fail('Повторы вне 1–100');
  if (step !== null && !(step > 0 && step <= 100)) return fail('Шаг должен быть больше 0');
  if (sets !== null && (sets < 1 || sets > 20 || !Number.isInteger(sets))) return fail('Подходы 1–20, целое');
  if (rir !== null && (rir < 0 || rir > 10)) return fail('RIR вне 0–10');

  const targets: ExerciseTargets = {
    repRangeLow: low, repRangeHigh: high, inputWeightStep: step,
    targetWorkingSets: sets, rirTargetMax: rir,
  };
  const same = (Object.keys(targets) as (keyof ExerciseTargets)[])
    .every((key) => (row.current[key] ?? null) === (targets[key] ?? null));
  return { ok: true, error: null, targets, unchanged: same };
}

/** Rows that would actually be sent by a save. */
export function pendingChanges(
  rows: WizardRow[],
  drafts: Record<string, Record<string, string>>,
): { exerciseId: string; name: string; targets: ExerciseTargets }[] {
  const out: { exerciseId: string; name: string; targets: ExerciseTargets }[] = [];
  for (const row of rows) {
    const draft = drafts[row.exerciseId];
    if (!draft) continue;
    const verdict = validateDraft(row, draft);
    if (!verdict.ok || verdict.unchanged || !verdict.targets) continue;
    out.push({ exerciseId: row.exerciseId, name: row.name, targets: verdict.targets });
  }
  return out;
}
