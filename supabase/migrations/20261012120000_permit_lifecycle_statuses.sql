-- Permit workflow uses suspension, rejection and completion states in addition
-- to the original register states. Keep the stored type constraint unchanged:
-- permit_type_v2 carries the detailed type while permit_type remains compatible.
alter table public.permits drop constraint if exists permits_status_check;
alter table public.permits add constraint permits_status_check
  check (status in ('draft','pending_approval','approved','active','suspended','completed','closed','cancelled','rejected'));
