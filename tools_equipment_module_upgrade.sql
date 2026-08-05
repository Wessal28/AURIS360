-- AURIS 360 Tools & Equipment lifecycle upgrade
-- Additive and rerunnable. Existing register, inspection, lifting, vehicle,
-- personal-tool and RCD records are preserved. No equipment is auto-released.
begin;
create extension if not exists pgcrypto;

create table if not exists public.equipment_assurance_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  equipment_id uuid not null references public.tools_register(id) on delete cascade,
  criticality text not null default 'standard' check (criticality in ('standard','elevated','safety_critical','statutory')),
  ownership_type text not null default 'company' check (ownership_type in ('company','contractor','hired','leased')),
  owner_custodian text, intended_use text, permitted_environment text,
  capacity_rating text, configuration text, limitations text,
  assurance_requirements text, acceptance_status text not null default 'pending' check (acceptance_status in ('pending','accepted','conditional','rejected','suspended')),
  acceptance_authority text, acceptance_date date, review_due date,
  critical_block boolean not null default false, block_reason text,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,equipment_id)
);
create index if not exists equipment_assurance_profile_queue on public.equipment_assurance_profiles(company_id,acceptance_status,criticality,review_due);

create table if not exists public.equipment_movements (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  equipment_id uuid not null references public.tools_register(id) on delete restrict,
  movement_type text not null check (movement_type in ('issue','return','reservation','transfer','possession_check')),
  linked_movement_id uuid references public.equipment_movements(id) on delete set null,
  holder_name text, holder_reference text, custody_type text, task_reference text, work_package_reference text,
  site_name text, location_from text, location_to text, issued_at timestamptz, expected_return_at timestamptz, returned_at timestamptz,
  condition_out text, condition_in text, eligibility_verified boolean not null default false,
  eligibility_evidence_reference text, status text not null default 'open' check (status in ('planned','open','returned','cancelled','overdue')),
  defect_noted boolean not null default false, evidence_reference text, notes text,
  created_by uuid, created_at timestamptz not null default now()
);
create index if not exists equipment_movement_queue on public.equipment_movements(company_id,equipment_id,status,expected_return_at);

create table if not exists public.equipment_assurance_records (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  equipment_id uuid not null references public.tools_register(id) on delete cascade,
  record_type text not null check (record_type in ('acceptance','certificate','calibration','periodic_inspection','service','return_to_service','recall_check')),
  reference text not null, provider text, method_standard text, scope_range text, tolerance text,
  result text not null default 'pending' check (result in ('pending','pass','conditional','fail','not_applicable')),
  performed_date date, expiry_date date, next_due_date date, restrictions text,
  as_found text, as_left text, out_of_tolerance boolean not null default false, impact_review text,
  evidence_reference text, validation_status text not null default 'submitted' check (validation_status in ('submitted','review','validated','rejected','superseded')),
  validated_by text, validated_at timestamptz, release_status text not null default 'not_requested' check (release_status in ('not_requested','pending','released','rejected')),
  release_authority text, release_date date, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,equipment_id,record_type,reference)
);
create index if not exists equipment_assurance_record_queue on public.equipment_assurance_records(company_id,record_type,validation_status,next_due_date);

create table if not exists public.equipment_maintenance_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  equipment_id uuid not null references public.tools_register(id) on delete restrict,
  reference text not null, maintenance_type text not null default 'corrective' check (maintenance_type in ('preventive','corrective','breakdown','recall','modification')),
  status text not null default 'requested' check (status in ('requested','planned','in_progress','testing','awaiting_release','completed','cancelled')),
  problem_description text not null, work_performed text, parts_used text, technician text,
  requested_date date not null default current_date, planned_date date, completed_date date,
  post_work_test_reference text, release_required boolean not null default true,
  release_status text not null default 'pending' check (release_status in ('pending','released','rejected','not_required')),
  release_authority text, release_date date, evidence_reference text, cost numeric(14,2), notes text,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,reference)
);
create index if not exists equipment_maintenance_queue on public.equipment_maintenance_events(company_id,status,planned_date,equipment_id);

create table if not exists public.equipment_defects (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  equipment_id uuid not null references public.tools_register(id) on delete restrict,
  reference text not null, source text not null default 'reported', severity text not null default 'major' check (severity in ('minor','major','critical')),
  description text not null, reported_by text, reported_date date not null default current_date,
  status text not null default 'open' check (status in ('open','quarantined','under_repair','awaiting_verification','closed','disposed')),
  quarantine_location text, tag_reference text, disposition text, corrective_action_reference text,
  evidence_reference text, verification_result text, verified_by text, verified_at timestamptz,
  release_required boolean not null default true, release_authority text, release_date date,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,reference)
);
create index if not exists equipment_defect_queue on public.equipment_defects(company_id,status,severity,equipment_id);

do $$ declare t text; begin
  foreach t in array array['equipment_assurance_profiles','equipment_movements','equipment_assurance_records','equipment_maintenance_events','equipment_defects'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_read',t);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id)))',t||'_tenant_read',t,t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_write',t);
    execute format('create policy %I on public.%I for all to authenticated using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''company_admin'',''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor''))))) with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''company_admin'',''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'')))))',t||'_tenant_write',t,t,t);
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
