import { Check, MoreHorizontal, Trash2 } from 'lucide-react';
import { calcEffectiveWeight, rulesAsExercise, USER_BODY_WEIGHT_DEFAULT, DEFAULT_PLATES } from '../exerciseConfig';
import { formatSeconds } from '../workoutTiming';
import type { Exercise, WorkoutSet, SetType } from '../types';
import { CompactLoadHint } from './CompactLoadHint';

const kinds: [SetType, string][] = [['warmup', 'Разминочный'], ['working', 'Рабочий'], ['drop', 'Дроп'], ['failure', 'Отказной']];

export function WorkoutSetRow({ set, ordinal, exercise, bodyWeight = USER_BODY_WEIGHT_DEFAULT, plates = DEFAULT_PLATES, isActive = false, syncMark, onUpdate, onDelete, onComplete, onStart }: {
  set: WorkoutSet; ordinal: number; exercise?: Exercise; bodyWeight?: number; plates?: number[]; isActive?: boolean;
  syncMark?: string; onUpdate: (sid: string, field: string, value: string | number) => void;
  onDelete: (sid: string) => void; onComplete: (sid: string) => void; onStart?: (sid: string) => void;
}) {
  const rules = set.load ? rulesAsExercise(set.load) : exercise;
  const total = calcEffectiveWeight(rules, parseFloat(set.weight || '0'), bodyWeight);
  const oneRM = set.weight && set.reps ? Math.round(total * (1 + parseInt(set.reps) / 30)) : 0;
  const delta = set.prevWeight ? total - set.prevWeight : 0;
  const field = (name: 'weight' | 'reps' | 'rest', label: string, className: string) => <label className={`set-entry-field ${className}`}>
    <input type="text" inputMode={name === 'reps' ? 'numeric' : 'decimal'} aria-label={label} value={set[name]}
      disabled={set.completed} placeholder="0" className="set-entry-number" onFocus={e => e.target.select()}
      onChange={e => onUpdate(set.id, name, e.target.value.replace(',', '.'))} />
  </label>;
  return <div className={`border-b py-1 ${isActive ? 'border-zinc-700' : 'border-zinc-800/70'}`}>
    <div className="set-entry-grid items-center">
      <button type="button" aria-label={set.completed ? 'Изменить выполненный подход' : 'Отметить подход выполненным'}
        onClick={() => onComplete(set.id)} className={`relative flex h-11 w-11 items-center justify-center rounded-lg text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ${set.completed ? 'text-green-400' : isActive ? 'text-blue-300' : 'text-zinc-300'}`}>
        {set.completed ? <Check className="h-5 w-5" /> : ordinal}
        {syncMark && <span title={syncMark === 'rejected' ? 'Сервер отклонил — подробности в очереди' : 'Ждёт отправки'} className={`absolute right-0 top-0 h-2.5 w-2.5 rounded-full ${syncMark === 'rejected' ? 'bg-red-400' : 'bg-amber-400'}`} />}
      </button>
      {field('weight', 'Вес подхода', 'set-entry-weight')}
      {field('reps', 'Повторения подхода', 'set-entry-reps')}
      {field('rest', 'Отдых после подхода в минутах', 'set-entry-rest')}
      <details className="workout-set-options relative self-start">
        <summary aria-label={`Параметры подхода ${ordinal}`} className="relative flex min-h-11 items-center justify-center rounded-lg text-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"><MoreHorizontal className="h-5 w-5" /></summary>
        <div className="absolute right-0 top-full z-30 w-60 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-lg">
          <label className="text-xs text-zinc-300">Тип подхода<select aria-label={`Тип подхода ${ordinal}`} value={set.setType || 'working'} disabled={set.completed} onChange={e => onUpdate(set.id, 'setType', e.target.value)} className="mt-1 min-h-11 w-full rounded-lg bg-zinc-800 px-2 text-sm text-zinc-100">{kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {isActive && !set.completed && <div className="mt-3">
            <p className="mb-1 text-xs text-zinc-300">Повторы в запасе</p>
            <div className="flex flex-wrap gap-1">{[0, 1, 2, 3].map(rir => <button type="button" key={rir} aria-pressed={String(set.rir) === String(rir)} onClick={() => onUpdate(set.id, 'rir', String(set.rir) === String(rir) ? '' : rir)} className={`min-h-11 rounded-lg px-2 text-xs ${String(set.rir) === String(rir) ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-300'}`}>RIR {rir}{rir === 3 ? '+' : ''}</button>)}</div>
            <label className="mt-2 block text-xs text-zinc-300">RPE<input aria-label={`RPE подхода ${ordinal}`} type="number" min={1} max={10} value={set.rpe ?? ''} onChange={e => onUpdate(set.id, 'rpe', e.target.value)} className="mt-1 h-11 w-full rounded-lg bg-zinc-800 px-2 text-base text-zinc-100" /></label>
          </div>}
          {isActive && onStart && <button type="button" onClick={() => onStart(set.id)} className="mt-2 min-h-11 w-full text-left text-sm text-blue-300">Начать этот подход</button>}
          <button type="button" onClick={() => onDelete(set.id)} className="mt-2 flex min-h-11 w-full items-center gap-2 text-left text-sm text-red-300"><Trash2 className="h-4 w-4" />Удалить подход</button>
        </div>
      </details>
      <span className="set-metadata col-start-2 text-center text-blue-300">{set.weight !== '' ? `Σ ${total} кг` : ''}</span>
      <span className="set-metadata col-span-2 col-start-3 flex flex-wrap justify-center gap-x-2 text-zinc-400">
        {oneRM > 0 && <span>1ПМ:{oneRM}</span>}
        {delta !== 0 && <span className={delta > 0 ? 'text-green-400' : 'text-amber-300'}>{delta > 0 ? '+' : ''}{delta}</span>}
        {set.rir != null && set.rir !== '' && <span>RIR {set.rir}</span>}
        {set.rpe != null && set.rpe !== '' && <span>RPE {set.rpe}</span>}
        {(set.setType || 'working') !== 'working' && <span>{kinds.find(([type]) => type === set.setType)?.[1]}</span>}
      </span>
    </div>
    {isActive && !set.completed && <CompactLoadHint exercise={rules} inputWeight={parseFloat(set.weight || '0')} bodyWeight={bodyWeight} plates={plates} />}
    {set.completed && set.timing?.duration_seconds != null && <p className="ml-12 text-xs text-zinc-300">Время подхода{set.load?.perSide ? ' (обе руки)' : ''} {formatSeconds(set.timing.duration_seconds)}</p>}
  </div>;
}
