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
import type { GlobalHistorySession, GlobalHistorySet } from './historyTypes';

export interface ExerciseLine {
  exerciseId: string;
  name: string;
  /** Input weight the sets were done at, one entry per distinct weight. */
  weights: number[];
  reps: number[];
  /** `22.5 × 12/12/10` — what to read aloud to a coach. */
  text: string;
  totalReps: number;
  maxWeight: number;
  setCount: number;
  /** Comparison with the previous time this exercise was done, if any. */
  change: null | {
    previousDate: string;
    previousText: string;
    weightDelta: number;
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

const fmtNum = (value: number) => (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100));
const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** Weight the user typed, falling back to the effective weight when absent. */
const inputOf = (set: GlobalHistorySet) =>
  (set.input_weight !== undefined && set.input_weight !== null ? num(set.input_weight) : num(set.weight));

function lineOf(name: string, exerciseId: string, sets: GlobalHistorySet[]): ExerciseLine {
  const ordered = [...sets].sort((a, b) => num(a.order) - num(b.order));
  const weights = ordered.map(inputOf);
  const reps = ordered.map((s) => num(s.reps));
  const distinct = [...new Set(weights)];
  const weightText = distinct.length === 1 ? fmtNum(distinct[0]) : distinct.map(fmtNum).join('/');
  return {
    exerciseId,
    name,
    weights,
    reps,
    text: `${weightText} × ${reps.join('/')}`,
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
 */
export function buildTrainerSummary(
  history: GlobalHistorySession[] | null | undefined,
  since: string,
  until: string,
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
      list.push({ iso: session.iso, line: lineOf(String(entry.name || id), id, sets) });
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
      if (!id || !sets.length) continue;
      const line = lineOf(String(entry.name || id), id, sets);

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
        const { weightDelta, repsDelta, previousText } = exercise.change;
        if (weightDelta !== 0 || repsDelta !== 0) {
          const parts: string[] = [];
          if (weightDelta !== 0) parts.push(`вес ${weightDelta > 0 ? '+' : ''}${fmtNum(weightDelta)}`);
          if (repsDelta !== 0) parts.push(`повт. ${repsDelta > 0 ? '+' : ''}${repsDelta}`);
          suffix = `  (было ${previousText}; ${parts.join(', ')})`;
        } else {
          suffix = '  (как в прошлый раз)';
        }
      } else {
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
