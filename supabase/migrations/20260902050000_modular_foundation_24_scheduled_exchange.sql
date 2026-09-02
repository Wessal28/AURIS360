-- AURIS360 Modular Foundation Phase 24: governed scheduled data exchange.
begin;

alter table public.integration_connections add column if not exists inbound_csv_enabled boolean not null default false;
alter table public.integration_connections add column if not exists source_approved_by uuid references public.profiles(id);
alter table public.integration_connections add column if not exists source_approved_at timestamptz;

create or replace function public.protect_integration_csv_source()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.endpoint_url is distinct from old.endpoint_url or new.approved_host is distinct from old.approved_host or new.credential_ref is distinct from old.credential_ref then new.inbound_csv_enabled:=false;new.source_approved_by:=null;new.source_approved_at:=null;end if;
  return new;
end;
$$;
drop trigger if exists protect_integration_csv_source on public.integration_connections;
create trigger protect_integration_csv_source before update on public.integration_connections for each row execute function public.protect_integration_csv_source();

create or replace function public.set_integration_csv_source(p_connection_id uuid,p_company_id uuid,p_enabled boolean,p_expected_revision integer)
returns setof public.integration_connections language plpgsql security definer set search_path=public as $$
declare actor public.profiles; saved public.integration_connections;
begin
  actor:=public.integration_require_admin(p_company_id);
  if actor.role<>'sephs_admin' then raise exception 'Only a SEPHS platform administrator may approve a scheduled CSV source'; end if;
  update public.integration_connections set inbound_csv_enabled=p_enabled,source_approved_by=case when p_enabled then actor.id else null end,source_approved_at=case when p_enabled then now() else null end,revision=revision+1,updated_by=actor.id,updated_at=now() where id=p_connection_id and company_id=p_company_id and revision=p_expected_revision and (not p_enabled or (status='active' and approved_host is not null and credential_ref is not null)) returning * into saved;
  if saved.id is null then raise exception 'CSV source changed, belongs to another company, or is not an approved active connection'; end if;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code) values(p_company_id,actor.id,actor.full_name,actor.role,case when p_enabled then 'integration_csv_source_enabled' else 'integration_csv_source_disabled' end,'integrations','integration_connections',saved.id,case when p_enabled then 'Approved connection enabled exclusively for scheduled CSV intake' else 'Scheduled CSV intake capability disabled' end,jsonb_build_object('revision',saved.revision,'approved_host',saved.approved_host),'integrations.csv_source_'||case when p_enabled then 'enabled' else 'disabled' end);
  return next saved;
end;
$$;

create or replace function public.skip_outbound_for_csv_source()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.integration_connections c where c.id=new.connection_id and c.company_id=new.company_id and c.inbound_csv_enabled) then return null;end if;
  return new;
end;
$$;
drop trigger if exists skip_outbound_for_csv_source on public.integration_deliveries;
create trigger skip_outbound_for_csv_source before insert on public.integration_deliveries for each row execute function public.skip_outbound_for_csv_source();

create table if not exists public.data_exchange_schedules (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check(char_length(trim(name)) between 3 and 100), connection_id uuid not null references public.integration_connections(id) on delete restrict,
  mapping_profile_id uuid not null references public.import_mapping_profiles(id) on delete restrict,
  cadence text not null check(cadence in ('every_15_minutes','hourly','daily','weekly')), timezone text not null default 'UTC' check(char_length(timezone) between 3 and 64),
  local_time time not null default '08:00', weekday integer not null default 1 check(weekday between 1 and 7), retry_limit integer not null default 3 check(retry_limit between 0 and 5),
  status text not null default 'draft' check(status in ('draft','pending_review','active','paused','rejected','blocked')),
  connection_revision integer, approved_host text, mapping_revision integer, mapping_fingerprint text,
  next_run_at timestamptz, last_planned_at timestamptz, last_health text check(last_health is null or last_health in ('healthy','degraded','blocked')),
  failure_count integer not null default 0 check(failure_count>=0), revision integer not null default 1 check(revision>0),
  created_by uuid not null references public.profiles(id), review_requested_by uuid references public.profiles(id), approved_by uuid references public.profiles(id), approved_at timestamptz,
  updated_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check((status<>'active') or (connection_revision>0 and mapping_revision>0 and char_length(mapping_fingerprint)=32 and next_run_at is not null))
);
create unique index if not exists data_exchange_schedules_company_name_idx on public.data_exchange_schedules(company_id,lower(name));
create index if not exists data_exchange_schedules_due_idx on public.data_exchange_schedules(status,next_run_at) where status='active';

create table if not exists public.data_exchange_runs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  schedule_id uuid not null references public.data_exchange_schedules(id) on delete restrict, scheduled_for timestamptz not null,
  idempotency_key text not null check(char_length(idempotency_key) between 16 and 160), status text not null default 'queued' check(status in ('queued','processing','retry','awaiting_review','failed','blocked')),
  attempt_count integer not null default 0 check(attempt_count between 0 and 6), next_attempt_at timestamptz not null default now(), lease_token uuid, locked_at timestamptz,
  batch_id uuid references public.data_import_batches(id) on delete restrict, row_count integer check(row_count between 1 and 500), error_code text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
  unique(company_id,idempotency_key), unique(batch_id)
);
create index if not exists data_exchange_runs_due_idx on public.data_exchange_runs(status,next_attempt_at) where status in ('queued','retry');
create index if not exists data_exchange_runs_company_idx on public.data_exchange_runs(company_id,created_at desc);
alter table public.data_import_batches add column if not exists exchange_run_id uuid references public.data_exchange_runs(id) on delete restrict;
create unique index if not exists data_import_batches_exchange_run_idx on public.data_import_batches(exchange_run_id) where exchange_run_id is not null;

alter table public.data_exchange_schedules enable row level security;
alter table public.data_exchange_runs enable row level security;
create policy data_exchange_schedules_company_admin on public.data_exchange_schedules for select using (exists(select 1 from public.profiles actor where actor.id=auth.uid() and (actor.role='sephs_admin' or (actor.company_id=data_exchange_schedules.company_id and actor.role in ('admin','company_admin','hse_manager')))));
create policy data_exchange_runs_company_admin on public.data_exchange_runs for select using (exists(select 1 from public.profiles actor where actor.id=auth.uid() and (actor.role='sephs_admin' or (actor.company_id=data_exchange_runs.company_id and actor.role in ('admin','company_admin','hse_manager')))));
revoke all on public.data_exchange_schedules,public.data_exchange_runs from public,anon;
grant select on public.data_exchange_schedules,public.data_exchange_runs to authenticated;

create or replace function public.next_data_exchange_run(p_cadence text,p_timezone text,p_local_time time,p_weekday integer,p_after timestamptz default now())
returns timestamptz language plpgsql stable set search_path=public as $$
declare local_after timestamp; candidate timestamp; days_ahead integer;
begin
  if p_cadence='every_15_minutes' then return date_trunc('minute',p_after)+interval '15 minutes'; end if;
  if p_cadence='hourly' then return date_trunc('hour',p_after)+interval '1 hour'; end if;
  local_after:=p_after at time zone p_timezone;
  if p_cadence='daily' then
    candidate:=local_after::date+p_local_time;
    if candidate<=local_after then candidate:=candidate+interval '1 day'; end if;
  elsif p_cadence='weekly' then
    days_ahead:=(p_weekday-extract(isodow from local_after)::integer+7)%7;
    candidate:=local_after::date+days_ahead+p_local_time;
    if candidate<=local_after then candidate:=candidate+interval '7 days'; end if;
  else raise exception 'Unsupported scheduled exchange cadence';
  end if;
  return candidate at time zone p_timezone;
exception when invalid_parameter_value then raise exception 'Schedule timezone is not recognized';
end;
$$;

create or replace function public.save_data_exchange_schedule(p_schedule_id uuid,p_company_id uuid,p_name text,p_connection_id uuid,p_mapping_profile_id uuid,p_cadence text,p_timezone text,p_local_time time,p_weekday integer,p_retry_limit integer,p_expected_revision integer)
returns setof public.data_exchange_schedules language plpgsql security definer set search_path=public as $$
declare actor public.profiles; current_row public.data_exchange_schedules; saved public.data_exchange_schedules;
begin
  actor:=public.integration_require_admin(p_company_id);
  if char_length(trim(coalesce(p_name,''))) not between 3 and 100 or p_cadence not in ('every_15_minutes','hourly','daily','weekly') or trim(coalesce(p_timezone,'')) !~ '^[A-Za-z_]+(/[A-Za-z0-9_+.-]+)*$' or p_weekday not between 1 and 7 or p_retry_limit not between 0 and 5 then raise exception 'Scheduled exchange definition is invalid'; end if;
  if not exists(select 1 from public.integration_connections c where c.id=p_connection_id and c.company_id=p_company_id and c.status='active' and c.inbound_csv_enabled) or not exists(select 1 from public.import_mapping_profiles m where m.id=p_mapping_profile_id and m.company_id=p_company_id and m.status='active') then raise exception 'Schedule requires approved inbound CSV connection and active company mapping dependencies'; end if;
  if p_schedule_id is null then
    insert into public.data_exchange_schedules(company_id,name,connection_id,mapping_profile_id,cadence,timezone,local_time,weekday,retry_limit,created_by,updated_by) values(p_company_id,trim(p_name),p_connection_id,p_mapping_profile_id,p_cadence,trim(p_timezone),p_local_time,p_weekday,p_retry_limit,actor.id,actor.id) returning * into saved;
  else
    select * into current_row from public.data_exchange_schedules where id=p_schedule_id and company_id=p_company_id and revision=p_expected_revision for update;
    if current_row.id is null then raise exception 'Schedule changed or belongs to another company'; end if;
    if current_row.status='pending_review' then raise exception 'A schedule pending review cannot be edited'; end if;
    if exists(select 1 from public.data_exchange_runs r where r.schedule_id=current_row.id and r.status in ('queued','processing','retry')) then raise exception 'Schedule cannot change while a run is queued or processing'; end if;
    update public.data_exchange_schedules set name=trim(p_name),connection_id=p_connection_id,mapping_profile_id=p_mapping_profile_id,cadence=p_cadence,timezone=trim(p_timezone),local_time=p_local_time,weekday=p_weekday,retry_limit=p_retry_limit,status='draft',connection_revision=null,approved_host=null,mapping_revision=null,mapping_fingerprint=null,next_run_at=null,review_requested_by=null,approved_by=null,approved_at=null,revision=revision+1,updated_by=actor.id,updated_at=now() where id=current_row.id returning * into saved;
  end if;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code) values(p_company_id,actor.id,actor.full_name,actor.role,'data_exchange_schedule_saved','integrations','data_exchange_schedules',saved.id,'Scheduled exchange saved as a non-executable draft',jsonb_build_object('cadence',saved.cadence,'timezone',saved.timezone,'revision',saved.revision),'integrations.schedule_saved');
  return next saved;
exception when unique_violation then raise exception 'A scheduled exchange with this name already exists for the company';
end;
$$;

create or replace function public.set_data_exchange_schedule_status(p_schedule_id uuid,p_company_id uuid,p_status text,p_expected_revision integer)
returns setof public.data_exchange_schedules language plpgsql security definer set search_path=public as $$
declare actor public.profiles; current_row public.data_exchange_schedules; source public.integration_connections; mapping public.import_mapping_profiles; saved public.data_exchange_schedules;
begin
  actor:=public.integration_require_admin(p_company_id);
  select * into current_row from public.data_exchange_schedules where id=p_schedule_id and company_id=p_company_id and revision=p_expected_revision for update;
  if current_row.id is null then raise exception 'Schedule changed or belongs to another company'; end if;
  if p_status='pending_review' and current_row.status not in ('draft','paused','rejected','blocked') then raise exception 'Only a controlled schedule draft may request review'; end if;
  if p_status in ('active','rejected') and current_row.status<>'pending_review' then raise exception 'Only a pending schedule may be decided'; end if;
  if p_status='paused' and current_row.status<>'active' then raise exception 'Only an active schedule may be paused'; end if;
  if p_status not in ('pending_review','active','rejected','paused') then raise exception 'Unsupported schedule governance status'; end if;
  if p_status in ('active','rejected') and current_row.review_requested_by=actor.id then raise exception 'The schedule requester cannot decide the same schedule'; end if;
  if p_status='paused' and exists(select 1 from public.data_exchange_runs r where r.schedule_id=current_row.id and r.status in ('processing','retry')) then raise exception 'Schedule cannot pause while a run is processing or retrying'; end if;
  if p_status='active' then
    select * into source from public.integration_connections where id=current_row.connection_id and company_id=p_company_id and status='active' and inbound_csv_enabled for share;
    select * into mapping from public.import_mapping_profiles where id=current_row.mapping_profile_id and company_id=p_company_id and status='active' for share;
    if source.id is null or mapping.id is null then raise exception 'Schedule dependencies are not active for this company'; end if;
  end if;
  update public.data_exchange_schedules set status=p_status,review_requested_by=case when p_status='pending_review' then actor.id else review_requested_by end,approved_by=case when p_status in ('active','rejected') then actor.id else approved_by end,approved_at=case when p_status='active' then now() else approved_at end,connection_revision=case when p_status='active' then source.revision else connection_revision end,approved_host=case when p_status='active' then source.approved_host else approved_host end,mapping_revision=case when p_status='active' then mapping.revision else mapping_revision end,mapping_fingerprint=case when p_status='active' then mapping.mapping_fingerprint else mapping_fingerprint end,next_run_at=case when p_status='active' then public.next_data_exchange_run(cadence,timezone,local_time,weekday,now()) when p_status='paused' then null else next_run_at end,last_health=case when p_status='active' then 'healthy' else last_health end,revision=revision+1,updated_by=actor.id,updated_at=now() where id=current_row.id returning * into saved;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code,outcome) values(p_company_id,actor.id,actor.full_name,actor.role,'data_exchange_schedule_'||p_status,'integrations','data_exchange_schedules',saved.id,'Scheduled exchange status changed to '||p_status,jsonb_build_object('revision',saved.revision,'mapping_revision',saved.mapping_revision,'connection_revision',saved.connection_revision),'integrations.schedule_'||p_status,case when p_status='rejected' then 'denied' else 'success' end);
  return next saved;
end;
$$;

create or replace function public.queue_data_exchange_run(p_schedule_id uuid,p_company_id uuid,p_expected_revision integer)
returns setof public.data_exchange_runs language plpgsql security definer set search_path=public as $$
declare actor public.profiles; schedule public.data_exchange_schedules; saved public.data_exchange_runs; planned timestamptz:=date_trunc('minute',now());
begin
  actor:=public.integration_require_admin(p_company_id);
  select * into schedule from public.data_exchange_schedules where id=p_schedule_id and company_id=p_company_id and revision=p_expected_revision and status='active' for share;
  if schedule.id is null then raise exception 'Only an exact active schedule may run now'; end if;
  insert into public.data_exchange_runs(company_id,schedule_id,scheduled_for,idempotency_key,next_attempt_at) values(p_company_id,schedule.id,planned,schedule.id::text||'/manual/'||planned::text,now()) on conflict(company_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning * into saved;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code) values(p_company_id,actor.id,actor.full_name,actor.role,'data_exchange_run_queued','integrations','data_exchange_runs',saved.id,'Manual scheduled exchange run queued idempotently',jsonb_build_object('schedule_id',schedule.id,'scheduled_for',planned),'integrations.run_queued');
  return next saved;
end;
$$;

create or replace function public.claim_due_data_exchange_runs(p_limit integer default 5,p_worker_id text default null)
returns table(run_id uuid,company_id uuid,schedule_id uuid,schedule_name text,schedule_revision integer,cadence text,timezone text,local_time time,weekday integer,retry_limit integer,attempt_count integer,lease_token uuid,connection_id uuid,connection_revision integer,endpoint_url text,approved_host text,credential_ref text,mapping_profile_id uuid,mapping_name text,mapping_revision integer,mapping_fingerprint text,operation text,field_map jsonb,value_map jsonb)
language plpgsql security definer set search_path=public as $$
declare due public.data_exchange_schedules; planned timestamptz;
begin
  for due in select * from public.data_exchange_schedules s where s.status='active' and s.next_run_at<=now() order by s.next_run_at for update skip locked limit 20 loop
    planned:=due.next_run_at;
    insert into public.data_exchange_runs(company_id,schedule_id,scheduled_for,idempotency_key,next_attempt_at) values(due.company_id,due.id,planned,due.id::text||'/scheduled/'||planned::text,now()) on conflict(company_id,idempotency_key) do nothing;
    update public.data_exchange_schedules set last_planned_at=planned,next_run_at=public.next_data_exchange_run(cadence,timezone,local_time,weekday,planned),updated_at=now() where id=due.id;
  end loop;
  update public.data_exchange_schedules s set status='blocked',last_health='blocked',revision=revision+1,updated_at=now() where s.status='active' and (not exists(select 1 from public.integration_connections c where c.id=s.connection_id and c.company_id=s.company_id and c.status='active' and c.inbound_csv_enabled and c.revision=s.connection_revision and c.approved_host=s.approved_host) or not exists(select 1 from public.import_mapping_profiles m where m.id=s.mapping_profile_id and m.company_id=s.company_id and m.status='active' and m.revision=s.mapping_revision and m.mapping_fingerprint=s.mapping_fingerprint));
  update public.data_exchange_runs r set status='blocked',error_code='dependency_revision_changed',updated_at=now() from public.data_exchange_schedules s where r.schedule_id=s.id and s.status='blocked' and r.status in ('queued','retry');
  return query with candidates as (select r.id from public.data_exchange_runs r join public.data_exchange_schedules s on s.id=r.schedule_id and s.company_id=r.company_id join public.integration_connections c on c.id=s.connection_id and c.company_id=s.company_id and c.status='active' and c.inbound_csv_enabled and c.revision=s.connection_revision and c.approved_host=s.approved_host join public.import_mapping_profiles m on m.id=s.mapping_profile_id and m.company_id=s.company_id and m.status='active' and m.revision=s.mapping_revision and m.mapping_fingerprint=s.mapping_fingerprint where s.status='active' and r.status in ('queued','retry') and r.next_attempt_at<=now() and (r.locked_at is null or r.locked_at<now()-interval '15 minutes') order by r.next_attempt_at,r.created_at for update of r skip locked limit greatest(1,least(coalesce(p_limit,5),10))), claimed as (update public.data_exchange_runs r set status='processing',attempt_count=r.attempt_count+1,lease_token=gen_random_uuid(),locked_at=now(),updated_at=now() from candidates x where r.id=x.id returning r.*)
  select r.id,r.company_id,s.id,s.name,s.revision,s.cadence,s.timezone,s.local_time,s.weekday,s.retry_limit,r.attempt_count,r.lease_token,c.id,c.revision,c.endpoint_url,s.approved_host,c.credential_ref,m.id,m.name,m.revision,m.mapping_fingerprint,m.operation,m.field_map,m.value_map from claimed r join public.data_exchange_schedules s on s.id=r.schedule_id join public.integration_connections c on c.id=s.connection_id and c.company_id=s.company_id and c.status='active' and c.inbound_csv_enabled and c.revision=s.connection_revision and c.approved_host=s.approved_host join public.import_mapping_profiles m on m.id=s.mapping_profile_id and m.company_id=s.company_id and m.status='active' and m.revision=s.mapping_revision and m.mapping_fingerprint=s.mapping_fingerprint;
end;
$$;

create or replace function public.stage_scheduled_exchange_run(p_run_id uuid,p_lease_token uuid,p_schedule_revision integer,p_mapping_revision integer,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare run public.data_exchange_runs; schedule public.data_exchange_schedules; mapping public.import_mapping_profiles; item jsonb; target public.action_tracker; saved public.data_import_batches; clean jsonb; before_value jsonb; row_number integer:=0; ref text; target_id uuid; expected_time timestamptz; seen_refs text[]:=array[]::text[]; seen_ids uuid[]:=array[]::uuid[]; fingerprint text;
begin
  select * into run from public.data_exchange_runs where id=p_run_id and lease_token=p_lease_token and status='processing' for update;
  if run.id is null then raise exception 'Scheduled exchange run lease is invalid or expired'; end if;
  select * into schedule from public.data_exchange_schedules where id=run.schedule_id and company_id=run.company_id and status='active' and revision=p_schedule_revision for share;
  if schedule.id is null then raise exception 'Scheduled exchange changed or is no longer active'; end if;
  select * into mapping from public.import_mapping_profiles where id=schedule.mapping_profile_id and company_id=run.company_id and status='active' and revision=p_mapping_revision and revision=schedule.mapping_revision and mapping_fingerprint=schedule.mapping_fingerprint for share;
  if mapping.id is null or not exists(select 1 from public.integration_connections c where c.id=schedule.connection_id and c.company_id=run.company_id and c.status='active' and c.inbound_csv_enabled and c.revision=schedule.connection_revision and c.approved_host=schedule.approved_host) then raise exception 'Scheduled exchange dependencies changed after approval'; end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 or octet_length(p_rows::text)>1048576 then raise exception 'Scheduled exchange requires 1 to 500 reviewed rows within 1 MiB'; end if;
  fingerprint:=md5(run.id::text||':'||p_rows::text);
  insert into public.data_import_batches(company_id,operation,row_count,payload_fingerprint,requested_by,mapping_profile_id,mapping_revision,mapping_fingerprint,exchange_run_id,status) values(run.company_id,mapping.operation,jsonb_array_length(p_rows),fingerprint,schedule.created_by,mapping.id,mapping.revision,mapping.mapping_fingerprint,run.id,'pending_review') returning * into saved;
  for item in select value from jsonb_array_elements(p_rows) loop
    row_number:=row_number+1;
    if mapping.operation='create' then
      ref:=left(trim(coalesce(item->>'action_ref','')),160);
      if ref='' or lower(ref)=any(seen_refs) or exists(select 1 from public.action_tracker where company_id=run.company_id and lower(action_ref)=lower(ref)) then raise exception 'Scheduled import contains a missing, duplicate or existing action reference at row %',row_number; end if;
      if coalesce(item->>'status','open') not in ('open','in_progress','overdue','closed') or coalesce(item->>'priority','medium') not in ('low','medium','high','critical') then raise exception 'Scheduled import contains an invalid controlled value at row %',row_number; end if;
      if coalesce(item->>'target_date','')<>'' and (item->>'target_date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Scheduled import contains an invalid target date at row %',row_number; end if;
      clean:=jsonb_build_object('action_ref',ref,'title',left(trim(coalesce(item->>'title','')),500),'description',left(trim(coalesce(item->>'description','')),2000),'status',coalesce(item->>'status','open'),'priority',coalesce(item->>'priority','medium'),'target_date',nullif(item->>'target_date',''));
      insert into public.data_import_rows(batch_id,company_id,row_no,operation,source_data,row_fingerprint) values(saved.id,run.company_id,row_number,'create',clean,md5(clean::text)); seen_refs:=array_append(seen_refs,lower(ref));
    else
      begin target_id:=(item->>'record_id')::uuid; expected_time:=(item->>'expected_updated_at')::timestamptz; exception when others then raise exception 'Scheduled reconciliation row % has invalid identity or revision',row_number; end;
      if target_id=any(seen_ids) then raise exception 'Scheduled reconciliation repeats target row %',row_number; end if;
      select * into target from public.action_tracker where id=target_id and company_id=run.company_id for share;
      if target.id is null or target.action_ref is distinct from left(trim(coalesce(item->>'action_ref','')),160) or target.updated_at is distinct from expected_time then raise exception 'Scheduled reconciliation row % is not the exact current company action',row_number; end if;
      if coalesce(item->>'status',target.status) not in ('open','in_progress','overdue','closed') or coalesce(item->>'priority',target.priority) not in ('low','medium','high','critical') then raise exception 'Scheduled reconciliation row % contains an invalid controlled value',row_number; end if;
      if coalesce(item->>'target_date','')<>'' and (item->>'target_date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Scheduled reconciliation row % contains an invalid target date',row_number; end if;
      clean:=jsonb_build_object('record_id',target.id,'action_ref',target.action_ref,'expected_updated_at',target.updated_at,'title',left(trim(coalesce(item->>'title','')),500),'description',left(trim(coalesce(item->>'description','')),2000),'status',coalesce(item->>'status',target.status),'priority',coalesce(item->>'priority',target.priority),'target_date',nullif(item->>'target_date',''));
      before_value:=jsonb_build_object('title',target.title,'description',target.description,'status',target.status,'priority',target.priority,'target_date',target.target_date,'updated_at',target.updated_at);
      insert into public.data_import_rows(batch_id,company_id,row_no,operation,target_record_id,expected_updated_at,source_data,before_data,row_fingerprint) values(saved.id,run.company_id,row_number,'update',target.id,target.updated_at,clean,before_value,md5(clean::text)); seen_ids:=array_append(seen_ids,target.id);
    end if;
  end loop;
  update public.data_exchange_runs set status='awaiting_review',batch_id=saved.id,row_count=saved.row_count,lease_token=null,locked_at=null,completed_at=now(),updated_at=now() where id=run.id;
  update public.data_exchange_schedules set failure_count=0,last_health='healthy',updated_at=now() where id=schedule.id;
  insert into public.audit_events(company_id,actor_user_id,action,module_name,related_table,related_id,summary,details,event_code) values(run.company_id,schedule.created_by,'scheduled_data_batch_staged','integrations','data_import_batches',saved.id,'Scheduled source staged for independent batch approval',jsonb_build_object('run_id',run.id,'schedule_id',schedule.id,'mapping_revision',mapping.revision,'row_count',saved.row_count),'integrations.scheduled_batch_staged');
  return jsonb_build_object('run_id',run.id,'batch_id',saved.id,'status','awaiting_review','row_count',saved.row_count);
end;
$$;

create or replace function public.fail_scheduled_exchange_run(p_run_id uuid,p_lease_token uuid,p_error_code text,p_transient boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare run public.data_exchange_runs; schedule public.data_exchange_schedules; final_status text; delay_minutes integer;
begin
  select * into run from public.data_exchange_runs where id=p_run_id and lease_token=p_lease_token and status='processing' for update;
  if run.id is null then raise exception 'Scheduled exchange failure lease is invalid or expired'; end if;
  select * into schedule from public.data_exchange_schedules where id=run.schedule_id for update;
  final_status:=case when p_transient and run.attempt_count<schedule.retry_limit then 'retry' when p_error_code in ('credential_unavailable','endpoint_not_approved','endpoint_not_public','redirect_blocked','unsupported_content_type','source_body_unavailable','source_too_large') then 'blocked' else 'failed' end;
  delay_minutes:=least(60,power(2,greatest(0,run.attempt_count-1))::integer*5);
  update public.data_exchange_runs set status=final_status,error_code=left(coalesce(p_error_code,'controlled_failure'),80),next_attempt_at=case when final_status='retry' then now()+make_interval(mins=>delay_minutes) else next_attempt_at end,lease_token=null,locked_at=null,updated_at=now() where id=run.id;
  update public.data_exchange_schedules set failure_count=failure_count+1,last_health=case when final_status='blocked' then 'blocked' else 'degraded' end,status=case when final_status='blocked' then 'blocked' else status end,revision=case when final_status='blocked' then revision+1 else revision end,updated_at=now() where id=schedule.id;
  insert into public.audit_events(company_id,action,module_name,related_table,related_id,summary,details,event_code,outcome) values(run.company_id,'scheduled_data_exchange_'||final_status,'integrations','data_exchange_runs',run.id,'Scheduled exchange completed as '||final_status,jsonb_build_object('schedule_id',run.schedule_id,'attempt_count',run.attempt_count,'error_code',left(p_error_code,80)),'integrations.scheduled_'||final_status,case when final_status='retry' then 'partial' else 'failed' end);
  return jsonb_build_object('run_id',run.id,'status',final_status,'attempt_count',run.attempt_count);
end;
$$;

revoke all on function public.save_data_exchange_schedule(uuid,uuid,text,uuid,uuid,text,text,time,integer,integer,integer) from public,anon;
revoke all on function public.next_data_exchange_run(text,text,time,integer,timestamptz) from public,anon,authenticated;
revoke all on function public.protect_integration_csv_source() from public,anon,authenticated;
revoke all on function public.skip_outbound_for_csv_source() from public,anon,authenticated;
revoke all on function public.set_integration_csv_source(uuid,uuid,boolean,integer) from public,anon;
revoke all on function public.set_data_exchange_schedule_status(uuid,uuid,text,integer) from public,anon;
revoke all on function public.queue_data_exchange_run(uuid,uuid,integer) from public,anon;
revoke all on function public.claim_due_data_exchange_runs(integer,text) from public,anon,authenticated;
revoke all on function public.stage_scheduled_exchange_run(uuid,uuid,integer,integer,jsonb) from public,anon,authenticated;
revoke all on function public.fail_scheduled_exchange_run(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.save_data_exchange_schedule(uuid,uuid,text,uuid,uuid,text,text,time,integer,integer,integer) to authenticated;
grant execute on function public.set_integration_csv_source(uuid,uuid,boolean,integer) to authenticated;
grant execute on function public.set_data_exchange_schedule_status(uuid,uuid,text,integer) to authenticated;
grant execute on function public.queue_data_exchange_run(uuid,uuid,integer) to authenticated;
grant execute on function public.claim_due_data_exchange_runs(integer,text) to service_role;
grant execute on function public.stage_scheduled_exchange_run(uuid,uuid,integer,integer,jsonb) to service_role;
grant execute on function public.fail_scheduled_exchange_run(uuid,uuid,text,boolean) to service_role;

commit;
