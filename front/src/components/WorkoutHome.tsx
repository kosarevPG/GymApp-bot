import { Check, Dumbbell, Home, MapPin, MoreHorizontal, Plus, Settings, ArrowUp, ArrowDown, Play } from 'lucide-react';
import { ScreenContent, ScreenHeader } from './ScreenLayout';
import { planTargetText, type PlanItem } from '../workoutPlan';
import { recordedSets } from '../workoutRepeat';

export function WorkoutHome({ workoutActive, location, onLocationChange, restBanner, plan = [], planDone = [], draft, resumeStep, onOpenPlanItem, onStartWorkout, onFinishWorkout, onAllExercises, onHistory, onSettings, onMove, onReplace, onSkip, sourceDate, localStatus }: any) {
  const places = [{ value: 'gym', label: 'Зал', icon: Dumbbell }, { value: 'home', label: 'Дома', icon: Home }, { value: 'other', label: 'Другое', icon: MapPin }];
  const count = plan.filter((p: PlanItem, i: number) => p.status === 'done' || planDone[i]).length;
  return <div className="min-h-screen bg-zinc-950">
    <ScreenHeader title={workoutActive ? 'Текущая тренировка' : 'Главная'} action={<button type="button" aria-label="Настройки" onClick={onSettings} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-zinc-300 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"><Settings className="h-6 w-6" /></button>} />
    <ScreenContent className="space-y-5 py-4 pb-24">
      {localStatus}
      {!workoutActive ? <section className="space-y-3">
        <h2 className="text-lg font-semibold">Тренировка</h2><p className="text-sm text-zinc-300">Откройте историю и повторите подходящую тренировку.</p>
        <button type="button" onClick={onHistory} className="min-h-14 w-full rounded-xl bg-blue-600 px-4 text-lg font-semibold text-white hover:bg-blue-500">Выбрать из истории</button>
        <button type="button" onClick={onStartWorkout} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-zinc-800 px-4 font-medium text-zinc-100"><Plus className="h-5 w-5" />Новая тренировка</button>
        <button type="button" onClick={onAllExercises} className="min-h-11 w-full text-sm text-blue-300">Справочник упражнений</button>
      </section> : <>
        {sourceDate && <p className="text-sm text-zinc-300">Повтор тренировки от {String(sourceDate).replace(/^(\d{4})[.-](\d{2})[.-](\d{2})$/, '$3.$2.$1')}</p>}
        <section aria-label="Место тренировки">
          <p className="mb-2 text-sm text-zinc-300">Место тренировки</p>
          <div role="group" aria-label="Место новой тренировки" className="grid grid-cols-3 gap-1 rounded-xl bg-zinc-900 p-1">{places.map(place => <button type="button" key={place.value} aria-pressed={location === place.value} onClick={() => onLocationChange(place.value)} className={`flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ${location === place.value ? 'bg-slate-700 text-blue-100' : 'text-zinc-300 hover:bg-zinc-800'}`}><place.icon className="h-4 w-4 shrink-0" />{place.label}</button>)}</div>
        </section>
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Упражнения</h2><span className="text-sm text-zinc-300">{count} из {plan.length} завершено{plan.some((p: PlanItem) => p.status === 'skipped') ? ` · ${plan.filter((p: PlanItem) => p.status === 'skipped').length} пропущено` : ''}</span></div>
          <div className="divide-y divide-zinc-800 border-y border-zinc-800">
            {plan.map((item: PlanItem, i: number) => <div key={item.key} className="flex items-center gap-2 py-3">
              <span className="flex w-7 shrink-0 items-center justify-center text-sm text-blue-300">{item.status === 'skipped' ? '—' : planDone[i] ? <Check className="h-5 w-5 text-green-400" /> : i + 1}</span>
              <button type="button" onClick={() => onOpenPlanItem(item)} className="min-h-12 min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"><span className="block text-base font-semibold text-zinc-100">{item.label}</span><span className="mt-1 block text-sm text-zinc-300">{(item.templates?.length || 0) > 1 ? item.templates!.map(t => t.name).join(' · ') + ' · ' : ''}{item.blockId ? `${recordedSets(item, draft)} выполнено · план: ` : ''}{planTargetText(item)}{item.status === 'skipped' ? ' · оставшееся пропущено' : ''}</span></button>
              <details className="plan-item-options relative shrink-0">
                <summary aria-label={`Действия: ${item.label}`} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"><MoreHorizontal className="h-5 w-5" /></summary>
                <div className="absolute right-0 top-full z-30 w-56 rounded-xl border border-zinc-700 bg-zinc-900 p-2 shadow-lg">
                  {plan.length > 1 && <div className="flex gap-2"><button type="button" aria-label={`Поднять ${item.label}`} disabled={i === 0} onClick={() => onMove(i, -1)} className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-zinc-800 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button><button type="button" aria-label={`Опустить ${item.label}`} disabled={i === plan.length - 1} onClick={() => onMove(i, 1)} className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-zinc-800 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button></div>}
                  <button type="button" onClick={() => onReplace(item.key)} className="min-h-11 w-full px-2 text-left text-sm text-blue-300">Заменить</button>
                  {!item.status && <button type="button" onClick={() => onSkip(item.key)} className="min-h-11 w-full px-2 text-left text-sm text-zinc-300">Пропустить</button>}
                </div>
              </details>
            </div>)}
          </div>
          {!plan.length && <p className="py-3 text-sm text-zinc-300">Добавьте первое упражнение из справочника.</p>}
          <button type="button" onClick={onAllExercises} className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 text-sm text-blue-300"><Plus className="h-4 w-4" />Добавить упражнение</button>
        </section>
        {restBanner}
        {resumeStep && !restBanner && <button type="button" onClick={() => onOpenPlanItem(resumeStep)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-white"><Play className="h-4 w-4" />Продолжить тренировку</button>}
        <button type="button" onClick={onFinishWorkout} className="min-h-12 w-full rounded-xl bg-zinc-800 px-4 font-medium text-zinc-100">Завершить тренировку</button>
      </>}
    </ScreenContent>
  </div>;
}
