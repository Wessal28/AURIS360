-- The incident reporter saves incomplete work before submission. Keep the
-- database status contract aligned with the states offered by the application.
alter table public.events drop constraint if exists events_status_check;
alter table public.events add constraint events_status_check check (
  status in ('draft', 'open', 'submitted', 'awaiting_triage', 'triage',
             'in_progress', 'under_investigation', 'action_required',
             'verification', 'management_review', 'resolved', 'closed',
             'cancelled', 'archived')
);
