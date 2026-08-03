-- AURIS 360 Incident Management module upgrade
-- Production-safe and rerunnable. This migration installs no sample records.
begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.events') is not null then
    alter table public.events add column if not exists title text;
    alter table public.events add column if not exists estimated_time boolean not null default false;
    alter table public.events add column if not exists potential_severity text;
    alter table public.events add column if not exists likelihood text;
    alter table public.events add column if not exists confidentiality text not null default 'internal';
    alter table public.events add column if not exists emergency_gate text;
    alter table public.events add column if not exists immediate_danger boolean not null default false;
    alter table public.events add column if not exists reporter_mode text not null default 'named';
    alter table public.events add column if not exists work_activity text;
    alter table public.events add column if not exists regulatory_required text;
    alter table public.events add column if not exists triage_status text;
    alter table public.events add column if not exists investigation_level text;
    alter table public.events add column if not exists target_closure_date date;
    alter table public.events add column if not exists idempotency_key text;
    alter table public.events add column if not exists submitted_at timestamptz;
    alter table public.events add column if not exists lifecycle_version integer not null default 1;
  end if;

  if to_regclass('public.investigations') is not null then
    alter table public.investigations add column if not exists plan_status text not null default 'draft';
    alter table public.investigations add column if not exists plan_version integer not null default 1;
    alter table public.investigations add column if not exists objective text;
    alter table public.investigations add column if not exists scope text;
    alter table public.investigations add column if not exists exclusions text;
    alter table public.investigations add column if not exists reviewer_name text;
    alter table public.investigations add column if not exists confidentiality text not null default 'internal';
    alter table public.investigations add column if not exists completeness_json jsonb not null default '{}'::jsonb;
    alter table public.investigations add column if not exists closure_snapshot jsonb;
  end if;
end $$;

create table if not exists public.incident_mgmt_records (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  incident_id text,
  investigation_id text,
  record_type text not null,
  code text,
  title text not null,
  status text not null default 'draft',
  confidentiality text not null default 'internal',
  owner_id uuid,
  owner_name text,
  due_date date,
  payload jsonb not null default '{}'::jsonb,
  source_links jsonb not null default '[]'::jsonb,
  version_no integer not null default 1,
  parent_id text,
  change_reason text,
  effective_from date,
  effective_to date,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  published_at timestamptz,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.incident_mgmt_config_records (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  workspace text not null,
  code text not null,
  name text not null,
  description text,
  scope_type text not null default 'company',
  scope_id text,
  inherited_from_id text,
  payload jsonb not null default '{}'::jsonb,
  test_cases jsonb not null default '[]'::jsonb,
  impact_snapshot jsonb not null default '{}'::jsonb,
  owner_id uuid,
  owner_name text,
  effective_from date,
  effective_to date,
  status text not null default 'draft',
  version_no integer not null default 1,
  copied_from_id text,
  change_reason text,
  tested_by uuid,
  tested_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  published_by uuid,
  published_at timestamptz,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, workspace, code, version_no)
);

create table if not exists public.incident_mgmt_audit_events (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  before_json jsonb,
  after_json jsonb,
  reason text,
  source text not null default 'web',
  correlation_id text,
  performed_by uuid,
  performed_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists incident_mgmt_records_case on public.incident_mgmt_records(company_id, incident_id, investigation_id, record_type, status);
create index if not exists incident_mgmt_records_due on public.incident_mgmt_records(company_id, record_type, status, due_date);
create index if not exists incident_mgmt_config_workspace on public.incident_mgmt_config_records(company_id, workspace, status, effective_from);
create index if not exists incident_mgmt_audit_entity on public.incident_mgmt_audit_events(company_id, entity_type, entity_id, created_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['incident_mgmt_records','incident_mgmt_config_records'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_tenant_read', table_name);
    execute format(
      'create policy %I on public.%I for select using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id)))',
      table_name || '_tenant_read', table_name, table_name
    );
    execute format('drop policy if exists %I on public.%I', table_name || '_tenant_write', table_name);
    execute format(
      'create policy %I on public.%I for all using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''auditor''))))) with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''auditor'')))))',
      table_name || '_tenant_write', table_name, table_name, table_name
    );
  end loop;
end $$;

alter table public.incident_mgmt_audit_events enable row level security;
drop policy if exists incident_mgmt_audit_read on public.incident_mgmt_audit_events;
create policy incident_mgmt_audit_read on public.incident_mgmt_audit_events for select using (
  exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=incident_mgmt_audit_events.company_id and p.role in ('admin','hse_manager','hse_officer','auditor'))))
);
drop policy if exists incident_mgmt_audit_insert on public.incident_mgmt_audit_events;
create policy incident_mgmt_audit_insert on public.incident_mgmt_audit_events for insert with check (
  exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=incident_mgmt_audit_events.company_id))
);

notify pgrst, 'reload schema';
commit;
