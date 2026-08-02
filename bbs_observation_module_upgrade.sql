-- AURIS 360 Behaviour-Based Safety Observation Module
-- Governed extension around the existing public.safety_observations register.
-- Run once in the Supabase SQL Editor, then refresh the application.

begin;

create table if not exists public.bbs_programmes (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  purpose text not null,
  learning_outcomes jsonb not null default '[]'::jsonb,
  scope text,
  target_population text,
  sampling_method text,
  sampling_plan jsonb not null default '{}'::jsonb,
  checklist_version text not null,
  privacy_notice text not null,
  owner_id uuid,
  owner_name text,
  start_date date,
  end_date date,
  version_no integer not null default 1,
  status text not null default 'draft' check (status in ('draft','review','published','active','paused','completed','evaluated','archived')),
  evaluation jsonb not null default '{}'::jsonb,
  change_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_by uuid,
  published_at timestamptz,
  unique(company_id,code,version_no)
);

create table if not exists public.bbs_behaviour_categories (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  display_order integer not null default 0,
  version_no integer not null default 1,
  status text not null default 'draft' check (status in ('draft','validated','published','retired')),
  effective_from date,
  effective_to date,
  owner_id uuid,
  owner_name text,
  change_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,code,version_no)
);

create table if not exists public.bbs_behaviour_items (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  category_id text references public.bbs_behaviour_categories(id),
  category_code text,
  category_name text,
  code text not null,
  name text not null,
  safe_statement text not null,
  at_risk_examples jsonb not null default '[]'::jsonb,
  applicability jsonb not null default '{}'::jsonb,
  critical boolean not null default false,
  potential_consequence text,
  feedback_prompt text,
  control_links jsonb not null default '[]'::jsonb,
  translations jsonb not null default '{}'::jsonb,
  version_no integer not null default 1,
  source_version_id text,
  status text not null default 'draft' check (status in ('draft','validated','published','active','retired')),
  effective_from date,
  effective_to date,
  owner_id uuid,
  owner_name text,
  change_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,code,version_no)
);

create table if not exists public.bbs_observation_details (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  observation_id text not null,
  programme_id text references public.bbs_programmes(id),
  observation_type text not null,
  task_activity text not null,
  work_group text,
  shift_name text,
  observer_mode text not null check (observer_mode in ('identified','confidential','anonymous')),
  observer_person_id uuid,
  observed_subject_type text not null default 'none',
  observed_subject_name text,
  positive_behaviour_text text,
  at_risk_behaviour_text text,
  potential_severity text,
  work_status text,
  immediate_action text,
  referral_type text not null default 'none',
  referral_id text,
  feedback_status text not null,
  feedback_method text,
  feedback_summary text,
  employee_response text,
  agreed_step text,
  barrier_narrative text,
  workflow_status text not null default 'draft' check (workflow_status in ('draft','submitted','in_review','returned','accepted','duplicate','redirected','closed','archived')),
  duplicate_of text,
  checklist_version text not null,
  configuration_version text not null,
  quality_score numeric,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  record_version integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,observation_id)
);

create table if not exists public.bbs_observation_responses (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  observation_id text not null,
  observation_detail_id text references public.bbs_observation_details(id) on delete cascade,
  behaviour_item_id text,
  item_code text not null,
  category_name text,
  item_snapshot jsonb not null,
  result text not null check (result in ('safe','at_risk','not_observed','not_applicable')),
  comment text,
  critical_flag boolean not null default false,
  created_at timestamptz not null default now(),
  unique(company_id,observation_id,item_code)
);

create table if not exists public.bbs_barriers (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  parent_code text,
  version_no integer not null default 1,
  status text not null default 'draft' check (status in ('draft','validated','published','retired')),
  effective_from date,
  effective_to date,
  owner_id uuid,
  change_reason text,
  created_at timestamptz not null default now(),
  unique(company_id,code,version_no)
);

create table if not exists public.bbs_observation_barriers (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  observation_id text not null,
  response_id text references public.bbs_observation_responses(id) on delete set null,
  barrier_id text references public.bbs_barriers(id) on delete set null,
  barrier_code text not null,
  barrier_name text not null,
  narrative text,
  review_state text not null default 'selected' check (review_state in ('selected','confirmed','rejected','theme')),
  selected_by uuid,
  reviewed_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.bbs_feedback (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  observation_id text not null,
  observation_ref text,
  status text not null,
  method text,
  summary text,
  employee_response text,
  agreed_step text,
  no_feedback_reason text,
  author_id uuid,
  author_name text,
  follow_up_due date,
  follow_up_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bbs_quality_reviews (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  observation_id text not null,
  observation_version integer not null default 1,
  validator_id uuid not null,
  validator_name text,
  decision text not null check (decision in ('accepted','returned','duplicate','redirected')),
  reason text,
  comment text,
  quality_components jsonb not null default '{}'::jsonb,
  quality_score numeric,
  retained_observation_id text,
  destination_module text,
  destination_id text,
  assigned_at timestamptz,
  due_at timestamptz,
  reviewed_at timestamptz not null default now(),
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.bbs_themes (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  signature text not null,
  behaviour_code text,
  barrier_name text,
  context text,
  evidence_count integer not null default 0,
  source_observation_ids jsonb not null default '[]'::jsonb,
  criticality text not null default 'normal',
  response_decision text not null default 'monitor',
  confirmed_by uuid,
  confirmed_at timestamptz,
  owner_id uuid,
  owner_name text,
  status text not null default 'suggested' check (status in ('suggested','confirmed','actioned','monitoring','closed','archived')),
  effectiveness text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,signature)
);

create table if not exists public.bbs_action_links (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  theme_id text references public.bbs_themes(id) on delete set null,
  observation_id text,
  action_id text not null,
  action_ref text,
  relationship text not null default 'addresses',
  owner_id uuid,
  owner_name text,
  due_date date,
  status_cache text,
  status_checked_at timestamptz,
  effectiveness text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique(company_id,action_id,theme_id,observation_id)
);

create table if not exists public.bbs_recognitions (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  observation_id text not null,
  source_ref text,
  nominee_type text not null,
  nominee_id text,
  nominee_name text not null,
  reason text not null,
  visibility text not null default 'private' check (visibility in ('private','team','organisation')),
  consent_confirmed boolean not null default false,
  nominated_by_id uuid,
  nominated_by_name text,
  reviewed_by uuid,
  review_reason text,
  status text not null default 'submitted' check (status in ('draft','submitted','review','approved','returned','declined','withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bbs_report_definitions (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  scope text not null,
  measures jsonb not null default '[]'::jsonb,
  formats jsonb not null default '["PDF"]'::jsonb,
  schedule text not null default 'on_demand',
  distribution jsonb not null default '{}'::jsonb,
  owner_id uuid,
  owner_name text,
  version_no integer not null default 1,
  status text not null default 'draft' check (status in ('draft','review','published','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,code,version_no)
);

create table if not exists public.bbs_config_versions (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  version_no integer not null,
  name text not null,
  configuration_group text not null,
  payload jsonb not null default '{}'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  impact_summary jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','validated','published','retired')),
  effective_from date,
  effective_to date,
  change_reason text not null,
  rollback_of text,
  created_by uuid,
  created_at timestamptz not null default now(),
  validated_by uuid,
  validated_at timestamptz,
  published_by uuid,
  published_at timestamptz,
  unique(company_id,version_no)
);

create table if not exists public.bbs_sensitive_access (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  object_type text not null,
  object_id text not null,
  identity_type text not null,
  purpose text not null,
  outcome text not null,
  correlation_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.bbs_audit_events (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  event_type text not null,
  before_json jsonb,
  after_json jsonb,
  reason text,
  actor_id uuid,
  actor_name text,
  correlation_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists bbs_programmes_company_status on public.bbs_programmes(company_id,status,start_date);
create index if not exists bbs_details_company_status on public.bbs_observation_details(company_id,workflow_status,submitted_at);
create index if not exists bbs_details_observation on public.bbs_observation_details(company_id,observation_id);
create index if not exists bbs_responses_observation on public.bbs_observation_responses(company_id,observation_id,result);
create index if not exists bbs_reviews_queue on public.bbs_quality_reviews(company_id,decision,created_at);
create index if not exists bbs_themes_company_status on public.bbs_themes(company_id,status,criticality);
create index if not exists bbs_audit_entity on public.bbs_audit_events(company_id,entity_type,entity_id,created_at desc);
create index if not exists bbs_sensitive_access_lookup on public.bbs_sensitive_access(company_id,object_type,object_id,created_at desc);

-- Tenant membership helpers are repeated inline so the migration has no
-- dependency on a custom security-definer function.
do $$
declare t text;
begin
  foreach t in array array[
    'bbs_programmes','bbs_behaviour_categories','bbs_behaviour_items',
    'bbs_observation_responses','bbs_barriers','bbs_observation_barriers',
    'bbs_feedback','bbs_quality_reviews','bbs_themes','bbs_action_links',
    'bbs_recognitions','bbs_report_definitions','bbs_config_versions'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_read',t);
    execute format(
      'create policy %I on public.%I for select using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id)))',
      t||'_tenant_read',t,t
    );
    execute format('drop policy if exists %I on public.%I',t||'_tenant_write',t);
    execute format(
      'create policy %I on public.%I for all using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id))) with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id)))',
      t||'_tenant_write',t,t,t
    );
  end loop;
end $$;

-- Governed master/workflow objects require an authorised BBS management role.
do $$
declare t text;
begin
  foreach t in array array[
    'bbs_programmes','bbs_behaviour_categories','bbs_behaviour_items','bbs_barriers',
    'bbs_quality_reviews','bbs_themes','bbs_action_links','bbs_report_definitions','bbs_config_versions'
  ] loop
    execute format('drop policy if exists %I on public.%I',t||'_tenant_write',t);
    execute format('drop policy if exists %I on public.%I',t||'_governed_write',t);
    execute format(
      'create policy %I on public.%I for all using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''auditor''))))) with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''auditor'')))))',
      t||'_governed_write',t,t,t
    );
  end loop;
end $$;

alter table public.bbs_observation_details enable row level security;
drop policy if exists bbs_details_scoped_read on public.bbs_observation_details;
create policy bbs_details_scoped_read on public.bbs_observation_details for select using (
  exists (
    select 1 from public.profiles p where p.id=auth.uid() and (
      p.role='sephs_admin' or
      (p.company_id=bbs_observation_details.company_id and (
        bbs_observation_details.observer_mode='identified' or
        bbs_observation_details.observer_person_id=auth.uid() or
        p.role in ('admin','hse_manager','hse_officer','auditor')
      ))
    )
  )
);
drop policy if exists bbs_details_create on public.bbs_observation_details;
create policy bbs_details_create on public.bbs_observation_details for insert with check (
  exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=bbs_observation_details.company_id))
);
drop policy if exists bbs_details_update on public.bbs_observation_details;
create policy bbs_details_update on public.bbs_observation_details for update using (
  observer_person_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=bbs_observation_details.company_id and p.role in ('admin','hse_manager','hse_officer','auditor'))))
);

alter table public.bbs_sensitive_access enable row level security;
drop policy if exists bbs_sensitive_access_privacy on public.bbs_sensitive_access;
create policy bbs_sensitive_access_privacy on public.bbs_sensitive_access for select using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=bbs_sensitive_access.company_id and p.role in ('admin','hse_manager','auditor'))))
);
drop policy if exists bbs_sensitive_access_insert on public.bbs_sensitive_access;
create policy bbs_sensitive_access_insert on public.bbs_sensitive_access for insert with check (
  exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=bbs_sensitive_access.company_id))
);

alter table public.bbs_audit_events enable row level security;
drop policy if exists bbs_audit_read on public.bbs_audit_events;
create policy bbs_audit_read on public.bbs_audit_events for select using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=bbs_audit_events.company_id and p.role in ('admin','hse_manager','hse_officer','auditor'))))
);
drop policy if exists bbs_audit_insert on public.bbs_audit_events;
create policy bbs_audit_insert on public.bbs_audit_events for insert with check (
  exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=bbs_audit_events.company_id))
);

commit;
