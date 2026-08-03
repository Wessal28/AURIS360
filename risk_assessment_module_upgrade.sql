-- AURIS 360 Risk Assessment operational assurance upgrade
-- Production-safe and rerunnable. Existing risk_assessments remain the master records.
-- No sample assessments, risk decisions, verifications or relationships are inserted.

begin;

create extension if not exists pgcrypto;

create table if not exists public.risk_assessment_operational_records (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  risk_assessment_id text not null,
  record_type text not null check (record_type in (
    'assessment_profile','control_verification','acknowledgement','review_event','communication'
  )),
  reference text,
  title text not null,
  status text not null default 'draft',
  owner_id uuid,
  owner_name text,
  assignee_id uuid,
  assignee_name text,
  due_at timestamptz,
  performed_at timestamptz,
  completed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  version_no integer not null default 1,
  idempotency_key text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists risk_assessment_record_idempotency
  on public.risk_assessment_operational_records(company_id, record_type, idempotency_key)
  where idempotency_key is not null;
create unique index if not exists risk_assessment_one_profile
  on public.risk_assessment_operational_records(company_id, risk_assessment_id)
  where record_type = 'assessment_profile';
create index if not exists risk_assessment_record_parent
  on public.risk_assessment_operational_records(company_id, risk_assessment_id, record_type, created_at desc);
create index if not exists risk_assessment_record_queue
  on public.risk_assessment_operational_records(company_id, record_type, status, assignee_id, due_at);

create table if not exists public.risk_assessment_relationships (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  risk_assessment_id text not null,
  related_module text not null,
  related_record_id text not null,
  relationship_type text not null default 'supports',
  status text not null default 'active',
  scope jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, risk_assessment_id, related_module, related_record_id, relationship_type)
);

create index if not exists risk_assessment_relationship_parent
  on public.risk_assessment_relationships(company_id, risk_assessment_id, related_module);
create index if not exists risk_assessment_relationship_source
  on public.risk_assessment_relationships(company_id, related_module, related_record_id);

do $$
declare t text;
begin
  foreach t in array array['risk_assessment_operational_records','risk_assessment_relationships'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_tenant_read', t);
    execute format(
      'create policy %I on public.%I for select using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id)))',
      t||'_tenant_read', t, t);
    execute format('drop policy if exists %I on public.%I', t||'_tenant_write', t);
    execute format(
      'create policy %I on public.%I for all using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''risk_assessor'',''risk_reviewer''))))) with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''risk_assessor'',''risk_reviewer'')))))',
      t||'_tenant_write', t, t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
