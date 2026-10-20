import type { GlobalHistorySession } from './historyTypes';
import { computeWorkloadTrend, dateNumber, formatWorkloadTrend, type WorkloadTrend } from './workloadTrend';

export interface AnalyticsData {
  volume: number;
  muscleVolume: Record<string, number>;
  muscleSets: Record<string, number>;
  workloadTrend: WorkloadTrend & { text: string };
}

/** Python round(value, 1): round the exact IEEE-754 value, ties to even. */
export function roundVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!value || Math.abs(value) >= 1e15) return value;
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, Math.abs(value));
  const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
  let numerator = ((bits & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n)) * 10n;
  let denominator = 1n;
  const power = (exponent || 1) - 1023 - 52;
  if (power >= 0) numerator <<= BigInt(power); else denominator <<= BigInt(-power);
  let units = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || (remainder * 2n === denominator && units % 2n === 1n)) units++;
  return Math.sign(value) * Number(units) / 10;
}

/** Old/truncated journals cannot tell which sets were excluded: retain the server fallback. */
export function calculateLocalAnalytics(history: GlobalHistorySession[], days: number, referenceDate: string): AnalyticsData | null {
  const reference = dateNumber(referenceDate);
  if (reference === null) return null;
  const muscleSets: Record<string, number> = {}, muscleVolume: Record<string, number> = {};
  const trendSessions: { date: string; volumeKg: number }[] = [];
  for (const session of history) {
    if (session.analyticsComplete === false) return null;
    const iso = String(session.date || '').replace(/\./g, '-'), day = dateNumber(iso);
    if (day === null || day > reference) continue;
    let volume = 0;
    for (const exercise of session.exercises || []) {
      for (const set of exercise.sets || []) {
        if ((set.set_type || 'working') !== 'working') continue;
        if (typeof set.include_in_tonnage !== 'boolean' || typeof exercise.muscleGroup !== 'string') return null;
        if (!set.include_in_tonnage) continue;
        const weight = Number(set.weight), reps = Number(set.reps);
        const load = (Number.isFinite(weight) ? weight : 0) * (Number.isFinite(reps) ? Math.trunc(reps) : 0);
        volume += load;
        if (reference - day < days) {
          const muscle = exercise.muscleGroup || 'Другое';
          muscleSets[muscle] = (muscleSets[muscle] || 0) + 1;
          muscleVolume[muscle] = (muscleVolume[muscle] || 0) + load;
        }
      }
    }
    trendSessions.push({ date: iso, volumeKg: volume });
  }
  const volume = roundVolume(Object.values(muscleVolume).reduce((sum, n) => sum + n, 0));
  const trend = computeWorkloadTrend(trendSessions, referenceDate);
  return { volume, muscleSets, muscleVolume: Object.fromEntries(Object.entries(muscleVolume).map(([key, n]) => [key, roundVolume(n)])),
    workloadTrend: { ...trend, text: formatWorkloadTrend(trend) } };
}
