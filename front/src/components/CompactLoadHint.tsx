import { ChevronRight } from 'lucide-react';
import { describeLoad, type ExerciseForWeight } from '../exerciseConfig';

/** Presentation only: the existing rules still calculate every weight and plate. */
export function CompactLoadHint({ exercise, inputWeight, bodyWeight, plates }: {
  exercise?: ExerciseForWeight; inputWeight: number; bodyWeight: number; plates: number[];
}) {
  const plan = describeLoad(exercise, inputWeight, bodyWeight, plates);
  if (!plan) return null;
  const type = exercise?.weightType?.toLowerCase();
  const base = exercise?.baseWeight || 0;
  const prefix = plan.plates ? `${type === 'barbell' ? 'Гриф' : 'База'} ${base} · на сторону:`
    : exercise?.unilateral ? 'На руку · повторы на каждую'
    : type === 'dumbbell' ? `${exercise?.weightMultiplier === 2 ? '2 ×' : 'Одна гантель'} ${inputWeight} кг`
    : type === 'assisted' ? `Противовес ${inputWeight} кг` : plan.summary;
  return <details className="compact-load-hint">
    <summary className="flex flex-wrap items-center gap-1 text-xs leading-5 text-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400" aria-label="Подробный расчёт веса">
      <span>{prefix}</span>
      {plan.plates && <><span className="flex flex-wrap items-center gap-1">{plan.plates.items.map((plate, i) => <span key={i} className="rounded bg-zinc-700 px-1.5 text-xs font-medium text-zinc-100">{String(plate).replace('.', ',')}</span>)}{!plan.plates.items.length && 'без блинов'}</span>
        {plan.plates.remainder > 0 && <span className="text-amber-300">не хватает {plan.plates.remainder} кг</span>}</>}
      <ChevronRight className="h-3 w-3" aria-hidden="true" />
    </summary>
    <div className="mt-1 border-l border-zinc-700 pl-2 text-xs leading-relaxed text-zinc-300"><p>{plan.summary}</p><p>Общий вес: {plan.total} кг</p></div>
  </details>;
}
