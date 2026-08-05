-- AURIS 360 Chemical Control lifecycle upgrade
-- Additive and rerunnable. The existing chemical_register and SDS extraction workflow are preserved.
-- This script does not insert fictional SDS validation, approvals, stock movements or compatibility decisions.

begin;
create extension if not exists pgcrypto;

create table if not exists public.chemical_sds_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  chemical_id uuid not null references public.chemical_register(id) on delete cascade,
  file_name text not null,
  revision_date date,
  source_reference text,
  language_code text,
  jurisdiction text,
  extraction_status text not null default 'extracted' check (extraction_status in ('uploaded','extracted','extraction_failed','manual_entry')),
  validation_status text not null default 'pending' check (validation_status in ('pending','validated','current','superseded','invalid')),
  reviewer_id uuid,
  reviewer_name text,
  validated_at timestamptz,
  material_change boolean not null default false,
  impact_summary text,
  superseded_by uuid references public.chemical_sds_versions(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,chemical_id,file_name,revision_date)
);
create index if not exists chemical_sds_review_queue on public.chemical_sds_versions(company_id,validation_status,revision_date desc);

create table if not exists public.chemical_use_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  reference text not null,
  chemical_id uuid not null references public.chemical_register(id) on delete cascade,
  task_name text not null,
  site_name text,
  location_name text not null,
  method_description text,
  maximum_quantity numeric,
  quantity_unit text,
  frequency text,
  duration text,
  persons_exposed integer not null default 0,
  abnormal_conditions text,
  substitution_considered boolean not null default false,
  substitution_outcome text,
  controls_required text not null,
  emergency_arrangements text,
  waste_arrangements text,
  conditions text,
  owner_name text,
  reviewer_name text,
  status text not null default 'proposed' check (status in ('proposed','assessed','approved','conditional','returned','rejected','suspended','withdrawn','prohibited','closed')),
  approval_date date,
  review_date date,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,reference)
);
create index if not exists chemical_use_scope_queue on public.chemical_use_approvals(company_id,status,review_date,chemical_id);

create table if not exists public.chemical_inventory_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  reference text not null,
  chemical_id uuid not null references public.chemical_register(id) on delete cascade,
  event_type text not null check (event_type in ('receipt','transfer','issue','return','count','quarantine','release','disposal')),
  event_date date not null default current_date,
  quantity numeric not null check (quantity >= 0),
  unit text not null,
  from_location text,
  to_location text,
  batch_number text,
  container_reference text,
  expiry_date date,
  condition_status text not null default 'acceptable' check (condition_status in ('acceptable','damaged','leaking','expired','unlabelled','quarantined','disposed')),
  evidence_reference text,
  notes text,
  recorded_by uuid,
  created_at timestamptz not null default now(),
  unique(company_id,reference)
);
create index if not exists chemical_inventory_trace on public.chemical_inventory_events(company_id,chemical_id,event_date desc,event_type);

do $$
declare t text;
begin
  foreach t in array array['chemical_sds_versions','chemical_use_approvals','chemical_inventory_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_read',t);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id)))',t||'_tenant_read',t,t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_write',t);
    execute format('create policy %I on public.%I for all to authenticated using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''company_admin'',''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor''))))) with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''company_admin'',''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'')))))',t||'_tenant_write',t,t,t);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
