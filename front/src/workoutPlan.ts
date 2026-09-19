/**
 * Пресет «начало и конец тренировки»: разминка на дорожке, пресс, заминка.
 *
 * Пресет только строит план. Результатов он не создаёт: подход появляется,
 * лишь когда его отметили на экране упражнения, — план подставляет туда
 * значения по умолчанию. Хранится на устройстве, сервер о нём не знает.
 */

export type PlanKey = 'warmup' | 'abs' | 'cooldown';

export interface PresetItem {
  /** Упражнение из каталога; пусто — пункт выключен. */
  exerciseId: string;
  minutes?: number;
  sets?: number;
  reps?: number;
}

export type WorkoutPreset = Partial<Record<PlanKey, PresetItem>>;

export interface PlanItem extends PresetItem {
  key: PlanKey;
  label: string;
}

/** Что подставить на экране упражнения, открытого из плана. */
export interface PlanDefaults {
  minutes?: number;
  sets?: number;
  reps?: number;
  /**
   * Заминка на том же тренажёре, что и разминка: к уже выполненному отрезку
   * добавляется новый, а не открывается разминка ещё раз.
   */
  append?: boolean;
}

/** Черновик тренировки в том виде, в каком он лежит в localStorage. */
export interface DraftLike {
  exercises?: Record<string, { sets?: { completed?: boolean }[] } | undefined>;
}

export const DEFAULT_PRESET: WorkoutPreset = {
  warmup: { exerciseId: '', minutes: 10 },
  abs: { exerciseId: '', sets: 3, reps: 20 },
  cooldown: { exerciseId: '', minutes: 10 },
};

const ORDER: { key: PlanKey; label: string }[] = [
  { key: 'warmup', label: 'Разминка' },
  { key: 'abs', label: 'Пресс' },
  { key: 'cooldown', label: 'Заминка' },
];

const positive = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Пресет из хранилища, с дырами, заполненными значениями по умолчанию. */
export function normalizePreset(raw: unknown): WorkoutPreset {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const out: WorkoutPreset = {};
  for (const { key } of ORDER) {
    const base = DEFAULT_PRESET[key]!;
    const item = source[key] && typeof source[key] === 'object' ? source[key] : {};
    out[key] = {
      exerciseId: String(item.exerciseId || ''),
      ...(base.minutes !== undefined ? { minutes: positive(item.minutes, base.minutes) } : {}),
      ...(base.sets !== undefined ? { sets: Math.round(positive(item.sets, base.sets)) } : {}),
      ...(base.reps !== undefined ? { reps: Math.round(positive(item.reps, base.reps)) } : {}),
    };
  }
  return out;
}

/** План на тренировку: включённые пункты пресета в порядке выполнения. */
export function planFromPreset(preset: WorkoutPreset | null | undefined): PlanItem[] {
  const normalized = normalizePreset(preset);
  return ORDER
    .filter(({ key }) => normalized[key]?.exerciseId)
    .map(({ key, label }) => ({ ...normalized[key]!, key, label }));
}

const sharesWarmup = (item: PlanItem, plan: PlanItem[]) =>
  item.key === 'cooldown' && plan.some((p) => p.key === 'warmup' && p.exerciseId === item.exerciseId);

export function planDefaultsFor(item: PlanItem, plan: PlanItem[]): PlanDefaults {
  if (item.key === 'abs') return { sets: item.sets, reps: item.reps };
  return { minutes: item.minutes, ...(sharesWarmup(item, plan) ? { append: true } : {}) };
}

/** «10 мин», «3×20». */
export function planTargetText(item: PlanItem): string {
  return item.key === 'abs' ? `${item.sets}×${item.reps}` : `${item.minutes} мин`;
}

/**
 * Выполнен ли пункт — по отмеченным строкам черновика. Заминка на том же
 * тренажёре, что и разминка, засчитывается вторым отмеченным отрезком.
 */
export function planItemDone(item: PlanItem, plan: PlanItem[], draft: DraftLike | null | undefined): boolean {
  const rows = draft?.exercises?.[item.exerciseId]?.sets || [];
  const done = rows.filter((row) => row?.completed).length;
  if (item.key === 'abs') return done >= (item.sets || 1);
  return done >= (sharesWarmup(item, plan) ? 2 : 1);
}
