-- Keep Training Plan's allowed values aligned with the choices in the form.
-- Preserve the original e-learning and on-the-job values on existing records.
alter table public.training_plan
  drop constraint if exists training_plan_training_type_check;

alter table public.training_plan
  add constraint training_plan_training_type_check
  check (training_type in (
    'internal', 'external', 'e-learning', 'on-the-job',
    'online', 'toolbox', 'induction', 'refresher'
  ));

alter table public.training_plan
  drop constraint if exists training_plan_status_check;

alter table public.training_plan
  add constraint training_plan_status_check
  check (status in (
    'planned', 'confirmed', 'in_progress', 'completed',
    'cancelled', 'postponed', 'overdue'
  ));
