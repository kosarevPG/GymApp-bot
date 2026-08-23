export type SetType = 'warmup' | 'working' | 'drop' | 'failure';

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: string;
  description?: string;
  imageUrl?: string;
  secondaryMuscles?: string;
  weightType?: string;
  baseWeight?: number;
  weightMultiplier?: number;
  /* Release B progression targets. Null/undefined means "not configured" —
     the card then offers a setup button instead of a recommendation. */
  repRangeLow?: number | null;
  repRangeHigh?: number | null;
  inputWeightStep?: number | null;
  targetWorkingSets?: number | null;
  rirTargetMax?: number | null;
}

export interface WorkoutSet {
  id: string;
  weight: string;
  reps: string;
  rest: string;
  completed: boolean;
  prevWeight?: number;
  setType?: SetType;
  rpe?: number | string;
  rir?: number | string;
  isLowConfidence?: boolean;
  requestId?: string;
  order?: number;
}

export interface HistoryItem {
  session_id?: string;
  date: string;
  weight: number;
  input_weight?: number;
  reps: number;
  rest: number;
  order?: number;
  set_type?: string;
  rpe?: number;
  rir?: number;
}

export interface ExerciseSessionData {
  exercise: Exercise;
  note: string;
  sets: WorkoutSet[];
  history: HistoryItem[];
  sessionId?: string;
}
