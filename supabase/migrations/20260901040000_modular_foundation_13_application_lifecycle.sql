-- Phase 13: versioned application lifecycle and enterprise operations.
-- Business records remain in their owning modules; this schema records only
-- tenant-scoped release, migration, health and rollback evidence.

create table if not exists public.company_application_releases (
  company_id uuid not null references public.companies(id) on delete cascade,
  module_key text not null check (module_key ~ '^[a-z][a-z0-9-]{0,62}$'),
  installed_version text not null check (installed_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'),
  previous_version text check (previous_version is null or previous_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'),
  activation_status text not null default 'pilot' check (activation_status in ('pilot','enabled','paused','disabled')),
  migration_status text not null default 'pending' check (migration_status in ('pending','running','succeeded','failed','rolled_back')),
  manifest_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(manifest_snapshot)='object'),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  primary key (company_id,module_key)
);

create table if not exists public.application_upgrade_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  module_key text not null check (module_key ~ '^[a-z][a-z0-9-]{0,62}$'),
  from_version text not null,
  to_version text not null,
  status text not null default 'running' check (status in ('planned','running','succeeded','failed','rolled_back')),
  activation_status text not null default 'pilot' check (activation_status in ('pilot','enabled','paused','disabled')),
  compatibility_snapshot jsonb not null check (jsonb_typeof(compatibility_snapshot)='object'),
  migration_plan jsonb not null default '[]'::jsonb check (jsonb_typeof(migration_plan)='array'),
  error_code text check (error_code is null or error_code ~ '^[A-Z0-9_-]{1,48}$'),
  idempotency_key text not null check (length(idempotency_key) between 8 and 120),
  initiated_by uuid not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(company_id,module_key,idempotency_key)
);

create unique index if not exists application_upgrade_one_running_uq
  on public.application_upgrade_runs(company_id,module_key) where status='running';

create table if not exists public.application_migration_status (
  company_id uuid not null references public.companies(id) on delete cascade,
  module_key text not null,
  migration_key text not null check (migration_key ~ '^[0-9]{14}_[a-z0-9_]{1,100}$'),
  status text not null check (status in ('pending','running','succeeded','failed','rolled_back')),
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  upgrade_run_id uuid references public.application_upgrade_runs(id),
  applied_by uuid,
  applied_at timestamptz,
  primary key(company_id,module_key,migration_key)
);

create table if not exists public.application_health_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  module_key text not null,
  event_type text not null check (event_type in ('module_failure','service_failure','workflow_failure','approval_backlog','performance_budget','accessibility_failure','migration_failure')),
  severity text not null check (severity in ('info','warning','critical')),
  error_code text not null check (error_code ~ '^[A-Z0-9_-]{1,48}$'),
  safe_context jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_context)='object' and octet_length(safe_context::text)<=4096),
  release_sha text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);

create index if not exists application_health_open_idx on public.application_health_events(company_id,module_key,severity,created_at desc) where resolved_at is null;

alter table public.company_application_releases enable row level security;
alter table public.application_upgrade_runs enable row level security;
alter table public.application_migration_status enable row level security;
alter table public.application_health_events enable row level security;

drop policy if exists company_application_releases_read on public.company_application_releases;
create policy company_application_releases_read on public.company_application_releases for select to authenticated using (public.auris_can_access_company(company_id));
drop policy if exists application_upgrade_runs_read on public.application_upgrade_runs;
create policy application_upgrade_runs_read on public.application_upgrade_runs for select to authenticated using (public.auris_can_access_company(company_id));
drop policy if exists application_migration_status_read on public.application_migration_status;
create policy application_migration_status_read on public.application_migration_status for select to authenticated using (public.auris_can_access_company(company_id));
drop policy if exists application_health_events_read on public.application_health_events;
create policy application_health_events_read on public.application_health_events for select to authenticated using (public.auris_can_access_company(company_id));

create or replace function public.begin_application_upgrade(
  p_company_id uuid,p_module_key text,p_from_version text,p_to_version text,
  p_activation_status text,p_compatibility_snapshot jsonb,p_migration_plan jsonb,p_idempotency_key text
) returns public.application_upgrade_runs language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.application_upgrade_runs;
begin
  if auth.uid() is null or not public.auris_can_manage_company(p_company_id) then raise exception 'application upgrade authority denied' using errcode='42501'; end if;
  if p_module_key !~ '^[a-z][a-z0-9-]{0,62}$' or p_from_version !~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' or p_to_version !~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' then raise exception 'invalid application release identity' using errcode='22023'; end if;
  if p_activation_status not in ('pilot','enabled') or jsonb_typeof(p_compatibility_snapshot)<>'object' or coalesce((p_compatibility_snapshot->>'compatible')::boolean,false) is not true or jsonb_typeof(p_migration_plan)<>'array' then raise exception 'upgrade compatibility evidence is incomplete' using errcode='22023'; end if;
  select * into v_row from public.application_upgrade_runs where company_id=p_company_id and module_key=p_module_key and idempotency_key=p_idempotency_key;
  if found then return v_row; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_module_key,0));
  if exists(select 1 from public.application_upgrade_runs where company_id=p_company_id and module_key=p_module_key and status='running') then raise exception 'application upgrade already running' using errcode='55000'; end if;
  insert into public.application_upgrade_runs(company_id,module_key,from_version,to_version,activation_status,compatibility_snapshot,migration_plan,idempotency_key,initiated_by)
  values(p_company_id,p_module_key,p_from_version,p_to_version,p_activation_status,p_compatibility_snapshot,p_migration_plan,p_idempotency_key,auth.uid()) returning * into v_row;
  insert into public.company_application_releases(company_id,module_key,installed_version,activation_status,migration_status,manifest_snapshot,updated_by)
  values(p_company_id,p_module_key,p_from_version,p_activation_status,'running',p_compatibility_snapshot,auth.uid())
  on conflict(company_id,module_key) do update set activation_status=excluded.activation_status,migration_status='running',manifest_snapshot=excluded.manifest_snapshot,updated_by=auth.uid(),updated_at=now();
  return v_row;
end $$;

create or replace function public.finish_application_upgrade(p_run_id uuid,p_status text,p_error_code text default null)
returns public.application_upgrade_runs language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run public.application_upgrade_runs;
begin
  select * into v_run from public.application_upgrade_runs where id=p_run_id for update;
  if not found or auth.uid() is null or not public.auris_can_manage_company(v_run.company_id) then raise exception 'upgrade run unavailable' using errcode='42501'; end if;
  if v_run.status<>'running' then return v_run; end if;
  if p_status not in ('succeeded','failed') or (p_error_code is not null and p_error_code !~ '^[A-Z0-9_-]{1,48}$') then raise exception 'invalid upgrade result' using errcode='22023'; end if;
  update public.application_upgrade_runs set status=p_status,error_code=p_error_code,completed_at=now() where id=p_run_id returning * into v_run;
  update public.company_application_releases set previous_version=case when p_status='succeeded' then installed_version else previous_version end,installed_version=case when p_status='succeeded' then v_run.to_version else installed_version end,migration_status=p_status,activation_status=case when p_status='failed' then 'paused' else v_run.activation_status end,updated_by=auth.uid(),updated_at=now() where company_id=v_run.company_id and module_key=v_run.module_key;
  if p_status='failed' then insert into public.application_health_events(company_id,module_key,event_type,severity,error_code,safe_context) values(v_run.company_id,v_run.module_key,'migration_failure','critical',coalesce(p_error_code,'MIGRATION_FAILED'),jsonb_build_object('upgrade_run_id',v_run.id)); end if;
  return v_run;
end $$;

create or replace function public.rollback_application_release(p_company_id uuid,p_module_key text,p_idempotency_key text)
returns public.application_upgrade_runs language plpgsql security definer set search_path=public,pg_temp as $$
declare v_release public.company_application_releases;v_run public.application_upgrade_runs;
begin
  if auth.uid() is null or not public.auris_can_manage_company(p_company_id) then raise exception 'rollback authority denied' using errcode='42501'; end if;
  select * into v_run from public.application_upgrade_runs where company_id=p_company_id and module_key=p_module_key and idempotency_key=p_idempotency_key;if found then return v_run;end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_module_key,0));
  select * into v_release from public.company_application_releases where company_id=p_company_id and module_key=p_module_key for update;
  if not found or v_release.previous_version is null or v_release.migration_status<>'succeeded' then raise exception 'no safe rollback release is available' using errcode='55000'; end if;
  insert into public.application_upgrade_runs(company_id,module_key,from_version,to_version,status,activation_status,compatibility_snapshot,migration_plan,idempotency_key,initiated_by,completed_at)
  values(p_company_id,p_module_key,v_release.installed_version,v_release.previous_version,'rolled_back','paused',v_release.manifest_snapshot,'[]',p_idempotency_key,auth.uid(),now()) returning * into v_run;
  update public.company_application_releases set installed_version=v_release.previous_version,previous_version=v_release.installed_version,activation_status='paused',migration_status='rolled_back',updated_by=auth.uid(),updated_at=now() where company_id=p_company_id and module_key=p_module_key;
  return v_run;
end $$;

create or replace function public.record_application_health_event(
  p_company_id uuid,p_module_key text,p_event_type text,p_severity text,p_error_code text,
  p_safe_context jsonb default '{}'::jsonb,p_release_sha text default null
) returns public.application_health_events language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.application_health_events;
begin
  if auth.uid() is null or not public.auris_can_access_company(p_company_id) then raise exception 'health event company access denied' using errcode='42501'; end if;
  if p_module_key !~ '^[a-z][a-z0-9-]{0,62}$' or p_event_type not in ('module_failure','service_failure','workflow_failure','approval_backlog','performance_budget','accessibility_failure','migration_failure') or p_severity not in ('info','warning','critical') or p_error_code !~ '^[A-Z0-9_-]{1,48}$' then raise exception 'invalid health event identity' using errcode='22023'; end if;
  if jsonb_typeof(p_safe_context)<>'object' or octet_length(p_safe_context::text)>4096 or p_safe_context ?| array['token','password','secret','email','person','record','payload'] then raise exception 'unsafe health context rejected' using errcode='22023'; end if;
  insert into public.application_health_events(company_id,module_key,event_type,severity,error_code,safe_context,release_sha)
  values(p_company_id,p_module_key,p_event_type,p_severity,p_error_code,p_safe_context,nullif(left(p_release_sha,64),'')) returning * into v_row;
  return v_row;
end $$;

revoke all on function public.begin_application_upgrade(uuid,text,text,text,text,jsonb,jsonb,text) from public;
revoke all on function public.finish_application_upgrade(uuid,text,text) from public;
revoke all on function public.rollback_application_release(uuid,text,text) from public;
revoke all on function public.record_application_health_event(uuid,text,text,text,text,jsonb,text) from public;
grant execute on function public.begin_application_upgrade(uuid,text,text,text,text,jsonb,jsonb,text) to authenticated;
grant execute on function public.finish_application_upgrade(uuid,text,text) to authenticated;
grant execute on function public.rollback_application_release(uuid,text,text) to authenticated;
grant execute on function public.record_application_health_event(uuid,text,text,text,text,jsonb,text) to authenticated;
grant select on public.company_application_releases,public.application_upgrade_runs,public.application_migration_status,public.application_health_events to authenticated;

comment on table public.company_application_releases is 'Tenant-scoped installed application version, pilot activation and last safe rollback identity.';
comment on table public.application_upgrade_runs is 'Append-only application upgrade and rollback evidence with compatibility and migration plans.';
comment on table public.application_health_events is 'Bounded operational diagnostics; safe_context must never contain credentials, record payloads or personal data.';
