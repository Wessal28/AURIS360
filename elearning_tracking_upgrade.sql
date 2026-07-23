-- AURIS360 e-learning tracking upgrade
-- Run once in Supabase SQL Editor, then refresh the app.

alter table public.elearning_courses
  add column if not exists course_url text,
  add column if not exists duration_minutes integer,
  add column if not exists validity_months integer default 12,
  add column if not exists mandatory boolean default false,
  add column if not exists target_roles text,
  add column if not exists passing_score integer;

alter table public.elearning_enrolments
  add column if not exists target_date date,
  add column if not exists expiry_date date,
  add column if not exists attempts integer default 1,
  add column if not exists time_spent_minutes integer,
  add column if not exists watch_started_at timestamptz,
  add column if not exists watch_completed_at timestamptz,
  add column if not exists watched_seconds numeric default 0,
  add column if not exists video_duration_seconds numeric,
  add column if not exists watch_progress_pct numeric default 0,
  add column if not exists certificate_ref text,
  add column if not exists certificate_issued_at timestamptz,
  add column if not exists valid_from date;

create index if not exists idx_elearning_enrolments_company_course
  on public.elearning_enrolments(company_id, course_id);

create index if not exists idx_elearning_enrolments_watch_status
  on public.elearning_enrolments(company_id, status, watch_progress_pct);

notify pgrst, 'reload schema';
