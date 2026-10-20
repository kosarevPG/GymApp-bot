import { Home, History, Activity, CloudUpload } from 'lucide-react';

type Destination = 'home' | 'history' | 'analytics';
export function BottomNavigation({ screen, navigate, pendingCount, onQueue }: {
  screen: string; navigate: (screen: Destination) => void; pendingCount: number; onQueue: () => void;
}) {
  const activeScreen = screen === 'summary' ? 'analytics' : screen;
  const links = [{ screen: 'home' as const, label: 'Главная', icon: Home },
    { screen: 'history' as const, label: 'История', icon: History },
    { screen: 'analytics' as const, label: 'Аналитика', icon: Activity }];
  return <nav aria-label="Основная навигация" className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-950 pb-safe">
    <div className="mx-auto flex h-16 max-w-3xl">
      {links.map(link => <button key={link.screen} onClick={() => navigate(link.screen)} aria-current={activeScreen === link.screen ? 'page' : undefined}
        className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${activeScreen === link.screen ? 'text-blue-400' : 'text-zinc-400 hover:text-zinc-100'}`}>
        <link.icon className="h-5 w-5" />{link.label}
      </button>)}
      {pendingCount > 0 && <button onClick={onQueue} aria-label={`Очередь синхронизации: ${pendingCount}`}
        className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
        <CloudUpload className="h-5 w-5" />Очередь · {pendingCount}
      </button>}
    </div>
  </nav>;
}
