-- Release B MVP: per-exercise progression targets on public.gym_exercises.
--
-- Strictly additive. Five nullable columns, no backfill, no default values.
-- Nothing is inferred: an exercise without a configured range is treated by the
-- app as "not configured yet" and offers a setup button rather than guessing.
-- Suggestions may be computed from history and shown, but only a person's
-- confirmation writes them here.
--
-- Re-runnable: every statement is IF NOT EXISTS / dropped-then-created.

alter table public.gym_exercises
  add column if not exists rep_range_low integer,
  add column if not exists rep_range_high integer,
  add column if not exists input_weight_step numeric(8,3),
  add column if not exists target_working_sets integer,
  add column if not exists rir_target_max numeric(3,1);

comment on column public.gym_exercises.rep_range_low is
  'Lower bound of the working rep range, e.g. 10 in 10-12. NULL = not configured.';
comment on column public.gym_exercises.rep_range_high is
  'Upper bound of the working rep range, e.g. 12 in 10-12. NULL = not configured.';
comment on column public.gym_exercises.input_weight_step is
  'Smallest usable weight increment in the units the USER TYPES for this '
  'exercise, not in effective kilograms. For a barbell with multiplier 2 a '
  '1.25 kg plate per side is a step of 1.25 here and 2.5 kg of effective load.';
comment on column public.gym_exercises.target_working_sets is
  'How many working sets this exercise is meant to get. Also the fallback for '
  'deciding which sets count as working when set_type is unmarked.';
comment on column public.gym_exercises.rir_target_max is
  'Highest reps-in-reserve still considered on target on the last working set. '
  'NULL = RIR is not used for this exercise; the rule falls back to reps only.';

-- Bounds are deliberately wide. They exist to catch a typo or a unit mix-up,
-- not to encode a training opinion.
alter table public.gym_exercises
  drop constraint if exists gym_exercises_rep_range_low_range;
alter table public.gym_exercises
  add constraint gym_exercises_rep_range_low_range
  check (rep_range_low is null or (rep_range_low >= 1 and rep_range_low <= 100));

alter table public.gym_exercises
  drop constraint if exists gym_exercises_rep_range_high_range;
alter table public.gym_exercises
  add constraint gym_exercises_rep_range_high_range
  check (rep_range_high is null or (rep_range_high >= 1 and rep_range_high <= 100));

-- Either both bounds are set or neither is: a half-configured range would make
-- the recommendation rule silently untestable.
alter table public.gym_exercises
  drop constraint if exists gym_exercises_rep_range_order;
alter table public.gym_exercises
  add constraint gym_exercises_rep_range_order
  check (
    (rep_range_low is null and rep_range_high is null)
    or (rep_range_low is not null and rep_range_high is not null
        and rep_range_low <= rep_range_high)
  );

alter table public.gym_exercises
  drop constraint if exists gym_exercises_input_weight_step_positive;
alter table public.gym_exercises
  add constraint gym_exercises_input_weight_step_positive
  check (input_weight_step is null or (input_weight_step > 0 and input_weight_step <= 100));

alter table public.gym_exercises
  drop constraint if exists gym_exercises_target_working_sets_range;
alter table public.gym_exercises
  add constraint gym_exercises_target_working_sets_range
  check (target_working_sets is null or (target_working_sets >= 1 and target_working_sets <= 20));

alter table public.gym_exercises
  drop constraint if exists gym_exercises_rir_target_max_range;
alter table public.gym_exercises
  add constraint gym_exercises_rir_target_max_range
  check (rir_target_max is null or (rir_target_max >= 0 and rir_target_max <= 10));
