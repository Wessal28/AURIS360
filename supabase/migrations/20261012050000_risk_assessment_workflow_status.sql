-- Align the controlled RA workflow with the statuses used by the application.
-- The production baseline allowed only draft/active/review/closed, so a
-- completed assessment could never enter pending_review.
alter table public.risk_assessments
  drop constraint if exists risk_assessments_status_check;

alter table public.risk_assessments
  add constraint risk_assessments_status_check
  check (status in (
    'draft', 'pending_review', 'pending_approval', 'submitted',
    'review', 'approved', 'active', 'rejected', 'closed', 'archived'
  ));
