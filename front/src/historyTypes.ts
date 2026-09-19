import type { LoadRules } from './exerciseConfig';

/** Shapes returned by GET /api/global_history. Shared by the summary code. */
export interface GlobalHistorySet {
  id?: string;
  weight?: number;
  input_weight?: number;
  reps?: number;
  rest?: number;
  order?: number;
  set_type?: string;
  rpe?: number;
  rir?: number;
  load?: LoadRules | null;
}

export interface GlobalHistoryExercise {
  name?: string;
  exerciseId?: string;
  supersetId?: string | null;
  sets?: GlobalHistorySet[];
  /** Отрезки кардио: минуты, скорость, наклон. */
  cardio?: { minutes?: number; speed?: number; incline?: number; order?: number }[];
}

export interface GlobalHistorySession {
  id?: string;
  /** `_api_date` emits YYYY.MM.DD, but ISO shows up too. Both are handled. */
  date?: string;
  muscleGroups?: string[];
  exercises?: GlobalHistoryExercise[];
}
