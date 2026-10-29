import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatSeconds, type WorkoutClock } from '../workoutTiming';

export function WorkoutClockPanel({ clock, onStart, onComplete, onCancel, onContinue, runningHere = false, perSide = false, notify, docked = false, continueLabel, cardio = false, completionLabel }:
  { clock: WorkoutClock | null; onStart?: () => void; onComplete?: () => void; onCancel?: () => void;
    onContinue?: () => void; runningHere?: boolean; perSide?: boolean; notify?: () => void;
    docked?: boolean; continueLabel?: string; cardio?: boolean; completionLabel?: string }) {
  const [now, setNow] = useState(Date.now);
  const alerted = useRef('');
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (menu.current) menu.current.open = false; }, [clock?.kind, clock?.since]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const interval = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', tick); };
  }, []);
  const elapsed = clock ? Math.max(0, (now - clock.since) / 1000) : 0;
  const remaining = clock?.kind === 'rest' && !clock.betweenExercises && clock.restTargetSeconds
    ? Math.max(0, clock.restTargetSeconds - elapsed) : null;
  useEffect(() => {
    if (remaining !== 0 || !clock || alerted.current === String(clock.since)) return;
    alerted.current = String(clock.since); notify?.();
  }, [remaining, clock?.since]);
  const working = clock?.kind === 'set';
  const label = completionLabel ? 'Готово' : working ? (cardio ? 'Кардио идёт' : perSide ? 'Подход идёт · обе руки' : 'Подход идёт')
    : clock?.betweenExercises ? 'Отдых между упражнениями' : clock ? 'Отдых между подходами' : 'Готовы к подходу';
  const action = runningHere ? onComplete : onStart || onContinue;
  const actionLabel = runningHere ? 'Подход выполнен' : onStart ? 'Начать подход' : continueLabel || (working ? 'К начатому подходу' : 'Продолжить тренировку');
  const time = completionLabel || formatSeconds(remaining !== null && remaining > 0 ? Math.ceil(remaining) : elapsed);
  const cancel = working && runningHere && onCancel;
  if (docked) return <div className="workout-controls" aria-label="Таймер тренировки">
    <details ref={menu} className="relative min-w-0">
      <summary className="clock-summary flex min-h-14 items-center justify-between gap-1 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400" aria-label="Действия с таймером">
        <span className="min-w-0"><span className="block truncate text-xs text-zinc-300">{completionLabel ? 'Готово' : working ? label : clock ? 'Отдых' : 'Готовы'}</span>
          <span role="timer" aria-label={label} className="mt-1 block text-[28px] font-semibold leading-none tabular-nums text-zinc-50">{time}</span></span>
        <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
      </summary>
      <div className="absolute bottom-full left-0 z-50 mb-3 w-60 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-lg">
        <p className="text-sm text-zinc-200">{label}</p>
        {remaining === 0 && <p className="mt-1 text-xs text-amber-300">Заданный отдых окончен</p>}
        {cardio && working && <p className="mt-2 text-xs text-zinc-300">Сохранится фактическое время отрезка.</p>}
        {cancel && <button type="button" className="mt-2 min-h-11 w-full rounded-lg bg-zinc-800 px-3 text-left text-sm text-zinc-100" onClick={cancel}>Отменить замер</button>}
      </div>
    </details>
    {action && <button type="button" onClick={action} className="min-h-14 min-w-0 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold leading-tight text-white hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400">{actionLabel}</button>}
  </div>;
  return <div className="flex flex-wrap items-center justify-between gap-3 border-y border-zinc-800 py-3" aria-label="Таймер тренировки">
    <div><div className="text-xs text-zinc-300">{label}</div><div role="timer" aria-label={label} className="mt-1 text-2xl font-semibold tabular-nums">{time}</div></div>
    {action && <button type="button" onClick={action} className="min-h-12 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">{actionLabel}</button>}
    {cancel && <button type="button" className="min-h-11 text-sm text-zinc-300 underline underline-offset-4" onClick={cancel}>Отменить замер</button>}
  </div>;
}
