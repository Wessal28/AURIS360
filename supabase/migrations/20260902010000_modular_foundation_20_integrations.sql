-- AURIS360 Modular Foundation Phase 20: governed integrations and data exchange.
begin;

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check(char_length(name) between 1 and 100),
  provider text not null default 'webhook' check(provider='webhook'),
  endpoint_url text not null check(char_length(endpoint_url) between 12 and 500),
  approved_host text,
  credential_ref text,
  event_types text[] not null default array['action.updated']::text[],
  status text not null default 'draft' check(status in ('draft','pending_review','active','paused','blocked')),
  failure_count integer not null default 0 check(failure_count>=0),
  last_health text check(last_health is null or last_health in ('healthy','degraded','blocked')),
  last_delivery_at timestamptz,
  revision integer not null default 1 check(revision>0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  check(cardinality(event_types) between 1 and 20),
  check(event_types <@ array['action.updated','incident.updated','permit.updated','document.updated']::text[])
);
create index if not exists integration_connections_company_idx on public.integration_connections(company_id,updated_at desc);

create table if not exists public.integration_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  event_type text not null check(event_type in ('action.updated','incident.updated','permit.updated','document.updated')),
  event_key text not null check(char_length(event_key) between 1 and 160),
  source_module text not null,
  source_table text not null,
  source_record_id uuid not null,
  source_ref text,
  payload jsonb not null,
  payload_fingerprint text not null check(char_length(payload_fingerprint)=32),
  status text not null default 'pending' check(status in ('pending','processing','retry','delivered','failed','blocked')),
  attempt_count integer not null default 0 check(attempt_count between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  locked_at timestamptz,
  response_code integer,
  error_code text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id,event_key)
);
create index if not exists integration_deliveries_due_idx on public.integration_deliveries(status,next_attempt_at) where status in ('pending','retry');
create index if not exists integration_deliveries_company_idx on public.integration_deliveries(company_id,created_at desc);

create table if not exists public.data_exchange_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  direction text not null check(direction in ('import','export')),
  module_key text not null check(module_key in ('actions','incidents')),
  format text not null check(format='csv'),
  mode text not null check(mode in ('dry_run','completed','rejected')),
  row_count integer not null default 0 check(row_count between 0 and 1000),
  rejected_count integer not null default 0 check(rejected_count between 0 and 1000),
  requested_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists data_exchange_batches_company_idx on public.data_exchange_batches(company_id,created_at desc);

alter table public.integration_connections enable row level security;
alter table public.integration_deliveries enable row level security;
alter table public.data_exchange_batches enable row level security;
drop policy if exists integration_connections_company_admin on public.integration_connections;
create policy integration_connections_company_admin on public.integration_connections for select using (
  exists(select 1 from public.profiles actor where actor.id=auth.uid() and (actor.role='sephs_admin' or (actor.company_id=integration_connections.company_id and actor.role in ('admin','company_admin','hse_manager'))))
);
drop policy if exists integration_deliveries_company_admin on public.integration_deliveries;
create policy integration_deliveries_company_admin on public.integration_deliveries for select using (
  exists(select 1 from public.profiles actor where actor.id=auth.uid() and (actor.role='sephs_admin' or (actor.company_id=integration_deliveries.company_id and actor.role in ('admin','company_admin','hse_manager'))))
);
drop policy if exists data_exchange_batches_company_admin on public.data_exchange_batches;
create policy data_exchange_batches_company_admin on public.data_exchange_batches for select using (
  exists(select 1 from public.profiles actor where actor.id=auth.uid() and (actor.role='sephs_admin' or (actor.company_id=data_exchange_batches.company_id and actor.role in ('admin','company_admin','hse_manager'))))
);
revoke all on public.integration_connections,public.integration_deliveries,public.data_exchange_batches from public,anon;
grant select on public.integration_connections,public.integration_deliveries,public.data_exchange_batches to authenticated;

create or replace function public.integration_require_admin(p_company_id uuid)
returns public.profiles language plpgsql security definer set search_path=public as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles where id=auth.uid();
  if actor.id is null or not(actor.role='sephs_admin' or (actor.company_id=p_company_id and actor.role in ('admin','company_admin','hse_manager'))) then raise exception 'Integration administration is not permitted for this company'; end if;
  return actor;
end;
$$;

create or replace function public.save_integration_connection(p_connection_id uuid,p_company_id uuid,p_name text,p_endpoint_url text,p_event_types text[],p_expected_revision integer)
returns setof public.integration_connections language plpgsql security definer set search_path=public as $$
declare actor public.profiles; saved public.integration_connections; host_value text; endpoint_changed boolean:=false;
begin
  actor:=public.integration_require_admin(p_company_id);
  host_value:=lower(substring(trim(p_endpoint_url) from '^https://([^/:?#]+)(?::443)?(?:[/?#]|$)'));
  if host_value is null or position('.' in host_value)=0 or host_value='localhost' or host_value like '%.local' or host_value ~ '^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)' or trim(p_endpoint_url) ~ '^https://[^/]*@' then raise exception 'Webhook endpoint must be a public HTTPS URL without credentials or a custom port'; end if;
  if char_length(trim(coalesce(p_name,''))) not between 1 and 100 or cardinality(p_event_types) not between 1 and 20 or not(p_event_types <@ array['action.updated','incident.updated','permit.updated','document.updated']::text[]) then raise exception 'Invalid integration definition'; end if;
  if p_connection_id is null then
    insert into public.integration_connections(company_id,name,endpoint_url,event_types,created_by,updated_by)
    values(p_company_id,trim(p_name),trim(p_endpoint_url),p_event_types,actor.id,actor.id) returning * into saved;
  else
    select endpoint_url<>trim(p_endpoint_url) into endpoint_changed from public.integration_connections where id=p_connection_id and company_id=p_company_id;
    update public.integration_connections set name=trim(p_name),endpoint_url=trim(p_endpoint_url),event_types=p_event_types,status=case when endpoint_changed then 'draft' else status end,approved_host=case when endpoint_changed then null else approved_host end,credential_ref=case when endpoint_changed then null else credential_ref end,revision=revision+1,updated_by=actor.id,updated_at=now()
    where id=p_connection_id and company_id=p_company_id and revision=p_expected_revision returning * into saved;
    if saved.id is null then raise exception 'Integration changed or belongs to another company'; end if;
  end if;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code)
  values(p_company_id,actor.id,actor.full_name,actor.role,'integration_connection_saved','integrations','integration_connections',saved.id,'Integration connection draft saved',jsonb_build_object('status',saved.status,'revision',saved.revision,'event_types',saved.event_types),'integrations.connection_saved');
  return next saved;
end;
$$;

create or replace function public.set_integration_connection_status(p_connection_id uuid,p_company_id uuid,p_status text,p_expected_revision integer,p_approved_host text default null,p_credential_ref text default null)
returns setof public.integration_connections language plpgsql security definer set search_path=public as $$
declare actor public.profiles; saved public.integration_connections; host_value text;
begin
  actor:=public.integration_require_admin(p_company_id);
  if p_status not in ('pending_review','active','paused','blocked') then raise exception 'Unsupported integration status'; end if;
  if p_status in ('active','blocked') and actor.role<>'sephs_admin' then raise exception 'Only a SEPHS platform administrator may approve or block an integration'; end if;
  if p_status='active' then
    select lower(substring(endpoint_url from '^https://([^/:?#]+)(?::443)?(?:[/?#]|$)')) into host_value from public.integration_connections where id=p_connection_id and company_id=p_company_id;
    if host_value is null or lower(trim(coalesce(p_approved_host,'')))<>host_value or trim(coalesce(p_credential_ref,'')) !~ '^[A-Za-z0-9_.-]{3,100}$' then raise exception 'Activation requires the exact reviewed host and a provisioned credential reference'; end if;
  end if;
  update public.integration_connections set status=p_status,approved_host=case when p_status='active' then lower(trim(p_approved_host)) else approved_host end,credential_ref=case when p_status='active' then trim(p_credential_ref) else credential_ref end,last_health=case when p_status='blocked' then 'blocked' when p_status='active' then 'healthy' else last_health end,revision=revision+1,updated_by=actor.id,updated_at=now()
  where id=p_connection_id and company_id=p_company_id and revision=p_expected_revision returning * into saved;
  if saved.id is null then raise exception 'Integration changed or belongs to another company'; end if;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code,outcome)
  values(p_company_id,actor.id,actor.full_name,actor.role,'integration_connection_'||p_status,'integrations','integration_connections',saved.id,'Integration status changed to '||p_status,jsonb_build_object('revision',saved.revision,'approved_host',saved.approved_host),'integrations.connection_'||p_status,case when p_status='blocked' then 'denied' else 'success' end);
  return next saved;
end;
$$;

create or replace function public.queue_integration_event(p_company_id uuid,p_event_type text,p_event_key text,p_source_module text,p_source_table text,p_source_record_id uuid,p_source_ref text,p_payload jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare connection_row public.integration_connections; queued integer:=0; source_ok boolean:=false;
begin
  if p_event_type='action.updated' and p_source_module='actions' and p_source_table='action_tracker' then select exists(select 1 from public.action_tracker where id=p_source_record_id and company_id=p_company_id) into source_ok;
  elsif p_event_type='incident.updated' and p_source_module='events' and p_source_table='events' then select exists(select 1 from public.events where id=p_source_record_id and company_id=p_company_id) into source_ok;
  elsif p_event_type='permit.updated' and p_source_module='permit' and p_source_table='permits' then select exists(select 1 from public.permits where id=p_source_record_id and company_id=p_company_id) into source_ok;
  elsif p_event_type='document.updated' and p_source_module='documents' and p_source_table='documents' then select exists(select 1 from public.documents where id=p_source_record_id and company_id=p_company_id) into source_ok;
  end if;
  if not source_ok or char_length(coalesce(p_event_key,'')) not between 1 and 160 or (p_payload->>'company_id') is distinct from p_company_id::text or (p_payload->'source'->>'id') is distinct from p_source_record_id::text or octet_length(p_payload::text)>262144 then raise exception 'Integration event failed its reviewed source contract'; end if;
  for connection_row in select * from public.integration_connections where company_id=p_company_id and status='active' and p_event_type=any(event_types) loop
    insert into public.integration_deliveries(company_id,connection_id,event_type,event_key,source_module,source_table,source_record_id,source_ref,payload,payload_fingerprint)
    values(p_company_id,connection_row.id,p_event_type,p_event_key,p_source_module,p_source_table,p_source_record_id,left(p_source_ref,160),p_payload,md5(p_payload::text)) on conflict(connection_id,event_key) do nothing;
    if found then queued:=queued+1; end if;
  end loop;
  if queued>0 then insert into public.audit_events(company_id,action,module_name,related_table,related_id,related_ref,summary,details,event_code) values(p_company_id,'integration_event_queued','integrations',p_source_table,p_source_record_id,left(p_source_ref,160),'Reviewed integration event queued',jsonb_build_object('event_type',p_event_type,'delivery_count',queued),'integrations.event_queued'); end if;
  return queued;
end;
$$;

create or replace function public.claim_integration_deliveries(p_limit integer default 25,p_worker_id text default null)
returns table(id uuid,company_id uuid,connection_id uuid,event_type text,event_key text,payload jsonb,endpoint_url text,approved_host text,credential_ref text,lease_token uuid,attempt_count integer)
language plpgsql security definer set search_path=public as $$
begin
  return query with candidates as (
    select d.id from public.integration_deliveries d join public.integration_connections c on c.id=d.connection_id and c.company_id=d.company_id
    where c.status='active' and d.status in ('pending','retry') and d.next_attempt_at<=now() and (d.locked_at is null or d.locked_at<now()-interval '10 minutes')
    order by d.next_attempt_at,d.created_at for update of d skip locked limit greatest(1,least(coalesce(p_limit,25),50))
  ), claimed as (
    update public.integration_deliveries d set status='processing',attempt_count=d.attempt_count+1,lease_token=gen_random_uuid(),locked_at=now(),updated_at=now() from candidates x where d.id=x.id
    returning d.*
  ) select d.id,d.company_id,d.connection_id,d.event_type,d.event_key,d.payload,c.endpoint_url,c.approved_host,c.credential_ref,d.lease_token,d.attempt_count from claimed d join public.integration_connections c on c.id=d.connection_id;
end;
$$;

create or replace function public.complete_integration_delivery(p_delivery_id uuid,p_lease_token uuid,p_status text,p_response_code integer default null,p_error_code text default null,p_transient boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare delivery public.integration_deliveries; final_status text; delay_minutes integer;
begin
  select * into delivery from public.integration_deliveries where id=p_delivery_id and lease_token=p_lease_token and status='processing' for update;
  if delivery.id is null then raise exception 'Integration delivery lease is invalid or expired'; end if;
  final_status:=case when p_status='delivered' then 'delivered' when p_status='blocked' then 'blocked' when p_transient and delivery.attempt_count<5 then 'retry' else 'failed' end;
  delay_minutes:=least(60,power(2,greatest(0,delivery.attempt_count-1))::integer);
  update public.integration_deliveries set status=final_status,response_code=p_response_code,error_code=left(p_error_code,80),next_attempt_at=case when final_status='retry' then now()+make_interval(mins=>delay_minutes) else next_attempt_at end,delivered_at=case when final_status='delivered' then now() else delivered_at end,lease_token=null,locked_at=null,updated_at=now() where id=delivery.id;
  update public.integration_connections set failure_count=case when final_status='delivered' then 0 else failure_count+1 end,last_health=case when final_status='delivered' then 'healthy' when final_status='blocked' then 'blocked' else 'degraded' end,last_delivery_at=case when final_status='delivered' then now() else last_delivery_at end,updated_at=now() where id=delivery.connection_id and company_id=delivery.company_id;
  insert into public.audit_events(company_id,action,module_name,related_table,related_id,related_ref,summary,details,event_code,outcome)
  values(delivery.company_id,'integration_delivery_'||final_status,'integrations',delivery.source_table,delivery.source_record_id,delivery.source_ref,'Integration delivery completed as '||final_status,jsonb_build_object('delivery_id',delivery.id,'event_type',delivery.event_type,'attempt_count',delivery.attempt_count,'response_code',p_response_code,'error_code',left(p_error_code,80)),'integrations.delivery_'||final_status,case when final_status='delivered' then 'success' when final_status='retry' then 'partial' else 'failed' end);
  return jsonb_build_object('id',delivery.id,'status',final_status,'attempt_count',delivery.attempt_count);
end;
$$;

create or replace function public.record_data_exchange_batch(p_company_id uuid,p_direction text,p_module_key text,p_format text,p_row_count integer,p_rejected_count integer,p_mode text)
returns setof public.data_exchange_batches language plpgsql security definer set search_path=public as $$
declare actor public.profiles; saved public.data_exchange_batches;
begin
  actor:=public.integration_require_admin(p_company_id);
  if p_direction not in ('import','export') or p_module_key not in ('actions','incidents') or p_format<>'csv' or p_mode not in ('dry_run','completed','rejected') or p_row_count not between 0 and 1000 or p_rejected_count not between 0 and 1000 then raise exception 'Invalid data exchange evidence'; end if;
  if p_direction='import' and p_mode<>'dry_run' then raise exception 'Phase 20 imports are validation-only and cannot mutate source records'; end if;
  insert into public.data_exchange_batches(company_id,direction,module_key,format,mode,row_count,rejected_count,requested_by) values(p_company_id,p_direction,p_module_key,p_format,p_mode,p_row_count,p_rejected_count,actor.id) returning * into saved;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code)
  values(p_company_id,actor.id,actor.full_name,actor.role,'data_exchange_'||p_direction,'integrations','data_exchange_batches',saved.id,'Controlled data exchange recorded',jsonb_build_object('module_key',p_module_key,'format',p_format,'mode',p_mode,'row_count',p_row_count,'rejected_count',p_rejected_count),'integrations.data_'||p_direction);
  return next saved;
end;
$$;

revoke all on function public.integration_require_admin(uuid) from public,anon,authenticated;
revoke all on function public.save_integration_connection(uuid,uuid,text,text,text[],integer) from public,anon;
revoke all on function public.set_integration_connection_status(uuid,uuid,text,integer,text,text) from public,anon;
revoke all on function public.queue_integration_event(uuid,text,text,text,text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.claim_integration_deliveries(integer,text) from public,anon,authenticated;
revoke all on function public.complete_integration_delivery(uuid,uuid,text,integer,text,boolean) from public,anon,authenticated;
revoke all on function public.record_data_exchange_batch(uuid,text,text,text,integer,integer,text) from public,anon;
grant execute on function public.save_integration_connection(uuid,uuid,text,text,text[],integer) to authenticated;
grant execute on function public.set_integration_connection_status(uuid,uuid,text,integer,text,text) to authenticated;
grant execute on function public.record_data_exchange_batch(uuid,text,text,text,integer,integer,text) to authenticated;
grant execute on function public.queue_integration_event(uuid,text,text,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.claim_integration_deliveries(integer,text) to service_role;
grant execute on function public.complete_integration_delivery(uuid,uuid,text,integer,text,boolean) to service_role;

commit;
