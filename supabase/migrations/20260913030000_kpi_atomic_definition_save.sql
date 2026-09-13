-- One transaction for a KPI definition, indicators and derived YTD values.
begin;

alter table public.kpis_v2 add column if not exists definition_revision bigint not null default 1;

create or replace function public.advance_kpi_definition_revision()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  new.definition_revision := old.definition_revision + 1;
  return new;
end;$$;

-- Run after the existing governance check. Callers cannot supply the revision.
drop trigger if exists trg_zz_kpi_definition_revision on public.kpis_v2;
create trigger trg_zz_kpi_definition_revision before update on public.kpis_v2
for each row execute function public.advance_kpi_definition_revision();

create or replace function public.lock_kpi_definition_parent()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare
  parent_id uuid;
  tenant_id uuid;
begin
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.company_id is distinct from old.company_id
      or new.kpi_id is distinct from old.kpi_id) then
    raise exception 'AURIS_KPI_IDENTITY_IMMUTABLE' using errcode='23514';
  end if;
  parent_id := case when tg_op='DELETE' then old.kpi_id else new.kpi_id end;
  tenant_id := case when tg_op='DELETE' then old.company_id else new.company_id end;
  if tg_table_name='kpi_monthly_data' then
    if tg_op='UPDATE' and new.indicator_id is distinct from old.indicator_id then
      raise exception 'AURIS_KPI_IDENTITY_IMMUTABLE' using errcode='23514';
    end if;
    select i.kpi_id into parent_id from public.kpi_indicators i
      where i.id=case when tg_op='DELETE' then old.indicator_id else new.indicator_id end
        and i.company_id=tenant_id and (parent_id is null or i.kpi_id=parent_id);
    perform 1 from public.kpis_v2 where id=parent_id and company_id=tenant_id for update;
  else
    -- Also advance the version for older REST indicator writers.
    update public.kpis_v2 set updated_at=updated_at where id=parent_id and company_id=tenant_id;
  end if;
  if not found then
    -- An existing parent deletion may cascade to its children.
    if tg_op='DELETE' and pg_trigger_depth()>1 then return old;end if;
    raise exception 'AURIS_KPI_PARENT_REQUIRED' using errcode='23503';
  end if;
  if tg_op='DELETE' then return old;end if;
  return new;
end;$$;

drop trigger if exists trg_a_lock_kpi_indicator_parent on public.kpi_indicators;
create trigger trg_a_lock_kpi_indicator_parent before insert or update or delete on public.kpi_indicators
for each row execute function public.lock_kpi_definition_parent();
drop trigger if exists trg_a_lock_kpi_monthly_parent on public.kpi_monthly_data;
create trigger trg_a_lock_kpi_monthly_parent before insert or update or delete on public.kpi_monthly_data
for each row execute function public.lock_kpi_definition_parent();

create or replace function public.save_kpi_definition(
  p_company_id uuid, p_kpi_id uuid, p_expected_revision bigint,
  p_expected_indicators jsonb, p_definition jsonb, p_indicators jsonb
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor_role text;
  item public.kpis_v2%rowtype;
  desired public.kpis_v2%rowtype;
  indicator public.kpi_indicators%rowtype;
  input_row jsonb;
  expected_rows jsonb;
  current_rows jsonb;
  retained_ids uuid[] := '{}';
  saved_ids uuid[] := '{}';
  result jsonb;
begin
  -- Explicit authorization is required before definer access. This lets history
  -- checks see even inconsistent legacy child rows hidden by tenant RLS.
  select role into actor_role from public.profiles
    where id=auth.uid() and status='active'
      and (company_id=p_company_id or role='sephs_admin');
  if auth.uid() is null or p_company_id is null or actor_role is null
      or actor_role not in ('manager','admin','sephs_admin')
      or not public.auris_can_access_company(p_company_id) then
    raise exception 'AURIS_KPI_SAVE_DENIED' using errcode='42501';
  end if;
  if jsonb_typeof(p_definition) is distinct from 'object'
      or jsonb_typeof(p_indicators) is distinct from 'array'
      or jsonb_array_length(p_indicators) not between 1 and 100
      or jsonb_typeof(p_expected_indicators) is distinct from 'array' then
    raise exception 'AURIS_KPI_INVALID_DEFINITION' using errcode='22023';
  end if;
  desired := jsonb_populate_record(null::public.kpis_v2,p_definition);
  if desired.company_id is distinct from p_company_id or nullif(btrim(desired.name),'') is null
      or desired.year is null or desired.year not between 1900 and 9999
      or desired.frequency is null then
    raise exception 'AURIS_KPI_INVALID_DEFINITION' using errcode='22023';
  end if;
  if p_kpi_id is not null then
    select * into item from public.kpis_v2 where id=p_kpi_id and company_id=p_company_id for update;
    if not found then raise exception 'AURIS_KPI_NOT_FOUND' using errcode='P0002';end if;
    -- Business conflicts must not use 40001, which PostgREST may retry.
    if item.definition_revision is distinct from p_expected_revision then
      raise exception 'AURIS_KPI_EDIT_CONFLICT' using errcode='PT409';
    end if;
    if coalesce(item.approval_status,'') not in ('draft','rejected','revision_requested') or item.status='archived' then
      raise exception 'AURIS_KPI_DEFINITION_FROZEN' using errcode='42501';
    end if;
    if item.year is distinct from desired.year then
      raise exception 'AURIS_KPI_YEAR_MISMATCH' using errcode='23514';
    end if;
    select coalesce(jsonb_agg(to_jsonb(i)-'created_at' order by i.id),'[]') into current_rows
      from public.kpi_indicators i where i.kpi_id=item.id;
    select coalesce(jsonb_agg(value order by value->>'id'),'[]') into expected_rows
      from jsonb_array_elements(p_expected_indicators);
    if current_rows is distinct from expected_rows then
      raise exception 'AURIS_KPI_EDIT_CONFLICT' using errcode='PT409';
    end if;
  elsif p_expected_revision is not null or p_expected_indicators<>'[]' then
    raise exception 'AURIS_KPI_INVALID_BASELINE' using errcode='22023';
  end if;
  -- This lock also makes an objective move/archive conflict with this save.
  perform 1 from public.objectives where id=desired.objective_id and company_id=p_company_id
    and year=desired.year and name !~* '^\[Archived' for share;
  if not found then raise exception 'AURIS_KPI_OBJECTIVE_REQUIRED' using errcode='23503';end if;

  for input_row in select value from jsonb_array_elements(p_indicators) loop
    if jsonb_typeof(input_row) is distinct from 'object' or nullif(btrim(input_row->>'name'),'') is null then
      raise exception 'AURIS_KPI_INVALID_INDICATOR' using errcode='22023';
    end if;
    if nullif(input_row->>'id','') is not null then
      if p_kpi_id is null or (input_row->>'id')::uuid=any(retained_ids)
          or not exists(select 1 from public.kpi_indicators where id=(input_row->>'id')::uuid
            and kpi_id=p_kpi_id and company_id=p_company_id) then
        raise exception 'AURIS_KPI_INDICATOR_MISMATCH' using errcode='23503';
      end if;
      retained_ids := array_append(retained_ids,(input_row->>'id')::uuid);
    end if;
  end loop;
  if exists(select 1 from public.kpi_indicators i join public.kpi_monthly_data m on m.indicator_id=i.id
      where i.kpi_id=p_kpi_id and not i.id=any(retained_ids)) then
    raise exception 'AURIS_KPI_INDICATOR_HAS_HISTORY' using errcode='23503';
  end if;
  if exists(select 1 from public.kpi_indicators i join public.kpi_monthly_data m on m.indicator_id=i.id
      where i.kpi_id=p_kpi_id and (i.company_id is distinct from p_company_id
        or m.company_id is distinct from p_company_id or (m.kpi_id is not null and m.kpi_id<>p_kpi_id))) then
    raise exception 'AURIS_KPI_HISTORY_SCOPE_MISMATCH' using errcode='23514';
  end if;

  if p_kpi_id is null then
    insert into public.kpis_v2(company_id,objective_id,code,name,description,frequency,responsible,
      data_provider,data_source,reviewer,approver,year,planned_months,created_by,approval_status,status)
    values(p_company_id,desired.objective_id,desired.code,desired.name,desired.description,desired.frequency,
      desired.responsible,desired.data_provider,desired.data_source,desired.reviewer,desired.approver,
      desired.year,coalesce(desired.planned_months,'{}'),auth.uid(),'draft','not_started') returning * into item;
  else
    update public.kpis_v2 set objective_id=desired.objective_id,code=desired.code,name=desired.name,
      description=desired.description,frequency=desired.frequency,responsible=desired.responsible,
      data_provider=desired.data_provider,data_source=desired.data_source,reviewer=desired.reviewer,
      approver=desired.approver,planned_months=coalesce(desired.planned_months,'{}'),updated_at=clock_timestamp()
      where id=item.id returning * into item;
  end if;
  for input_row in select value from jsonb_array_elements(p_indicators) loop
    indicator := jsonb_populate_record(null::public.kpi_indicators,input_row);
    if indicator.id is null then
      insert into public.kpi_indicators(kpi_id,company_id,name,target_value,target_operator,unit,ytd_method,sort_order)
        values(item.id,p_company_id,indicator.name,indicator.target_value,indicator.target_operator,
          indicator.unit,indicator.ytd_method,cardinality(saved_ids)) returning * into indicator;
    else
      update public.kpi_indicators set name=indicator.name,target_value=indicator.target_value,
        target_operator=indicator.target_operator,unit=indicator.unit,ytd_method=indicator.ytd_method,
        sort_order=cardinality(saved_ids) where id=indicator.id and kpi_id=item.id and company_id=p_company_id
        returning * into indicator;
    end if;
    if indicator.target_operator is null or indicator.ytd_method is null then
      raise exception 'AURIS_KPI_INVALID_INDICATOR' using errcode='22023';
    end if;
    saved_ids := array_append(saved_ids,indicator.id);
  end loop;
  delete from public.kpi_indicators where kpi_id=item.id and company_id=p_company_id and not id=any(saved_ids);

  -- Derive YTD for every recorded year; retain actuals, evidence and authorship.
  -- floor(x+0.5) matches the editor's Math.round tie direction, including negatives.
  with totals as (
    select m.id,case i.ytd_method
      when 'last' then (select p.actual from public.kpi_monthly_data p where p.indicator_id=m.indicator_id
        and p.company_id=p_company_id and p.year=m.year and p.month<=m.month and p.actual is not null order by p.month desc limit 1)
      when 'average' then floor((select avg(p.actual) from public.kpi_monthly_data p where p.indicator_id=m.indicator_id and p.year=m.year and p.month<=m.month)*100+0.5)/100
      when 'max' then (select max(p.actual) from public.kpi_monthly_data p where p.indicator_id=m.indicator_id and p.year=m.year and p.month<=m.month)
      when 'min' then (select min(p.actual) from public.kpi_monthly_data p where p.indicator_id=m.indicator_id and p.year=m.year and p.month<=m.month)
      else floor((select sum(p.actual) from public.kpi_monthly_data p where p.indicator_id=m.indicator_id and p.year=m.year and p.month<=m.month)*100+0.5)/100 end as ytd
    from public.kpi_monthly_data m join public.kpi_indicators i on i.id=m.indicator_id
    where i.kpi_id=item.id and m.company_id=p_company_id
  ) update public.kpi_monthly_data m set ytd=t.ytd from totals t where m.id=t.id and m.ytd is distinct from t.ytd;

  insert into public.audit_events(company_id,actor_user_id,actor_role,action,module_name,related_table,related_id,related_ref,summary,details,event_code)
    values(p_company_id,auth.uid(),actor_role,case when p_kpi_id is null then 'create' else 'update' end,
      'kpi','kpis_v2',item.id,item.code,'KPI definition saved',jsonb_build_object('indicator_ids',saved_ids),'kpi.definition_saved');
  select jsonb_build_object('kpi',to_jsonb(k),
    'indicators',(select coalesce(jsonb_agg(to_jsonb(i) order by i.sort_order),'[]') from public.kpi_indicators i where i.kpi_id=k.id and i.company_id=p_company_id),
    'monthly',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.kpi_monthly_data m where m.indicator_id=any(saved_ids) and m.company_id=p_company_id and m.year=k.year))
    into result from public.kpis_v2 k where k.id=item.id;
  return result;
end;$$;

revoke all on function public.advance_kpi_definition_revision() from public,anon,authenticated;
revoke all on function public.lock_kpi_definition_parent() from public,anon,authenticated;
revoke all on function public.save_kpi_definition(uuid,uuid,bigint,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.save_kpi_definition(uuid,uuid,bigint,jsonb,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
