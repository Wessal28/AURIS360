-- Phase 11: Unified Work and Activity Centre.
-- Source lifecycle state remains authoritative in its owning table. This migration
-- only adds append-only collaboration evidence and controlled delegation records.

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

create unique index if not exists work_activities_idempotency_uq
  on public.work_activities(company_id, actor_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists work_activities_source_idx
  on public.work_activities(company_id, source_table, source_record_id, created_at desc);

create table if not exists public.work_item_delegations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_module text not null check (length(btrim(source_module)) between 1 and 80),
  source_table text not null check (source_table ~ '^[a-z][a-z0-9_]{0,62}$'),
  source_record_id uuid not null,
  source_ref text,
  delegated_from uuid not null,
  delegated_to uuid not null check (delegated_to <> delegated_from),
  reason text not null default '' check (length(reason) <= 1000),
  status text not null default 'active' check (status in ('active','completed','revoked')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  revoked_at timestamptz
);

create unique index if not exists work_item_delegations_one_active_uq
  on public.work_item_delegations(company_id, source_table, source_record_id, delegated_to)
  where status = 'active';
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

-- No direct INSERT/UPDATE/DELETE policies are defined. Governed writes use the
-- validated RPCs below, keeping activities append-only and delegation controlled.
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
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.work_activities;
begin
  if auth.uid() is null or not public.auris_can_access_company(p_company_id) then raise exception 'company access denied' using errcode='42501'; end if;
  if p_source_record_id is null or p_source_table !~ '^[a-z][a-z0-9_]{0,62}$' or length(btrim(coalesce(p_source_module,''))) not between 1 and 80 then raise exception 'exact source is required' using errcode='22023'; end if;
  if p_activity_type not in ('comment','mention','evidence','status','decision','delegated','escalated') then raise exception 'unsupported activity type' using errcode='22023'; end if;
  if length(coalesce(p_body,'')) > 4000 or jsonb_typeof(coalesce(p_evidence,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_evidence,'[]'::jsonb)) > 20 then raise exception 'activity payload exceeds governed limits' using errcode='22023'; end if;
  if p_idempotency_key is not null then select * into v_row from public.work_activities where company_id=p_company_id and actor_id=auth.uid() and idempotency_key=p_idempotency_key; if found then return v_row; end if; end if;
  insert into public.work_activities(company_id,source_module,source_table,source_record_id,source_ref,actor_id,activity_type,body,evidence,idempotency_key,mentioned_profile_ids,policy_version)
  values(p_company_id,btrim(p_source_module),p_source_table,p_source_record_id,nullif(btrim(p_source_ref),''),auth.uid(),p_activity_type,coalesce(p_body,''),coalesce(p_evidence,'[]'::jsonb),p_idempotency_key,coalesce(p_mentioned_profile_ids,'{}'),p_policy_version)
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.delegate_work_item(
  p_company_id uuid,
  p_source_module text,
  p_source_table text,
  p_source_record_id uuid,
  p_delegated_to uuid,
  p_source_ref text default null,
  p_reason text default ''
) returns public.work_item_delegations
language plpgsql security definer set search_path = public, pg_temp as $$
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
end $$;

revoke all on function public.add_work_activity(uuid,text,text,uuid,text,text,text,jsonb,text,uuid[],text) from public;
revoke all on function public.delegate_work_item(uuid,text,text,uuid,uuid,text,text) from public;
grant execute on function public.add_work_activity(uuid,text,text,uuid,text,text,text,jsonb,text,uuid[],text) to authenticated;
grant execute on function public.delegate_work_item(uuid,text,text,uuid,uuid,text,text) to authenticated;
grant select on public.work_activities, public.work_item_delegations to authenticated;

comment on table public.work_activities is 'Append-only, tenant-scoped work comments, mentions, evidence and governed decision history tied to an exact source record.';
comment on table public.work_item_delegations is 'Controlled tenant-scoped delegation overlay; source lifecycle state remains authoritative in its owning module.';
