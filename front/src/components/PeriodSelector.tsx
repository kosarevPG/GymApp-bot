export type HistoryPeriod = 7 | 14 | 28;

const periods = [{ days: 7, label: 'Неделя' }, { days: 14, label: '2 недели' }, { days: 28, label: '4 недели' }] as const;

export function PeriodSelector({ value, onChange }: { value: HistoryPeriod; onChange: (days: HistoryPeriod) => void }) {
  return <div role="group" aria-label="Период" className="flex w-full max-w-sm gap-2">
    {periods.map(({ days, label }) => <button key={days} type="button" aria-pressed={value === days}
      onClick={() => onChange(days)}
      className={`min-h-11 min-w-0 flex-1 rounded-xl px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 ${value === days ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}>
      {label}
    </button>)}
  </div>;
}
