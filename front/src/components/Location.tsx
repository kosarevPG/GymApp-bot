import { Dumbbell, Home, MapPin, type LucideIcon } from 'lucide-react';
import { LOCATION_LABELS, type WorkoutLocation } from '../sessionMetadata';

/** Одни и те же значки места везде: на главной, в истории и в очереди. */
export const LOCATION_ICONS: Record<WorkoutLocation, LucideIcon> = { gym: Dumbbell, home: Home, other: MapPin };
const PLACES = Object.keys(LOCATION_LABELS) as WorkoutLocation[];

export function LocationLabel({ location, className = '' }: { location?: string | null; className?: string }) {
  const Icon = location ? LOCATION_ICONS[location as WorkoutLocation] : undefined;
  if (!Icon) return null;
  return <span className={`inline-flex items-center gap-1 ${className}`}><Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />{LOCATION_LABELS[location as WorkoutLocation]}</span>;
}

export function LocationPicker({ value, onChange, label, disabled = false }: {
  value?: string | null; onChange: (location: WorkoutLocation) => void; label: string; disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-3 gap-1 rounded-xl bg-zinc-900 p-1">
      {PLACES.map(place => {
        const Icon = LOCATION_ICONS[place];
        return (
          <button type="button" key={place} disabled={disabled} aria-pressed={value === place} onClick={() => onChange(place)}
            className={`flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-40 ${value === place ? 'bg-slate-700 text-blue-100' : 'text-zinc-300 hover:bg-zinc-800'}`}>
            <Icon aria-hidden className="h-4 w-4 shrink-0" />{LOCATION_LABELS[place]}
          </button>
        );
      })}
    </div>
  );
}
