-- AURIS 360 Occupational Noise Management module
-- Production-safe schema only: no fictional readings, people, results, charts or maps.
-- Run once in the Supabase SQL Editor, then refresh the application.

begin;

create table if not exists public.noise_mgmt_sources (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 code text not null, name text not null, source_type text, site text, operating_context text, exposed_population text,
 existing_controls text, owner_id uuid, owner_name text, status text not null default 'draft', version_no int not null default 1,
 effective_from date, effective_to date, archived_at timestamptz, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,code,version_no)
);
create table if not exists public.noise_mgmt_tasks (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 code text not null, name text not null, process_name text, typical_duration_minutes numeric, work_pattern text, operating_conditions text,
 population_scope text, exposure_components jsonb not null default '[]', review_trigger text, owner_id uuid, status text not null default 'draft', version_no int not null default 1,
 created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,code,version_no)
);
create table if not exists public.noise_mgmt_segs (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 code text not null, name text not null, owner_id uuid, owner_name text, inclusion_criteria text not null, membership_rules jsonb not null default '{}',
 work_profile text, sampling_strategy text, effective_from date, effective_to date, next_review_date date, status text not null default 'draft', version_no int not null default 1,
 created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,code,version_no)
);
create table if not exists public.noise_mgmt_programmes (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 code text not null, name text not null, programme_type text not null, purpose text not null, scope text not null, profile_id text, profile_name text,
 coverage_target numeric, owner_id uuid, owner_name text, start_date date, end_date date, next_due_date date, recurrence jsonb not null default '{}',
 strategy text, resources jsonb not null default '{}', workflow jsonb not null default '{}', status text not null default 'draft', version_no int not null default 1,
 change_reason text, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,code,version_no)
);
create table if not exists public.noise_mgmt_measurement_plans (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 code text not null, programme_id text, purpose text not null, scope text not null, profile_id text, profile_name text, strategy text,
 sample_count int, sample_plan jsonb not null default '[]', instrument_requirements text, assignee_id uuid, assignee_name text, planned_date date,
 quality_controls text, issued_at timestamptz, status text not null default 'draft', version_no int not null default 1, previous_version_id text,
 change_reason text, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,code,version_no)
);
create table if not exists public.noise_mgmt_instruments (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 asset_code text not null, equipment_type text not null, manufacturer text, model text, serial_number text not null, capabilities text,
 components jsonb not null default '[]', custodian_id uuid, custodian_name text, calibration_certificate text, calibration_date date, calibration_due_date date,
 service_history jsonb not null default '[]', availability text, last_field_check_status text, status text not null default 'available', version_no int not null default 1,
 created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,asset_code), unique(company_id,serial_number)
);
create table if not exists public.noise_mgmt_field_surveys (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 code text not null, survey_type text not null, site text, scope text, survey_date date, plan_id text, plan_code text, plan_version int,
 assessor_id uuid, assessor_name text, instrument_codes text, operating_conditions text, pre_check_status text, post_check_status text,
 planned_samples int, completed_samples int, quality_flags jsonb not null default '[]', sync_status text default 'online', status text not null default 'draft', version_no int not null default 1,
 created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,code,version_no)
);
create table if not exists public.noise_mgmt_measurements (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 code text not null, survey_id text, measurement_type text not null, subject_type text, subject_id text, subject_name text, location text,
 measurement_date timestamptz not null, descriptor text not null, raw_value numeric, unit text, valid_duration_minutes numeric,
 instrument_id text, instrument_code text, weighting_response text, operating_context text, source_reference text, raw_file_ref text, raw_file_checksum text,
 raw_payload jsonb not null default '{}', excluded_intervals jsonb not null default '[]', field_check_refs jsonb not null default '[]', data_quality_status text default 'not_assessed',
 limitations text, status text not null default 'draft', version_no int not null default 1, supersedes_id text, exclusion_reason text,
 accepted_by uuid, accepted_at timestamptz, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,code,version_no), unique(company_id,raw_file_checksum)
);
create table if not exists public.noise_mgmt_assessment_profiles (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 code text not null, name text not null, jurisdiction text, scope text not null, effective_from date not null, effective_to date,
 reference_duration_hours numeric not null default 8, parameters_json jsonb not null default '{}', bands_json jsonb not null default '[]',
 field_check_tolerance numeric, uncertainty_rule text, test_cases_json jsonb not null default '[]', owner_id uuid, version_no int not null default 1,
 status text not null default 'draft', change_reason text, published_by uuid, published_at timestamptz, created_by uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,code,version_no)
);
create table if not exists public.noise_mgmt_exposure_assessments (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 code text not null, subject_type text not null, subject_id text, subject_name text not null, assessment_date date, assessment_period text,
 profile_id text, profile_name text not null, source_measurement_versions jsonb not null default '[]', source_level numeric, duration_hours numeric,
 result_value numeric, result_unit text, calculation_method text, calculation_snapshot jsonb not null default '{}', classification text,
 data_quality_status text, uncertainty jsonb not null default '{}', limitations text, response_status text, assessor_id uuid, reviewer_id uuid,
 status text not null default 'draft', version_no int not null default 1, supersedes_id text, approved_at timestamptz, created_by uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,code,version_no)
);
create table if not exists public.noise_mgmt_maps (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 code text not null, name text not null, site text, area text, survey_id text, survey_code text, descriptor text, point_count int,
 base_plan_ref text, point_layer jsonb not null default '[]', zone_layer jsonb not null default '[]', interpolation_method text default 'point_only',
 operating_condition text, limitations text, status text not null default 'draft', version_no int not null default 1, supersedes_id text,
 published_by uuid, published_at timestamptz, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,code,version_no)
);
alter table public.noise_mgmt_maps
 add column if not exists map_type text default 'point_only',
 add column if not exists owner_name text,
 add column if not exists reviewer_name text,
 add column if not exists data_period text,
 add column if not exists profile_name text,
 add column if not exists confidentiality text default 'internal',
 add column if not exists plan_filename text,
 add column if not exists plan_checksum text,
 add column if not exists scale_distance numeric,
 add column if not exists scale_unit text default 'm',
 add column if not exists orientation_degrees numeric default 0,
 add column if not exists coordinate_mode text default 'plan_xy',
 add column if not exists quality_status text default 'not_validated',
 add column if not exists review_due_date date,
 add column if not exists current_version_id text;
create table if not exists public.noise_mgmt_map_versions (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 map_id text not null, version_no int not null, plan_snapshot jsonb not null default '{}', profile_snapshot jsonb not null default '{}',
 source_snapshot jsonb not null default '[]', settings_snapshot jsonb not null default '{}', limitation_statement text,
 quality_result jsonb not null default '{}', change_reason text, checksum text, status text not null default 'draft',
 reviewer_id uuid, reviewer_name text, reviewed_at timestamptz, published_by uuid, published_at timestamptz,
 created_by uuid, created_at timestamptz not null default now(), unique(company_id,map_id,version_no)
);
create table if not exists public.noise_mgmt_map_points (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 map_id text not null, map_version_id text, measurement_id text not null, measurement_version int, plan_x numeric, plan_y numeric,
 coordinate_x numeric, coordinate_y numeric, coordinate_mode text default 'plan_xy', placement_status text default 'unplaced',
 label text, symbol text, display_note text, exclusion_reason text, status text not null default 'included',
 created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,map_version_id,measurement_id)
);
create table if not exists public.noise_mgmt_map_layers (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 map_id text not null, map_version_id text, layer_type text not null, name text not null, geometry_json jsonb not null default '{}',
 style_json jsonb not null default '{}', source_entity_type text, source_entity_id text, source_version text, effective_from date,
 effective_to date, display_order int default 0, visible boolean not null default true, status text not null default 'draft',
 created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.noise_mgmt_map_surfaces (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 map_id text not null, map_version_id text, method_code text not null, method_version text not null, parameters_json jsonb not null default '{}',
 boundary_json jsonb not null default '{}', grid_resolution numeric, eligible_measurements jsonb not null default '[]',
 quality_result jsonb not null default '{}', surface_ref text, checksum text, status text not null default 'draft',
 generated_by uuid, generated_at timestamptz not null default now()
);
create table if not exists public.noise_mgmt_map_reviews (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 map_id text not null, map_version_id text, reviewer_id uuid, reviewer_name text, checklist_json jsonb not null default '{}',
 comments text, decision text not null, returned_cycle int not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.noise_mgmt_control_plans (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 code text not null, source_ref text not null, baseline_result text not null, hierarchy text not null, options_json jsonb not null default '[]', selected_control text not null,
 owner_id uuid, owner_name text, accountable_manager text, due_date date, expected_reduction numeric, verification_criteria text not null,
 verification_measurement_ids jsonb not null default '[]', effectiveness_status text default 'not_verified', interim_controls text, status text not null default 'draft',
 version_no int not null default 1, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,code,version_no)
);
create table if not exists public.noise_mgmt_hearing_protectors (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 code text not null, name text not null, manufacturer text, model text, protector_type text, certification_reference text,
 snr numeric, hml_values text, octave_attenuation jsonb not null default '{}', derating_percent numeric, fit_test_method text,
 compatibility_notes text, stock_data jsonb not null default '{}', status text not null default 'draft', version_no int not null default 1,
 created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,code,version_no)
);
create table if not exists public.noise_mgmt_health_statuses (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 subject_code text, subject_id uuid, seg_id text, seg_name text, eligibility_status text, referral_status text, last_surveillance_date date,
 next_surveillance_date date, integration_status text, source_reference text, restriction_flag boolean not null default false,
 status text not null default 'active', version_no int not null default 1, updated_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.noise_mgmt_reports (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 code text not null, name text not null, report_type text not null, scope text, data_as_of date, source_versions jsonb not null default '[]',
 owner_id uuid, owner_name text, approver_id uuid, approver_name text, distribution_rules text, rendered_file_ref text,
 status text not null default 'draft', version_no int not null default 1, supersedes_id text, issued_at timestamptz, created_by uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,code,version_no)
);
create table if not exists public.noise_mgmt_audit_events (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 entity_type text not null, entity_id text not null, action text not null, before_json jsonb, after_json jsonb, reason text,
 performed_by uuid, performed_by_name text, created_at timestamptz not null default now()
);
create table if not exists public.noise_mgmt_config_records (
 id text primary key default gen_random_uuid()::text, company_id uuid not null references public.companies(id) on delete cascade,
 workspace text not null, code text not null, name text not null, description text, scope_type text not null default 'company', scope_id text,
 inherited_from_id text, override_fields jsonb not null default '[]', payload jsonb not null default '{}', test_cases jsonb not null default '[]',
 dependency_snapshot jsonb not null default '{}', owner_id uuid, owner_name text, effective_from date, effective_to date,
 status text not null default 'draft', version_no int not null default 1, copied_from_id text, change_reason text,
 tested_by uuid, tested_at timestamptz, published_by uuid, published_at timestamptz, archived_at timestamptz,
 created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,workspace,code,version_no)
);

create index if not exists noise_mgmt_measurements_company_status on public.noise_mgmt_measurements(company_id,status,measurement_date desc);
create index if not exists noise_mgmt_assessments_company_status on public.noise_mgmt_exposure_assessments(company_id,status,assessment_date desc);
create index if not exists noise_mgmt_controls_company_due on public.noise_mgmt_control_plans(company_id,status,due_date);
create index if not exists noise_mgmt_instruments_company_due on public.noise_mgmt_instruments(company_id,status,calibration_due_date);
create index if not exists noise_mgmt_audit_entity on public.noise_mgmt_audit_events(company_id,entity_type,entity_id,created_at desc);
create index if not exists noise_mgmt_map_points_source on public.noise_mgmt_map_points(company_id,map_id,measurement_id);
create index if not exists noise_mgmt_map_versions_status on public.noise_mgmt_map_versions(company_id,map_id,status,version_no desc);
create index if not exists noise_mgmt_config_workspace on public.noise_mgmt_config_records(company_id,workspace,status,effective_from);

do $$
declare t text;
begin
 foreach t in array array['noise_mgmt_sources','noise_mgmt_tasks','noise_mgmt_segs','noise_mgmt_programmes','noise_mgmt_measurement_plans','noise_mgmt_instruments','noise_mgmt_field_surveys','noise_mgmt_measurements','noise_mgmt_assessment_profiles','noise_mgmt_exposure_assessments','noise_mgmt_maps','noise_mgmt_map_versions','noise_mgmt_map_points','noise_mgmt_map_layers','noise_mgmt_map_surfaces','noise_mgmt_map_reviews','noise_mgmt_control_plans','noise_mgmt_hearing_protectors','noise_mgmt_reports','noise_mgmt_config_records'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('drop policy if exists %I on public.%I',t||'_tenant_read',t);
  execute format('create policy %I on public.%I for select using (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id)))',t||'_tenant_read',t,t);
  execute format('drop policy if exists %I on public.%I',t||'_tenant_write',t);
  execute format('create policy %I on public.%I for all using (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''auditor''))))) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''auditor'')))))',t||'_tenant_write',t,t,t);
 end loop;
end $$;

alter table public.noise_mgmt_health_statuses enable row level security;
drop policy if exists noise_health_restricted_read on public.noise_mgmt_health_statuses;
create policy noise_health_restricted_read on public.noise_mgmt_health_statuses for select using (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=noise_mgmt_health_statuses.company_id and p.role in ('admin','hse_manager','hse_officer','occupational_health','auditor')))));
drop policy if exists noise_health_restricted_write on public.noise_mgmt_health_statuses;
create policy noise_health_restricted_write on public.noise_mgmt_health_statuses for all using (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=noise_mgmt_health_statuses.company_id and p.role in ('admin','hse_manager','occupational_health'))))) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=noise_mgmt_health_statuses.company_id and p.role in ('admin','hse_manager','occupational_health')))));

alter table public.noise_mgmt_audit_events enable row level security;
drop policy if exists noise_audit_read on public.noise_mgmt_audit_events;
create policy noise_audit_read on public.noise_mgmt_audit_events for select using (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=noise_mgmt_audit_events.company_id and p.role in ('admin','hse_manager','hse_officer','auditor')))));
drop policy if exists noise_audit_insert on public.noise_mgmt_audit_events;
create policy noise_audit_insert on public.noise_mgmt_audit_events for insert with check (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=noise_mgmt_audit_events.company_id)));

notify pgrst, 'reload schema';
commit;
