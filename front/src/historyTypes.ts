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
}

export interface GlobalHistoryExercise {
  name?: string;
  exerciseId?: string;
  supersetId?: string | null;
  sets?: GlobalHistorySet[];
}

export interface GlobalHistorySession {
  id?: string;
  /** `_api_date` emits YYYY.MM.DD, but ISO shows up too. Both are handled. */
  date?: string;
  muscleGroups?: string[];
  exercises?: GlobalHistoryExercise[];
}
