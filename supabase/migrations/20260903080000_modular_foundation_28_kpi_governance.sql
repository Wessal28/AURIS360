-- Phase 28: governed KPI submission, verification, approval and locking.

alter table public.kpis_v2
  add column if not exists lifecycle_revision integer not null default 1,
  add column if not exists lifecycle_reason text,
  add column if not exists submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists verified_by uuid references auth.users(id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists locked_by uuid references auth.users(id) on delete set null,
  add column if not exists locked_at timestamptz;

create index if not exists idx_kpis_v2_company_approval_status
  on public.kpis_v2(company_id,approval_status,updated_at desc);

alter table public.kpis_v2 drop constraint if exists kpis_v2_lifecycle_revision_check;
alter table public.kpis_v2 add constraint kpis_v2_lifecycle_revision_check check (lifecycle_revision > 0);

create or replace function public.transition_kpi_lifecycle(
  p_company_id uuid,
  p_kpi_id uuid,
  p_from_state text,
  p_to_state text,
  p_reason text default '',
  p_expected_revision integer default null,
  p_approval_request_id uuid default null
) returns public.kpis_v2
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  item public.kpis_v2;
  actor_role text;
  allowed boolean:=false;
  approval_row public.approval_requests;
begin
  select * into item from public.kpis_v2 where id=p_kpi_id for update;
  if not found then raise exception 'AURIS_KPI_NOT_FOUND' using errcode='P0002';end if;
  if item.company_id<>p_company_id or not public.auris_can_access_company(p_company_id) then raise exception 'AURIS_KPI_TENANT_MISMATCH' using errcode='42501';end if;
  if item.approval_status<>p_from_state then raise exception 'AURIS_KPI_STATE_CONFLICT' using errcode='40001';end if;
  if p_expected_revision is not null and item.lifecycle_revision<>p_expected_revision then raise exception 'AURIS_KPI_REVISION_CONFLICT' using errcode='40001';end if;
  if item.approval_status='locked' then raise exception 'AURIS_KPI_LOCKED' using errcode='42501';end if;

  select role into actor_role from public.profiles where id=auth.uid() and (company_id=p_company_id or role='sephs_admin');
  if actor_role is null then raise exception 'AURIS_KPI_TRANSITION_DENIED' using errcode='42501';end if;

  allowed:=(p_from_state,p_to_state) in (
    ('draft','submitted'),('submitted','verified'),('submitted','rejected'),('submitted','revision_requested'),
    ('verified','approved'),('verified','rejected'),('verified','revision_requested'),('approved','locked'),
    ('rejected','draft'),('rejected','submitted'),('revision_requested','draft'),('revision_requested','submitted')
  );
  if not allowed then raise exception 'AURIS_KPI_TRANSITION_INVALID' using errcode='22023';end if;

  if p_to_state='submitted' then
    if actor_role not in ('hse_officer','hse_manager','admin','sephs_admin') then raise exception 'AURIS_KPI_SUBMIT_DENIED' using errcode='42501';end if;
    if nullif(trim(item.reviewer),'') is null or nullif(trim(item.approver),'') is null or nullif(trim(item.data_provider),'') is null or nullif(trim(item.data_source),'') is null then raise exception 'AURIS_KPI_REQUIRED_FIELDS' using errcode='22023';end if;
    if not exists(select 1 from public.kpi_indicators i where i.kpi_id=item.id and i.company_id=item.company_id) then raise exception 'AURIS_KPI_INDICATOR_REQUIRED' using errcode='22023';end if;
  elsif p_to_state in ('verified','approved') then
    if p_approval_request_id is null then raise exception 'AURIS_KPI_APPROVAL_REQUIRED' using errcode='42501';end if;
    select * into approval_row from public.approval_requests where id=p_approval_request_id and company_id=p_company_id and module_name='kpi' and related_table='kpis_v2' and source_record_id=p_kpi_id::text and from_state=p_from_state and to_state=p_to_state and status='approved';
    if not found then raise exception 'AURIS_KPI_APPROVAL_EVIDENCE_INVALID' using errcode='42501';end if;
  elsif p_to_state='locked' and actor_role not in ('hse_manager','admin','sephs_admin') then
    raise exception 'AURIS_KPI_LOCK_DENIED' using errcode='42501';
  end if;

  update public.kpis_v2 set
    approval_status=p_to_state,
    lifecycle_revision=lifecycle_revision+1,
    lifecycle_reason=nullif(trim(p_reason),''),
    submitted_by=case when p_to_state='submitted' then auth.uid() else submitted_by end,
    submitted_at=case when p_to_state='submitted' then now() else submitted_at end,
    verified_by=case when p_to_state='verified' then auth.uid() else verified_by end,
    verified_at=case when p_to_state='verified' then now() else verified_at end,
    approved_by=case when p_to_state='approved' then auth.uid() else approved_by end,
    approved_at=case when p_to_state='approved' then now() else approved_at end,
    locked_by=case when p_to_state='locked' then auth.uid() else locked_by end,
    locked_at=case when p_to_state='locked' then now() else locked_at end,
    updated_at=now()
  where id=item.id returning * into item;

  if to_regclass('public.audit_events') is not null then
    insert into public.audit_events(company_id,actor_user_id,actor_role,action,module_name,related_table,related_id,related_ref,summary,details,event_code)
    values(item.company_id,auth.uid(),actor_role,'workflow_transition','kpi','kpis_v2',item.id,item.code,'KPI moved from '||p_from_state||' to '||p_to_state,jsonb_build_object('from',p_from_state,'to',p_to_state,'reason',nullif(trim(p_reason),''),'approval_request_id',p_approval_request_id,'lifecycle_revision',item.lifecycle_revision),'kpi.workflow_'||p_to_state);
  end if;
  return item;
end;$$;

create or replace function public.decide_kpi_workflow_approval(
  p_request_id uuid,
  p_decision text,
  p_reason text default '',
  p_expected_request_revision integer default null,
  p_expected_kpi_revision integer default null
) returns public.kpis_v2
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  request_row public.approval_requests;
  decided public.approval_requests;
  item public.kpis_v2;
  actor_role text;
  actor_name text;
  next_state text;
begin
  if p_decision not in ('approved','rejected','changes_requested') then raise exception 'AURIS_KPI_DECISION_INVALID' using errcode='22023';end if;
  select * into request_row from public.approval_requests where id=p_request_id for update;
  if not found or request_row.module_name<>'kpi' or request_row.related_table<>'kpis_v2' then raise exception 'AURIS_KPI_APPROVAL_NOT_FOUND' using errcode='P0002';end if;
  select * into item from public.kpis_v2 where id=request_row.source_record_id::uuid and company_id=request_row.company_id for update;
  if not found or not public.auris_can_access_company(item.company_id) then raise exception 'AURIS_KPI_TENANT_MISMATCH' using errcode='42501';end if;
  if item.approval_status<>request_row.from_state then raise exception 'AURIS_KPI_STATE_CONFLICT' using errcode='40001';end if;
  if p_expected_kpi_revision is not null and item.lifecycle_revision<>p_expected_kpi_revision then raise exception 'AURIS_KPI_REVISION_CONFLICT' using errcode='40001';end if;
  if p_decision in ('rejected','changes_requested') and nullif(trim(p_reason),'') is null then raise exception 'AURIS_KPI_DECISION_REASON_REQUIRED' using errcode='22023';end if;

  select role,coalesce(full_name,email) into actor_role,actor_name from public.profiles where id=auth.uid() and (company_id=item.company_id or role='sephs_admin');
  if actor_role is null then raise exception 'AURIS_KPI_DECISION_DENIED' using errcode='42501';end if;
  if actor_role<>'sephs_admin' and request_row.to_state='verified' and not exists(select 1 from public.profiles p where p.id=auth.uid() and lower(trim(coalesce(item.reviewer,''))) in (lower(trim(coalesce(p.full_name,''))),lower(trim(coalesce(p.email,''))),lower(trim(coalesce(p.real_email,''))))) then raise exception 'AURIS_KPI_REVIEWER_MISMATCH' using errcode='42501';end if;
  if actor_role<>'sephs_admin' and request_row.to_state='approved' and not exists(select 1 from public.profiles p where p.id=auth.uid() and lower(trim(coalesce(item.approver,''))) in (lower(trim(coalesce(p.full_name,''))),lower(trim(coalesce(p.email,''))),lower(trim(coalesce(p.real_email,''))))) then raise exception 'AURIS_KPI_APPROVER_MISMATCH' using errcode='42501';end if;

  select * into decided from public.decide_workflow_approval_v2(p_request_id,p_decision,p_reason,p_expected_request_revision);
  if decided.status='pending' then return item;end if;
  next_state:=case p_decision when 'approved' then request_row.to_state when 'rejected' then 'rejected' else 'revision_requested' end;

  update public.kpis_v2 set
    approval_status=next_state,
    lifecycle_revision=lifecycle_revision+1,
    lifecycle_reason=nullif(trim(p_reason),''),
    verified_by=case when next_state='verified' then auth.uid() else verified_by end,
    verified_at=case when next_state='verified' then now() else verified_at end,
    approved_by=case when next_state='approved' then auth.uid() else approved_by end,
    approved_at=case when next_state='approved' then now() else approved_at end,
    updated_at=now()
  where id=item.id returning * into item;

  if to_regclass('public.audit_events') is not null then
    insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,related_ref,summary,details,event_code)
    values(item.company_id,auth.uid(),actor_name,actor_role,case when p_decision='approved' then 'approve' when p_decision='rejected' then 'reject' else 'request_changes' end,'kpi','kpis_v2',item.id,item.code,'KPI approval decision: '||p_decision,jsonb_build_object('approval_request_id',p_request_id,'decision',p_decision,'from',request_row.from_state,'to',next_state,'reason',nullif(trim(p_reason),''),'lifecycle_revision',item.lifecycle_revision),'kpi.decision_'||p_decision);
  end if;
  return item;
end;$$;

create or replace function public.protect_governed_kpi_record()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare
  old_definition jsonb;
  new_definition jsonb;
begin
  if old.approval_status in ('submitted','verified','approved','locked') then
    old_definition:=to_jsonb(old)-array['approval_status','lifecycle_revision','lifecycle_reason','submitted_by','submitted_at','verified_by','verified_at','approved_by','approved_at','locked_by','locked_at','updated_at'];
    new_definition:=to_jsonb(new)-array['approval_status','lifecycle_revision','lifecycle_reason','submitted_by','submitted_at','verified_by','verified_at','approved_by','approved_at','locked_by','locked_at','updated_at'];
    if old_definition is distinct from new_definition then raise exception 'AURIS_KPI_DEFINITION_FROZEN' using errcode='42501';end if;
  end if;
  if old.approval_status='locked' and new.approval_status<>'locked' then raise exception 'AURIS_KPI_LOCKED' using errcode='42501';end if;
  return new;
end;$$;

drop trigger if exists trg_protect_governed_kpi_record on public.kpis_v2;
create trigger trg_protect_governed_kpi_record before update on public.kpis_v2
for each row execute function public.protect_governed_kpi_record();

create or replace function public.protect_governed_kpi_child()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare
  parent_id uuid;
  parent_state text;
begin
  parent_id:=case when tg_op='DELETE' then old.kpi_id else new.kpi_id end;
  select approval_status into parent_state from public.kpis_v2 where id=parent_id;
  if parent_state in ('submitted','verified','approved','locked') then raise exception 'AURIS_KPI_DATA_FROZEN' using errcode='42501';end if;
  if tg_op='DELETE' then return old;end if;
  return new;
end;$$;

drop trigger if exists trg_protect_governed_kpi_indicators on public.kpi_indicators;
create trigger trg_protect_governed_kpi_indicators before insert or update or delete on public.kpi_indicators
for each row execute function public.protect_governed_kpi_child();
drop trigger if exists trg_protect_governed_kpi_monthly_data on public.kpi_monthly_data;
create trigger trg_protect_governed_kpi_monthly_data before insert or update or delete on public.kpi_monthly_data
for each row execute function public.protect_governed_kpi_child();

revoke all on function public.transition_kpi_lifecycle(uuid,uuid,text,text,text,integer,uuid) from public;
revoke all on function public.decide_kpi_workflow_approval(uuid,text,text,integer,integer) from public;
revoke all on function public.protect_governed_kpi_record() from public;
revoke all on function public.protect_governed_kpi_child() from public;
grant execute on function public.transition_kpi_lifecycle(uuid,uuid,text,text,text,integer,uuid) to authenticated;
grant execute on function public.decide_kpi_workflow_approval(uuid,text,text,integer,integer) to authenticated;

comment on function public.transition_kpi_lifecycle(uuid,uuid,text,text,text,integer,uuid) is 'Atomically applies an allowed tenant-scoped KPI lifecycle transition with optimistic concurrency and audit evidence.';
comment on function public.decide_kpi_workflow_approval(uuid,text,text,integer,integer) is 'Atomically records a shared Approval Centre decision and updates its exact KPI source record.';

notify pgrst,'reload schema';
