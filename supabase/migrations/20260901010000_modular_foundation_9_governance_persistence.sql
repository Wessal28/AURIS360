-- AURIS360 Modular Foundation 9: durable tenant workflow and approval governance.
-- This migration preserves the existing Approval Centre tables while adding the
-- versioned policy and atomic decision contracts used by the shared services.

create table if not exists public.workflow_policy_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  module_key text not null,
  version integer not null,
  status text not null default 'draft',
  revision integer not null default 1,
  policy jsonb not null,
  supersedes_id uuid null references public.workflow_policy_versions(id) on delete set null,
  created_by uuid null default auth.uid(),
  published_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz null,
  constraint workflow_policy_versions_status_check check (status in ('draft','published','archived')),
  constraint workflow_policy_versions_version_check check (version > 0),
  constraint workflow_policy_versions_revision_check check (revision > 0),
  constraint workflow_policy_versions_policy_object_check check (jsonb_typeof(policy) = 'object'),
  unique (company_id,module_key,version)
);

create unique index if not exists ux_workflow_policy_one_published
  on public.workflow_policy_versions(company_id,module_key)
  where status = 'published';
create index if not exists idx_workflow_policy_company_module_history
  on public.workflow_policy_versions(company_id,module_key,version desc);

create table if not exists public.workflow_policy_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  module_key text not null,
  policy_id uuid not null references public.workflow_policy_versions(id) on delete restrict,
  event_type text not null,
  actor_user_id uuid null default auth.uid(),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint workflow_policy_events_type_check check (event_type in ('draft_created','published','archived','rolled_back'))
);

create index if not exists idx_workflow_policy_events_company_created
  on public.workflow_policy_events(company_id,created_at desc);

alter table public.workflow_policy_versions enable row level security;
alter table public.workflow_policy_events enable row level security;

drop policy if exists workflow_policy_versions_select_company on public.workflow_policy_versions;
create policy workflow_policy_versions_select_company
on public.workflow_policy_versions for select
using (exists (
  select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or p.company_id=workflow_policy_versions.company_id)
));

drop policy if exists workflow_policy_versions_manage_company on public.workflow_policy_versions;
create policy workflow_policy_versions_manage_company
on public.workflow_policy_versions for all
using (exists (
  select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=workflow_policy_versions.company_id and p.role in ('admin','hse_manager')))
))
with check (exists (
  select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=workflow_policy_versions.company_id and p.role in ('admin','hse_manager')))
));

drop policy if exists workflow_policy_events_select_company on public.workflow_policy_events;
create policy workflow_policy_events_select_company
on public.workflow_policy_events for select
using (exists (
  select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or p.company_id=workflow_policy_events.company_id)
));

drop policy if exists workflow_policy_events_insert_manager on public.workflow_policy_events;
create policy workflow_policy_events_insert_manager
on public.workflow_policy_events for insert
with check (exists (
  select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=workflow_policy_events.company_id and p.role in ('admin','hse_manager')))
));

create or replace function public.auris_can_access_company(p_company_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=p_company_id));
$$;

create or replace function public.auris_can_manage_company(p_company_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=p_company_id and p.role in ('admin','hse_manager'))));
$$;

create or replace function public.create_workflow_policy_draft(
  p_company_id uuid,p_module_key text,p_policy jsonb,p_expected_revision integer default null
) returns setof public.workflow_policy_versions
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_version integer;v_active_revision integer;v_row public.workflow_policy_versions;
begin
  if not public.auris_can_manage_company(p_company_id) then raise exception 'AURIS_WORKFLOW_MANAGE_DENIED' using errcode='42501';end if;
  if nullif(trim(p_module_key),'') is null or jsonb_typeof(p_policy)<>'object' then raise exception 'AURIS_WORKFLOW_INVALID_POLICY' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_module_key,0));
  select revision into v_active_revision from public.workflow_policy_versions where company_id=p_company_id and module_key=p_module_key and status='published';
  if p_expected_revision is not null and coalesce(v_active_revision,0)<>p_expected_revision then raise exception 'AURIS_WORKFLOW_REVISION_CONFLICT' using errcode='40001';end if;
  select coalesce(max(version),0)+1 into v_version from public.workflow_policy_versions where company_id=p_company_id and module_key=p_module_key;
  insert into public.workflow_policy_versions(company_id,module_key,version,status,policy,created_by)
  values(p_company_id,p_module_key,v_version,'draft',p_policy,auth.uid()) returning * into v_row;
  insert into public.workflow_policy_events(company_id,module_key,policy_id,event_type,details)
  values(p_company_id,p_module_key,v_row.id,'draft_created',jsonb_build_object('version',v_row.version));
  return next v_row;
end;$$;

create or replace function public.publish_workflow_policy(
  p_company_id uuid,p_module_key text,p_policy_id uuid,p_expected_revision integer default null
) returns setof public.workflow_policy_versions
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_target public.workflow_policy_versions;v_previous public.workflow_policy_versions;
begin
  if not public.auris_can_manage_company(p_company_id) then raise exception 'AURIS_WORKFLOW_MANAGE_DENIED' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_module_key,0));
  select * into v_target from public.workflow_policy_versions where id=p_policy_id and company_id=p_company_id and module_key=p_module_key for update;
  if not found then raise exception 'AURIS_WORKFLOW_POLICY_NOT_FOUND' using errcode='P0002';end if;
  if v_target.status<>'draft' then raise exception 'AURIS_WORKFLOW_POLICY_NOT_DRAFT' using errcode='22023';end if;
  if p_expected_revision is not null and v_target.revision<>p_expected_revision then raise exception 'AURIS_WORKFLOW_REVISION_CONFLICT' using errcode='40001';end if;
  select * into v_previous from public.workflow_policy_versions where company_id=p_company_id and module_key=p_module_key and status='published' for update;
  if found then
    update public.workflow_policy_versions set status='archived',revision=revision+1,updated_at=now() where id=v_previous.id;
    insert into public.workflow_policy_events(company_id,module_key,policy_id,event_type,details) values(p_company_id,p_module_key,v_previous.id,'archived',jsonb_build_object('replaced_by',v_target.id));
  end if;
  update public.workflow_policy_versions set status='published',revision=revision+1,published_by=auth.uid(),published_at=now(),updated_at=now(),supersedes_id=v_previous.id where id=v_target.id returning * into v_target;
  insert into public.workflow_policy_events(company_id,module_key,policy_id,event_type,details) values(p_company_id,p_module_key,v_target.id,'published',jsonb_build_object('version',v_target.version,'supersedes_id',v_target.supersedes_id));
  return next v_target;
end;$$;

create or replace function public.rollback_workflow_policy(
  p_company_id uuid,p_module_key text,p_restore_policy_id uuid,p_expected_active_revision integer default null
) returns setof public.workflow_policy_versions
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_restore public.workflow_policy_versions;v_active public.workflow_policy_versions;v_result public.workflow_policy_versions;v_version integer;
begin
  if not public.auris_can_manage_company(p_company_id) then raise exception 'AURIS_WORKFLOW_MANAGE_DENIED' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_module_key,0));
  select * into v_restore from public.workflow_policy_versions where id=p_restore_policy_id and company_id=p_company_id and module_key=p_module_key;
  if not found then raise exception 'AURIS_WORKFLOW_POLICY_NOT_FOUND' using errcode='P0002';end if;
  select * into v_active from public.workflow_policy_versions where company_id=p_company_id and module_key=p_module_key and status='published' for update;
  if p_expected_active_revision is not null and (not found or v_active.revision<>p_expected_active_revision) then raise exception 'AURIS_WORKFLOW_REVISION_CONFLICT' using errcode='40001';end if;
  select coalesce(max(version),0)+1 into v_version from public.workflow_policy_versions where company_id=p_company_id and module_key=p_module_key;
  if v_active.id is not null then update public.workflow_policy_versions set status='archived',revision=revision+1,updated_at=now() where id=v_active.id;end if;
  insert into public.workflow_policy_versions(company_id,module_key,version,status,revision,policy,supersedes_id,created_by,published_by,published_at)
  values(p_company_id,p_module_key,v_version,'published',1,v_restore.policy,v_restore.id,auth.uid(),auth.uid(),now()) returning * into v_result;
  insert into public.workflow_policy_events(company_id,module_key,policy_id,event_type,details) values(p_company_id,p_module_key,v_result.id,'rolled_back',jsonb_build_object('restored_policy_id',v_restore.id,'replaced_policy_id',v_active.id));
  return next v_result;
end;$$;

alter table public.approval_requests alter column related_id drop not null;
alter table public.approval_requests
  add column if not exists source_record_id text,
  add column if not exists source_page text,
  add column if not exists source_ref text,
  add column if not exists source_adapter_key text,
  add column if not exists from_state text,
  add column if not exists to_state text,
  add column if not exists request_reason text,
  add column if not exists requested_by uuid,
  add column if not exists decided_by uuid,
  add column if not exists decided_at timestamptz,
  add column if not exists decision_reason text,
  add column if not exists idempotency_key text,
  add column if not exists revision integer not null default 1;

create unique index if not exists ux_approval_requests_idempotency
  on public.approval_requests(company_id,idempotency_key) where idempotency_key is not null;
create unique index if not exists ux_approval_requests_one_pending_transition
  on public.approval_requests(company_id,module_name,related_table,source_record_id,from_state,to_state)
  where status='pending' and source_record_id is not null;

drop policy if exists "approval_requests_company_access" on public.approval_requests;
drop policy if exists approval_requests_company_select on public.approval_requests;
create policy approval_requests_company_select on public.approval_requests for select
using (public.auris_can_access_company(company_id));
drop policy if exists approval_requests_company_insert on public.approval_requests;
create policy approval_requests_company_insert on public.approval_requests for insert
with check (public.auris_can_access_company(company_id) and coalesce(requested_by,submitted_by)=auth.uid());
drop policy if exists approval_requests_company_update on public.approval_requests;
create policy approval_requests_company_update on public.approval_requests for update
using (public.auris_can_manage_company(company_id)) with check (public.auris_can_manage_company(company_id));
drop policy if exists approval_requests_company_delete on public.approval_requests;
create policy approval_requests_company_delete on public.approval_requests for delete
using (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=approval_requests.company_id and p.role='admin'))));

drop policy if exists "approval_decisions_company_access" on public.approval_decisions;
drop policy if exists approval_decisions_company_select on public.approval_decisions;
create policy approval_decisions_company_select on public.approval_decisions for select
using (exists(select 1 from public.approval_requests r where r.id=approval_decisions.request_id and public.auris_can_access_company(r.company_id)));
drop policy if exists approval_decisions_manager_insert on public.approval_decisions;
create policy approval_decisions_manager_insert on public.approval_decisions for insert
with check (exists(select 1 from public.approval_requests r where r.id=approval_decisions.request_id and public.auris_can_manage_company(r.company_id) and approval_decisions.decided_by=auth.uid()));

create or replace function public.request_workflow_approval(
  p_company_id uuid,p_module_name text,p_related_table text,p_source_record_id text,p_source_page text,p_source_ref text,p_source_adapter_key text,p_from_state text,p_to_state text,p_reason text default '',p_idempotency_key text default null
) returns setof public.approval_requests
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.approval_requests;v_uuid uuid;
begin
  if not public.auris_can_access_company(p_company_id) then raise exception 'AURIS_APPROVAL_TENANT_MISMATCH' using errcode='42501';end if;
  if nullif(trim(p_source_record_id),'') is null then raise exception 'AURIS_APPROVAL_SOURCE_REQUIRED' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_module_name||':'||p_related_table||':'||p_source_record_id||':'||p_from_state||':'||p_to_state,0));
  if nullif(p_idempotency_key,'') is not null then select * into v_row from public.approval_requests where company_id=p_company_id and idempotency_key=p_idempotency_key;if found then return next v_row;return;end if;end if;
  select * into v_row from public.approval_requests where company_id=p_company_id and module_name=p_module_name and related_table=p_related_table and source_record_id=p_source_record_id and coalesce(from_state,'')=coalesce(p_from_state,'') and coalesce(to_state,'')=coalesce(p_to_state,'') and status='pending' limit 1;
  if found then return next v_row;return;end if;
  if p_source_record_id~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then v_uuid=p_source_record_id::uuid;end if;
  insert into public.approval_requests(company_id,module_name,related_table,related_id,source_record_id,source_page,source_ref,source_adapter_key,from_state,to_state,request_reason,idempotency_key,submitted_by,requested_by,status)
  values(p_company_id,p_module_name,p_related_table,v_uuid,p_source_record_id,p_source_page,nullif(p_source_ref,''),nullif(p_source_adapter_key,''),nullif(p_from_state,''),nullif(p_to_state,''),nullif(p_reason,''),nullif(p_idempotency_key,''),auth.uid(),auth.uid(),'pending') returning * into v_row;
  return next v_row;
end;$$;

create or replace function public.decide_workflow_approval(
  p_request_id uuid,p_decision text,p_reason text default '',p_expected_revision integer default null
) returns setof public.approval_requests
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.approval_requests;v_name text;
begin
  if p_decision not in ('approved','rejected','changes_requested','cancelled') then raise exception 'AURIS_APPROVAL_INVALID_DECISION' using errcode='22023';end if;
  select * into v_row from public.approval_requests where id=p_request_id for update;
  if not found then raise exception 'AURIS_APPROVAL_NOT_FOUND' using errcode='P0002';end if;
  if not public.auris_can_manage_company(v_row.company_id) then raise exception 'AURIS_APPROVAL_DECISION_DENIED' using errcode='42501';end if;
  if v_row.status<>'pending' then raise exception 'AURIS_APPROVAL_ALREADY_DECIDED' using errcode='40001';end if;
  if p_expected_revision is not null and v_row.revision<>p_expected_revision then raise exception 'AURIS_APPROVAL_REVISION_CONFLICT' using errcode='40001';end if;
  select coalesce(full_name,email) into v_name from public.profiles where id=auth.uid();
  insert into public.approval_decisions(request_id,step_no,decision,decided_by,decided_by_name,comments) values(v_row.id,v_row.current_step_no,p_decision,auth.uid(),v_name,nullif(p_reason,''));
  update public.approval_requests set status=p_decision,decided_by=auth.uid(),decided_at=now(),decision_reason=nullif(p_reason,''),completed_at=now(),released_by=case when p_decision='approved' then auth.uid() else released_by end,release_reason=case when p_decision='approved' then nullif(p_reason,'') else release_reason end,revision=revision+1,updated_at=now() where id=v_row.id returning * into v_row;
  return next v_row;
end;$$;

revoke all on function public.create_workflow_policy_draft(uuid,text,jsonb,integer) from public;
revoke all on function public.publish_workflow_policy(uuid,text,uuid,integer) from public;
revoke all on function public.rollback_workflow_policy(uuid,text,uuid,integer) from public;
revoke all on function public.request_workflow_approval(uuid,text,text,text,text,text,text,text,text,text,text) from public;
revoke all on function public.decide_workflow_approval(uuid,text,text,integer) from public;
grant execute on function public.create_workflow_policy_draft(uuid,text,jsonb,integer) to authenticated;
grant execute on function public.publish_workflow_policy(uuid,text,uuid,integer) to authenticated;
grant execute on function public.rollback_workflow_policy(uuid,text,uuid,integer) to authenticated;
grant execute on function public.request_workflow_approval(uuid,text,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.decide_workflow_approval(uuid,text,text,integer) to authenticated;

notify pgrst,'reload schema';
