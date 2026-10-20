import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';

export function SectionLink({ title, detail, icon: Icon, onClick }: {
  title: string; detail?: string; icon: LucideIcon; onClick: () => void;
}) {
  return <button type="button" onClick={onClick}
    className="flex min-h-14 w-full items-center gap-3 py-3 text-left text-zinc-100 hover:bg-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
    <Icon className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
    <span className="min-w-0 flex-1"><span className="block font-medium">{title}</span>
      {detail && <span className="block text-sm text-zinc-400">{detail}</span>}
    </span>
    <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
  </button>;
}
