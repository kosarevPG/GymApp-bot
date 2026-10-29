import { useEffect, useRef, useState } from 'react';
import { formatSeconds, type WorkoutClock } from '../workoutTiming';

export function WorkoutClockPanel({ clock, onStart, onComplete, onCancel, onContinue, runningHere = false, perSide = false, notify, docked = false, continueLabel, cardio = false }:
  { clock: WorkoutClock | null; onStart?: () => void; onComplete?: () => void; onCancel?: () => void;
    onContinue?: () => void; runningHere?: boolean; perSide?: boolean; notify?: () => void;
    docked?: boolean; continueLabel?: string; cardio?: boolean }) {
  const [now, setNow] = useState(Date.now);
  const alerted = useRef('');
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
  const label = working ? (cardio ? 'Кардио идёт' : perSide ? 'Подход идёт · обе руки' : 'Подход идёт')
    : clock?.betweenExercises ? 'Отдых между упражнениями' : clock ? 'Отдых между подходами' : 'Готовы к подходу';
  return <div className={docked ? '' : 'rounded-xl border border-zinc-700 bg-zinc-900 p-4'} aria-label="Таймер тренировки">
    <div className={docked ? 'flex flex-col gap-3' : 'flex flex-wrap items-center justify-between gap-3'}>
      <div className={docked ? 'flex items-center justify-between gap-3' : ''}><div><div className="text-sm text-zinc-300">{label}</div>
        <div role="timer" aria-label={label} className="mt-1 text-3xl font-semibold tabular-nums text-zinc-50">{formatSeconds(remaining !== null && remaining > 0 ? Math.ceil(remaining) : elapsed)}</div>
        {remaining === 0 && <div className="mt-1 text-xs text-amber-300">Заданный отдых окончен</div>}
        {working && runningHere && cardio && <p className="mt-1 text-xs text-zinc-400">Сохранится фактическое время отрезка.</p>}
      </div>
        {docked && working && runningHere && onCancel && <button type="button" className="min-h-11 shrink-0 text-sm text-zinc-300 underline underline-offset-4" onClick={onCancel}>Отменить замер</button>}
      </div>
      {(runningHere ? onComplete : onStart || onContinue) && <button type="button" onClick={runningHere ? onComplete : onStart || onContinue}
        className={`${docked ? 'w-full min-h-14 text-base' : 'min-h-12 text-sm'} rounded-xl bg-blue-600 px-4 font-semibold text-white hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400`}>
        {runningHere ? 'Подход выполнен' : onStart ? 'Начать подход' : continueLabel || (working ? 'К начатому подходу' : 'Продолжить тренировку')}
      </button>}
    </div>
    {!docked && working && runningHere && onCancel && <button type="button" className="mt-1 min-h-11 text-sm text-zinc-300 underline underline-offset-4" onClick={onCancel}>Отменить замер</button>}
  </div>;
}
