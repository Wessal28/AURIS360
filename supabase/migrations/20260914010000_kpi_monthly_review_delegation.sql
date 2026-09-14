-- Governed reassignment for a submitted KPI monthly review.
-- Reuses the append-only work-centre delegation ledger while keeping the
-- monthly review route snapshot authoritative for transition checks.
begin;

-- The delegation ledger normally comes from the Work Centre migration. Keep
-- this migration safe to paste on a staging project where that phase was not
-- replayed yet; existing tables and policies are preserved.
create table if not exists public.work_activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_module text not null check (length(btrim(source_module)) between 1 and 80),
  source_table text not null check (source_table ~ '^[a-z][a-z0-9_]{0,62}$'),
  source_record_id uuid not null,
  source_ref text,
  actor_id uuid not null,
  activity_type text not null check (activity_type in ('comment','mention','evidence','status','decision','delegated','escalated')),
  body text not null default '' check (length(body) <= 4000),
  mentioned_profile_ids uuid[] not null default '{}',
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 20),
  policy_version text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  constraint work_activities_exact_source unique (company_id, source_table, source_record_id, id)
);

create table if not exists public.work_item_delegations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_module text not null check (length(btrim(source_module)) between 1 and 80),
  source_table text not null check (source_table ~ '^[a-z][a-z0-9_]{0,62}$'),
  source_record_id uuid not null,
  source_ref text,
  delegated_from uuid not null,
  delegated_to uuid not null check (delegated_to <> delegated_from),
  delegation_role text,
  reason text not null default '' check (length(reason) <= 1000),
  status text not null default 'active' check (status in ('active','completed','revoked')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  revoked_at timestamptz
);

alter table public.work_item_delegations
  add column if not exists delegation_role text;

create unique index if not exists work_activities_idempotency_uq
  on public.work_activities(company_id, actor_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists work_activities_source_idx
  on public.work_activities(company_id, source_table, source_record_id, created_at desc);
create unique index if not exists work_item_delegations_one_active_uq
  on public.work_item_delegations(company_id, source_table, source_record_id, delegated_to)
  where status='active';
create index if not exists work_item_delegations_recipient_idx
  on public.work_item_delegations(company_id, delegated_to, status, created_at desc);
alter table public.work_activities enable row level security;
alter table public.work_item_delegations enable row level security;
drop policy if exists work_activities_company_read on public.work_activities;
create policy work_activities_company_read on public.work_activities for select to authenticated
using (public.auris_can_access_company(company_id));
drop policy if exists work_item_delegations_participant_read on public.work_item_delegations;
create policy work_item_delegations_participant_read on public.work_item_delegations for select to authenticated
using (public.auris_can_access_company(company_id) and (delegated_from = auth.uid() or delegated_to = auth.uid() or public.auris_can_manage_company(company_id)));
grant select on public.work_activities, public.work_item_delegations to authenticated;

-- Keep this release migration safe when it is pasted into a staging project
-- without the earlier Work Centre migration. The two shared RPCs are repeated
-- here deliberately so the review delegation flow never compiles against a
-- table that exists without its governed write boundary.
create or replace function public.add_work_activity(
  p_company_id uuid,
  p_source_module text,
  p_source_table text,
  p_source_record_id uuid,
  p_source_ref text default null,
  p_activity_type text default 'comment',
  p_body text default '',
  p_evidence jsonb default '[]'::jsonb,
  p_idempotency_key text default null,
  p_mentioned_profile_ids uuid[] default '{}',
  p_policy_version text default null
) returns public.work_activities
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.work_activities;
begin
  if auth.uid() is null or not public.auris_can_access_company(p_company_id) then raise exception 'company access denied' using errcode='42501'; end if;
  if p_source_record_id is null or p_source_table !~ '^[a-z][a-z0-9_]{0,62}$' or length(btrim(coalesce(p_source_module,''))) not between 1 and 80 then raise exception 'exact source is required' using errcode='22023'; end if;
  if p_activity_type not in ('comment','mention','evidence','status','decision','delegated','escalated') then raise exception 'unsupported activity type' using errcode='22023'; end if;
  if length(coalesce(p_body,'')) > 4000 or jsonb_typeof(coalesce(p_evidence,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_evidence,'[]'::jsonb)) > 20 then raise exception 'activity payload exceeds governed limits' using errcode='22023'; end if;
  if p_idempotency_key is not null then
    select * into v_row from public.work_activities where company_id=p_company_id and actor_id=auth.uid() and idempotency_key=p_idempotency_key;
    if found then return v_row; end if;
  end if;
  insert into public.work_activities(company_id,source_module,source_table,source_record_id,source_ref,actor_id,activity_type,body,evidence,idempotency_key,mentioned_profile_ids,policy_version)
  values(p_company_id,btrim(p_source_module),p_source_table,p_source_record_id,nullif(btrim(p_source_ref),''),auth.uid(),p_activity_type,coalesce(p_body,''),coalesce(p_evidence,'[]'::jsonb),p_idempotency_key,coalesce(p_mentioned_profile_ids,'{}'),p_policy_version)
  returning * into v_row;
  return v_row;
end;$$;

create or replace function public.delegate_work_item(
  p_company_id uuid,
  p_source_module text,
  p_source_table text,
  p_source_record_id uuid,
  p_delegated_to uuid,
  p_source_ref text default null,
  p_reason text default ''
) returns public.work_item_delegations
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.work_item_delegations;
begin
  if auth.uid() is null or not public.auris_can_access_company(p_company_id) then raise exception 'company access denied' using errcode='42501'; end if;
  if p_delegated_to is null or p_delegated_to=auth.uid() or p_source_record_id is null or p_source_table !~ '^[a-z][a-z0-9_]{0,62}$' then raise exception 'valid source and delegate are required' using errcode='22023'; end if;
  if length(coalesce(p_reason,'')) > 1000 then raise exception 'delegation reason is too long' using errcode='22023'; end if;
  if not (
    public.auris_can_manage_company(p_company_id)
    or (p_source_table='action_tracker' and exists(select 1 from public.action_tracker a where a.id=p_source_record_id and a.company_id=p_company_id and a.assigned_to_id=auth.uid()))
    or exists(select 1 from public.work_item_delegations d where d.company_id=p_company_id and d.source_table=p_source_table and d.source_record_id=p_source_record_id and d.delegated_to=auth.uid() and d.status='active')
  ) then raise exception 'delegation authority denied' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles p where p.id=p_delegated_to and public.auris_can_access_company(p_company_id) and (p.company_id=p_company_id or public.is_sephs_admin())) then raise exception 'delegate is outside the company boundary' using errcode='42501'; end if;
  insert into public.work_item_delegations(company_id,source_module,source_table,source_record_id,source_ref,delegated_from,delegated_to,reason)
  values(p_company_id,btrim(p_source_module),p_source_table,p_source_record_id,nullif(btrim(p_source_ref),''),auth.uid(),p_delegated_to,coalesce(p_reason,'')) returning * into v_row;
  insert into public.work_activities(company_id,source_module,source_table,source_record_id,source_ref,actor_id,activity_type,body)
  values(p_company_id,btrim(p_source_module),p_source_table,p_source_record_id,nullif(btrim(p_source_ref),''),auth.uid(),'delegated',coalesce(p_reason,''));
  return v_row;
end;$$;

revoke all on function public.add_work_activity(uuid,text,text,uuid,text,text,text,jsonb,text,uuid[],text) from public,anon;
revoke all on function public.delegate_work_item(uuid,text,text,uuid,uuid,text,text) from public,anon;
grant execute on function public.add_work_activity(uuid,text,text,uuid,text,text,text,jsonb,text,uuid[],text) to authenticated;
grant execute on function public.delegate_work_item(uuid,text,text,uuid,uuid,text,text) to authenticated;

create index if not exists work_item_delegations_kpi_stage_idx
  on public.work_item_delegations(company_id, source_record_id, delegation_role, status, created_at desc)
  where source_table='kpi_monthly_reviews';

create unique index if not exists work_item_delegations_kpi_stage_active_uq
  on public.work_item_delegations(company_id, source_table, source_record_id, delegation_role)
  where source_table='kpi_monthly_reviews' and delegation_role is not null and status='active';

create or replace function public.delegate_kpi_monthly_review(
  p_company_id uuid,
  p_review_id uuid,
  p_expected_revision integer,
  p_stage text,
  p_delegated_to uuid,
  p_reason text default ''
) returns public.kpi_monthly_reviews
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  item public.kpi_monthly_reviews;
  actor uuid:=auth.uid();
  actor_role text;
  expected_stage text;
  new_route jsonb;
  target_name text;
begin
  if actor is null or not public.auris_can_access_company(p_company_id) then
    raise exception 'AURIS_MONTH_REVIEW_DENIED' using errcode='42501';
  end if;
  if p_stage not in ('reviewer','approver') or p_delegated_to is null or p_delegated_to=actor then
    raise exception 'AURIS_MONTH_REVIEW_DELEGATION' using errcode='22023';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null or length(p_reason)>1000 then
    raise exception 'AURIS_MONTH_REVIEW_REASON' using errcode='22023';
  end if;
  select role into actor_role from public.profiles where id=actor and status='active';
  if actor_role is null or actor_role not in ('admin','sephs_admin','hse_manager','manager') then
    raise exception 'AURIS_MONTH_REVIEW_DELEGATION_AUTHORITY' using errcode='42501';
  end if;
  select * into item from public.kpi_monthly_reviews
    where id=p_review_id and company_id=p_company_id for update;
  if not found or item.revision is distinct from p_expected_revision then
    raise exception 'AURIS_MONTH_REVIEW_CONFLICT' using errcode='PT409';
  end if;
  expected_stage:=case when item.status='submitted' then 'reviewer' when item.status='verified' then 'approver' else null end;
  if expected_stage is distinct from p_stage then
    raise exception 'AURIS_MONTH_REVIEW_DELEGATION_STAGE' using errcode='22023';
  end if;
  if not exists(select 1 from public.profiles p where p.id=p_delegated_to and p.company_id=p_company_id and p.status='active') then
    raise exception 'AURIS_MONTH_REVIEW_DELEGATION_TARGET' using errcode='42501';
  end if;
  if not coalesce((item.route->>'self_approval')::boolean,false) and (
    p_delegated_to=item.submitted_by
    or p_stage='reviewer' and p_delegated_to=nullif(item.route->>'approver','')::uuid
    or p_stage='approver' and p_delegated_to=coalesce(nullif(item.route->>'delegated_reviewer','')::uuid,nullif(item.route->>'reviewer','')::uuid)
  ) then
    raise exception 'AURIS_MONTH_REVIEW_SELF_APPROVAL' using errcode='42501';
  end if;
  select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.real_email),''),nullif(btrim(p.email),''),p.id::text)
    into target_name from public.profiles p where p.id=p_delegated_to;
  new_route:=item.route;
  new_route:=jsonb_set(new_route,array['delegated_'||p_stage],to_jsonb(p_delegated_to::text),true);
  new_route:=jsonb_set(new_route,array['delegated_'||p_stage||'_name'],to_jsonb(target_name),true);
  update public.work_item_delegations
    set status='revoked',revoked_at=now()
    where company_id=p_company_id and source_table='kpi_monthly_reviews' and source_record_id=item.id
      and delegation_role=p_stage and status='active';
  insert into public.work_item_delegations(company_id,source_module,source_table,source_record_id,source_ref,delegated_from,delegated_to,delegation_role,reason)
    values(p_company_id,'objectives','kpi_monthly_reviews',item.id,item.year||'-'||lpad(item.month::text,2,'0'),actor,p_delegated_to,p_stage,btrim(p_reason));
  update public.kpi_monthly_reviews set route=new_route,revision=revision+1,updated_at=now()
    where id=item.id returning * into item;
  insert into public.work_activities(company_id,source_module,source_table,source_record_id,source_ref,actor_id,activity_type,body)
    values(p_company_id,'objectives','kpi_monthly_reviews',item.id,item.year||'-'||lpad(item.month::text,2,'0'),actor,'delegated',btrim(p_reason));
  insert into public.audit_events(company_id,actor_user_id,actor_role,action,module_name,related_table,related_id,summary,event_code,details)
    values(p_company_id,actor,actor_role,'delegated','kpi','kpi_monthly_reviews',item.id,item.title||': delegate '||p_stage,'kpi.monthly_review_delegated',jsonb_build_object('stage',p_stage,'delegated_to',p_delegated_to,'reason',btrim(p_reason)));
  return item;
end;$$;

create or replace function public.transition_kpi_monthly_review(p_company_id uuid,p_year integer,p_month integer,p_expected_id uuid,p_expected_revision integer,p_fingerprint text,p_action text,p_reason text default '')
returns public.kpi_monthly_reviews language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.kpi_monthly_reviews; prior public.kpi_monthly_reviews; preview jsonb; route jsonb; actor uuid:=auth.uid(); actor_role text; target text; assigned uuid;
begin
  select role into actor_role from public.profiles where id=actor and status='active' and (company_id=p_company_id or role='sephs_admin');
  if actor is null or actor_role is null or not public.auris_can_access_company(p_company_id) then raise exception 'AURIS_MONTH_REVIEW_DENIED' using errcode='42501';end if;
  if length(coalesce(p_reason,''))>4000 then raise exception 'AURIS_MONTH_REVIEW_REASON' using errcode='22023';end if;
  perform public.lock_kpi_monthly_review(p_company_id);
  select * into item from public.kpi_monthly_reviews where company_id=p_company_id and year=p_year and month=p_month for update;
  prior:=item;
  if item.id is distinct from p_expected_id or item.revision is distinct from p_expected_revision then raise exception 'AURIS_MONTH_REVIEW_CONFLICT' using errcode='PT409';end if;
  if p_action='submit' and (item.id is null or item.status in ('revision_requested','rejected')) then
    preview:=public.get_kpi_monthly_review(p_company_id,p_year,p_month);route:=preview->'route';
    if preview->>'fingerprint' is distinct from p_fingerprint then raise exception 'AURIS_MONTH_REVIEW_DATA_CHANGED' using errcode='PT409';end if;
    if (preview->>'period_open')::boolean or jsonb_array_length(preview->'snapshot')=0 or (preview->>'missing')::integer>0 then raise exception 'AURIS_MONTH_REVIEW_INCOMPLETE' using errcode='22023';end if;
    if exists(select 1 from jsonb_array_elements(preview->'snapshot') e where e->>'definition_state' in ('submitted','verified')) then raise exception 'AURIS_MONTH_REVIEW_DEFINITION' using errcode='22023';end if;
    if route ? 'error' then raise exception 'AURIS_MONTH_REVIEW_ROUTE' using errcode='22023';end if;
    if actor<>(route->>'submitter')::uuid then raise exception 'AURIS_MONTH_REVIEW_ASSIGNEE' using errcode='42501';end if;
    if item.id is not null and nullif(btrim(p_reason),'') is null then raise exception 'AURIS_MONTH_REVIEW_REASON' using errcode='22023';end if;
    insert into public.kpi_monthly_reviews(company_id,year,month,status,title,route,snapshot,fingerprint,submitted_by,reason)
      values(p_company_id,p_year,p_month,'submitted','KPI monthly review — '||p_year||'-'||lpad(p_month::text,2,'0'),route,preview->'snapshot',preview->>'fingerprint',actor,nullif(btrim(p_reason),''))
      on conflict(company_id,year,month) do update set status='submitted',revision=kpi_monthly_reviews.revision+1,route=excluded.route,snapshot=excluded.snapshot,fingerprint=excluded.fingerprint,
        submitted_by=actor,submitted_at=now(),verified_by=null,verified_at=null,approved_by=null,approved_at=null,reason=excluded.reason,updated_at=now()
      returning * into item;
  else
    if item.id is null or p_fingerprint is distinct from item.fingerprint then raise exception 'AURIS_MONTH_REVIEW_CONFLICT' using errcode='PT409';end if;
    assigned:=case when item.status='submitted' then coalesce(nullif(item.route->>'delegated_reviewer','')::uuid,nullif(item.route->>'reviewer','')::uuid) else coalesce(nullif(item.route->>'delegated_approver','')::uuid,nullif(item.route->>'approver','')::uuid) end;
    if p_action='request_reopen' and item.status='approved' then
      if actor<>item.submitted_by and actor_role not in ('admin','sephs_admin','hse_manager','manager') then raise exception 'AURIS_MONTH_REVIEW_ASSIGNEE' using errcode='42501';end if;
      target:='reopen_requested';
    else
      if actor<>assigned then raise exception 'AURIS_MONTH_REVIEW_ASSIGNEE' using errcode='42501';end if;
      if not (item.route->>'self_approval')::boolean and (actor=item.submitted_by or item.status='verified' and actor=item.verified_by) then raise exception 'AURIS_MONTH_REVIEW_SELF_APPROVAL' using errcode='42501';end if;
      target:=case when p_action='verify' and item.status='submitted' then 'verified'
        when p_action='approve' and item.status='verified' then 'approved'
        when p_action='request_revision' and item.status in ('submitted','verified') then 'revision_requested'
        when p_action='reject' and item.status in ('submitted','verified') then 'rejected'
        when p_action='allow_reopen' and item.status='reopen_requested' then 'revision_requested'
        when p_action='deny_reopen' and item.status='reopen_requested' then 'approved' end;
    end if;
    if target is null then raise exception 'AURIS_MONTH_REVIEW_TRANSITION' using errcode='22023';end if;
    if p_action not in ('verify','approve') and nullif(btrim(p_reason),'') is null then raise exception 'AURIS_MONTH_REVIEW_REASON' using errcode='22023';end if;
    update public.kpi_monthly_reviews set status=target,revision=revision+1,reason=nullif(btrim(p_reason),''),updated_at=now(),
      verified_by=case when p_action='verify' then actor else verified_by end,verified_at=case when p_action='verify' then now() else verified_at end,
      approved_by=case when p_action='approve' then actor else approved_by end,approved_at=case when p_action='approve' then now() else approved_at end
      where id=item.id returning * into item;
  end if;
  insert into public.audit_events(company_id,actor_user_id,actor_role,action,module_name,related_table,related_id,summary,event_code,details)
    values(p_company_id,actor,actor_role,'workflow_transition','kpi','kpi_monthly_reviews',item.id,item.title||': '||p_action,'kpi.monthly_review_'||p_action,
      jsonb_build_object('action',p_action,'previous',to_jsonb(prior),'result',to_jsonb(item)));
  return item;
end;$$;

revoke all on function public.delegate_kpi_monthly_review(uuid,uuid,integer,text,uuid,text) from public,anon;
grant execute on function public.delegate_kpi_monthly_review(uuid,uuid,integer,text,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
