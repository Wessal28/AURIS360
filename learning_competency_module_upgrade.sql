-- AURIS 360 E-Learning and Competency assurance upgrade
-- Additive and rerunnable. Existing training, e-learning, certificate and competency data is preserved.
-- No fictional courses, assessments, results or competence decisions are inserted.

begin;
create extension if not exists pgcrypto;

create table if not exists public.learning_course_governance (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  course_id text not null,
  version_no integer not null default 1,
  lifecycle_status text not null default 'draft' check (lifecycle_status in ('draft','sme_review','hse_accessibility_review','awaiting_approval','published','under_revision','archived')),
  owner_name text,
  risk_class text not null default 'standard' check (risk_class in ('standard','elevated','safety_critical')),
  audience_summary text,
  language_codes text[] not null default array['en']::text[],
  source_module text,
  source_record_id text,
  source_reference text,
  source_revision text,
  source_status text,
  learning_objectives text,
  accessibility_metadata jsonb not null default '{}'::jsonb,
  sme_review_status text not null default 'pending' check (sme_review_status in ('pending','approved','changes_requested','not_required')),
  hse_review_status text not null default 'pending' check (hse_review_status in ('pending','approved','changes_requested','not_required')),
  accessibility_review_status text not null default 'pending' check (accessibility_review_status in ('pending','approved','changes_requested')),
  material_change_class text check (material_change_class is null or material_change_class in ('editorial','acknowledgement','microlearning','full_reassessment','practical_reassessment','immediate_suspension')),
  effective_date date,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,course_id,version_no)
);
create index if not exists learning_course_governance_queue on public.learning_course_governance(company_id,lifecycle_status,risk_class,updated_at desc);

create table if not exists public.learning_practical_assessments (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  reference text not null,
  candidate_id uuid,
  candidate_name text not null,
  course_id text,
  course_title text,
  competency_id text,
  competency_name text not null,
  scope_text text,
  assessor_id uuid,
  assessor_name text not null,
  assessor_scope_confirmed boolean not null default false,
  scheduled_at timestamptz,
  assessed_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled','in_progress','submitted','awaiting_verification','final','cancelled')),
  result text not null default 'pending' check (result in ('pending','competent','not_yet_competent','stopped_critical_fail')),
  criteria jsonb not null default '[]'::jsonb,
  critical_failure boolean not null default false,
  evidence_reference text,
  assessor_comments text,
  candidate_acknowledged boolean not null default false,
  verifier_id uuid,
  verifier_name text,
  verification_status text not null default 'not_required' check (verification_status in ('not_required','pending','confirmed','returned')),
  verified_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists learning_practical_reference on public.learning_practical_assessments(company_id,reference);
create index if not exists learning_practical_queue on public.learning_practical_assessments(company_id,status,result,scheduled_at);

create table if not exists public.learning_source_relationships (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  course_id text not null,
  course_version integer not null default 1,
  related_module text not null,
  related_record_id text not null,
  related_revision text,
  relationship_type text not null default 'learning_source',
  impact_status text not null default 'current' check (impact_status in ('current','review_required','affected','superseded')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,course_id,course_version,related_module,related_record_id,relationship_type)
);
create index if not exists learning_source_reverse on public.learning_source_relationships(company_id,related_module,related_record_id,impact_status);

do $$
declare t text;
begin
  foreach t in array array['learning_course_governance','learning_practical_assessments','learning_source_relationships'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_read',t);
    execute format('create policy %I on public.%I for select using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id)))',t||'_tenant_read',t,t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_write',t);
    execute format('create policy %I on public.%I for all using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''training_admin'',''hr_manager''))))) with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''training_admin'',''hr_manager'')))))',t||'_tenant_write',t,t,t);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
