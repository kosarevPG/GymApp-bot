/**
 * Сводка для тренера — what was actually done, in a form that can be shown or
 * sent.
 *
 * This replaces the self-progression suggestion. The programme is set by a
 * coach, so the app has no business proposing weights; what it can do that the
 * coach cannot is remember every set precisely and point at what moved.
 *
 * Everything here is descriptive. A drop is reported as a drop — fewer reps,
 * less weight — never as a diagnosis or a recommendation.
 */
import {
  describeLoadChange, formatSetSequence, loadProgress, rulesForSet, setLoadLabel,
  type ExerciseForWeight,
} from './exerciseConfig';
import { formatCardioSegments } from './cardio';
import type { GlobalHistorySession, GlobalHistorySet } from './historyTypes';

export interface ExerciseLine {
  exerciseId: string;
  name: string;
  /** `loadProgress` of every set: grows when the set gets harder. */
  weights: number[];
  reps: number[];
  /** `2×8 кг × 12/12 · 2×10 кг × 10` — what to read aloud to a coach. */
  text: string;
  totalReps: number;
  maxWeight: number;
  setCount: number;
  /** Timed work: listed as done, never compared, never counted as sets. */
  cardio?: boolean;
  /** Comparison with the previous time this exercise was done, if any. */
  change: null | {
    previousDate: string;
    previousText: string;
    weightDelta: number;
    /** `вес +2.5`, `помощь −5` — the weight change in the words of the display. */
    weightText: string | null;
    repsDelta: number;
    /** True when weight or total reps went down. */
    down: boolean;
  };
}

export interface SessionSummary {
  date: string;
  exercises: ExerciseLine[];
  totalSets: number;
}

export interface TrainerSummary {
  since: string;
  until: string;
  sessionCount: number;
  sessions: SessionSummary[];
  /** Exercises that went down versus their previous session, newest first. */
  drops: { date: string; name: string; text: string; previousText: string }[];
  /** Exercises in the period that no previous session exists for. */
  firstTime: { date: string; name: string }[];
}

const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** `2026.07.15` and `2026-07-15` both normalise to `2026-07-15`. */
export function normalizeDate(value: unknown): string {
  const text = String(value ?? '').trim().slice(0, 10).replace(/\./g, '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

function lineOf(
  name: string,
  exerciseId: string,
  sets: GlobalHistorySet[],
  exercise: ExerciseForWeight | null,
): ExerciseLine {
  const ordered = [...sets].sort((a, b) => num(a.order) - num(b.order));
  // Weight is compared and written the way the history shows it: a snapshot
  // on the set when there is one, the exercise's current rules otherwise.
  const weights = ordered.map((s) => loadProgress(s, exercise));
  const reps = ordered.map((s) => num(s.reps));
  return {
    exerciseId,
    name,
    weights,
    reps,
    text: formatSetSequence(ordered.map((s, i) => ({ label: setLoadLabel(s, exercise), reps: reps[i] }))),
    totalReps: reps.reduce((a, b) => a + b, 0),
    maxWeight: weights.length ? Math.max(...weights) : 0,
    setCount: ordered.length,
    change: null,
  };
}

/**
 * @param history rows from /api/global_history
 * @param since inclusive ISO date
 * @param until inclusive ISO date
 * @param exercises catalog by id, for sets saved before load snapshots
 */
export function buildTrainerSummary(
  history: GlobalHistorySession[] | null | undefined,
  since: string,
  until: string,
  exercises: Record<string, ExerciseForWeight> = {},
): TrainerSummary {
  const sessions = (Array.isArray(history) ? history : [])
    .map((session) => ({ ...session, iso: normalizeDate(session?.date) }))
    .filter((session) => session.iso)
    .sort((a, b) => a.iso.localeCompare(b.iso));

  // Every occurrence, including before the window: a comparison needs the
  // previous session even when it falls outside the reported period.
  const occurrences = new Map<string, { iso: string; line: ExerciseLine }[]>();
  for (const session of sessions) {
    for (const entry of session.exercises || []) {
      const id = String(entry?.exerciseId ?? '');
      const sets = entry?.sets || [];
      if (!id || !sets.length) continue;
      const list = occurrences.get(id) || [];
      list.push({ iso: session.iso, line: lineOf(String(entry.name || id), id, sets, exercises[id] || null) });
      occurrences.set(id, list);
    }
  }

  const inWindow = sessions.filter((session) => session.iso >= since && session.iso <= until);
  const out: SessionSummary[] = [];
  const drops: TrainerSummary['drops'] = [];
  const firstTime: TrainerSummary['firstTime'] = [];

  for (const session of inWindow) {
    const lines: ExerciseLine[] = [];
    for (const entry of session.exercises || []) {
      const id = String(entry?.exerciseId ?? '');
      const sets = entry?.sets || [];
      const cardio = Array.isArray(entry?.cardio) ? entry.cardio : [];
      if (id && !sets.length && cardio.length) {
        lines.push({
          exerciseId: id, name: String(entry.name || id), weights: [], reps: [],
          text: formatCardioSegments(cardio), totalReps: 0, maxWeight: 0, setCount: 0,
          change: null, cardio: true,
        });
        continue;
      }
      if (!id || !sets.length) continue;
      const line = lineOf(String(entry.name || id), id, sets, exercises[id] || null);

      const history_ = occurrences.get(id) || [];
      const index = history_.findIndex((x) => x.iso === session.iso);
      const previous = index > 0 ? history_[index - 1] : null;
      if (previous) {
        const weightDelta = line.maxWeight - previous.line.maxWeight;
        const repsDelta = line.totalReps - previous.line.totalReps;
        const down = weightDelta < 0 || (weightDelta === 0 && repsDelta < 0);
        line.change = {
          previousDate: previous.iso,
          previousText: previous.line.text,
          weightDelta,
          weightText: weightDelta !== 0
            ? describeLoadChange(rulesForSet(sets[0], exercises[id] || null), weightDelta)
            : null,
          repsDelta,
          down,
        };
        if (down) {
          drops.push({ date: session.iso, name: line.name, text: line.text, previousText: previous.line.text });
        }
      } else {
        firstTime.push({ date: session.iso, name: line.name });
      }
      lines.push(line);
    }
    if (lines.length) {
      out.push({ date: session.iso, exercises: lines, totalSets: lines.reduce((a, l) => a + l.setCount, 0) });
    }
  }

  return {
    since,
    until,
    sessionCount: out.length,
    sessions: out.reverse(), // newest first for reading
    drops: drops.reverse(),
    firstTime: firstTime.reverse(),
  };
}

/** Plain text, sized for a messenger. No advice, only what happened. */
export function formatTrainerSummaryText(summary: TrainerSummary): string {
  if (!summary || !summary.sessionCount) {
    return `Тренировок с ${short(summary?.since || '')} по ${short(summary?.until || '')} нет.`;
  }
  const lines: string[] = [];
  lines.push(`Тренировки ${short(summary.since)}–${short(summary.until)} · ${summary.sessionCount}`);
  lines.push('');

  for (const session of summary.sessions) {
    lines.push(`${short(session.date)} · ${session.totalSets} подх.`);
    for (const exercise of session.exercises) {
      let suffix = '';
      if (exercise.change) {
        const { weightDelta, weightText, repsDelta, previousText } = exercise.change;
        if (weightDelta !== 0 || repsDelta !== 0) {
          const parts: string[] = [];
          if (weightText) parts.push(weightText);
          if (repsDelta !== 0) parts.push(`повт. ${repsDelta > 0 ? '+' : '−'}${Math.abs(repsDelta)}`);
          suffix = `  (было ${previousText}; ${parts.join(', ')})`;
        } else {
          suffix = '  (как в прошлый раз)';
        }
      } else if (!exercise.cardio) {
        suffix = '  (впервые)';
      }
      lines.push(`  ${exercise.name}: ${exercise.text}${suffix}`);
    }
    lines.push('');
  }

  if (summary.drops.length) {
    lines.push('Просело:');
    for (const drop of summary.drops) {
      lines.push(`  ${short(drop.date)} ${drop.name}: ${drop.text} (было ${drop.previousText})`);
    }
  } else {
    lines.push('Просевших упражнений нет.');
  }
  return lines.join('\n').trim();
}

/** ISO date `days` back from `iso`, inclusive of today. */
export function isoDaysAgo(iso: string, days: number): string {
  const base = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(base)) return iso;
  return new Date(base - (days - 1) * 86400000).toISOString().slice(0, 10);
}
