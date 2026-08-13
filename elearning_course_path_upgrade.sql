-- AURIS 360 e-learning course path and final assessment upgrade
-- Additive and rerunnable. Existing single-video courses remain valid.

begin;
create extension if not exists pgcrypto;

alter table public.elearning_courses
  add column if not exists learning_path jsonb not null default '[]'::jsonb,
  add column if not exists quiz_config jsonb not null default '{"enabled":false,"questions":[]}'::jsonb;

alter table public.elearning_enrolments
  add column if not exists learning_progress jsonb not null default '{}'::jsonb,
  add column if not exists quiz_passed boolean,
  add column if not exists quiz_completed_at timestamptz;

create table if not exists public.elearning_quiz_attempts (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  course_id text not null,
  enrolment_id text not null,
  learner_profile_id uuid,
  attempt_no integer not null default 1 check (attempt_no > 0),
  answers jsonb not null default '[]'::jsonb,
  score numeric not null check (score >= 0 and score <= 100),
  passing_score numeric not null check (passing_score >= 0 and passing_score <= 100),
  passed boolean not null,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists elearning_quiz_attempts_enrolment_idx
  on public.elearning_quiz_attempts(company_id,enrolment_id,completed_at desc);

alter table public.elearning_quiz_attempts enable row level security;
drop policy if exists elearning_quiz_attempts_tenant_read on public.elearning_quiz_attempts;
create policy elearning_quiz_attempts_tenant_read on public.elearning_quiz_attempts
for select using (exists (
  select 1 from public.profiles p
  where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=elearning_quiz_attempts.company_id)
));
drop policy if exists elearning_quiz_attempts_tenant_write on public.elearning_quiz_attempts;
create policy elearning_quiz_attempts_tenant_write on public.elearning_quiz_attempts
for all using (exists (
  select 1 from public.profiles p
  where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=elearning_quiz_attempts.company_id)
)) with check (exists (
  select 1 from public.profiles p
  where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=elearning_quiz_attempts.company_id)
));

commit;
notify pgrst, 'reload schema';

