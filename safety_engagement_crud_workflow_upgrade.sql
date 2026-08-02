-- AURIS 360 Safety Engagement CRUD & Workflow Remediation
-- Apply after safety_engagement_schema.sql. Safe to re-run.

begin;

-- Governed records share lifecycle, concurrency, archive and audit metadata.
do $$
declare t text;
begin
  foreach t in array array[
    'engagement_programmes','engagement_kpi_definitions','engagement_assignments','engagement_person_results',
    'engagement_recognitions','engagement_coaching_plans','engagement_disputes'
  ] loop
    execute format('alter table public.%I add column if not exists updated_by uuid',t);
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()',t);
    execute format('alter table public.%I add column if not exists archived_at timestamptz',t);
    execute format('alter table public.%I add column if not exists archived_by uuid',t);
    execute format('alter table public.%I add column if not exists record_version integer not null default 1',t);
  end loop;
end $$;

alter table public.engagement_kpi_definitions add column if not exists effective_from date;
alter table public.engagement_kpi_definitions add column if not exists effective_to date;
alter table public.engagement_kpi_definitions add column if not exists created_by uuid;
alter table public.engagement_kpi_definitions add column if not exists change_reason text;
alter table public.engagement_recognitions add column if not exists created_by uuid;
alter table public.engagement_disputes add column if not exists created_by uuid;
alter table public.engagement_programmes add column if not exists published_by uuid;
alter table public.engagement_programmes add column if not exists published_at timestamptz;

-- Lifecycle constraints now include inactive/archive states without erasing history.
alter table public.engagement_programmes drop constraint if exists engagement_programmes_status_check;
alter table public.engagement_programmes add constraint engagement_programmes_status_check
  check (status in ('draft','review','published','inactive','retired','archived'));
alter table public.engagement_assignments drop constraint if exists engagement_assignments_status_check;
alter table public.engagement_assignments add constraint engagement_assignments_status_check
  check (status in ('pending','active','inactive','ended','conflict','archived'));
alter table public.engagement_recognitions drop constraint if exists engagement_recognitions_status_check;
alter table public.engagement_recognitions add constraint engagement_recognitions_status_check
  check (status in ('draft','submitted','review','approved','issued','declined','withdrawn','archived'));
alter table public.engagement_coaching_plans drop constraint if exists engagement_coaching_plans_status_check;
alter table public.engagement_coaching_plans add constraint engagement_coaching_plans_status_check
  check (status in ('draft','active','improving','review','effective','partial','ineffective','completed','cancelled','closed','archived'));
alter table public.engagement_disputes drop constraint if exists engagement_disputes_status_check;
alter table public.engagement_disputes add constraint engagement_disputes_status_check
  check (status in ('draft','submitted','acknowledged','evidence','review','more_information','decision','approved','partially_upheld','rejected','appeal','withdrawn','closed','archived'));

create table if not exists public.engagement_review_templates (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  scope text not null default 'Company',
  sections jsonb not null default '[]'::jsonb,
  questions jsonb not null default '[]'::jsonb,
  employee_fields jsonb not null default '[]'::jsonb,
  action_triggers jsonb not null default '{}'::jsonb,
  submission_rules jsonb not null default '{}'::jsonb,
  approval_flow jsonb not null default '{}'::jsonb,
  communications jsonb not null default '{}'::jsonb,
  effective_from date,
  effective_to date,
  version_no integer not null default 1,
  status text not null default 'draft' check (status in ('draft','review','published','inactive','archived')),
  change_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  published_by uuid,
  published_at timestamptz,
  record_version integer not null default 1,
  unique(company_id,code,version_no)
);

create table if not exists public.engagement_team_reviews (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  review_code text,
  period text not null,
  team_id text,
  team_name text not null,
  template_id text not null references public.engagement_review_templates(id),
  owner_id uuid,
  owner_name text,
  review_date date not null default current_date,
  meeting_date date,
  participants jsonb not null default '[]'::jsonb,
  scope_note text,
  readiness jsonb not null default '{}'::jsonb,
  assessments jsonb not null default '{}'::jsonb,
  conclusions jsonb not null default '{}'::jsonb,
  snapshot jsonb not null default '{}'::jsonb,
  return_comments text,
  status text not null default 'draft' check (status in ('draft','submitted','returned','approved','locked','reopened','archived')),
  version_no integer not null default 1,
  idempotency_key uuid not null default gen_random_uuid(),
  submitted_at timestamptz,
  approved_at timestamptz,
  locked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  record_version integer not null default 1
);
create unique index if not exists engagement_one_active_team_review
  on public.engagement_team_reviews(company_id,period,coalesce(team_id,team_name))
  where status in ('draft','submitted','returned','approved','locked','reopened');

create table if not exists public.engagement_report_definitions (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  dataset text not null,
  scope text not null default 'Company',
  privacy_level text not null default 'role_controlled',
  definition jsonb not null default '{}'::jsonb,
  distribution jsonb not null default '{}'::jsonb,
  effective_from date,
  version_no integer not null default 1,
  status text not null default 'draft' check (status in ('draft','review','published','inactive','archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  published_by uuid,
  published_at timestamptz,
  record_version integer not null default 1,
  unique(company_id,code,version_no)
);

create table if not exists public.engagement_configuration_records (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  record_type text not null,
  code text not null,
  name text not null,
  scope text not null default 'Company',
  inherited_from_id text references public.engagement_configuration_records(id),
  payload jsonb not null default '{}'::jsonb,
  impact_summary jsonb not null default '{}'::jsonb,
  dependencies jsonb not null default '[]'::jsonb,
  effective_from date,
  effective_to date,
  version_no integer not null default 1,
  status text not null default 'draft' check (status in ('draft','review','published','inactive','archived')),
  change_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  published_by uuid,
  published_at timestamptz,
  record_version integer not null default 1,
  unique(company_id,record_type,code,version_no)
);
alter table public.engagement_review_templates add column if not exists published_by uuid;
alter table public.engagement_review_templates add column if not exists published_at timestamptz;
alter table public.engagement_report_definitions add column if not exists published_by uuid;
alter table public.engagement_report_definitions add column if not exists published_at timestamptz;
alter table public.engagement_configuration_records add column if not exists published_by uuid;
alter table public.engagement_configuration_records add column if not exists published_at timestamptz;

-- Existing starter content is not deleted automatically. It is queued for the
-- product owner to classify as retain/archive/delete after checking for edits.
create table if not exists public.engagement_seed_reconciliation (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  entity_code text,
  classification text not null default 'pending' check (classification in ('pending','retain','archive','delete_unused_draft')),
  reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id,entity_type,entity_id)
);
insert into public.engagement_seed_reconciliation(company_id,entity_type,entity_id,entity_code,reason)
select company_id,'programme',id,code,'Matches a programme code previously installed by the starter seed.'
from public.engagement_programmes
where code in ('SEP-OPS','SEP-SUP','SEP-OFF','SEP-CON','SEP-NEW')
on conflict(company_id,entity_type,entity_id) do nothing;

-- Tenant-isolated policies. UI visibility is not treated as a security control.
do $$
declare t text;
begin
  foreach t in array array[
    'engagement_review_templates','engagement_team_reviews','engagement_report_definitions',
    'engagement_configuration_records','engagement_seed_reconciliation'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('grant select,insert,update on public.%I to authenticated',t);
    execute format('drop policy if exists %I on public.%I',t||'_read',t);
    execute format('drop policy if exists %I on public.%I',t||'_manage',t);
    execute format(
      'create policy %I on public.%I for select using (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id)))',
      t||'_read',t,t
    );
    execute format(
      'create policy %I on public.%I for all using (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer''))))) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'')))))',
      t||'_manage',t,t,t
    );
  end loop;
end $$;

drop policy if exists engagement_team_reviews_supervisor_manage on public.engagement_team_reviews;
create policy engagement_team_reviews_supervisor_manage on public.engagement_team_reviews for all
using (
  owner_id=auth.uid() and exists(
    select 1 from public.profiles p where p.id=auth.uid()
      and p.company_id=engagement_team_reviews.company_id
      and p.role in ('manager','site_manager','supervisor')
  )
)
with check (
  owner_id=auth.uid() and exists(
    select 1 from public.profiles p where p.id=auth.uid()
      and p.company_id=engagement_team_reviews.company_id
      and p.role in ('manager','site_manager','supervisor')
  )
);

create index if not exists engagement_team_reviews_period on public.engagement_team_reviews(company_id,period,status);
create index if not exists engagement_report_definitions_status on public.engagement_report_definitions(company_id,status);
create index if not exists engagement_configuration_records_type on public.engagement_configuration_records(company_id,record_type,status);

commit;
notify pgrst, 'reload schema';
