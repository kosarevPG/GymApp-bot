/** Browser implementation of docs/WORKLOAD_TREND_V1.md; shared fixtures pin parity. */
export interface WorkloadTrend {
  version: string;
  status: 'ok' | 'insufficient';
  reason: string | null;
  recentVolumeKg: number;
  baselineVolumeKg: number;
  baselineWeeklyVolumeKg: number;
  deltaPct: number | null;
  recentSessions: number;
  baselineSessions: number;
  text?: string;
}

const round = (value: number, digits = 0) => {
  const scaled = value * 10 ** digits;
  return (scaled < 0 ? -Math.floor(-scaled + 0.5) : Math.floor(scaled + 0.5)) / 10 ** digits;
};
export function dateNumber(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms / 86_400_000 : null;
}

export function computeWorkloadTrend(sessions: unknown, referenceDate: string): WorkloadTrend {
  const result: WorkloadTrend = { version: 'workload-trend-v1', status: 'insufficient', reason: 'short-history',
    recentVolumeKg: 0, baselineVolumeKg: 0, baselineWeeklyVolumeKg: 0, deltaPct: null, recentSessions: 0, baselineSessions: 0 };
  const reference = dateNumber(referenceDate);
  if (reference === null) return result;
  let recent = 0, baseline = 0, oldest = -1;
  for (const row of Array.isArray(sessions) ? sessions : []) {
    const day = dateNumber(String(row?.date || '')), volume = Number(row?.volumeKg);
    if (day === null || !Number.isFinite(volume) || volume <= 0) continue;
    const offset = reference - day;
    if (offset < 0) continue;
    oldest = Math.max(oldest, offset);
    if (offset < 7) { recent += volume; result.recentSessions++; }
    else if (offset < 35) { baseline += volume; result.baselineSessions++; }
  }
  result.recentVolumeKg = round(recent, 1);
  result.baselineVolumeKg = round(baseline, 1);
  result.baselineWeeklyVolumeKg = round(baseline / 4, 1);
  if (oldest < 34) return result;
  if (baseline <= 0) { result.reason = 'no-baseline-volume'; return result; }
  result.status = 'ok'; result.reason = null;
  result.deltaPct = round((recent - baseline / 4) / (baseline / 4) * 100);
  return result;
}

export function formatWorkloadTrend(trend: WorkloadTrend): string {
  if (trend.status !== 'ok' || trend.deltaPct === null)
    return 'Недостаточно данных для сравнения: нужна история за предыдущие четыре недели.';
  const n = trend.baselineSessions, mod10 = n % 10, mod100 = n % 100;
  const noun = mod10 === 1 && mod100 !== 11 ? 'тренировка'
    : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? 'тренировки' : 'тренировок';
  const tail = `(${n} ${noun} в базовом периоде)`;
  return trend.deltaPct === 0
    ? `Объём последних 7 дней совпадает со средним за предыдущие четыре недели ${tail}.`
    : `Объём последних 7 дней на ${Math.abs(trend.deltaPct)}% ${trend.deltaPct > 0 ? 'выше' : 'ниже'} среднего за предыдущие четыре недели ${tail}.`;
}
