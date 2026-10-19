import type { GlobalHistorySession, GlobalHistorySet } from './historyTypes';
import type { PlanItem, PlanDefaults } from './workoutPlan';
import type { Exercise, WorkoutSet } from './types';
import { carryOverInput, forNewEntry, loadRulesOf } from './exerciseConfig';

export interface RepeatTemplate {
  exerciseId: string;
  name: string;
  sets: GlobalHistorySet[];
  cardio?: { minutes?: number; speed?: number; incline?: number; order?: number }[];
}

/** One item is a block (possibly a superset), with independent identity. */
export function repeatPlan(source: GlobalHistorySession, uuid = () => crypto.randomUUID()): PlanItem[] {
  const blocks: { order: number; item: PlanItem }[] = [];
  const supersets = new Map<string, PlanItem>();
  for (const exercise of source.exercises || []) {
    if (!exercise.exerciseId) throw new Error(`Не найдено упражнение «${exercise.name || ''}»`);
    if (exercise.cardio?.length) {
      for (const segment of exercise.cardio) {
        blocks.push({ order: segment.order || 0, item: { key: uuid(), blockId: uuid(),
          exerciseId: exercise.exerciseId, label: exercise.name || 'Кардио', sourceDate: source.date,
          templates: [{ exerciseId: exercise.exerciseId, name: exercise.name || '', sets: [], cardio: [{ ...segment }] }] } });
      }
      continue;
    }
    const template: RepeatTemplate = { exerciseId: exercise.exerciseId, name: exercise.name || '',
      sets: [...(exercise.sets || [])].sort((a, b) => (a.order || 0) - (b.order || 0)).map(s => ({ ...s })) };
    const shared = exercise.supersetId && supersets.get(exercise.supersetId);
    if (shared) { shared.templates!.push(template); shared.label = 'Суперсет'; continue; }
    const item: PlanItem = { key: uuid(), blockId: uuid(), exerciseId: exercise.exerciseId,
      label: exercise.name || 'Упражнение', templates: [template], sourceDate: source.date };
    if (exercise.supersetId) supersets.set(exercise.supersetId, item);
    blocks.push({ order: Math.min(...template.sets.map(s => s.order || 0), Number.MAX_SAFE_INTEGER), item });
  }
  return blocks.sort((a, b) => a.order - b.order).map(b => b.item);
}

export function draftKey(exerciseId: string, blockId?: string): string {
  return blockId ? `${blockId}:${exerciseId}` : exerciseId;
}

/** Historical effort, notes, timings and request IDs are never copied as today's results. */
export function templateSets(template: RepeatTemplate, exercise: Exercise, bodyWeight: number,
  uuid = () => crypto.randomUUID()): WorkoutSet[] {
  if (template.cardio?.length) return template.cardio.map(s => ({ id: uuid(), completed: false,
    weight: '', reps: '', rest: '', minutes: String(s.minutes ?? ''), speed: String(s.speed ?? ''), incline: String(s.incline ?? '') }));
  const current = forNewEntry(exercise);
  return template.sets.map(s => ({ id: uuid(), completed: false,
    weight: String(carryOverInput(s, current, bodyWeight)), reps: String(s.reps ?? ''), rest: String(s.rest ?? ''),
    prevWeight: s.weight, setType: (['warmup','working','drop','failure'].includes(s.set_type || '') ? s.set_type : 'working') as WorkoutSet['setType'],
    load: loadRulesOf(current, bodyWeight) }));
}

export function repeatDefaults(item: PlanItem): PlanDefaults {
  return { blockId: item.blockId, templates: item.templates, sourceDate: item.sourceDate };
}

export function stepHasResults(item: PlanItem, draft: any): boolean {
  return (item.templates || [{ exerciseId: item.exerciseId }]).some(t =>
    (draft?.exercises?.[draftKey(t.exerciseId, item.blockId)]?.sets || []).some((s: WorkoutSet) => s.completed || s.requestId));
}

export function recordedSets(item: PlanItem, draft: any): number {
  return (item.templates || [{ exerciseId: item.exerciseId }]).reduce((sum, t) => sum +
    (draft?.exercises?.[draftKey(t.exerciseId, item.blockId)]?.sets || []).filter((s: WorkoutSet) => s.completed).length, 0);
}

/** Replacing a partly performed step keeps that step and all its recorded work. */
export function replaceStep(plan: PlanItem[], key: string, replacement: PlanItem, draft: any): PlanItem[] {
  return plan.flatMap(item => item.key !== key ? [item]
    : stepHasResults(item, draft) ? [{ ...item, status: 'done' as const }, replacement] : [replacement]);
}

export function nextStep(plan: PlanItem[], currentKey?: string): PlanItem | undefined {
  const index = currentKey ? plan.findIndex(p => p.key === currentKey) : -1;
  return plan.slice(index + 1).find(p => !p.status) || plan.find(p => !p.status);
}
