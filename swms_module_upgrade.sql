-- AURIS 360 Safe Work Method Statement module upgrade
-- Production-safe and rerunnable. No fictional SWMS, tasks or field records are inserted.
-- Existing SWMS documents remain in public.documents and continue to be the parent records.

begin;

create extension if not exists pgcrypto;

create table if not exists public.swms_operational_records (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  swms_document_id text not null,
  revision_code text,
  record_type text not null check (record_type in ('briefing','verification','change_request','work_pack','review_task','approval_task')),
  reference text,
  title text not null,
  status text not null default 'draft',
  work_decision text,
  owner_id uuid,
  owner_name text,
  assignee_id uuid,
  assignee_name text,
  due_at timestamptz,
  performed_at timestamptz,
  completed_at timestamptz,
  source_module text,
  source_id text,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists swms_operational_idempotency
  on public.swms_operational_records(company_id, record_type, idempotency_key)
  where idempotency_key is not null;
create index if not exists swms_operational_document
  on public.swms_operational_records(company_id, swms_document_id, revision_code, record_type, created_at desc);
create index if not exists swms_operational_queue
  on public.swms_operational_records(company_id, record_type, status, due_at);

create table if not exists public.swms_relationships (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  swms_document_id text not null,
  revision_code text,
  related_module text not null,
  related_record_id text not null,
  relationship_type text not null default 'related_to',
  status text not null default 'active',
  applicability jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, swms_document_id, revision_code, related_module, related_record_id, relationship_type)
);

create index if not exists swms_relationship_document
  on public.swms_relationships(company_id, swms_document_id, revision_code, related_module);
create index if not exists swms_relationship_source
  on public.swms_relationships(company_id, related_module, related_record_id);

create table if not exists public.swms_configuration_versions (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  workspace text not null,
  version_no integer not null default 1,
  status text not null default 'draft' check (status in ('draft','validated','tested','impact_reviewed','approved','published','superseded','inactive','archived')),
  settings jsonb not null default '{}'::jsonb,
  test_result jsonb not null default '{}'::jsonb,
  impact_summary jsonb not null default '{}'::jsonb,
  reason text,
  effective_from date,
  effective_to date,
  approved_by uuid,
  approved_at timestamptz,
  published_by uuid,
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, workspace, version_no)
);

create unique index if not exists swms_one_published_workspace
  on public.swms_configuration_versions(company_id, workspace)
  where status='published' and effective_to is null;

do $$
declare t text;
begin
  foreach t in array array['swms_operational_records','swms_relationships','swms_configuration_versions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_read',t);
    execute format(
      'create policy %I on public.%I for select using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id)))',
      t||'_tenant_read',t,t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_write',t);
    execute format(
      'create policy %I on public.%I for all using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''document_controller''))))) with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''document_controller'')))))',
      t||'_tenant_write',t,t,t);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
