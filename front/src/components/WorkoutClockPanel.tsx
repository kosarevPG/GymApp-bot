import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatSeconds, type WorkoutClock } from '../workoutTiming';

export function WorkoutClockPanel({ clock, onStart, onComplete, onCancel, onContinue, runningHere = false, perSide = false, notify, docked = false, continueLabel, cardio = false, completionLabel, subject }:
  { clock: WorkoutClock | null; onStart?: () => void; onComplete?: () => void; onCancel?: () => void;
    onContinue?: () => void; runningHere?: boolean; perSide?: boolean; notify?: () => void;
    docked?: boolean; continueLabel?: string; cardio?: boolean; completionLabel?: string;
    /** Суперсет: упражнение, чей подход идёт или будет следующим. */ subject?: string }) {
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
  const target = clock?.restTargetSeconds;
  const remaining = clock?.kind === 'rest' && !clock.betweenExercises
    && typeof target === 'number' && Number.isFinite(target) && target > 0
    ? Math.max(0, target - elapsed) : null;
  const restExpired = remaining === 0 && !completionLabel;
  useEffect(() => {
    if (!restExpired || !clock || alerted.current === String(clock.since)) return;
    alerted.current = String(clock.since); notify?.();
  }, [restExpired, clock?.since]);
  const working = clock?.kind === 'set';
  const baseLabel = completionLabel ? 'Готово' : restExpired ? 'Отдых окончен' : working ? (cardio ? 'Кардио идёт' : perSide ? 'Подход идёт · обе руки' : 'Подход идёт')
    : clock?.betweenExercises ? 'Отдых между упражнениями' : clock ? 'Отдых между подходами' : 'Готовы к подходу';
  const label = baseLabel + (subject && !completionLabel ? ` · ${subject}` : '');
  const action = runningHere ? onComplete : onStart || onContinue;
  const actionLabel = runningHere ? 'Подход выполнен' : onStart ? 'Начать подход' : continueLabel || (working ? 'К начатому подходу' : 'Продолжить тренировку');
  const time = completionLabel || (restExpired ? `+${formatSeconds(elapsed - target!)}`
    : formatSeconds(remaining !== null ? Math.ceil(remaining) : elapsed));
  const timerColor = restExpired ? 'text-amber-300' : 'text-zinc-50';
  const status = <span role="status" aria-atomic="true" className="sr-only">{restExpired ? 'Запланированное время отдыха вышло. Можно начать следующий подход.' : ''}</span>;
  const pulse = restExpired && onStart ? ' rest-ready-pulse' : '';
  const cancel = working && runningHere && onCancel;
  if (docked) return <div className="workout-controls" aria-label="Таймер тренировки">
    {status}
    <details ref={menu} className="relative min-w-0">
      <summary className="clock-summary flex min-h-14 items-center justify-between gap-1 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400" aria-label="Действия с таймером">
        <span className="min-w-0"><span className={`block truncate leading-4 ${restExpired ? 'text-[11px] text-amber-300' : 'text-xs text-zinc-300'}`}>{completionLabel ? 'Готово' : restExpired || working ? baseLabel : clock ? 'Отдых' : 'Готовы'}</span>
          <span role="timer" aria-label={label} className={`mt-1 flex h-7 items-center font-semibold leading-none tabular-nums ${restExpired ? 'text-[26px]' : 'text-[28px]'} ${timerColor}`}>{time}</span></span>
        <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
      </summary>
      <div className="absolute bottom-full left-0 z-50 mb-3 w-60 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-lg">
        <p className="text-sm text-zinc-200">{label}</p>
        {restExpired && <p className="mt-1 text-xs text-amber-300">+{formatSeconds(elapsed - target!)} сверх запланированного отдыха</p>}
        {cardio && working && <p className="mt-2 text-xs text-zinc-300">Сохранится фактическое время отрезка.</p>}
        {cancel && <button type="button" className="mt-2 min-h-11 w-full rounded-lg bg-zinc-800 px-3 text-left text-sm text-zinc-100" onClick={cancel}>Отменить замер</button>}
      </div>
    </details>
    {action && <button type="button" onClick={action} className={`min-h-14 min-w-0 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold leading-tight text-white hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400${pulse}`}
      aria-label={actionLabel}>{actionLabel}{subject && (runningHere || onStart) && <span aria-hidden="true" className="mt-0.5 block truncate text-xs font-normal text-blue-100">{subject}</span>}</button>}
  </div>;
  return <div className="flex flex-wrap items-center justify-between gap-3 border-y border-zinc-800 py-3" aria-label="Таймер тренировки">
    {status}
    <div><div className={`text-xs ${restExpired ? 'text-amber-300' : 'text-zinc-300'}`}>{label}</div><div role="timer" aria-label={label} className={`mt-1 text-2xl font-semibold tabular-nums ${timerColor}`}>{time}</div></div>
    {action && <button type="button" onClick={action} className="min-h-12 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">{actionLabel}</button>}
    {cancel && <button type="button" className="min-h-11 text-sm text-zinc-300 underline underline-offset-4" onClick={cancel}>Отменить замер</button>}
  </div>;
}
