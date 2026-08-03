-- AURIS 360 Document Control module upgrade
-- Production-safe, rerunnable and intentionally free of fictional/sample records.
-- Existing public.documents, public.doc_revisions, public.doc_controlled_copies
-- and public.doc_acknowledgements remain in place and are read by the upgraded UI.
begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.documents') is not null then
    alter table public.documents add column if not exists lifecycle_state text;
    alter table public.documents add column if not exists confidentiality text not null default 'internal';
    alter table public.documents add column if not exists current_revision_id text;
    alter table public.documents add column if not exists language_code text not null default 'en';
    alter table public.documents add column if not exists scope_type text not null default 'company';
    alter table public.documents add column if not exists scope_id text;
    alter table public.documents add column if not exists retention_class text;
    alter table public.documents add column if not exists archived_at timestamptz;
    alter table public.documents add column if not exists idempotency_key text;
  end if;
end $$;

create table if not exists public.document_control_revisions (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id text not null,
  revision_code text not null,
  status text not null default 'draft',
  language_code text not null default 'en',
  scope_type text not null default 'company',
  scope_id text,
  title text,
  change_summary text,
  content_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  content_hash text,
  source_revision_id text,
  effective_from timestamptz,
  effective_to timestamptz,
  approved_at timestamptz,
  superseded_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, document_id, revision_code, language_code, scope_type, scope_id)
);

create unique index if not exists document_control_one_effective_revision
  on public.document_control_revisions(company_id, document_id, language_code, scope_type, coalesce(scope_id,''))
  where status = 'effective' and effective_to is null;

create table if not exists public.document_control_records (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id text,
  revision_id text,
  record_type text not null,
  code text,
  title text not null,
  status text not null default 'draft',
  owner_id uuid,
  owner_name text,
  assignee_id uuid,
  assignee_name text,
  due_date date,
  completed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  version_no integer not null default 1,
  parent_id text,
  idempotency_key text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists document_control_record_idempotency
  on public.document_control_records(company_id, record_type, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.document_control_files (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id text not null,
  revision_id text,
  file_role text not null default 'source',
  language_code text not null default 'en',
  file_name text not null,
  file_url text,
  storage_path text,
  mime_type text,
  file_size bigint,
  content_hash text,
  control_marking text,
  status text not null default 'draft',
  verified_by uuid,
  verified_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.document_control_config (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  workspace text not null,
  code text not null,
  name text not null,
  description text,
  scope_type text not null default 'company',
  scope_id text,
  payload jsonb not null default '{}'::jsonb,
  test_cases jsonb not null default '[]'::jsonb,
  test_result jsonb not null default '{}'::jsonb,
  impact_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  version_no integer not null default 1,
  copied_from_id text,
  change_reason text,
  effective_from date,
  effective_to date,
  owner_id uuid,
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

create table if not exists public.document_control_audit_events (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id text,
  revision_id text,
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

create index if not exists document_control_revision_lookup on public.document_control_revisions(company_id, document_id, created_at desc);
create index if not exists document_control_record_queue on public.document_control_records(company_id, record_type, status, due_date);
create index if not exists document_control_record_document on public.document_control_records(company_id, document_id, revision_id, record_type);
create index if not exists document_control_file_revision on public.document_control_files(company_id, document_id, revision_id, file_role);
create index if not exists document_control_config_workspace on public.document_control_config(company_id, workspace, status, effective_from);
create index if not exists document_control_audit_entity on public.document_control_audit_events(company_id, entity_type, entity_id, created_at desc);

-- Backfill a governed revision child for every legacy document. The stable
-- document row is preserved; this statement is idempotent.
do $$
begin
  if to_regclass('public.documents') is not null then
    insert into public.document_control_revisions (
      company_id, document_id, revision_code, status, language_code, scope_type,
      title, change_summary, metadata_json, effective_from, created_by, created_at, updated_at
    )
    select d.company_id, d.id::text,
      coalesce(nullif(to_jsonb(d)->>'version',''), nullif(to_jsonb(d)->>'doc_version',''), '1.0'),
      case coalesce(to_jsonb(d)->>'approval_status',to_jsonb(d)->>'status','draft')
        when 'approved' then 'effective' when 'active' then 'effective'
        when 'current' then 'effective' when 'published' then 'effective'
        when 'superseded' then 'superseded' when 'archived' then 'archived'
        else 'draft' end,
      coalesce(nullif(to_jsonb(d)->>'language_code',''),'en'),
      coalesce(nullif(to_jsonb(d)->>'scope_type',''),'company'),
      to_jsonb(d)->>'title',
      coalesce(to_jsonb(d)->>'revision_summary','Imported from the existing Document Control register'),
      jsonb_strip_nulls(jsonb_build_object(
        'document_type',coalesce(to_jsonb(d)->>'document_type',to_jsonb(d)->>'doc_type'),
        'department',coalesce(to_jsonb(d)->>'department',to_jsonb(d)->>'dept'),
        'owner',coalesce(to_jsonb(d)->>'owner',to_jsonb(d)->>'doc_owner'),
        'file_url',to_jsonb(d)->>'file_url',
        'file_name',to_jsonb(d)->>'file_name',
        'legacy_import',true
      )),
      nullif(to_jsonb(d)->>'effective_date','')::timestamptz,
      nullif(to_jsonb(d)->>'created_by','')::uuid,
      coalesce(nullif(to_jsonb(d)->>'created_at','')::timestamptz,now()),
      coalesce(nullif(to_jsonb(d)->>'updated_at','')::timestamptz,now())
    from public.documents d
    where d.company_id is not null
      and not exists (
        select 1 from public.document_control_revisions r
        where r.company_id=d.company_id and r.document_id=d.id::text
      );

    update public.documents d
       set current_revision_id=r.id,
           lifecycle_state=coalesce(d.lifecycle_state,r.status)
      from public.document_control_revisions r
     where r.company_id=d.company_id and r.document_id=d.id::text
       and d.current_revision_id is null
       and r.created_at=(select max(r2.created_at) from public.document_control_revisions r2 where r2.company_id=r.company_id and r2.document_id=r.document_id);
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['document_control_revisions','document_control_records','document_control_files','document_control_config'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_read',t);
    execute format(
      'create policy %I on public.%I for select using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id)))',
      t||'_tenant_read',t,t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_write',t);
    execute format(
      'create policy %I on public.%I for all using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''document_controller'',''records_manager''))))) with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''document_controller'',''records_manager'')))))',
      t||'_tenant_write',t,t,t);
  end loop;
end $$;

alter table public.document_control_audit_events enable row level security;
drop policy if exists document_control_audit_read on public.document_control_audit_events;
create policy document_control_audit_read on public.document_control_audit_events for select using (
  exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=document_control_audit_events.company_id and p.role in ('admin','hse_manager','hse_officer','auditor','document_controller','records_manager'))))
);
drop policy if exists document_control_audit_insert on public.document_control_audit_events;
create policy document_control_audit_insert on public.document_control_audit_events for insert with check (
  exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=document_control_audit_events.company_id))
);

notify pgrst, 'reload schema';
commit;
