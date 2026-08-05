-- AURIS 360 Contractor Management lifecycle upgrade
-- Additive and rerunnable. Existing contractor, pre-assessment, evaluation,
-- authorisation-to-work and incident records are preserved.
-- No contractor approval, document acceptance or mobilisation pass is seeded.

begin;
create extension if not exists pgcrypto;

create table if not exists public.contractor_assurance_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contractor_id uuid not null references public.contractors(id) on delete cascade,
  risk_tier text not null default 'tier_2' check (risk_tier in ('tier_1','tier_2','tier_3','restricted')),
  approved_scope text,
  permitted_sites text,
  approval_conditions text,
  scope_exclusions text,
  decision_status text not null default 'pending' check (decision_status in ('pending','review','approved','conditional','restricted','rejected','suspended','expired','archived')),
  decision_authority text,
  decision_date date,
  valid_until date,
  next_review_date date,
  critical_block boolean not null default false,
  block_reason text,
  change_notification_required boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,contractor_id)
);
create index if not exists contractor_assurance_queue on public.contractor_assurance_profiles(company_id,decision_status,risk_tier,valid_until);

create table if not exists public.contractor_work_packages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  reference text not null,
  contractor_id uuid not null references public.contractors(id) on delete restrict,
  title text not null,
  scope_description text not null,
  scope_exclusions text,
  site_name text not null,
  work_location text,
  planned_start date not null,
  planned_end date not null,
  contract_owner text not null,
  contractor_manager text,
  hse_lead text,
  risk_tier text not null default 'tier_2' check (risk_tier in ('tier_1','tier_2','tier_3','restricted')),
  status text not null default 'draft' check (status in ('draft','planning','mobilisation','ready','blocked','active','suspended','close_out','closed','cancelled')),
  interface_summary text,
  hse_plan_reference text,
  risk_assessment_reference text,
  rams_reference text,
  permit_reference text,
  emergency_arrangements text,
  workforce_summary text,
  plant_material_summary text,
  subcontracting_declared boolean not null default false,
  change_summary text,
  closeout_summary text,
  evaluation_reference text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,reference),
  check (planned_end >= planned_start)
);
create index if not exists contractor_package_queue on public.contractor_work_packages(company_id,status,planned_start,contractor_id);

create table if not exists public.contractor_mobilisation_gates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  work_package_id uuid not null references public.contractor_work_packages(id) on delete cascade,
  gate_code text not null,
  category text not null check (category in ('company','package','people','plant','emergency','site_interface')),
  requirement text not null,
  critical boolean not null default true,
  status text not null default 'pending' check (status in ('pending','passed','failed','waived','not_applicable')),
  evidence_reference text,
  verified_by text,
  verified_at timestamptz,
  comments text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,work_package_id,gate_code)
);
create index if not exists contractor_mobilisation_queue on public.contractor_mobilisation_gates(company_id,work_package_id,status,critical);

create table if not exists public.contractor_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contractor_id uuid not null references public.contractors(id) on delete cascade,
  work_package_id uuid references public.contractor_work_packages(id) on delete cascade,
  document_type text not null,
  scope_type text not null default 'company' check (scope_type in ('company','package','worker','plant')),
  file_reference text not null,
  version_no integer not null default 1 check (version_no > 0),
  issuer text,
  issue_date date,
  expiry_date date,
  review_status text not null default 'submitted' check (review_status in ('submitted','review','accepted','rejected','superseded','expired')),
  reviewer_name text,
  reviewed_at timestamptz,
  review_comment text,
  critical_for_work boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,contractor_id,scope_type,file_reference,version_no)
);
create index if not exists contractor_document_queue on public.contractor_documents(company_id,review_status,expiry_date,contractor_id);

do $$
declare t text;
begin
  foreach t in array array['contractor_assurance_profiles','contractor_work_packages','contractor_mobilisation_gates','contractor_documents'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_read',t);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id)))',t||'_tenant_read',t,t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_write',t);
    execute format('create policy %I on public.%I for all to authenticated using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''company_admin'',''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor''))))) with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''company_admin'',''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'')))))',t||'_tenant_write',t,t,t);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
