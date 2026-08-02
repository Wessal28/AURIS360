-- AURIS360 Safety Engagement & Individual Performance
-- Phase 1 authoritative workflow + Phase 2 mobile/automation records.
-- Run once in Supabase SQL Editor, then refresh the application.

begin;

create table if not exists public.engagement_programmes (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  purpose text,
  population text,
  population_rule jsonb not null default '{}'::jsonb,
  period text not null default extract(year from current_date)::text,
  version_no integer not null default 1,
  kpi_count integer not null default 0,
  weight_total numeric not null default 0,
  score_method text not null default 'weighted',
  na_rule text not null default 'redistribute',
  pending_rule text not null default 'exclude_from_failure',
  owner text,
  status text not null default 'draft' check (status in ('draft','review','published','retired')),
  effective_from date,
  effective_to date,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code, version_no)
);

create table if not exists public.engagement_kpi_definitions (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  programme_id text references public.engagement_programmes(id) on delete cascade,
  code text not null,
  name text not null,
  measure text not null,
  target numeric,
  target_operator text not null default 'greater_or_equal',
  unit text not null default 'count',
  frequency text not null default 'monthly',
  weight numeric not null default 0,
  direction text not null default 'higher' check (direction in ('higher','lower','exact','range')),
  source text,
  quality_rule jsonb not null default '{}'::jsonb,
  applicability jsonb not null default '{}'::jsonb,
  score_cap numeric not null default 100,
  critical boolean not null default false,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  unique(company_id, code, programme_id)
);

create table if not exists public.engagement_assignments (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  programme_id text references public.engagement_programmes(id),
  programme_name text not null,
  target_type text not null default 'group',
  target_id text,
  target_name text not null,
  scope text,
  population_rule jsonb not null default '{}'::jsonb,
  people_count integer not null default 0,
  effective_from date not null,
  effective_to date,
  priority integer not null default 100,
  override_reason text,
  override_payload jsonb not null default '{}'::jsonb,
  approved_by uuid,
  status text not null default 'pending' check (status in ('pending','active','ended','conflict')),
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.engagement_person_results (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid,
  person_name text not null,
  programme_id text references public.engagement_programmes(id),
  programme_name text not null,
  period text not null,
  employment_snapshot jsonb not null default '{}'::jsonb,
  score numeric,
  status text not null default 'pending' check (status in ('on_track','at_risk','off_track','pending','not_due','na','data_error')),
  hazards numeric not null default 0,
  toolbox numeric not null default 0,
  training numeric not null default 0,
  actions numeric not null default 0,
  pending integer not null default 0,
  excluded integer not null default 0,
  calculation jsonb not null default '{}'::jsonb,
  formula_version text not null default '1.0',
  employee_comment text,
  supervisor_comment text,
  review_state text not null default 'open',
  approved_by uuid,
  approved_at timestamptz,
  locked_at timestamptz,
  revision_no integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, person_id, programme_id, period, revision_no)
);

create table if not exists public.engagement_activity_credits (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  activity_type text not null,
  source_module text,
  source_id text,
  source_ref text,
  person_id uuid,
  person_name text not null,
  activity_date date,
  submitted_at timestamptz not null default now(),
  raw_value numeric not null default 1,
  credited_value numeric,
  quality text,
  potential_kpi text,
  duplicate_of text,
  evidence jsonb not null default '[]'::jsonb,
  sla text,
  status text not null default 'pending' check (status in ('pending','review','accepted','partial','rejected','duplicate','request_info')),
  decision_reason text,
  validated_by uuid,
  validated_at timestamptz,
  correlation_id uuid not null default gen_random_uuid(),
  unique(company_id, source_module, source_id, person_id)
);

create table if not exists public.engagement_recognitions (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  recognition_type text not null,
  recipient_id uuid,
  recipient_name text not null,
  basis text not null,
  activity_credit_id text references public.engagement_activity_credits(id),
  nominated_by_id uuid,
  nominated_by text,
  approver_id uuid,
  date date not null default current_date,
  visibility text not null default 'private' check (visibility in ('private','team','organisation')),
  consent_confirmed boolean not null default false,
  status text not null default 'draft' check (status in ('draft','submitted','review','approved','declined','withdrawn')),
  created_at timestamptz not null default now()
);

create table if not exists public.engagement_coaching_plans (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid,
  person_name text not null,
  trigger text not null,
  objective text not null,
  support_actions jsonb not null default '[]'::jsonb,
  barriers jsonb not null default '[]'::jsonb,
  coach_id uuid,
  coach text,
  start_date date not null,
  review_date date,
  progress integer not null default 0 check (progress between 0 and 100),
  effectiveness text,
  employee_comment text,
  status text not null default 'draft' check (status in ('draft','active','improving','review','effective','partial','ineffective','closed')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.engagement_disputes (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  reference text not null,
  person_id uuid,
  person_name text not null,
  period text,
  entity_type text,
  entity_id text,
  issue_type text not null,
  explanation text,
  evidence_ref text,
  submitted_at timestamptz not null default now(),
  reviewer_id uuid,
  reviewer text,
  decision text,
  decision_reason text,
  correction jsonb not null default '{}'::jsonb,
  appeal_of text,
  due_at timestamptz,
  status text not null default 'submitted' check (status in ('submitted','acknowledged','evidence','review','decision','approved','rejected','appeal','closed')),
  updated_at timestamptz not null default now(),
  unique(company_id, reference)
);

create table if not exists public.engagement_configuration_versions (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  version_no integer not null,
  status text not null default 'draft' check (status in ('draft','validated','published','retired')),
  effective_from date,
  configuration jsonb not null default '{}'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  impact_summary jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  validated_by uuid,
  validated_at timestamptz,
  published_by uuid,
  published_at timestamptz,
  unique(company_id, version_no)
);
create unique index if not exists engagement_one_published_config on public.engagement_configuration_versions(company_id) where status='published';

-- Phase 2 entities reference authoritative Phase 1/source records. They do not
-- duplicate personal scores, toolbox sessions, hazards or approvals.
create table if not exists public.engagement_mobile_installations (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null,
  installation_id text not null,
  platform text,
  app_version text,
  status text not null default 'active',
  notification_token_ref text,
  preferences jsonb not null default '{}'::jsonb,
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id, installation_id)
);

create table if not exists public.engagement_qr_sessions (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  session_ref text not null,
  toolbox_session_id text,
  token_hash text not null,
  nonce uuid not null default gen_random_uuid(),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  person_id uuid,
  person_name text,
  installation_id text,
  scan_at timestamptz,
  confirmation_id text,
  online_state text not null default 'online',
  anomaly_flags jsonb not null default '[]'::jsonb,
  status text not null default 'issued' check (status in ('issued','confirmed','expired','revoked','ineligible','correction')),
  created_at timestamptz not null default now(),
  unique(company_id, session_ref, person_id)
);

create table if not exists public.engagement_mobile_drafts (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  local_id text,
  owner_id uuid not null,
  installation_id text,
  record_type text not null,
  schema_version text not null default '1',
  payload jsonb not null default '{}'::jsonb,
  attachment_manifest jsonb not null default '[]'::jsonb,
  checksum text,
  idempotency_key uuid not null default gen_random_uuid(),
  state text not null default 'waiting' check (state in ('waiting','syncing','synced','conflict','failed','expired')),
  server_record_id text,
  server_version text,
  error_code text,
  acknowledged_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.engagement_notifications (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  recipient_id uuid,
  source_event text,
  source_id text,
  title text not null,
  detail text,
  priority text not null default 'normal',
  channel text not null default 'in_app',
  deep_link text,
  mandatory boolean not null default false,
  scheduled_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  acted_at timestamptz,
  state text not null default 'scheduled',
  failure_code text,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.engagement_calendar_events (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid,
  title text not null,
  source_module text not null,
  source_id text,
  start_at timestamptz not null,
  end_at timestamptz,
  timezone text not null default 'Asia/Dubai',
  location text,
  owner text,
  status text not null default 'scheduled',
  deep_link text,
  created_at timestamptz not null default now(),
  unique(company_id, source_module, source_id, person_id)
);

create table if not exists public.engagement_audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  entity_type text not null,
  entity_id text,
  event_type text not null,
  before_json jsonb,
  after_json jsonb,
  actor_id uuid,
  actor_name text,
  reason text,
  installation_id text,
  outcome text,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index if not exists engagement_results_company_period on public.engagement_person_results(company_id, period, status);
create index if not exists engagement_credits_queue on public.engagement_activity_credits(company_id, status, submitted_at);
create index if not exists engagement_disputes_queue on public.engagement_disputes(company_id, status, submitted_at);
create index if not exists engagement_notifications_person on public.engagement_notifications(company_id, recipient_id, created_at desc);
create index if not exists engagement_calendar_person on public.engagement_calendar_events(company_id, person_id, start_at);
create index if not exists engagement_mobile_drafts_owner on public.engagement_mobile_drafts(company_id, owner_id, state);
create index if not exists engagement_audit_entity on public.engagement_audit_events(company_id, entity_type, entity_id, created_at desc);

update public.companies
set module_access = array_append(coalesce(module_access,array[]::text[]),'engagement')
where not ('engagement'=any(coalesce(module_access,array[]::text[])));

-- Seed the governed programme library and visible starter data for each company.
insert into public.engagement_programmes(company_id,code,name,purpose,population,period,version_no,kpi_count,weight_total,owner,status,effective_from)
select c.id,v.code,v.name,v.purpose,v.population,v.period,v.version_no,v.kpi_count,100,v.owner,v.status,date '2026-01-01'
from public.companies c cross join (values
 ('SEP-OPS','Operational Employee Safety','Positive participation for operational employees','Operational employees','2026',2,6,'HSE Manager','published'),
 ('SEP-SUP','Supervisor Safety Leadership','Visible safety leadership and timely validation','Supervisors','2026',2,7,'HSE Manager','published'),
 ('SEP-OFF','Office Safety Participation','Role-appropriate office participation','Office employees','2026',1,4,'People Manager','published'),
 ('SEP-CON','Contractor Engagement','Project-based contractor participation','Contract workers','Project',1,5,'Contractor Manager','review'),
 ('SEP-NEW','New Starter - 90 Days','Supported first 90 days','New employees','90 days',1,5,'People Manager','draft')
) as v(code,name,purpose,population,period,version_no,kpi_count,owner,status)
where not exists(select 1 from public.engagement_programmes p where p.company_id=c.id and p.code=v.code and p.version_no=v.version_no);

insert into public.engagement_kpi_definitions(company_id,programme_id,code,name,measure,target,unit,frequency,weight,direction,source,status)
select p.company_id,p.id,v.code,v.name,v.measure,v.target,v.unit,v.frequency,v.weight,'higher',v.source,'published'
from public.engagement_programmes p cross join (values
 ('IKPI-001','Validated hazard reports','Accepted genuine reports',2::numeric,'count/month','monthly',25::numeric,'Hazard Reporting'),
 ('IKPI-002','Toolbox participation','Attended / scheduled while eligible',90::numeric,'%','monthly',20::numeric,'Toolbox Talks'),
 ('IKPI-003','Required training','Valid completed / required due',100::numeric,'%','monthly',20::numeric,'Training'),
 ('IKPI-004','Assigned actions on time','Closed by due / due',95::numeric,'%','monthly',15::numeric,'Master Action Plan'),
 ('IKPI-005','Inspection participation','Verified team membership',1::numeric,'count/quarter','quarterly',10::numeric,'Inspections'),
 ('IKPI-006','Safety suggestions','Accepted improvement suggestions',1::numeric,'count/quarter','quarterly',10::numeric,'BBS Observations')
) as v(code,name,measure,target,unit,frequency,weight,source)
where p.code='SEP-OPS' and p.status='published'
  and not exists(select 1 from public.engagement_kpi_definitions k where k.company_id=p.company_id and k.programme_id=p.id and k.code=v.code);

insert into public.engagement_configuration_versions(company_id,version_no,status,effective_from,configuration,published_at)
select c.id,1,'published',date '2026-08-01',
 '{"on_track":90,"at_risk":70,"min_group_size":5,"qr_expiry_minutes":5,"offline_retention_days":7,"upload_limit_mb":10,"quiet_hours":"20:00-06:00","pending_rule":"exclude_from_failure","na_rule":"redistribute","no_incident_targets":true,"public_negative_ranking":false,"automatic_discipline":false}'::jsonb,now()
from public.companies c
where not exists(select 1 from public.engagement_configuration_versions x where x.company_id=c.id);

-- Default-deny company isolation. Personal tables further restrict employees to
-- their own records while supervisors/governance roles retain authorised scope.
do $$
declare t text;
begin
  foreach t in array array[
    'engagement_programmes','engagement_kpi_definitions','engagement_assignments',
    'engagement_configuration_versions'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('grant select,insert,update on public.%I to authenticated',t);
    execute format('drop policy if exists %I on public.%I',t||'_read',t);
    execute format('drop policy if exists %I on public.%I',t||'_manage',t);
    execute format(
      'create policy %I on public.%I for select using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id)))',
      t||'_read',t,t
    );
    execute format(
      'create policy %I on public.%I for all using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer''))))) with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'')))))',
      t||'_manage',t,t,t
    );
  end loop;
end $$;

-- Personal and restricted workflow tables use tighter record rules.
do $$
declare t text;
begin
  foreach t in array array[
    'engagement_person_results','engagement_activity_credits','engagement_recognitions',
    'engagement_coaching_plans','engagement_disputes','engagement_audit_events',
    'engagement_mobile_installations','engagement_qr_sessions','engagement_mobile_drafts',
    'engagement_notifications','engagement_calendar_events'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('grant select,insert,update on public.%I to authenticated',t);
  end loop;
end $$;

drop policy if exists engagement_person_results_scope on public.engagement_person_results;
create policy engagement_person_results_scope on public.engagement_person_results for select using (
  exists(select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=engagement_person_results.company_id and
      (p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor','hr','executive') or engagement_person_results.person_id=auth.uid()))))
);
drop policy if exists engagement_person_results_manage on public.engagement_person_results;
create policy engagement_person_results_manage on public.engagement_person_results for all using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_person_results.company_id and p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor'))))
) with check (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_person_results.company_id and p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor'))))
);

drop policy if exists engagement_activity_credits_scope on public.engagement_activity_credits;
create policy engagement_activity_credits_scope on public.engagement_activity_credits for select using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_activity_credits.company_id and
      (p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor') or engagement_activity_credits.person_id=auth.uid()))))
);
drop policy if exists engagement_activity_credits_manage on public.engagement_activity_credits;
create policy engagement_activity_credits_manage on public.engagement_activity_credits for all using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_activity_credits.company_id and p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor'))))
) with check (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_activity_credits.company_id and p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor'))))
);

drop policy if exists engagement_recognitions_scope on public.engagement_recognitions;
create policy engagement_recognitions_scope on public.engagement_recognitions for select using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_recognitions.company_id and
      (p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor','hr')
       or engagement_recognitions.recipient_id=auth.uid()
       or (engagement_recognitions.visibility in ('team','organisation') and engagement_recognitions.status='approved')))))
);
drop policy if exists engagement_recognitions_create on public.engagement_recognitions;
create policy engagement_recognitions_create on public.engagement_recognitions for insert with check (
  nominated_by_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or p.company_id=engagement_recognitions.company_id))
);
drop policy if exists engagement_recognitions_manage on public.engagement_recognitions;
create policy engagement_recognitions_manage on public.engagement_recognitions for update using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_recognitions.company_id and p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor'))))
);

drop policy if exists engagement_coaching_scope on public.engagement_coaching_plans;
create policy engagement_coaching_scope on public.engagement_coaching_plans for select using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_coaching_plans.company_id and
      (p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor','hr') or engagement_coaching_plans.person_id=auth.uid()))))
);
drop policy if exists engagement_coaching_manage on public.engagement_coaching_plans;
create policy engagement_coaching_manage on public.engagement_coaching_plans for all using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_coaching_plans.company_id and p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor','hr'))))
) with check (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_coaching_plans.company_id and p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor','hr'))))
);

drop policy if exists engagement_disputes_scope on public.engagement_disputes;
create policy engagement_disputes_scope on public.engagement_disputes for select using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_disputes.company_id and
      (p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor','hr') or engagement_disputes.person_id=auth.uid()))))
);
drop policy if exists engagement_disputes_create on public.engagement_disputes;
create policy engagement_disputes_create on public.engagement_disputes for insert with check (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_disputes.company_id and engagement_disputes.person_id=auth.uid())
     or (p.company_id=engagement_disputes.company_id and p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor','hr'))))
);
drop policy if exists engagement_disputes_manage on public.engagement_disputes;
create policy engagement_disputes_manage on public.engagement_disputes for update using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_disputes.company_id and p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor','hr'))))
);

drop policy if exists engagement_mobile_drafts_owner on public.engagement_mobile_drafts;
create policy engagement_mobile_drafts_owner on public.engagement_mobile_drafts for all using (
  owner_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=engagement_mobile_drafts.company_id))
) with check (
  owner_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=engagement_mobile_drafts.company_id))
);

drop policy if exists engagement_mobile_installations_owner on public.engagement_mobile_installations;
create policy engagement_mobile_installations_owner on public.engagement_mobile_installations for all using (
  person_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=engagement_mobile_installations.company_id))
) with check (
  person_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=engagement_mobile_installations.company_id))
);

drop policy if exists engagement_qr_scope on public.engagement_qr_sessions;
create policy engagement_qr_scope on public.engagement_qr_sessions for all using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_qr_sessions.company_id and
      (engagement_qr_sessions.person_id=auth.uid() or p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor')))))
) with check (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_qr_sessions.company_id and
      (engagement_qr_sessions.person_id=auth.uid() or p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor')))))
);

drop policy if exists engagement_notifications_scope on public.engagement_notifications;
create policy engagement_notifications_scope on public.engagement_notifications for select using (
  recipient_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_notifications.company_id and p.role in ('admin','hse_manager','hse_officer'))))
);
drop policy if exists engagement_notifications_manage on public.engagement_notifications;
create policy engagement_notifications_manage on public.engagement_notifications for all using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_notifications.company_id and p.role in ('admin','hse_manager','hse_officer'))))
) with check (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_notifications.company_id and p.role in ('admin','hse_manager','hse_officer'))))
);

drop policy if exists engagement_calendar_scope on public.engagement_calendar_events;
create policy engagement_calendar_scope on public.engagement_calendar_events for select using (
  person_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_calendar_events.company_id and p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor'))))
);
drop policy if exists engagement_calendar_manage on public.engagement_calendar_events;
create policy engagement_calendar_manage on public.engagement_calendar_events for all using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_calendar_events.company_id and p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor'))))
) with check (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_calendar_events.company_id and p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor'))))
);

drop policy if exists engagement_audit_read on public.engagement_audit_events;
create policy engagement_audit_read on public.engagement_audit_events for select using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or (p.company_id=engagement_audit_events.company_id and p.role in ('admin','hse_manager','hse_officer','auditor'))))
);
drop policy if exists engagement_audit_insert on public.engagement_audit_events;
create policy engagement_audit_insert on public.engagement_audit_events for insert with check (
  exists(select 1 from public.profiles p where p.id=auth.uid() and
    (p.role='sephs_admin' or p.company_id=engagement_audit_events.company_id))
);

commit;
notify pgrst, 'reload schema';
