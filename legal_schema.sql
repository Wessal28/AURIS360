-- AURIS360 Legal Compliance schema
-- Run this once in Supabase SQL Editor if the Legal Compliance module shows missing-table errors.
-- The script is additive: it creates missing tables/columns and keeps existing data.

create extension if not exists pgcrypto;

create table if not exists public.legal_requirements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  req_ref text,
  legislation text not null,
  title text,
  section text,
  subsection text,
  requirement text,
  legislation_type text default 'statutory',
  category text default 'health_safety',
  jurisdiction text default 'Mauritius',
  authority text,
  obligation_type text default 'mandatory',
  frequency text default 'ongoing',
  applicable boolean default true,
  status text default 'non_compliant',
  compliance_score numeric default 0,
  controls text,
  evidence_required text,
  evidence_location text,
  gap boolean default false,
  gap_identified boolean default false,
  further_controls text,
  gap_description text,
  penalty_risk text,
  notes text,
  responsibility text,
  responsible_person text,
  target_date date,
  effective_date date,
  review_date date,
  last_assessed_date date,
  assessed_by text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.legal_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  date_received date,
  source text,
  jurisdiction text default 'Mauritius',
  legislation text,
  category text default 'health_safety',
  effective_date date,
  applicable boolean default true,
  implemented boolean default false,
  changes_identified text,
  changes text,
  action_required text,
  action text,
  responsible_person text,
  comments text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.compliance_assessments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  assessment_ref text,
  title text not null,
  assessment_type text default 'periodic',
  assessment_date date,
  next_assessment_date date,
  assessor text,
  scope text,
  methodology text,
  compliant_count integer default 0,
  partial_count integer default 0,
  non_compliant_count integer default 0,
  na_count integer default 0,
  total_requirements integer default 0,
  overall_score numeric default 0,
  compliance_score numeric default 0,
  findings text,
  recommendations text,
  status text default 'draft',
  approved_by text,
  approved_date date,
  linked_audit_ref text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.compliance_gaps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  gap_ref text,
  legislation text,
  section text,
  gap_description text not null,
  gap_type text default 'missing_control',
  risk_level text default 'medium',
  action_required text,
  responsible_person text,
  target_date date,
  action_ref text,
  status text default 'open',
  completion_date date,
  closure_notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.compliance_calendar (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  title text not null,
  event_type text default 'submission',
  legislation text,
  obligation_ref text,
  due_date date,
  recurrence text default 'none',
  responsible_person text,
  department text,
  description text,
  reminder_days integer default 30,
  status text default 'upcoming',
  completed_date date,
  linked_action_ref text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.legal_requirements add column if not exists req_ref text;
alter table public.legal_requirements add column if not exists compliance_score numeric default 0;
alter table public.legal_requirements add column if not exists gap boolean default false;
alter table public.legal_requirements add column if not exists gap_identified boolean default false;
alter table public.legal_requirements add column if not exists responsible_person text;

alter table public.legal_changes add column if not exists changes_identified text;
alter table public.legal_changes add column if not exists action_required text;
alter table public.legal_changes add column if not exists responsible_person text;

alter table public.compliance_assessments add column if not exists assessment_ref text;
alter table public.compliance_assessments add column if not exists total_requirements integer default 0;
alter table public.compliance_assessments add column if not exists overall_score numeric default 0;
alter table public.compliance_assessments add column if not exists compliance_score numeric default 0;

alter table public.compliance_gaps add column if not exists gap_ref text;
alter table public.compliance_gaps add column if not exists action_ref text;

alter table public.compliance_calendar add column if not exists linked_action_ref text;

create index if not exists idx_legal_requirements_company on public.legal_requirements(company_id);
create index if not exists idx_legal_requirements_status on public.legal_requirements(company_id, status);
create index if not exists idx_legal_changes_company on public.legal_changes(company_id);
create index if not exists idx_compliance_assessments_company on public.compliance_assessments(company_id);
create index if not exists idx_compliance_gaps_company_status on public.compliance_gaps(company_id, status);
create index if not exists idx_compliance_calendar_company_due on public.compliance_calendar(company_id, due_date);

-- Optional starter legal register for Mauritius HSE. Change the company_id before running
-- if you want to seed a specific client with a small initial baseline.
--
-- insert into public.legal_requirements
--   (company_id, req_ref, legislation, title, section, requirement, category, obligation_type, frequency, status, compliance_score)
-- values
--   ('00000000-0000-0000-0000-000000000000', 'OSH-001', 'Occupational Safety and Health Act 2005', 'General duties of employer', '5', 'Employer must ensure, so far as reasonably practicable, the safety, health and welfare at work of employees.', 'health_safety', 'mandatory', 'ongoing', 'partial', 50),
--   ('00000000-0000-0000-0000-000000000000', 'OSH-002', 'Occupational Safety and Health Act 2005', 'Risk assessment', '10', 'Employer must identify hazards, assess risks and implement suitable controls.', 'health_safety', 'mandatory', 'annual', 'partial', 50),
--   ('00000000-0000-0000-0000-000000000000', 'FIRE-001', 'Fire Services Act', 'Fire certificate', null, 'Premises requiring a fire certificate must maintain valid certification and comply with conditions.', 'fire', 'mandatory', 'annual', 'non_compliant', 0);
