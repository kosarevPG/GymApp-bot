import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Search, ChevronRight, Plus, X, Info, 
  Check, Trash2, StickyNote, ChevronDown, Dumbbell, Calendar, 
  ChevronLeft, Settings, ArrowLeft, Camera, Pencil, Trophy,
  History as HistoryIcon, Activity, Link as LinkIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { API_BASE_URL, AUTH_TOKEN_KEY, WORKOUT_STORAGE_KEY, ACTIVE_WORKOUT_KEY, sortGroups, SESSION_ID_KEY, ORDER_COUNTER_KEY, LAST_ACTIVE_KEY } from './constants';
import { SetDisplayRow } from './components/SetDisplayRow';
import { calcEffectiveWeight, weightInputLabel, WEIGHT_TYPE_OPTIONS, USER_BODY_WEIGHT_DEFAULT } from './exerciseConfig';
import type { Exercise, WorkoutSet, HistoryItem, ExerciseSessionData, SetType } from './types';
import {
  QUEUE_CHANGED_EVENT,
  addToQueue,
  upsertQueue,
  getPendingCount,
  getQueue,
  markAttempt,
  removeFromQueue,
  type QueuedItem,
} from './offlineSync';

// --- TYPES ---

type Screen = 'home' | 'exercises' | 'workout' | 'history' | 'analytics';

interface GlobalWorkoutSession {
  id: string;
  date: string;
  muscleGroups: string[];
  duration: string;
  exercises: { 
    name: string; 
    sets: any[]; 
    supersetId?: string;
  }[];
}

// --- HELPERS ---

const getToken = () => localStorage.getItem(AUTH_TOKEN_KEY) || '';

const cacheExercises = (data: any) => {
  try { localStorage.setItem('gym_exercises_cache', JSON.stringify(data)); } catch (_) {}
};

const getCachedExercises = () => {
  try { return JSON.parse(localStorage.getItem('gym_exercises_cache') || 'null'); } catch { return null; }
};

const historyCacheKey = (exerciseId: string) => `gym_history_cache_${exerciseId}`;

const cacheHistory = (exerciseId: string, data: any) => {
  try { localStorage.setItem(historyCacheKey(exerciseId), JSON.stringify(data)); } catch (_) {}
};

const getCachedHistory = (exerciseId: string) => {
  try { return JSON.parse(localStorage.getItem(historyCacheKey(exerciseId)) || 'null'); } catch { return null; }
};

const GLOBAL_HISTORY_CACHE_KEY = 'gym_global_history_cache';

let syncInFlight = false;

const initNetworkListeners = () => {
  const sync = () => { void api.syncOfflineQueue(); };
  window.addEventListener('online', sync);
  const interval = window.setInterval(sync, 30_000);
  sync();
  return () => {
    window.removeEventListener('online', sync);
    window.clearInterval(interval);
  };
};

// --- API SERVICE ---

const api = {
  request: async (endpoint: string, options: RequestInit = {}) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      if (!API_BASE_URL) throw new Error('VITE_API_BASE_URL is not configured');
      const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}?url=/api/${endpoint}`;
      const res = await fetch(url, {
        ...options,
        signal: options.signal || controller.signal,
        headers: { 
          'Content-Type': 'application/json', 
          'X-Auth-Token': getToken(),
          ...options.headers 
        }
      });
      if (!res.ok) throw new Error('API Error');
      return await res.json();
    } catch (e) {
      console.error(e);
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  },

  // refresh=1 обходит кэш каталога на бэкенде — нужен сразу после правки,
  // иначе ответ может прийти с данными до неё и затереть изменение в UI.
  getInit: async (refresh = false) => {
    const data = await api.request(refresh ? 'init?refresh=1' : 'init');
    if (data && data.exercises) {
      cacheExercises(data);
      return data;
    }
    return null;
  },

  getCachedInit: () => getCachedExercises(),

  getHistory: async (exerciseId: string) => {
    const data = await api.request(`history?exercise_id=${exerciseId}`);
    const raw = data || getCachedHistory(exerciseId) || { history: [], note: '' };
    if (data) cacheHistory(exerciseId, data);
    let history: HistoryItem[] = raw.history || [];
    const first = history[0] as { sets?: unknown[] } | undefined;
    if (history.length > 0 && first && 'sets' in first && Array.isArray(first.sets)) {
      history = history.flatMap((d: { date: string; sets?: Record<string, unknown>[] }) => (d.sets || []).map((s) => ({ ...s, date: d.date }))) as HistoryItem[];
    }
    return { history, note: raw.note || '' };
  },

  getGlobalHistory: async () => {
    const data = await api.request('global_history');
    if (data) {
      try { localStorage.setItem(GLOBAL_HISTORY_CACHE_KEY, JSON.stringify(data)); } catch (_) {}
      return data;
    }
    try { return JSON.parse(localStorage.getItem(GLOBAL_HISTORY_CACHE_KEY) || '[]'); } catch { return []; }
  },

  getAnalytics: async (period: number = 14) => {
    const params = new URLSearchParams();
    params.set('period', period.toString());
    const data = await api.request(`analytics?${params.toString()}`);
    return data || null;
  },
  
  confirmBaseline: async (proposalId: string, action: 'CONFIRM' | 'SNOOZE' | 'DECLINE') => {
    return await api.request('confirm_baseline', {
      method: 'POST',
      body: JSON.stringify({ proposalId, action })
    });
  },

  saveSet: async (data: any): Promise<{ status?: string; row_number?: number; pending_id?: string; offline?: boolean }> => {
    const clientRequestId = String(data.client_request_id || crypto.randomUUID());
    const pendingId = addToQueue('saveSet', { ...data, client_request_id: clientRequestId });
    queueMicrotask(() => { void api.syncOfflineQueue(); });
    return { status: 'queued', pending_id: pendingId, offline: !navigator.onLine };
  },

  updateSet: async (data: any): Promise<{ status?: string; pending_id?: string; offline?: boolean }> => {
    const clientRequestId = String(data.client_request_id || crypto.randomUUID());
    const pendingId = upsertQueue('updateSet', { ...data, client_request_id: clientRequestId });
    queueMicrotask(() => { void api.syncOfflineQueue(); });
    return { status: 'queued', pending_id: pendingId, offline: !navigator.onLine };
  },

  deleteSet: async (data: any): Promise<boolean> => {
    const id = String(data.client_request_id || '');
    // Подход ещё не улетел на сервер — достаточно убрать его из очереди.
    if (id && getQueue().some((item) => item.id === id && item.type === 'saveSet')) {
      removeFromQueue(id);
      return true;
    }
    const res = await api.request('delete_set', { method: 'POST', body: JSON.stringify(data) });
    return !!res && res.status === 'success';
  },

  deleteWorkout: async (date: string): Promise<{ status?: string; deleted?: number } | null> => {
    return await api.request('delete_workout', { method: 'POST', body: JSON.stringify({ date }) });
  },

  exportData: async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60_000);
    try {
      return await api.request('export', { signal: controller.signal });
    } finally {
      window.clearTimeout(timeout);
    }
  },

  importData: async (payload: unknown) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60_000);
    try {
      return await api.request('import', { method: 'POST', body: JSON.stringify(payload), signal: controller.signal });
    } finally {
      window.clearTimeout(timeout);
    }
  },

  validateToken: async (token: string): Promise<'ok' | 'invalid' | 'offline'> => {
    if (!API_BASE_URL) return 'offline';
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${API_BASE_URL}?url=/api/ping`, {
        headers: { 'X-Auth-Token': token },
        signal: controller.signal,
      });
      if (res.ok) return 'ok';
      if (res.status === 401 || res.status === 403) return 'invalid';
      return 'offline';
    } catch {
      return 'offline';
    } finally {
      window.clearTimeout(timeout);
    }
  },

  syncOfflineQueue: async () => {
    if (syncInFlight || !navigator.onLine || !getToken() || !API_BASE_URL) return;
    syncInFlight = true;
    try {
      for (const item of getQueue()) {
        const endpoint = item.type === 'saveSet' ? 'save_set' : 'update_set';
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 12_000);
        try {
          const res = await fetch(`${API_BASE_URL}?url=/api/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify(item.data),
            signal: controller.signal,
          });
          if (res.status === 401 || res.status === 403) {
            markAttempt(item.id, 'authorization');
            break;
          }
          const result = res.ok ? await res.json() : null;
          if (res.ok && result?.status === 'success') {
            removeFromQueue(item.id);
          } else {
            markAttempt(item.id, `HTTP ${res.status}`);
            if (res.status >= 500) break;
          }
        } catch (error) {
          markAttempt(item.id, error instanceof Error ? error.message : 'network');
          break;
        } finally {
          window.clearTimeout(timeout);
        }
      }
    } finally {
      syncInFlight = false;
    }
  },

  createExercise: async (name: string, group: string) => {
    return await api.request('create_exercise', { method: 'POST', body: JSON.stringify({ name, group }) });
  },

  updateExercise: async (id: string, updates: Partial<Exercise>) => {
    return await api.request('update_exercise', { method: 'POST', body: JSON.stringify({ id, updates }) });
  },

  ping: async () => {
    return await api.request('ping');
  },

  uploadImage: async (file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    try {
      const res = await fetch(`${API_BASE_URL}?url=/api/upload_image`, {
        method: 'POST',
        headers: { 'X-Auth-Token': getToken() },
        body: formData
      });
      if (!res.ok) throw new Error('Upload failed');
      return await res.json();
    } catch (e) { return null; }
  }
};

// --- HOOKS ---

const useHaptics = () => {
  const haptic = (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => {
    const tg = (window as any).Telegram?.WebApp?.HapticFeedback;
    if (tg?.impactOccurred) { try { tg.impactOccurred(style); return; } catch (_) {} }
    if (navigator.vibrate) {
      if (style === 'light') navigator.vibrate(10);
      else if (style === 'medium') navigator.vibrate(20);
      else navigator.vibrate(40);
    }
  };
  const notify = (type: 'error' | 'success' | 'warning') => {
    const tg = (window as any).Telegram?.WebApp?.HapticFeedback;
    if (tg?.notificationOccurred) { try { tg.notificationOccurred(type); return; } catch (_) {} }
    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
  };
  return { haptic, notify };
};

const useDebounce = <T,>(value: T, delay: number): T => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debouncedValue;
};

const useTimer = () => {
  const [time, setTime] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef<any>(null);

  const start = () => {
    if (isRunning) return;
    setIsRunning(true);
    const startTime = Date.now() - time;
    intervalRef.current = setInterval(() => setTime(Date.now() - startTime), 50);
  };
  const pause = () => {
    setIsRunning(false);
    clearInterval(intervalRef.current);
  };
  const reset = () => {
    setIsRunning(false);
    clearInterval(intervalRef.current);
    setTime(0);
  };
  const resetAndStart = () => {
    clearInterval(intervalRef.current);
    setTime(0);
    setIsRunning(true);
    const startTime = Date.now();
    intervalRef.current = setInterval(() => setTime(Date.now() - startTime), 50);
  };
  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    const ms2 = Math.floor((ms % 1000) / 10).toString().padStart(2, '0');
    return `${m}:${s}.${ms2}`;
  };
  return { time, isRunning, start, pause, reset, resetAndStart, formatTime };
};

const useSession = () => {
  const [sessionId, setSessionId] = useState('');
  const [orderCounter, setOrderCounter] = useState(0);
  const orderCounterRef = useRef(0);

  useEffect(() => {
    const lastActive = localStorage.getItem(LAST_ACTIVE_KEY);
    const savedSession = localStorage.getItem(SESSION_ID_KEY);
    const savedOrder = localStorage.getItem(ORDER_COUNTER_KEY);
    const now = Date.now();

    if (!lastActive || (now - parseInt(lastActive)) > 14400000 || !savedSession) {
      const newId = crypto.randomUUID();
      setSessionId(newId);
      setOrderCounter(0);
      orderCounterRef.current = 0;
      localStorage.setItem(SESSION_ID_KEY, newId);
      localStorage.setItem(ORDER_COUNTER_KEY, '0');
      // Тренировка не может пережить свою сессию: иначе восстановленный
      // setGroupId встретится с обнулённым Order, и подходы уйдут в дубли.
      localStorage.removeItem(WORKOUT_STORAGE_KEY);
      localStorage.removeItem(ACTIVE_WORKOUT_KEY);
    } else {
      setSessionId(savedSession || '');
      const restoredOrder = parseInt(savedOrder || '0');
      setOrderCounter(restoredOrder);
      orderCounterRef.current = restoredOrder;
    }
    localStorage.setItem(LAST_ACTIVE_KEY, now.toString());
  }, []);

  const resetSession = () => {
    const newId = crypto.randomUUID();
    setSessionId(newId);
    setOrderCounter(0);
    orderCounterRef.current = 0;
    localStorage.setItem(SESSION_ID_KEY, newId);
    localStorage.setItem(ORDER_COUNTER_KEY, '0');
    localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
  };

  const incrementOrder = () => {
    const next = orderCounterRef.current + 1;
    orderCounterRef.current = next;
    setOrderCounter(next);
    localStorage.setItem(ORDER_COUNTER_KEY, next.toString());
    localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
    return next;
  };

  // Подтягивает счётчик под уже записанные подходы восстановленной тренировки,
  // чтобы новый Order не совпал с существующей строкой в таблице.
  const ensureOrderAtLeast = (value: number) => {
    if (!Number.isFinite(value) || value <= orderCounterRef.current) return;
    orderCounterRef.current = value;
    setOrderCounter(value);
    localStorage.setItem(ORDER_COUNTER_KEY, value.toString());
  };
  const bodyWeightKey = 'gym_body_weight';
  const [bodyWeight, setBodyWeight] = useState(() => {
    try {
      const v = localStorage.getItem(bodyWeightKey);
      return v ? parseFloat(v) : USER_BODY_WEIGHT_DEFAULT;
    } catch { return USER_BODY_WEIGHT_DEFAULT; }
  });
  const updateBodyWeight = (v: number) => {
    setBodyWeight(v);
    localStorage.setItem(bodyWeightKey, String(v));
  };
  return { sessionId, incrementOrder, ensureOrderAtLeast, bodyWeight, updateBodyWeight, resetSession };
};

// --- UI COMPONENTS ---

const Card = ({ children, className = '', onClick }: any) => (
  <div onClick={onClick} className={`bg-zinc-900 border border-zinc-800 rounded-2xl ${className}`}>
    {children}
  </div>
);

const Button = ({ children, variant = 'primary', className = '', onClick, icon: Icon }: any) => {
  const variants: any = {
    primary: "bg-blue-600 text-white shadow-lg shadow-blue-900/20 hover:bg-blue-500",
    secondary: "bg-zinc-800 text-zinc-50 hover:bg-zinc-700",
    ghost: "bg-transparent text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800/50",
    danger: "bg-red-500/10 text-red-500 hover:bg-red-500/20",
    success: "bg-green-500/10 text-green-500"
  };
  return (
    <button onClick={onClick} className={`flex items-center justify-center font-medium rounded-xl transition-all active:scale-95 disabled:opacity-50 ${variants[variant]} ${className}`}>
      {Icon && <Icon className="w-5 h-5 mr-2" />}
      {children}
    </button>
  );
};

const Input = React.forwardRef<HTMLInputElement, any>((props, ref) => (
  <input ref={ref} {...props} className={`w-full h-12 bg-zinc-900 text-zinc-50 rounded-xl px-4 focus:outline-none focus:ring-1 focus:ring-zinc-600 placeholder:text-zinc-600 transition-all ${props.className}`} />
));
Input.displayName = 'Input';

const Modal = ({ isOpen, onClose, title, children, headerAction }: any) => (
  <AnimatePresence>
    {isOpen && (
      <>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50" />
        <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 300 }} className="fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 rounded-t-3xl z-50 max-h-[90vh] flex flex-col">
          <div className="p-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
            <h3 className="text-lg font-semibold text-zinc-50 truncate max-w-[70%]">{title}</h3>
            <div className="flex items-center gap-2">
              {headerAction}
              <button onClick={onClose} className="p-2 bg-zinc-800 rounded-full text-zinc-400"><X className="w-5 h-5" /></button>
            </div>
          </div>
          <div className="overflow-y-auto p-4 flex-1 pb-10">{children}</div>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

// --- FEATURES ---

const TimerBlock = ({ timer, onToggle, sessionTonnage = 0, restTarget = null }: any) => {
  const minutes = timer.time / 60000;
  const density = minutes > 0 ? Math.round(sessionTonnage / minutes) : 0;
  const remaining = restTarget != null ? restTarget - timer.time : null;
  const resting = remaining != null && timer.isRunning && remaining > 0;
  const restOver = remaining != null && timer.isRunning && remaining <= 0;
  return (
    <div className="sticky top-0 z-40 bg-zinc-950/80 backdrop-blur-md pb-4 pt-safe-2 px-4 border-b border-zinc-800/50 mb-4">
      <Card className="flex items-center justify-between p-3 px-5 shadow-xl shadow-black/50">
        <div className="flex flex-col gap-0.5">
          <div className={`font-mono text-3xl font-bold tracking-wider tabular-nums ${resting ? 'text-blue-400' : restOver ? 'text-amber-400' : 'text-zinc-50'}`}>
            {resting ? timer.formatTime(remaining) : timer.formatTime(timer.time)}
          </div>
          {resting && <div className="text-xs text-blue-400/80">отдых — осталось до подхода</div>}
          {restOver && <div className="text-xs text-amber-400/80">отдых окончен — работаем</div>}
          {!resting && !restOver && sessionTonnage > 0 && <div className="text-xs text-zinc-500">Плотность: {density} кг/мин</div>}
        </div>
        <div className="flex gap-2">
          <Button variant={timer.isRunning ? "danger" : "primary"} onClick={onToggle} className="w-20 h-10 text-sm">{timer.isRunning ? "Стоп" : "Старт"}</Button>
        </div>
      </Card>
    </div>
  );
};

const NoteWidget = ({ initialValue, onChange }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState(initialValue);
  useEffect(() => setValue(initialValue), [initialValue]);

  return (
    <div className="mb-4">
      <button onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-2 text-yellow-500 text-sm font-medium mb-2 w-full">
        <StickyNote className="w-4 h-4" /><span>Заметка</span><ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <textarea value={value} onChange={(e) => { setValue(e.target.value); onChange(e.target.value); }} placeholder="Настройки..." className="w-full bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-yellow-200 text-sm focus:outline-none min-h-[80px]" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const HistoryListModal = ({ isOpen, onClose, history, exerciseName }: any) => {
  const groupedHistory = useMemo(() => {
    const groups: Record<string, HistoryItem[]> = {};
    history.forEach((item: HistoryItem) => {
      if (!groups[item.date]) groups[item.date] = [];
      groups[item.date].push(item);
    });
    Object.keys(groups).forEach(date => {
      groups[date].sort((a, b) => (a.order || 0) - (b.order || 0));
    });
    return groups;
  }, [history]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`История: ${exerciseName}`}>
      <div className="space-y-6">
        {Object.entries(groupedHistory).map(([date, items]) => (
          <div key={date}>
            <div className="flex items-center gap-2 mb-2 sticky top-0 bg-zinc-900 py-1 z-10">
              <Calendar className="w-4 h-4 text-zinc-500" /><span className="text-sm font-bold text-zinc-400 uppercase tracking-wider">{date}</span>
            </div>
            <div className="bg-zinc-800/30 border border-zinc-800 rounded-xl overflow-hidden">
              {items.map((item, idx) => (
                <div key={idx} className="p-3 border-b border-zinc-800 last:border-0">
                  <SetDisplayRow
                    weight={item.weight}
                    reps={item.reps}
                    rest={item.rest}
                    setType={item.set_type}
                    rpe={item.rpe}
                    rir={item.rir}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
        {history.length === 0 && <div className="text-center text-zinc-500 py-10">История пуста</div>}
      </div>
    </Modal>
  );
};

const SET_TYPE_CYCLE: SetType[] = ['warmup', 'working', 'drop', 'failure'];
const SET_TYPE_LABELS: Record<SetType, string> = { warmup: 'W', working: 'R', drop: 'D', failure: 'F' };

const SetRow = ({ set, exercise, bodyWeight = USER_BODY_WEIGHT_DEFAULT, isActive = false, onUpdate, onDelete, onComplete }: { set: WorkoutSet; exercise?: Exercise; bodyWeight?: number; isActive?: boolean; onUpdate: (sid: string, field: string, value: string | number) => void; onDelete: (sid: string) => void; onComplete: (sid: string) => void }) => {
  const effectiveWeight = calcEffectiveWeight(exercise, parseFloat(set.weight || '0'), bodyWeight);
  const showTotal = set.weight !== '' && effectiveWeight !== parseFloat(set.weight || '0');
  const oneRM = set.weight && set.reps ? Math.round(effectiveWeight * (1 + parseInt(set.reps) / 30)) : 0;
  const delta = set.prevWeight ? (effectiveWeight - set.prevWeight) : 0;
  const deltaText = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '0';
  const deltaColor = delta > 0 ? 'text-green-500' : delta < 0 ? 'text-red-500' : 'text-zinc-500';

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`mb-3 ${set.completed ? 'opacity-60 grayscale' : ''}`}>
      <div className="grid grid-cols-[auto_auto_1fr_1fr_1fr_auto] gap-2 items-start">
        <button
          disabled={set.completed}
          onClick={() => {
            const idx = SET_TYPE_CYCLE.indexOf((set.setType || 'working') as SetType);
            const next = SET_TYPE_CYCLE[(idx + 1) % SET_TYPE_CYCLE.length];
            onUpdate(set.id, 'setType', next);
          }}
          className={`w-8 h-12 rounded-lg text-xs font-bold flex items-center justify-center transition-colors ${
            (set.setType || 'working') === 'warmup' ? 'bg-zinc-700 text-zinc-400' :
            (set.setType || 'working') === 'drop' ? 'bg-orange-900/50 text-orange-400' :
            (set.setType || 'working') === 'failure' ? 'bg-red-900/50 text-red-400' :
            'bg-zinc-800 text-zinc-200'
          }`}
          title={set.setType || 'working'}
        >
          {SET_TYPE_LABELS[(set.setType || 'working') as SetType]}
        </button>
        <button onClick={() => onComplete(set.id)} className={`w-12 h-12 rounded-xl border flex items-center justify-center transition-colors ${set.completed ? 'bg-green-500 border-green-500' : 'bg-zinc-900 border-zinc-700'}`}>
          <Check className={`w-6 h-6 ${set.completed ? 'text-white' : 'text-zinc-700'}`} />
        </button>
        <div className="flex flex-col gap-1">
          <input
            type="number"
            inputMode="decimal"
            placeholder="0"
            value={set.weight}
            disabled={set.completed}
            onChange={e => onUpdate(set.id, 'weight', e.target.value)}
            onFocus={e => e.target.select()}
            className="w-full h-12 bg-zinc-800 rounded-xl text-center text-xl font-bold text-zinc-100 focus:ring-1 focus:ring-blue-500 outline-none tabular-nums"
          />
          {(showTotal || oneRM > 0 || delta !== 0 || (set.rir != null && set.rir !== '')) && (
            <div className="flex justify-between px-1 text-[10px]">
              <span>
                {showTotal && <span className="text-blue-400 font-medium mr-1">Σ{effectiveWeight}</span>}
                {oneRM > 0 && <span className="text-zinc-500">1ПМ:{oneRM}</span>}
                {set.rir != null && set.rir !== '' && <span className="text-zinc-500 ml-1">| RIR: {set.rir}</span>}
              </span>
              {delta !== 0 && <span className={`${deltaColor} font-medium`}>{deltaText}</span>}
            </div>
          )}
        </div>
        <input
          type="tel"
          inputMode="numeric"
          placeholder="0"
          value={set.reps}
          disabled={set.completed}
          onChange={e => onUpdate(set.id, 'reps', e.target.value)}
          onFocus={e => e.target.select()}
          className="w-full h-12 bg-zinc-800 rounded-xl text-center text-xl font-bold text-zinc-100 focus:ring-1 focus:ring-blue-500 outline-none tabular-nums"
        />
        <input 
          type="number" 
          inputMode="decimal" 
          placeholder="0" 
          value={set.rest}
          disabled={set.completed}
          onChange={e => onUpdate(set.id, 'rest', e.target.value)}
          onFocus={e => e.target.select()}
          className="w-full h-12 bg-zinc-800 rounded-xl text-center text-zinc-400 focus:text-zinc-100 focus:ring-1 focus:ring-blue-500 outline-none tabular-nums"
        />
        <button onClick={() => onDelete(set.id)} className="w-10 h-12 flex items-center justify-center text-zinc-600 hover:text-red-500"><Trash2 className="w-5 h-5" /></button>
      </div>
      {isActive && !set.completed && (
      <div className="flex flex-wrap gap-2 mt-2 ml-14">
        {([0, 1, 2, 3] as const).map(rirVal => (
          <button
            key={rirVal}
            onClick={() => onUpdate(set.id, 'rir', set.rir === rirVal ? '' : rirVal)}
            className={`px-2 py-1 text-xs rounded-lg border ${String(set.rir) === String(rirVal) ? 'bg-zinc-700 border-zinc-600 text-zinc-200' : 'bg-zinc-800/50 border-zinc-800 text-zinc-500'}`}
          >
            RIR {rirVal}{rirVal === 3 ? '+' : ''}
          </button>
        ))}
        <input
          type="number"
          min={1}
          max={10}
          placeholder="RPE"
          value={set.rpe ?? ''}
          onChange={e => onUpdate(set.id, 'rpe', e.target.value)}
          className="w-12 h-7 bg-zinc-800 rounded text-center text-xs text-zinc-400 focus:text-zinc-100 focus:ring-1 focus:ring-blue-500 outline-none"
        />
      </div>
      )}
    </motion.div>
  );
};

const WorkoutCard = ({ exerciseData, bodyWeight = USER_BODY_WEIGHT_DEFAULT, onAddSet, onUpdateSet, onDeleteSet, onCompleteSet, onNoteChange, onAddSuperset }: any) => {
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const personalRecord = useMemo(() => {
    if (!exerciseData.history.length) return 0;
    return Math.max(...exerciseData.history.map((h: HistoryItem) => h.weight));
  }, [exerciseData.history]);

  return (
    <Card className="p-4 mb-4">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-50">{exerciseData.exercise.name}</h2>
          {personalRecord > 0 && (
            <div className="flex items-center gap-1 text-yellow-500 text-xs font-medium mt-1">
              <Trophy className="w-3 h-3" /><span>PR: {personalRecord} кг</span>
            </div>
          )}
        </div>
        <button onClick={() => setShowHistoryModal(true)} className="p-2 bg-zinc-800/50 rounded-lg text-zinc-400 hover:text-blue-500"><Calendar className="w-5 h-5" /></button>
      </div>
      <NoteWidget initialValue={exerciseData.note} onChange={onNoteChange} />
      <HistoryListModal isOpen={showHistoryModal} onClose={() => setShowHistoryModal(false)} history={exerciseData.history} exerciseName={exerciseData.exercise.name} />
      <div className="grid grid-cols-[auto_auto_1fr_1fr_1fr_auto] gap-2 mb-2 px-1">
        <div className="w-8" />
        <div className="w-10" />
        <div className="text-[10px] text-center text-zinc-500 font-bold uppercase">{weightInputLabel(exerciseData.exercise)}</div>
        <div className="text-[10px] text-center text-zinc-500 font-bold uppercase">ПОВТ</div>
        <div className="text-[10px] text-center text-zinc-500 font-bold uppercase">МИН</div>
        <div className="w-8" />
      </div>
      <div className="space-y-1">
        {exerciseData.sets.map((set: WorkoutSet) => (
          <SetRow key={set.id} set={set} exercise={exerciseData.exercise} bodyWeight={bodyWeight} isActive={set.id === exerciseData.sets.find((s: WorkoutSet) => !s.completed)?.id} onUpdate={onUpdateSet} onDelete={onDeleteSet} onComplete={onCompleteSet} />
        ))}
      </div>
      <div className="flex gap-2 mt-4">
        <Button variant="secondary" onClick={onAddSet} className="flex-1 h-12 bg-zinc-800/50 border border-dashed border-zinc-700 text-zinc-400 hover:text-blue-500"><Plus className="w-5 h-5 mr-2" /> Подход</Button>
        <Button variant="ghost" onClick={onAddSuperset} className="w-1/3 h-12 border border-dashed border-zinc-800 text-zinc-500 hover:text-white"><Plus className="w-4 h-4 mr-1" /> Сет</Button>
      </div>
    </Card>
  );
};

// --- SCREENS ---

const HomeScreen = ({ groups, workoutActive, onStartWorkout, onFinishWorkout, onSearch, onSelectGroup, onAllExercises, onHistory, onAnalytics, onSettings }: any) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-4 pb-4 pt-safe-4 space-y-6">
    {workoutActive
      ? <Button variant="secondary" onClick={onFinishWorkout} className="w-full h-14 text-lg border border-red-900/50 text-red-400">Закончить тренировку</Button>
      : <Button variant="primary" onClick={onStartWorkout} className="w-full h-14 text-lg font-semibold shadow-xl shadow-blue-900/20">Начать тренировку</Button>}
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
        <Input placeholder="Найти..." onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSearch(e.target.value)} className="pl-12 bg-zinc-900 w-full" />
      </div>
      <button onClick={onHistory} className="p-3 bg-zinc-900 rounded-xl text-zinc-400 hover:text-blue-500"><HistoryIcon className="w-6 h-6" /></button>
      <button onClick={onAnalytics} className="p-3 bg-zinc-900 rounded-xl text-zinc-400 hover:text-blue-500"><Activity className="w-6 h-6" /></button>
      <button onClick={onSettings} className="p-3 bg-zinc-900 rounded-xl text-zinc-400 hover:text-blue-500"><Settings className="w-6 h-6" /></button>
    </div>
    <div className="flex flex-col space-y-2">
      {groups.map((group: string) => (
        <Card key={group} onClick={() => onSelectGroup(group)} className="flex items-center p-4 hover:bg-zinc-800 transition-colors active:scale-95 cursor-pointer">
          <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-500 flex-shrink-0"><Dumbbell className="w-6 h-6" /></div>
          <span className="font-medium text-zinc-200 text-lg ml-4 flex-1">{group}</span>
          <ChevronRight className="w-6 h-6 text-zinc-600" />
        </Card>
      ))}
    </div>
    <Button onClick={onAllExercises} variant="secondary" className="w-full h-14 text-lg">Все упражнения</Button>
  </motion.div>
);

const ExercisesListScreen = ({ exercises, title, onBack, onSelectExercise, onAddExercise, onEditExercise, searchQuery, onSearch }: any) => {
  const [infoModalEx, setInfoModalEx] = useState<Exercise | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    if (searchQuery && searchInputRef.current) {
      searchInputRef.current.focus();
      const length = searchInputRef.current.value.length;
      searchInputRef.current.setSelectionRange(length, length);
    }
  }, [searchQuery]);
  
  return (
    <motion.div initial={{ x: 50, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="flex flex-col h-full">
      <div className="sticky top-0 z-30 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800 px-4 pb-4 pt-safe-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button onClick={onBack} className="p-2 -ml-2 text-zinc-400 active:text-white"><ChevronLeft className="w-6 h-6" /></button>
          {searchQuery ? (
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <Input 
                ref={searchInputRef}
                placeholder="Найти..." 
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSearch(e.target.value)} 
                className="pl-8 bg-zinc-900 w-full h-9 text-sm" 
              />
            </div>
          ) : (
            <h1 className="text-xl font-bold truncate">{title}</h1>
          )}
        </div>
        <button onClick={onAddExercise} className="p-2 text-blue-500 hover:bg-zinc-800 rounded-full active:scale-90"><Plus className="w-7 h-7" /></button>
      </div>
      <div className="p-4 space-y-2 pb-24">
        {exercises.map((ex: Exercise) => (
          <div key={ex.id} className="flex items-center p-2 rounded-2xl hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-all">
            <div onClick={(e) => { e.stopPropagation(); setInfoModalEx(ex); }} className="w-14 h-14 rounded-xl bg-zinc-800 flex-shrink-0 overflow-hidden cursor-pointer active:scale-90 transition-transform relative group">
              {ex.imageUrl ? <img src={ex.imageUrl} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-zinc-600"><Info /></div>}
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Settings className="w-5 h-5 text-white" /></div>
            </div>
            <div onClick={() => onSelectExercise(ex)} className="flex-1 px-4 cursor-pointer">
              <div className="font-medium text-zinc-100 text-[17px]">{ex.name}</div>
              <div className="text-xs text-zinc-500">{ex.muscleGroup}</div>
            </div>
            <button onClick={() => onSelectExercise(ex)} className="p-2 text-zinc-600"><ChevronRight className="w-5 h-5" /></button>
          </div>
        ))}
      </div>
      <Modal isOpen={!!infoModalEx} onClose={() => setInfoModalEx(null)} title={infoModalEx?.name} headerAction={<button onClick={() => { if (infoModalEx) { onEditExercise(infoModalEx); setInfoModalEx(null); } }} className="p-2 bg-zinc-800 rounded-full text-zinc-400 hover:text-blue-400"><Pencil className="w-5 h-5" /></button>}>
        {infoModalEx && (
          <div className="space-y-4">
            <div className="aspect-video bg-zinc-800 rounded-2xl overflow-hidden">{infoModalEx.imageUrl && <img src={infoModalEx.imageUrl} className="w-full h-full object-cover" alt="" />}</div>
            <div className="text-zinc-400 leading-relaxed">{infoModalEx.description || 'Описание отсутствует.'}</div>
            <div className="pt-4"><div className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-2">Группа</div><div className="px-3 py-1 bg-zinc-800 rounded-lg inline-block text-zinc-300 text-sm">{infoModalEx.muscleGroup}</div></div>
          </div>
        )}
      </Modal>
    </motion.div>
  );
};

const readSavedWorkout = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(WORKOUT_STORAGE_KEY) || 'null');
    if (saved && saved.timestamp && Date.now() - saved.timestamp < 86400000) return saved;
  } catch (_) {}
  return null;
};

/** Сегодняшняя дата в том же виде, в каком её пишет бэкенд: «2026.07.31». */
const todayInLogFormat = () =>
  new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }).replace(/-/g, '.');

const WorkoutScreen = ({ initialExercise, allExercises, onBack, sessionId, incrementOrder, ensureOrderAtLeast, bodyWeight = USER_BODY_WEIGHT_DEFAULT, haptic, notify }: any) => {
  const timer = useTimer();
  const savedWorkoutRef = useRef<any>(null);
  if (savedWorkoutRef.current === null) {
    savedWorkoutRef.current = readSavedWorkout() || false;
  }
  const savedWorkout = savedWorkoutRef.current || null;
  // Блок упражнения переживает переход к другому упражнению и обратно: сохранёнка
  // держит всю тренировку, а не только последний открытый экран.
  const savedBlock = savedWorkout?.exercises?.[initialExercise.id] || null;
  const savedGroupId: string | null =
    savedBlock?.setGroupId ||
    (Array.isArray(savedWorkout?.activeExercises) && savedWorkout.activeExercises.includes(initialExercise.id)
      ? savedWorkout?.setGroupId || null
      : null);

  const [setGroupId] = useState(() => savedGroupId || crypto.randomUUID());
  const [activeExercises, setActiveExercises] = useState<string[]>(() => {
    const saved = savedWorkout?.activeExercises;
    // Суперсет восстанавливаем целиком — он делит один setGroupId.
    if (savedGroupId && Array.isArray(saved) && saved.length > 1 && saved.includes(initialExercise.id)) return saved;
    return [initialExercise.id];
  });
  const [sessionData, setSessionData] = useState<Record<string, ExerciseSessionData>>({});
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [supersetSearchQuery, setSupersetSearchQuery] = useState('');

  const loadExerciseData = async (exId: string) => {
    const { history, note } = await api.getHistory(exId);
    const restored = savedWorkoutRef.current?.exercises?.[exId];
    if (restored && Array.isArray(restored.sets)) {
      // Восстановленные подходы уже занимают свои Order в таблице — счётчик
      // сессии обязан продолжиться после них, а не начаться заново.
      ensureOrderAtLeast?.(Math.max(0, ...restored.sets.map((s: WorkoutSet) => s.order || 0)));
    }
    setSessionData(prev => {
      if (prev[exId]) return prev;
      const savedEx = savedWorkoutRef.current?.exercises?.[exId];
      if (savedEx && Array.isArray(savedEx.sets) && savedEx.sets.length > 0) {
        return { ...prev, [exId]: { exercise: allExercises.find((e: Exercise) => e.id === exId)!, note: savedEx.note ?? note ?? '', history, sets: savedEx.sets, sessionId } };
      }
      let initialSets: WorkoutSet[] = [];
      // Шаблон берём с прошлой тренировки. Сегодняшние подходы уже в журнале:
      // подставить их как незавершённые — значит записать вторые копии.
      const templateDate = history.map(h => h.date).find(date => date && date !== todayInLogFormat());
      if (templateDate) {
        const lastDateItems = history
          .filter(h => h.date === templateDate)
          .sort((a, b) => (a.order || 0) - (b.order || 0));
        initialSets = lastDateItems.map(h => ({
          id: crypto.randomUUID(), 
          weight: (h.input_weight ?? h.weight).toString(),
          reps: h.reps.toString(), 
          rest: h.rest.toString(), 
          completed: false, 
          prevWeight: h.weight,
          setType: (h.set_type as SetType) || 'working',
          rpe: h.rpe,
          rir: h.rir
        }));
      } else {
        initialSets = [{ id: crypto.randomUUID(), weight: '', reps: '', rest: '', completed: false, prevWeight: 0 }];
      }
      return { ...prev, [exId]: { exercise: allExercises.find((e: Exercise) => e.id === exId)!, note: note || '', history, sets: initialSets, sessionId } };
    });
  };

  useEffect(() => { activeExercises.forEach(id => loadExerciseData(id)); }, [activeExercises]);

  // Тренировка переживает закрытие мини-аппа: состояние пишется в localStorage
  // на каждое изменение и восстанавливается при следующем открытии (до 24 ч).
  useEffect(() => {
    if (Object.keys(sessionData).length === 0) return;
    try {
      // Сливаем, а не перезаписываем: блоки других упражнений этой тренировки
      // должны пережить переход к следующему упражнению и обратно.
      const blocks: Record<string, unknown> = { ...(readSavedWorkout()?.exercises || {}) };
      Object.entries(sessionData).forEach(([id, d]) => {
        blocks[id] = { sets: d.sets, note: d.note, setGroupId };
      });
      localStorage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify({
        timestamp: Date.now(),
        setGroupId,
        activeExercises,
        exercises: blocks,
      }));
      // Открытое упражнение = тренировка де-факто идёт: отмечаем её активной,
      // чтобы на главной появилась кнопка «Закончить тренировку».
      if (!localStorage.getItem(ACTIVE_WORKOUT_KEY)) {
        localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify({ startedAt: Date.now() }));
      }
    } catch (_) {}
  }, [sessionData, activeExercises, setGroupId]);

  const sessionTonnage = useMemo(() => {
    let total = 0;
    activeExercises.forEach(exId => {
      const data = sessionData[exId];
      if (!data) return;
      const ex = allExercises.find((e: Exercise) => e.id === exId);
      data.sets.filter((s: WorkoutSet) => s.completed && (s.setType || 'working') === 'working').forEach((s: WorkoutSet) => {
        const w = calcEffectiveWeight(ex, parseFloat(s.weight || '0'), bodyWeight);
        total += w * (parseInt(s.reps || '0') || 0);
      });
    });
    return total;
  }, [sessionData, activeExercises, allExercises, bodyWeight]);

  const [restTarget, setRestTarget] = useState<number | null>(null);
  const restAlerted = useRef(false);

  useEffect(() => {
    if (!restTarget || !timer.isRunning || restAlerted.current) return;
    if (timer.time >= restTarget) {
      restAlerted.current = true;
      haptic('heavy');
      notify('warning');
    }
  }, [timer.time, restTarget, timer.isRunning]);

  const handleCompleteSet = async (exId: string, setId: string) => {
    const set = sessionData[exId]?.sets.find(s => s.id === setId);
    if (!set) return;
    if (set.completed) {
      // Повторный тап по галочке разблокирует подход для правки; при
      // следующей галочке уйдёт update той же строки, а не новая запись.
      haptic('light');
      setSessionData(prev => ({ ...prev, [exId]: { ...prev[exId], sets: prev[exId].sets.map(s => s.id === setId ? { ...s, completed: false } : s) } }));
      return;
    }
    if (!set.weight || !set.reps) { notify('error'); return; }

    haptic('medium');
    const isEdit = !!set.requestId;
    setSessionData(prev => ({ ...prev, [exId]: { ...prev[exId], sets: prev[exId].sets.map(s => s.id === setId ? { ...s, completed: true } : s) } }));
    if (!isEdit) {
      const restMs = (parseFloat(set.rest) || 0) * 60_000;
      setRestTarget(restMs > 0 ? restMs : null);
      restAlerted.current = false;
      timer.resetAndStart();
    }

    try {
      const exercise = allExercises.find((e: Exercise) => e.id === exId);
      const inputWeight = parseFloat(set.weight);
      const payload = {
        exercise_id: exId,
        exercise_name: exercise?.name,
        input_weight: inputWeight,
        weight: calcEffectiveWeight(exercise, inputWeight, bodyWeight),
        reps: parseInt(set.reps),
        rest: parseFloat(set.rest) || 0,
        note: sessionData[exId].note,
        set_group_id: setGroupId,
        session_id: sessionId,
        set_type: set.setType || 'working',
        rpe: set.rpe != null && set.rpe !== '' ? parseFloat(String(set.rpe)) : undefined,
        rir: set.rir != null && set.rir !== '' ? parseInt(String(set.rir), 10) : undefined
      };
      if (isEdit) {
        await api.updateSet({ ...payload, client_request_id: set.requestId, order: set.order });
      } else {
        const order = incrementOrder();
        const result = await api.saveSet({ ...payload, order });
        const requestId = result?.pending_id;
        setSessionData(prev => ({ ...prev, [exId]: { ...prev[exId], sets: prev[exId].sets.map(s => s.id === setId ? { ...s, requestId, order } : s) } }));
      }
      notify('success');
    } catch (e) {
      notify('error');
    }
  };

  const handleUpdateSet = (exId: string, setId: string, field: string, val: string | number) => {
    setSessionData(prev => ({ ...prev, [exId]: { ...prev[exId], sets: prev[exId].sets.map(s => s.id === setId ? { ...s, [field]: val } : s) } }));
  };
  
  const handleAddSet = (exId: string) => {
    setSessionData(prev => {
      const currentSets = prev[exId].sets;
      const lastSet = currentSets[currentSets.length - 1];
      const newSet: WorkoutSet = { id: crypto.randomUUID(), weight: lastSet?.weight || '', reps: lastSet?.reps || '', rest: lastSet?.rest || '', completed: false, prevWeight: 0, setType: 'working' };
      return { ...prev, [exId]: { ...prev[exId], sets: [...currentSets, newSet] } };
    });
  };

  const handleDeleteSet = async (exId: string, setId: string) => {
    const set = sessionData[exId]?.sets.find(s => s.id === setId);
    if (set?.requestId) {
      // Подход уже записан в таблицу — удаляем и строку на сервере.
      const ok = await api.deleteSet({ client_request_id: set.requestId, exercise_id: exId, set_group_id: setGroupId, order: set.order });
      if (!ok) { notify('error'); return; }
      haptic('medium');
    }
    setSessionData(prev => {
      if (!prev[exId]) return prev;
      const filteredSets = prev[exId].sets.filter(s => s.id !== setId);
      const finalSets = filteredSets.length === 0
        ? [{ id: crypto.randomUUID(), weight: '', reps: '', rest: '', completed: false, prevWeight: 0, setType: 'working' as SetType }]
        : filteredSets;
      return { ...prev, [exId]: { ...prev[exId], sets: finalSets } };
    });
  };

  return (
    <div className="min-h-screen bg-zinc-950 pb-20">
      <TimerBlock timer={timer} onToggle={() => { if (timer.isRunning) { timer.reset(); setRestTarget(null); } else { timer.start(); } }} sessionTonnage={sessionTonnage} restTarget={restTarget} />
      <div className="px-4 space-y-4">
        {activeExercises.map(exId => {
          const data = sessionData[exId];
          if (!data) return <div key={exId} className="h-40 bg-zinc-900 rounded-2xl animate-pulse" />;
          return <WorkoutCard key={exId} exerciseData={data} bodyWeight={bodyWeight} onAddSet={() => handleAddSet(exId)} onUpdateSet={(sid: string, f: string, v: string) => handleUpdateSet(exId, sid, f, v)} onDeleteSet={(sid: string) => handleDeleteSet(exId, sid)} onCompleteSet={(sid: string) => handleCompleteSet(exId, sid)} onNoteChange={(val: string) => setSessionData(p => ({...p, [exId]: {...p[exId], note: val}}))} onAddSuperset={() => setIsAddModalOpen(true)} />;
        })}
      </div>
      <div className="px-4 mt-8 mb-20"><Button variant="primary" onClick={onBack} className="w-full h-14 text-lg font-semibold shadow-xl shadow-blue-900/20">Завершить упражнение</Button></div>
      <Modal isOpen={isAddModalOpen} onClose={() => { setIsAddModalOpen(false); setSupersetSearchQuery(''); }} title="Добавить в суперсет">
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <Input 
              placeholder="Поиск упражнения..." 
              value={supersetSearchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSupersetSearchQuery(e.target.value)}
              onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.target.select()}
              className="pl-10 bg-zinc-900 w-full" 
            />
          </div>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {allExercises
              .filter((ex: Exercise) => ex.name.toLowerCase().includes(supersetSearchQuery.toLowerCase()))
              .map((ex: Exercise) => (
                <div 
                  key={ex.id} 
                  onClick={() => { 
                    if (!activeExercises.includes(ex.id)) setActiveExercises([...activeExercises, ex.id]);
                    setIsAddModalOpen(false);
                    setSupersetSearchQuery('');
                  }} 
                  className="flex items-center p-3 bg-zinc-800/50 rounded-xl border border-zinc-800 cursor-pointer hover:bg-zinc-800 transition-colors"
                >
                  <div className="font-medium text-zinc-200">{ex.name}</div>
                  {activeExercises.includes(ex.id) && <Check className="ml-auto text-green-500 w-5 h-5"/>}
                </div>
              ))}
            {allExercises.filter((ex: Exercise) => ex.name.toLowerCase().includes(supersetSearchQuery.toLowerCase())).length === 0 && (
              <div className="text-center text-zinc-500 py-4 text-sm">Упражнения не найдены</div>
            )}
          </div>
        </div>
      </Modal>
      <div className="fixed bottom-6 left-6 z-20"><button onClick={onBack} className="w-12 h-12 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center border border-zinc-700 shadow-lg hover:text-white"><ArrowLeft className="w-6 h-6" /></button></div>
    </div>
  );
};

const HistoryScreen = ({ onBack, allExercises = [], bodyWeight = USER_BODY_WEIGHT_DEFAULT, notify, haptic }: any) => {
  const [history, setHistory] = useState<GlobalWorkoutSession[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [editW, setEditW] = useState('');
  const [editR, setEditR] = useState('');
  const [editRest, setEditRest] = useState('');
  const [deleteDay, setDeleteDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => api.getGlobalHistory().then(data => setHistory(data));
  useEffect(() => { refresh(); }, []);

  const openEdit = (s: any, ex: any) => {
    const exercise = allExercises.find((e: Exercise) => e.id === ex.exerciseId);
    setEditTarget({ set: s, exerciseId: ex.exerciseId, exerciseName: ex.name, exercise });
    setEditW(String(s.input_weight ?? s.weight ?? ''));
    setEditR(String(s.reps ?? ''));
    setEditRest(String(s.rest ?? ''));
  };

  // Строка в таблице ищется по client_request_id, для старых записей —
  // по натуральному ключу (упражнение + сет-группа + порядок).
  const locator = (t: any) => ({ client_request_id: String(t.set.id || ''), exercise_id: t.exerciseId, set_group_id: t.set.setGroupId, order: t.set.order });

  const saveEdit = async () => {
    if (!editTarget || busy) return;
    const inputWeight = parseFloat(editW.replace(',', '.'));
    const reps = parseInt(editR, 10);
    if (Number.isNaN(inputWeight) || !(reps > 0)) { notify?.('error'); return; }
    setBusy(true);
    const res = await api.request('update_set', { method: 'POST', body: JSON.stringify({
      ...locator(editTarget),
      input_weight: inputWeight,
      weight: calcEffectiveWeight(editTarget.exercise, inputWeight, bodyWeight),
      reps,
      rest: parseFloat(editRest.replace(',', '.')) || 0,
    }) });
    setBusy(false);
    if (res && res.status === 'success') { haptic?.('medium'); notify?.('success'); setEditTarget(null); refresh(); }
    else { notify?.('error'); }
  };

  const deleteEditSet = async () => {
    if (!editTarget || busy) return;
    setBusy(true);
    const res = await api.request('delete_set', { method: 'POST', body: JSON.stringify(locator(editTarget)) });
    setBusy(false);
    if (res && res.status === 'success') { haptic?.('medium'); notify?.('success'); setEditTarget(null); refresh(); }
    else { notify?.('error'); }
  };

  const deleteDayConfirmed = async () => {
    if (!deleteDay || busy) return;
    setBusy(true);
    const res = await api.deleteWorkout(deleteDay);
    setBusy(false);
    if (res && res.status === 'success') { haptic?.('medium'); notify?.('success'); setDeleteDay(null); refresh(); }
    else { notify?.('error'); }
  };

  return (
    <motion.div initial={{ x: 50, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="min-h-screen bg-zinc-950">
      <div className="sticky top-0 z-30 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800 px-4 pb-4 pt-safe-4 flex items-center gap-4">
        <button onClick={onBack} className="p-2 -ml-2 text-zinc-400 active:text-white"><ChevronLeft className="w-6 h-6" /></button>
        <h1 className="text-xl font-bold">История</h1>
      </div>
      <div className="p-4 space-y-4 pb-20">
        {history.map(w => (
          <Card key={w.id} className="overflow-hidden">
            <div onClick={() => setExpandedId(expandedId === w.id ? null : w.id)} className="p-4 flex items-center justify-between cursor-pointer active:bg-zinc-800/50">
              <div>
                <div className="flex items-center gap-2 text-zinc-400 text-sm"><Calendar className="w-3 h-3" />{w.date} {w.muscleGroups.join(' • ')}</div>
              </div>
              <div className="flex items-center gap-1">
                {expandedId === w.id && (
                  <button onClick={(e) => { e.stopPropagation(); setDeleteDay(w.date); }} className="p-2 text-zinc-600 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                )}
                <ChevronDown className={`w-5 h-5 text-zinc-500 transition-transform ${expandedId === w.id ? 'rotate-180' : ''}`} />
              </div>
            </div>
            <AnimatePresence>
              {expandedId === w.id && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="border-t border-zinc-800 bg-zinc-900/30 overflow-hidden">
                  {w.exercises && w.exercises.length > 0 ? (
                    w.exercises.map((ex: any, i: number) => {
                      const isSuperset = !!ex.supersetId;
                      const prevSupersetId = i > 0 ? w.exercises[i-1].supersetId : null;
                      const nextSupersetId = i < w.exercises.length - 1 ? w.exercises[i+1].supersetId : null;
                      const isSupersetStart = isSuperset && prevSupersetId !== ex.supersetId;
                      let borderClass = "border-b border-zinc-800/50";
                      let paddingClass = "p-4";
                      let supersetIndicator = null;
                      if (isSuperset) {
                        borderClass = "border-l-2 border-l-blue-500 border-b border-zinc-800/50 bg-blue-500/5";
                        if (isSupersetStart) supersetIndicator = <div className="text-xs text-blue-400 font-bold mb-2 flex items-center"><LinkIcon className="w-3 h-3 mr-1" /> СУПЕРСЕТ</div>;
                        if (prevSupersetId === ex.supersetId && nextSupersetId === ex.supersetId) borderClass += " border-b-0";
                      }
                      return (
                        <div key={i} className={`${paddingClass} ${borderClass} last:border-b-0`}>
                          {supersetIndicator}
                          <div className="font-medium text-zinc-300 mb-2">{ex.name}</div>
                          {ex.sets && Array.isArray(ex.sets) && ex.sets.length > 0 ? (
                            <div className="space-y-1">
                              {ex.sets.map((s: any, j: number) => (
                                <button key={j} onClick={() => openEdit(s, ex)} className="w-full px-2 py-1 bg-zinc-800/30 rounded flex items-center justify-between text-left active:bg-zinc-800/60">
                                  <SetDisplayRow
                                    weight={s.weight}
                                    reps={s.reps}
                                    rest={s.rest}
                                    setType={s.set_type}
                                    rpe={s.rpe}
                                    rir={s.rir}
                                  />
                                  <Pencil className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0 ml-2" />
                                </button>
                              ))}
                            </div>
                          ) : <div className="text-xs text-zinc-500">Нет подходов</div>}
                        </div>
                      );
                    })
                  ) : <div className="p-4 text-center text-zinc-500 text-sm">Нет упражнений</div>}
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        ))}
        {history.length === 0 && <div className="text-center text-zinc-500 py-10 flex flex-col items-center"><Activity className="w-12 h-12 mb-3 opacity-20" /><p>Нет данных</p></div>}
      </div>
      <Modal isOpen={!!editTarget} onClose={() => setEditTarget(null)} title="Правка подхода">
        {editTarget && (
          <div className="space-y-4">
            <div className="text-sm text-zinc-400">{editTarget.exerciseName} · {editTarget.set.date}</div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-[10px] text-zinc-500 mb-1 block uppercase">{weightInputLabel(editTarget.exercise)}</label><Input type="number" inputMode="decimal" value={editW} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditW(e.target.value)} /></div>
              <div><label className="text-[10px] text-zinc-500 mb-1 block uppercase">Повт</label><Input type="tel" inputMode="numeric" value={editR} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditR(e.target.value)} /></div>
              <div><label className="text-[10px] text-zinc-500 mb-1 block uppercase">Мин</label><Input type="number" inputMode="decimal" value={editRest} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditRest(e.target.value)} /></div>
            </div>
            <Button className="w-full h-12" onClick={saveEdit}>{busy ? 'Сохраняю…' : 'Сохранить'}</Button>
            <Button variant="secondary" className="w-full h-12 text-red-400" onClick={deleteEditSet}>Удалить подход</Button>
          </div>
        )}
      </Modal>
      <Modal isOpen={!!deleteDay} onClose={() => setDeleteDay(null)} title="Удалить тренировку?">
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">Все подходы за {deleteDay} будут удалены из таблицы. Действие необратимо.</p>
          <Button variant="danger" className="w-full h-12" onClick={deleteDayConfirmed}>{busy ? 'Удаляю…' : 'Да, удалить'}</Button>
          <Button variant="secondary" className="w-full h-12" onClick={() => setDeleteDay(null)}>Отмена</Button>
        </div>
      </Modal>
    </motion.div>
  );
};

const MUSCLE_ORDER = ['Спина', 'Ноги', 'Грудь', 'Плечи', 'Трицепс', 'Бицепс', 'Пресс', 'Кардио'];

const AnalyticsScreen = ({ onBack }: any) => {
  const [data, setData] = useState<{ volume?: number; acwr?: { acute: number; chronic: number; ratio: number; status: string; trainingDays?: number }; muscleVolume?: Record<string, number>; muscleSets?: Record<string, number> } | null>(null);
  const [period, setPeriod] = useState(14);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getAnalytics(period).then((d) => {
      setData(d);
      setLoading(false);
    });
  }, [period]);

  const muscleList = useMemo(() => {
    const sets = data?.muscleSets || {};
    const vol = data?.muscleVolume || {};
    const hasData = MUSCLE_ORDER.some(m => (sets[m] ?? 0) > 0 || (vol[m] ?? 0) > 0);
    return hasData ? MUSCLE_ORDER.filter(m => (sets[m] ?? 0) > 0 || (vol[m] ?? 0) > 0) : [...MUSCLE_ORDER];
  }, [data?.muscleSets, data?.muscleVolume]);

  const barColor = (sets: number) => {
    if (sets < 6) return 'bg-zinc-600';
    if (sets >= 10 && sets <= 15) return 'bg-green-600';
    if (sets > 20) return 'bg-red-600';
    return 'bg-zinc-500';
  };

  return (
    <motion.div initial={{ x: 50, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="min-h-screen bg-zinc-950">
      <div className="sticky top-0 z-30 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800 px-4 pb-4 pt-safe-4 flex items-center gap-4">
        <button onClick={onBack} className="p-2 -ml-2 text-zinc-400 active:text-white"><ChevronLeft className="w-6 h-6" /></button>
        <h1 className="text-xl font-bold">Аналитика</h1>
      </div>
      <div className="p-4 space-y-6 pb-20">
        {data?.acwr?.status === 'danger' && (
          <div className="p-4 rounded-xl bg-red-900/40 border border-red-700 text-red-200 text-sm font-medium flex items-center gap-2">
            <Activity className="w-5 h-5 flex-shrink-0" />
            ACWR {data.acwr.ratio} — риск перетренированности. Снизьте нагрузку.
          </div>
        )}
        {data?.acwr?.status === 'building' && (
          <div className="p-4 rounded-xl bg-zinc-800/60 border border-zinc-700 text-zinc-300 text-sm flex items-center gap-2">
            <Activity className="w-5 h-5 flex-shrink-0 text-blue-400" />
            Накапливаю базу: {data.acwr.trainingDays ?? 0} из 8 тренировок за 28 дней. Оценка нагрузки (ACWR) появится позже.
          </div>
        )}
        <div className="flex gap-2">
          {[7, 14, 28].map((d) => (
            <button key={d} onClick={() => setPeriod(d)} className={`px-4 py-2 rounded-xl text-sm font-medium ${period === d ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>{d} дн.</button>
          ))}
        </div>
        {loading ? (
          <div className="text-center text-zinc-500 py-10">Загрузка...</div>
        ) : (
          <>
            <Card className="p-4">
              <h2 className="text-sm font-bold text-zinc-400 uppercase mb-3">Подходы по мышцам</h2>
              <div className="space-y-3">
                {muscleList.map((m) => {
                  const sets = (data?.muscleSets || {})[m] ?? 0;
                  const pct = Math.min(100, (sets / 20) * 100);
                  return (
                    <div key={m} className="flex items-center gap-3">
                      <span className="text-zinc-300 w-24 text-sm">{m}</span>
                      <div className="flex-1 h-6 bg-zinc-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${barColor(sets)}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-zinc-500 text-sm w-8">{sets}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 text-[10px] text-zinc-500">Зоны за период: серый — мало (&lt;6) · зелёный — оптимум (10–15) · красный — перебор (&gt;20)</div>
            </Card>
            <Card className="p-4">
              <h2 className="text-sm font-bold text-zinc-400 uppercase mb-3">Объём по группам (кг)</h2>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={muscleList.map(m => ({ name: m, volume: Math.round((data?.muscleVolume || {})[m] ?? 0) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#a1a1aa', fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: '#27272a', border: '1px solid #3f3f46' }} formatter={(v: number | undefined) => [(v ?? 0).toLocaleString('ru') + ' кг', 'Тоннаж']} />
                    <Bar dataKey="volume" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-4">
              <h2 className="text-sm font-bold text-zinc-400 uppercase mb-3">Объём нагрузки</h2>
              <div className="text-2xl font-bold text-zinc-50">{(data?.volume ?? 0).toLocaleString('ru')} кг</div>
              {data?.acwr && (
                <div className="mt-2 text-sm text-zinc-400">
                  {data.acwr.status === 'building'
                    ? <>ACWR: н/д — мало данных (неделя за 7 дн: {data.acwr.acute?.toLocaleString('ru')} кг)</>
                    : <>ACWR: {data.acwr.ratio} (острая: {data.acwr.acute?.toLocaleString('ru')}, хроническая: {data.acwr.chronic?.toLocaleString('ru')})</>}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </motion.div>
  );
};

const EditExerciseModal = ({ isOpen, onClose, exercise, groups, onSave }: any) => {
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [image, setImage] = useState('');
  const [weightMultiplier, setWeightMultiplier] = useState<string>('1');
  const [weightType, setWeightType] = useState('');
  const [baseWeight, setBaseWeight] = useState<string>('0');
  const [secondaryMuscles, setSecondaryMuscles] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (exercise) {
      setName(exercise.name);
      setGroup(exercise.muscleGroup);
      setImage(exercise.imageUrl || '');
      setWeightMultiplier(String(exercise.weightMultiplier ?? 1));
      setWeightType(exercise.weightType || 'Machine');
      setBaseWeight(String(exercise.baseWeight ?? 0));
      setSecondaryMuscles(exercise.secondaryMuscles || '');
    }
  }, [exercise]);
  
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { const r = new FileReader(); r.onloadend = () => setImage(r.result as string); r.readAsDataURL(file); }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Редактировать">
      <div className="space-y-6">
        <div onClick={() => fileRef.current?.click()} className="w-full h-48 bg-zinc-800 rounded-2xl overflow-hidden relative flex items-center justify-center cursor-pointer border border-zinc-700 border-dashed">
          {image ? <img src={image} className="w-full h-full object-cover" alt="" /> : <div className="flex flex-col items-center text-zinc-500"><Camera className="w-8 h-8 mb-2" /><span className="text-sm">Фото</span></div>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
        <div><label className="text-sm text-zinc-400 mb-1 block">Название</label><Input value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} /></div>
        <div>
          <label className="text-sm text-zinc-400 mb-1 block">Группа</label>
          <div className="flex flex-wrap gap-2">{groups.map((g: string) => <button key={g} onClick={() => setGroup(g)} className={`px-3 py-2 rounded-xl text-sm border ${group === g ? 'bg-blue-600 border-blue-600 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>{g}</button>)}</div>
        </div>
        <div>
          <label className="text-sm text-zinc-400 mb-1 block">Тип нагрузки</label>
          <div className="flex flex-wrap gap-2">{WEIGHT_TYPE_OPTIONS.map(opt => <button key={opt.value} onClick={() => { setWeightType(opt.value); if (opt.value === 'Assisted') { setBaseWeight('90'); setWeightMultiplier('-1'); } }} className={`px-3 py-2 rounded-xl text-sm border ${weightType === opt.value ? 'bg-blue-600 border-blue-600 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>{opt.label}</button>)}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-zinc-400 mb-1 block">Гриф/база, кг</label>
            <Input type="number" step="0.5" value={baseWeight} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBaseWeight(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className="text-sm text-zinc-400 mb-1 block">Множитель</label>
            <Input type="number" step="0.01" value={weightMultiplier} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWeightMultiplier(e.target.value)} placeholder="1" />
          </div>
        </div>
        <div className="text-xs text-zinc-500 -mt-3">Множитель 2 — ввод «блины на сторону» или вес одной гантели. Для «Свой вес» — доля веса тела (0.68 для отжиманий).</div>
        <div>
          <label className="text-sm text-zinc-400 mb-1 block">Вторичные мышцы</label>
          <Input value={secondaryMuscles} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSecondaryMuscles(e.target.value)} placeholder="Грудь, Трицепс" />
        </div>
        <Button onClick={() => { onSave(exercise.id, { name, muscleGroup: group, imageUrl: image, weightType, baseWeight: parseFloat(baseWeight) || 0, weightMultiplier: parseFloat(weightMultiplier) || 1, secondaryMuscles }); onClose(); }} className="w-full h-12">Сохранить</Button>
      </div>
    </Modal>
  );
};

// --- MAIN ---

const App = () => {
  const { haptic, notify } = useHaptics();
  const { sessionId, incrementOrder, ensureOrderAtLeast, bodyWeight, updateBodyWeight, resetSession } = useSession();
  const [screen, setScreen] = useState<Screen>('home');
  const [groups, setGroups] = useState<string[]>([]);
  const [allExercises, setAllExercises] = useState<Exercise[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentExercise, setCurrentExercise] = useState<Exercise | null>(null);
  const [exerciseToEdit, setExerciseToEdit] = useState<Exercise | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [pendingCount, setPendingCount] = useState(getPendingCount());

  // Состояние для авторизации
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem(AUTH_TOKEN_KEY));
  const [authInput, setAuthInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authChecking, setAuthChecking] = useState(false);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [bodyWeightInput, setBodyWeightInput] = useState('');
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [queueItems, setQueueItems] = useState<QueuedItem[]>([]);

  const [workoutActive, setWorkoutActive] = useState(() => !!localStorage.getItem(ACTIVE_WORKOUT_KEY));
  const [isFinishConfirmOpen, setIsFinishConfirmOpen] = useState(false);
  const [importReport, setImportReport] = useState('');
  const [dataBusy, setDataBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Тренировка могла стартовать неявно (из экрана подходов) — освежаем флаг
  // при каждом возврате на главную.
  useEffect(() => {
    if (screen === 'home') setWorkoutActive(!!localStorage.getItem(ACTIVE_WORKOUT_KEY));
  }, [screen]);

  const startWorkout = () => {
    localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify({ startedAt: Date.now() }));
    setWorkoutActive(true);
    haptic('medium');
  };

  const finishWorkoutConfirmed = () => {
    localStorage.removeItem(ACTIVE_WORKOUT_KEY);
    localStorage.removeItem(WORKOUT_STORAGE_KEY);
    resetSession();
    setWorkoutActive(false);
    setIsFinishConfirmOpen(false);
    setCurrentExercise(null);
    notify('success');
  };

  const handleExport = async () => {
    if (dataBusy) return;
    setDataBusy(true);
    const data = await api.exportData();
    setDataBusy(false);
    if (!data) { notify('error'); return; }
    const text = JSON.stringify(data);
    const fileName = `gymapp-backup-${new Date().toISOString().slice(0, 10)}.json`;
    try {
      const file = new File([text], fileName, { type: 'application/json' });
      const nav = navigator as any;
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: fileName });
        notify('success');
        return;
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    notify('success');
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || dataBusy) return;
    try {
      const payload = JSON.parse(await file.text());
      setDataBusy(true);
      setImportReport('');
      const result = await api.importData(payload);
      setDataBusy(false);
      if (!result) { notify('error'); setImportReport('Импорт не удался — проверь файл и сеть.'); return; }
      notify('success');
      setImportReport(`Упражнения: +${result.exercises_added ?? 0}, обновлено ${result.exercises_updated ?? 0}. Подходы: +${result.log_added ?? 0}, пропущено дублей ${result.log_skipped ?? 0}.`);
      const fresh = await api.getInit(true);
      if (fresh && fresh.groups) {
        setGroups(sortGroups(fresh.groups));
        setAllExercises(fresh.exercises || []);
      }
    } catch {
      setDataBusy(false);
      notify('error');
      setImportReport('Файл не похож на бэкап GymApp (ожидается JSON экспорта).');
    }
  };

  const handleLogin = async () => {
    const token = authInput.trim();
    if (!token || authChecking) return;
    setAuthChecking(true);
    setAuthError('');
    const status = await api.validateToken(token);
    if (status === 'invalid') {
      setAuthError('Неверный токен — проверь и попробуй ещё раз.');
      setAuthChecking(false);
      return;
    }
    // 'offline' пропускаем: приложение offline-first, проверим при синке.
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    setAuthChecking(false);
    setIsAuthenticated(true);
  };

  useEffect(() => {
    if (allExercises.length === 0) return;
    const saved = localStorage.getItem(WORKOUT_STORAGE_KEY);
    if (saved) {
      try {
        const session = JSON.parse(saved);
        const isFresh = session.timestamp && (Date.now() - session.timestamp) < 86400000;
        if (isFresh && session.activeExercises && session.activeExercises.length > 0) {
          const exId = session.activeExercises[0];
          const ex = allExercises.find((e: Exercise) => e.id === exId);
          if (ex) { setCurrentExercise(ex); setScreen('workout'); }
        } else { localStorage.removeItem(WORKOUT_STORAGE_KEY); }
      } catch { localStorage.removeItem(WORKOUT_STORAGE_KEY); }
    }
  }, [allExercises]);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      try {
        tg.ready();
        tg.expand();
        tg.disableVerticalSwipes?.();
        tg.setHeaderColor?.('#09090b');
        tg.setBackgroundColor?.('#09090b');
      } catch (_) { /* старые клиенты Telegram */ }
    }
  }, []);

  useEffect(() => {
    const cleanupNetwork = initNetworkListeners();
    const updatePendingCount = () => { setPendingCount(getPendingCount()); setQueueItems(getQueue()); };
    window.addEventListener(QUEUE_CHANGED_EVENT, updatePendingCount);
    updatePendingCount();
    return () => {
      cleanupNetwork();
      window.removeEventListener(QUEUE_CHANGED_EVENT, updatePendingCount);
    };
  }, []);

  useEffect(() => { 
    if (isAuthenticated) {
      const applyInit = (data: any) => {
        if (data && data.groups) {
          setGroups(sortGroups(data.groups));
          setAllExercises(data.exercises || []);
        }
      };
      applyInit(api.getCachedInit());
      api.getInit().then(d => {
        if (d) applyInit(d);
      }); 
      void api.syncOfflineQueue();
    }
  }, [isAuthenticated]);

  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const filteredExercises = useMemo(() => {
    let list = allExercises;
    if (selectedGroup) list = list.filter(ex => ex.muscleGroup === selectedGroup);
    if (debouncedSearchQuery) list = list.filter(ex => ex.name.toLowerCase().includes(debouncedSearchQuery.toLowerCase()));
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }));
  }, [allExercises, selectedGroup, debouncedSearchQuery]);

  const handleCreate = async () => {
    if (!newName || !newGroup) return;
    // Локальная проверка: не шлём запрос, если имя уже занято.
    const wanted = newName.trim().toLowerCase();
    if (allExercises.some(ex => ex.name.trim().toLowerCase() === wanted)) {
      notify('error');
      setImportReport('');
      alert('Упражнение с таким названием уже есть в библиотеке.');
      return;
    }
    const newEx = await api.createExercise(newName, newGroup);
    if (!newEx) { notify('error'); return; }
    // Сервер вернул существующее (дубль перехвачен) — не добавляем вторую копию.
    if ((newEx as any).deduplicated) {
      setAllExercises(p => p.some(ex => ex.id === newEx.id) ? p : [...p, newEx]);
      notify('warning');
      alert('Такое упражнение уже было — открыл существующее, дубль не создан.');
    } else {
      setAllExercises(p => [...p, newEx]);
      notify('success');
    }
    setIsCreateModalOpen(false);
    setNewName('');
    setNewGroup('');
  };

  const handleUpdate = async (id: string, updates: Partial<Exercise>) => {
    setAllExercises(p => p.map(ex => ex.id === id ? { ...ex, ...updates } : ex));
    const result = await api.updateExercise(id, updates);
    if (result) {
      const freshData = await api.getInit(true);
      if (freshData && freshData.exercises) setAllExercises(freshData.exercises);
      notify('success');
    } else { notify('error'); }
  };

  // ЭКРАН ВХОДА
  if (!isAuthenticated) {
    return (
      <div className="bg-zinc-950 min-h-screen flex items-center justify-center p-4">
        <div className="bg-zinc-900 p-6 rounded-2xl w-full max-w-sm space-y-4">
          <h2 className="text-xl font-bold text-zinc-50 text-center">Вход в gymtracker</h2>
          <Input type="password" placeholder="Секретный токен" value={authInput} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setAuthInput(e.target.value); setAuthError(''); }} />
          {authError && <div className="text-sm text-red-400 text-center">{authError}</div>}
          <Button className="w-full h-12" onClick={handleLogin}>{authChecking ? 'Проверяю…' : 'Войти'}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-zinc-950 min-h-screen text-zinc-50 font-sans selection:bg-blue-500/30 pb-safe">
      {screen === 'home' && <HomeScreen groups={groups} workoutActive={workoutActive} onStartWorkout={startWorkout} onFinishWorkout={() => setIsFinishConfirmOpen(true)} onSearch={(q: string) => { setSearchQuery(q); if (q) setScreen('exercises'); }} onSelectGroup={(g: string) => { setSelectedGroup(g); setScreen('exercises'); }} onAllExercises={() => { setSelectedGroup(null); setScreen('exercises'); }} onHistory={() => setScreen('history')} onAnalytics={() => setScreen('analytics')} onSettings={() => { setBodyWeightInput(String(bodyWeight)); setIsSettingsOpen(true); }} />}
      {screen === 'analytics' && <AnalyticsScreen onBack={() => setScreen('home')} />}
      {screen === 'history' && <HistoryScreen onBack={() => setScreen('home')} allExercises={allExercises} bodyWeight={bodyWeight} notify={notify} haptic={haptic} />}
      {screen === 'exercises' && <ExercisesListScreen exercises={filteredExercises} title={selectedGroup || (searchQuery ? `Поиск: ${searchQuery}` : 'Все упражнения')} searchQuery={searchQuery} onSearch={(q: string) => setSearchQuery(q)} onBack={() => { setSearchQuery(''); setSelectedGroup(null); setScreen('home'); }} onSelectExercise={(ex: Exercise) => { haptic('light'); setCurrentExercise(ex); setScreen('workout'); }} onAddExercise={() => setIsCreateModalOpen(true)} onEditExercise={(ex: Exercise) => setExerciseToEdit(ex)} />}
      {screen === 'workout' && currentExercise && <WorkoutScreen initialExercise={currentExercise} allExercises={allExercises} sessionId={sessionId} incrementOrder={incrementOrder} ensureOrderAtLeast={ensureOrderAtLeast} bodyWeight={bodyWeight} haptic={haptic} notify={notify} onBack={() => setScreen('exercises')} />}
      {pendingCount > 0 && (
        <button
          onClick={() => { setQueueItems(getQueue()); setIsQueueOpen(true); void api.syncOfflineQueue(); }}
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-amber-700/60 bg-amber-950/95 px-4 py-2 text-xs font-medium text-amber-200 shadow-xl"
        >
          В очереди: {pendingCount} · подробнее
        </button>
      )}
      
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Новое упражнение">
        <div className="space-y-4">
          <div><label className="text-sm text-zinc-400 mb-1 block">Название</label><Input value={newName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)} placeholder="Например: Отжимания" /></div>
          <div>
            <label className="text-sm text-zinc-400 mb-1 block">Группа</label>
            <div className="flex flex-wrap gap-2">
              {groups.map(g => <button key={g} onClick={() => setNewGroup(g)} className={newGroup === g ? 'px-3 py-2 rounded-xl text-sm border bg-blue-600 border-blue-600 text-white' : 'px-3 py-2 rounded-xl text-sm border bg-zinc-800 border-zinc-700 text-zinc-400'}>{g}</button>)}
            </div>
          </div>
          <Button onClick={handleCreate} className="w-full h-12 mt-4">Создать</Button>
        </div>
      </Modal>
      <Modal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} title="Настройки">
        <div className="space-y-5">
          <div>
            <label className="text-sm text-zinc-400 mb-1 block">Вес тела, кг</label>
            <Input type="number" inputMode="decimal" value={bodyWeightInput} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBodyWeightInput(e.target.value)} />
            <p className="text-xs text-zinc-500 mt-1">Используется для гравитрона, брусьев и упражнений со своим весом.</p>
          </div>
          <Button className="w-full h-12" onClick={() => { const v = parseFloat(bodyWeightInput.replace(',', '.')); if (v >= 30 && v <= 250) { updateBodyWeight(v); notify('success'); setIsSettingsOpen(false); } else { notify('error'); } }}>Сохранить</Button>
          <div className="border-t border-zinc-800 pt-4 space-y-3">
            <div className="text-sm font-medium text-zinc-400">Данные</div>
            <Button variant="secondary" className="w-full h-12" onClick={handleExport}>{dataBusy ? 'Готовлю…' : 'Экспорт (упражнения + тренировки)'}</Button>
            <Button variant="secondary" className="w-full h-12" onClick={() => importInputRef.current?.click()}>{dataBusy ? 'Импортирую…' : 'Импорт из файла'}</Button>
            <input ref={importInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportFile} />
            {importReport && <p className="text-xs text-zinc-400">{importReport}</p>}
            <p className="text-xs text-zinc-500">Экспорт делает полный слепок таблицы. Импорт добавляет недостающее и не создаёт дубли.</p>
          </div>
          <div className="border-t border-zinc-800 pt-4">
            <Button variant="secondary" className="w-full h-12 text-red-400" onClick={() => { localStorage.removeItem(AUTH_TOKEN_KEY); setIsSettingsOpen(false); setAuthInput(''); setIsAuthenticated(false); }}>Сменить токен (выйти)</Button>
          </div>
        </div>
      </Modal>
      <Modal isOpen={isFinishConfirmOpen} onClose={() => setIsFinishConfirmOpen(false)} title="Закончить тренировку?">
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">Выполненные подходы уже сохранены в таблице. Незавершённые строки и восстановление сессии будут очищены.</p>
          <Button className="w-full h-12" onClick={finishWorkoutConfirmed}>Да, закончить</Button>
          <Button variant="secondary" className="w-full h-12" onClick={() => setIsFinishConfirmOpen(false)}>Отмена</Button>
        </div>
      </Modal>
      <Modal isOpen={isQueueOpen} onClose={() => setIsQueueOpen(false)} title="Очередь синхронизации">
        <div className="space-y-3">
          {queueItems.length === 0 && <div className="text-center text-zinc-500 py-4 text-sm">Очередь пуста — всё синхронизировано.</div>}
          {queueItems.map(item => (
            <div key={item.id} className="flex items-center gap-3 p-3 bg-zinc-800/50 rounded-xl border border-zinc-800">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-zinc-200 truncate">{String(item.data.exercise_name || 'Подход')}</div>
                <div className="text-xs text-zinc-500">{String(item.data.input_weight ?? item.data.weight ?? '?')} кг × {String(item.data.reps ?? '?')} · {item.type === 'saveSet' ? 'новый подход' : 'правка'}</div>
                {item.lastError && <div className="text-xs text-red-400">попыток: {item.attempts} · {item.lastError === 'authorization' ? 'токен не подходит' : item.lastError}</div>}
              </div>
              <button onClick={() => { removeFromQueue(item.id); }} className="p-2 text-zinc-500 hover:text-red-500 flex-shrink-0"><Trash2 className="w-5 h-5" /></button>
            </div>
          ))}
          {queueItems.length > 0 && (
            <Button className="w-full h-12" onClick={async () => { await api.syncOfflineQueue(); if (getQueue().length === 0) { setIsQueueOpen(false); notify('success'); } }}>Синхронизировать сейчас</Button>
          )}
        </div>
      </Modal>
      {exerciseToEdit && <EditExerciseModal isOpen={!!exerciseToEdit} onClose={() => setExerciseToEdit(null)} exercise={exerciseToEdit} groups={groups} onSave={handleUpdate} />}
    </div>
  );
};

export default App;
