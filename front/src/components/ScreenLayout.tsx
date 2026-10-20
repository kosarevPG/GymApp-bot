import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

export function ScreenContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-3xl px-4 ${className}`}>{children}</div>;
}

export function ScreenHeader({ title, onBack, backLabel = 'На главную', action, children }: {
  title: string; onBack?: () => void; backLabel?: string; action?: ReactNode; children?: ReactNode;
}) {
  return <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950 pb-3 pt-safe-4">
    <ScreenContent className="flex min-h-11 items-center gap-3">
      {onBack && <button type="button" aria-label={backLabel} onClick={onBack}
        className="-ml-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-zinc-300 hover:bg-zinc-800 active:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
        <ChevronLeft className="h-6 w-6" aria-hidden="true" />
      </button>}
      <h1 className={children ? 'sr-only' : 'min-w-0 flex-1 text-xl font-bold text-zinc-50'}>{title}</h1>
      {children && <div className="min-w-0 flex-1">{children}</div>}
      {action}
    </ScreenContent>
  </header>;
}
