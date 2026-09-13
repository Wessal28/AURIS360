-- Monthly results have their own review; KPI definition approval remains separate.
begin;
create table if not exists public.kpi_monthly_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  year integer not null check(year between 1900 and 9999),
  month integer not null check(month between 1 and 12),
  status text not null check(status in ('submitted','verified','approved','revision_requested','rejected','reopen_requested')),
  revision integer not null default 1 check(revision>0),
  title text not null,
  route jsonb not null,
  snapshot jsonb not null check(jsonb_typeof(snapshot)='array'),
  fingerprint text not null,
  reason text,
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  verified_by uuid references auth.users(id), verified_at timestamptz,
  approved_by uuid references auth.users(id), approved_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(company_id,year,month)
);
alter table public.kpi_monthly_reviews enable row level security;
revoke all on public.kpi_monthly_reviews from public,anon,authenticated;
grant select on public.kpi_monthly_reviews to authenticated;
create policy kpi_monthly_review_read on public.kpi_monthly_reviews for select to authenticated
using(public.auris_can_access_company(company_id) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active'));

-- Try rather than wait: legacy statements may already hold a row lock. A busy
-- writer rolls back with HTTP 409 instead of deadlocking against a review.
create or replace function public.lock_kpi_monthly_review(p_company uuid)
returns void language plpgsql set search_path=public,pg_temp as $$begin
  if not pg_try_advisory_xact_lock(hashtextextended('kpi-month-review:'||p_company::text,0)) then
    raise exception 'AURIS_MONTH_REVIEW_BUSY' using errcode='PT409';
  end if;
end;$$;

create or replace function public.guard_kpi_monthly_review()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb; old_item jsonb; company uuid; parent uuid; indicator uuid; frozen boolean;
begin
  item:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  old_item:=case when tg_op='INSERT' then item else to_jsonb(old) end;
  company:=(item->>'company_id')::uuid;
  if item->>'company_id' is distinct from old_item->>'company_id' then raise exception 'AURIS_MONTH_REVIEW_SCOPE' using errcode='23514';end if;
  perform public.lock_kpi_monthly_review(company);
  -- Status-only reporting changes do not modify an approved definition.
  if tg_table_name='kpis_v2' and tg_op='UPDATE' and item->>'status'<>'archived' and old_item->>'status'<>'archived'
    and item-array['status','updated_at']=old_item-array['status','updated_at'] then return new;end if;
  if tg_table_name='kpi_monthly_data' then
    indicator:=(item->>'indicator_id')::uuid;
    select exists(select 1 from public.kpi_monthly_reviews r, jsonb_array_elements(r.snapshot) e
      where r.company_id=company and r.year=(item->>'year')::integer
      and r.status in ('submitted','verified','approved','reopen_requested')
      and (e->>'indicator_id' in (indicator::text,old_item->>'indicator_id'))
      and least((item->>'month')::integer,(old_item->>'month')::integer)<=(e->>'result_month')::integer) into frozen;
  else
    parent:=case when tg_table_name='kpis_v2' then (item->>'id')::uuid else (item->>'kpi_id')::uuid end;
    select exists(select 1 from public.kpi_monthly_reviews r,jsonb_array_elements(r.snapshot) e
      where r.company_id=company and r.status in ('submitted','verified','approved','reopen_requested')
      and e->>'kpi_id' in (parent::text,case when tg_table_name='kpis_v2' then old_item->>'id' else old_item->>'kpi_id' end)) into frozen;
  end if;
  if frozen then raise exception 'AURIS_MONTH_REVIEW_FROZEN' using errcode='PT409';end if;
  if tg_op='DELETE' then return old;end if;return new;
end;$$;
create trigger trg_00_monthly_review_kpi before insert or update or delete on public.kpis_v2
for each row execute function public.guard_kpi_monthly_review();
create trigger trg_00_monthly_review_indicator before insert or update or delete on public.kpi_indicators
for each row execute function public.guard_kpi_monthly_review();
create trigger trg_00_monthly_review_result before insert or update or delete on public.kpi_monthly_data
for each row execute function public.guard_kpi_monthly_review();

-- The configured person must resolve to exactly one active account in this tenant.
-- Names/emails are accepted for existing configurations; UUIDs remain unambiguous.
create or replace function public.kpi_monthly_review_route(p_company uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare config public.kpi_config_versions; route jsonb:='{}'; names text[]; ids uuid[]; n integer; matches uuid[]; value text; self_allowed boolean;
begin
  select * into config from public.kpi_config_versions where company_id=p_company and status='published' order by version_no desc limit 1;
  if not found then return jsonb_build_object('error','Publish an approval route in KPI Configuration first.');end if;
  self_allowed:=coalesce((config.configuration#>>'{workflow,self_approval}')::boolean,false);
  for n in 1..3 loop
    value:=nullif(btrim(config.configuration#>>array['workflow','stage'||case when self_allowed then 1 else n end]),'');
    select array_agg(p.id order by p.id) into matches from public.profiles p
      where p.company_id=p_company and p.status='active' and value is not null
      and (p.id::text=value or lower(value) in (lower(btrim(p.full_name)),lower(btrim(p.email)),lower(btrim(p.real_email)))
        or exists(select 1 from public.people person where person.company_id=p_company and person.status='active'
          and lower(btrim(person.first_name||' '||person.last_name))=lower(value) and nullif(btrim(person.email),'') is not null
          and lower(btrim(person.email)) in (lower(btrim(p.email)),lower(btrim(p.real_email)))));
    if coalesce(cardinality(matches),0)<>1 then return jsonb_build_object('error','Stage '||n||' must identify exactly one active account in this company.');end if;
    ids:=array_append(ids,matches[1]);
    names:=array_append(names,(select coalesce(full_name,real_email,email,id::text) from public.profiles where id=matches[1]));
  end loop;
  if not self_allowed and (ids[1]=ids[2] or ids[1]=ids[3] or ids[2]=ids[3]) then return jsonb_build_object('error','Select three different people or explicitly enable self-approval.');end if;
  return jsonb_build_object('submitter',ids[1],'reviewer',ids[2],'approver',ids[3],'submitter_name',names[1],'reviewer_name',names[2],'approver_name',names[3],'self_approval',self_allowed,'config_id',config.id,'config_version',config.version_no);
end;$$;

create or replace function public.kpi_monthly_review_snapshot(p_company uuid,p_year integer,p_month integer)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('kpi_id',k.id,'kpi_code',k.code,'kpi_name',k.name,
    'definition_revision',k.definition_revision,'definition_state',k.approval_status,
    'indicator_id',i.id,'indicator',to_jsonb(i),'result_month',period.month,
    'result',to_jsonb(m),'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.month),'[]') from public.kpi_monthly_data h
      where h.company_id=p_company and h.indicator_id=i.id and h.year=p_year and h.month<=period.month))
    order by k.id,i.id),'[]')
  from public.kpis_v2 k left join public.kpi_indicators i on i.kpi_id=k.id and i.company_id=p_company
  cross join lateral (select case when lower(k.frequency) in ('annual','annually') then
    coalesce((select min(a.month) from public.kpi_monthly_data a where a.indicator_id=i.id and a.company_id=p_company and a.year=p_year and a.actual is not null and a.month<=p_month),p_month)
    else p_month end as month) period
  left join public.kpi_monthly_data m on m.indicator_id=i.id and m.company_id=p_company and m.year=p_year and m.month=period.month
  where k.company_id=p_company and k.year=p_year and k.status<>'archived'
  and case when cardinality(k.planned_months)>0 then p_month=any(k.planned_months)
    when lower(k.frequency) in ('annual','annually') then p_month=12 or period.month=p_month and m.id is not null
    when lower(k.frequency) like '%biannual%' then p_month in (6,12)
    when lower(k.frequency) like '%quarter%' then p_month%3=0 else true end;
$$;

create or replace function public.get_kpi_monthly_review(p_company_id uuid,p_year integer,p_month integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare snapshot jsonb; review public.kpi_monthly_reviews; route jsonb;
begin
  if not public.auris_can_access_company(p_company_id) or not exists(select 1 from public.profiles where id=auth.uid() and status='active') then raise exception 'AURIS_MONTH_REVIEW_DENIED' using errcode='42501';end if;
  if p_year is null or p_year not between 1900 and 9999 or p_month is null or p_month not between 1 and 12 then raise exception 'AURIS_MONTH_REVIEW_PERIOD' using errcode='22023';end if;
  select * into review from public.kpi_monthly_reviews where company_id=p_company_id and year=p_year and month=p_month;
  snapshot:=public.kpi_monthly_review_snapshot(p_company_id,p_year,p_month);route:=public.kpi_monthly_review_route(p_company_id);
  return jsonb_build_object('company_id',p_company_id,'year',p_year,'month',p_month,'review',case when review.id is not null then to_jsonb(review) else null end,
    'snapshot',snapshot,'route',route,'fingerprint',md5(snapshot::text||route::text),
    'missing',(select count(*) from jsonb_array_elements(snapshot) e where e->>'indicator_id' is null or e#>>'{result,actual}' is null),
    'period_open',make_date(p_year,p_month,1)>date_trunc('month',current_timestamp at time zone 'UTC')::date);
end;$$;

create or replace function public.transition_kpi_monthly_review(p_company_id uuid,p_year integer,p_month integer,p_expected_id uuid,p_expected_revision integer,p_fingerprint text,p_action text,p_reason text default '')
returns public.kpi_monthly_reviews language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.kpi_monthly_reviews; prior public.kpi_monthly_reviews; preview jsonb; route jsonb; actor uuid:=auth.uid(); actor_role text; target text; assigned uuid;
begin
  select role into actor_role from public.profiles where id=actor and status='active' and (company_id=p_company_id or role='sephs_admin');
  if actor is null or actor_role is null or not public.auris_can_access_company(p_company_id) then raise exception 'AURIS_MONTH_REVIEW_DENIED' using errcode='42501';end if;
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
    assigned:=case when item.status='submitted' then (item.route->>'reviewer')::uuid else (item.route->>'approver')::uuid end;
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

revoke all on function public.lock_kpi_monthly_review(uuid),public.guard_kpi_monthly_review(),public.kpi_monthly_review_route(uuid),public.kpi_monthly_review_snapshot(uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.get_kpi_monthly_review(uuid,integer,integer),public.transition_kpi_monthly_review(uuid,integer,integer,uuid,integer,text,text,text) from public,anon;
grant execute on function public.get_kpi_monthly_review(uuid,integer,integer),public.transition_kpi_monthly_review(uuid,integer,integer,uuid,integer,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
