import React from 'react';
import type { SetType } from '../types';
import { formatSeconds } from '../workoutTiming';

export interface SetDisplayRowProps {
  /** Вес словами из `setLoadLabel`: «60 кг», «2×8 кг», «помощь 30 кг». */
  weightText: string;
  reps: number | string;
  rest: number | string;
  setType?: SetType | string;
  rpe?: number;
  rir?: number;
  className?: string;
  durationSeconds?: number;
  restBeforeSeconds?: number;
}

export const SetDisplayRow: React.FC<SetDisplayRowProps> = ({
  weightText,
  reps,
  rest,
  setType,
  rpe,
  rir,
  className = '',
  durationSeconds,
  restBeforeSeconds,
}) => {
  const r = typeof reps === 'number' ? reps : parseInt(String(reps || 0), 10);
  const restVal = typeof rest === 'number' ? rest : parseFloat(String(rest || 0));
  const isWarmup = setType === 'warmup';

  return (
    <div
      className={`text-left text-sm ${
        isWarmup ? 'text-zinc-500' : 'text-zinc-200'
      } ${className}`}
    >
      {weightText} × {r}{' '}
      <span className="opacity-70">повт</span>, {restVal}
      <span className="opacity-70">м</span>
      {isWarmup && (
        <span className="ml-2 text-xs bg-zinc-800 px-1.5 py-0.5 rounded">
          Разминка
        </span>
      )}
      {rpe != null && Number(rpe) > 0 && (
        <span className="ml-2 text-xs text-orange-400">RPE {rpe}</span>
      )}
      {rir != null && Number(rir) > 0 && (
        <span className="ml-2 text-xs text-zinc-400">RIR {rir}</span>
      )}
      {durationSeconds != null && <span className="mt-1 block text-xs text-zinc-400">Подход {formatSeconds(durationSeconds)}
        {restBeforeSeconds != null ? ` · отдых перед ним ${formatSeconds(restBeforeSeconds)}` : ''}</span>}
    </div>
  );
};
