-- AURIS 360 Legal Compliance governance upgrade
-- Production-safe and rerunnable. Existing legal requirements remain the parent register.
-- No sample legal content, compliance decisions, evidence or permits are inserted.

begin;

create extension if not exists pgcrypto;

create table if not exists public.legal_compliance_records (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  requirement_id text,
  record_type text not null check (record_type in (
    'requirement_profile','obligation','applicability','evidence','permit_licence','workflow_task'
  )),
  reference text,
  title text not null,
  status text not null default 'draft',
  owner_id uuid,
  owner_name text,
  assignee_id uuid,
  assignee_name text,
  due_date date,
  expiry_date date,
  completed_at timestamptz,
  source_module text,
  source_id text,
  payload jsonb not null default '{}'::jsonb,
  version_no integer not null default 1,
  idempotency_key text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists legal_compliance_record_idempotency
  on public.legal_compliance_records(company_id, record_type, idempotency_key)
  where idempotency_key is not null;
create unique index if not exists legal_compliance_one_requirement_profile
  on public.legal_compliance_records(company_id, requirement_id)
  where record_type = 'requirement_profile';
create index if not exists legal_compliance_record_requirement
  on public.legal_compliance_records(company_id, requirement_id, record_type, created_at desc);
create index if not exists legal_compliance_record_queue
  on public.legal_compliance_records(company_id, record_type, status, assignee_id, due_date);
create index if not exists legal_compliance_record_expiry
  on public.legal_compliance_records(company_id, record_type, expiry_date)
  where expiry_date is not null;

create table if not exists public.legal_compliance_relationships (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  requirement_id text,
  record_id text,
  related_module text not null,
  related_record_id text not null,
  relationship_type text not null default 'supports',
  status text not null default 'active',
  scope jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, requirement_id, record_id, related_module, related_record_id, relationship_type)
);

create index if not exists legal_compliance_relationship_requirement
  on public.legal_compliance_relationships(company_id, requirement_id, relationship_type);
create index if not exists legal_compliance_relationship_related
  on public.legal_compliance_relationships(company_id, related_module, related_record_id);

do $$
declare t text;
begin
  foreach t in array array['legal_compliance_records','legal_compliance_relationships'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_tenant_read', t);
    execute format(
      'create policy %I on public.%I for select using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id)))',
      t||'_tenant_read', t, t);
    execute format('drop policy if exists %I on public.%I', t||'_tenant_write', t);
    execute format(
      'create policy %I on public.%I for all using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''compliance_manager'',''legal_reviewer'',''document_controller''))))) with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''compliance_manager'',''legal_reviewer'',''document_controller'')))))',
      t||'_tenant_write', t, t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
