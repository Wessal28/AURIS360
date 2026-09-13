-- Manual monthly reporting: compare the opened version, write, recalculate and audit together.
begin;

create or replace function public.advance_kpi_monthly_revision()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' then
    if new.year is distinct from old.year or new.month is distinct from old.month then
      raise exception 'AURIS_KPI_PERIOD_IMMUTABLE' using errcode='23514';
    end if;
    new.result_revision := old.result_revision + 1;
  else new.result_revision := 1;
  end if;
  return new;
end;$$;
drop trigger if exists trg_zz_kpi_monthly_revision on public.kpi_monthly_data;
create trigger trg_zz_kpi_monthly_revision before insert or update on public.kpi_monthly_data
for each row execute function public.advance_kpi_monthly_revision();

-- Only the internal reporting status update may leave the definition revision intact.
-- The exact field comparison prevents this capability from changing a controlled definition.
create or replace function public.advance_kpi_definition_revision()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if current_setting('auris.kpi_monthly_status',true)='allowed'
      and old.status<>'archived' and new.status<>'archived'
      and to_jsonb(new)-array['status','updated_at'] = to_jsonb(old)-array['status','updated_at'] then
    new.definition_revision := old.definition_revision;
  else new.definition_revision := old.definition_revision+1;
  end if;
  return new;
end;$$;
create or replace function public.protect_governed_kpi_record()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if current_setting('auris.kpi_monthly_status',true)='allowed'
      and old.status<>'archived' and new.status<>'archived'
      and to_jsonb(new)-array['status','updated_at'] = to_jsonb(old)-array['status','updated_at'] then return new;end if;
  if old.approval_status in ('submitted','verified','approved','locked')
      and to_jsonb(old)-array['approval_status','lifecycle_revision','lifecycle_reason','submitted_by','submitted_at','verified_by','verified_at','approved_by','approved_at','locked_by','locked_at','updated_at']
        is distinct from to_jsonb(new)-array['approval_status','lifecycle_revision','lifecycle_reason','submitted_by','submitted_at','verified_by','verified_at','approved_by','approved_at','locked_by','locked_at','updated_at'] then
    raise exception 'AURIS_KPI_DEFINITION_FROZEN' using errcode='42501';
  end if;
  if old.approval_status='locked' and new.approval_status<>'locked' then raise exception 'AURIS_KPI_LOCKED' using errcode='42501';end if;
  return new;
end;$$;

-- Same operator and threshold rules as kpiXEvaluate; never supplied by the caller.
create or replace function public.kpi_monthly_score(i jsonb, actual numeric, previous numeric, config jsonb)
returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare
  op text:=coalesce(i->>'target_operator','gte'); target numeric:=(i->>'target_value')::numeric; ceiling numeric:=(i->>'target_value_max')::numeric;
  ok boolean:=false; near boolean:=false; score numeric:=0; gap numeric; status text;
  risk numeric:=coalesce((config#>>'{targets,at_risk_percent}')::numeric,85);
begin
  if actual is null then return jsonb_build_object('status','data_missing','score',null);end if;
  if op in ('zero','zero_tolerance') then ok:=actual=0;score:=case when ok then 100 else 0 end;
  elsif op in ('trend_up','trend_down') then
    if previous is null then return jsonb_build_object('status','not_started','score',null);end if;
    ok:=case when op='trend_up' then actual>=previous else actual<=previous end;
    near:=not ok and abs(actual-previous)<=greatest(abs(previous)*.1,1);
    score:=case when ok then 100 when near then 85 else greatest(0,100-abs(actual-previous)/greatest(abs(previous),1)*100) end;
  elsif op='between' then
    if target is null or ceiling is null then return jsonb_build_object('status','not_started','score',null);end if;
    ok:=actual between least(target,ceiling) and greatest(target,ceiling);
    gap:=case when actual<target then target-actual when actual>ceiling then actual-ceiling else 0 end;
    near:=not ok and gap<=greatest(abs(ceiling-target)*.1,1);
    score:=case when ok then 100 when near then 85 else greatest(0,100-gap/greatest(abs(ceiling-target),1)*100) end;
  elsif target is null then return jsonb_build_object('status','not_started','score',null);
  elsif op='eq' then
    ok:=actual=target;near:=not ok and abs(actual-target)<=greatest(abs(target)*.1,.01);
    score:=case when ok then 100 when near then 85 else greatest(0,100-abs(actual-target)/greatest(abs(target),1)*100) end;
  elsif op in ('lte','lt') then
    ok:=case when op='lte' then actual<=target else actual<target end;
    score:=case when ok then 100 when target=0 then 0 else greatest(0,target/greatest(actual,.0001)*100) end;
  else
    ok:=case when op='gt' then actual>target else actual>=target end;
    score:=case when ok then 100 when target=0 then 0 else greatest(0,actual/target*100) end;
  end if;
  score:=floor(least(100,greatest(0,score))+.5);
  status:=case when ok then 'on_track' when score>=risk then 'at_risk' else 'off_track' end;
  if op in ('zero','zero_tolerance') and coalesce((config#>>'{targets,zero_tolerance_override}')::boolean,true) and actual<>0 then status:='off_track';end if;
  return jsonb_build_object('status',status,'score',score);
end;$$;

create or replace function public.kpi_monthly_status(k public.kpis_v2, config jsonb, reporting_month integer, compilation_month integer)
returns text language plpgsql set search_path=public,pg_temp as $$
declare
  i public.kpi_indicators%rowtype; m public.kpi_monthly_data%rowtype; due integer; previous numeric;
  snap jsonb; statuses text[]:='{}'; scores numeric[]:='{}'; status text; score numeric;
begin
  for i in select * from public.kpi_indicators where kpi_id=k.id and company_id=k.company_id loop
    if cardinality(k.planned_months)>0 then select max(n) into due from unnest(k.planned_months) n where n<=reporting_month;
    elsif lower(k.frequency) in ('annual','annually') then
      select coalesce(max(month),reporting_month) into due from public.kpi_monthly_data where indicator_id=i.id and company_id=k.company_id and year=k.year and actual is not null;
    elsif lower(k.frequency) like '%biannual%' then due:=case when reporting_month>=12 then 12 when reporting_month>=6 then 6 else 0 end;
    elsif lower(k.frequency) like '%quarter%' then due:=(reporting_month/3)*3;
    else due:=reporting_month;end if;
    if coalesce(due,0)=0 or due>reporting_month then snap:='{"status":"not_due","score":null}';
    else
      select * into m from public.kpi_monthly_data where indicator_id=i.id and company_id=k.company_id and year=k.year and month=due;
      if not found then snap:=jsonb_build_object('status',case when due>compilation_month then 'in_progress' else 'data_missing' end,'score',null);
      else
        select actual into previous from public.kpi_monthly_data where indicator_id=i.id and company_id=k.company_id and year=k.year and month<due order by month desc limit 1;
        snap:=public.kpi_monthly_score(to_jsonb(i),m.actual,previous,config);
      end if;
    end if;
    statuses:=array_append(statuses,snap->>'status');
    if snap->>'score' is not null then scores:=array_append(scores,(snap->>'score')::numeric);end if;
  end loop;
  if cardinality(statuses)=0 then return 'not_started';end if;
  status:=case when 'off_track'=any(statuses) then 'off_track' when 'data_missing'=any(statuses) then 'data_missing'
    when 'at_risk'=any(statuses) then 'at_risk' when 'in_progress'=any(statuses) then 'in_progress'
    when 'not_due'=all(statuses) then 'not_due' when 'not_started'=all(statuses) then 'not_started' else 'on_track' end;
  if coalesce((config#>>'{targets,critical_override}')::boolean,true)=false and cardinality(scores)>0 and not 'data_missing'=any(statuses) then
    select case when config#>>'{calculations,aggregation}'='worst' then min(n) else avg(n) end into score from unnest(scores) n;
    status:=case when score>=coalesce((config#>>'{targets,on_track_percent}')::numeric,95) then 'on_track'
      when score>=coalesce((config#>>'{targets,at_risk_percent}')::numeric,85) then 'at_risk' else 'off_track' end;
  end if;
  -- Detailed missing/open/not-due labels remain derived in the reporting UI.
  return case when status in ('on_track','at_risk','off_track') then status else 'not_started' end;
end;$$;

create or replace function public.mutate_kpi_monthly_result(
  p_company_id uuid, p_kpi_id uuid, p_indicator_id uuid, p_year integer, p_month integer,
  p_expected_definition_revision bigint, p_expected_id uuid, p_expected_revision integer,
  p_operation text, p_entry jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor_role text; k public.kpis_v2%rowtype; i public.kpi_indicators%rowtype;
  original public.kpi_monthly_data%rowtype; saved public.kpi_monthly_data%rowtype;
  input_actual numeric; comment_text text; previous numeric; config jsonb:='{}'; evaluation jsonb;
  today date:=(current_timestamp at time zone 'UTC')::date; reporting_month integer; compilation_month integer;
  prior_setting text:=current_setting('auris.kpi_monthly_status',true); derived_status text;
begin
  select role into actor_role from public.profiles where id=auth.uid() and status='active' and (company_id=p_company_id or role='sephs_admin');
  if auth.uid() is null or p_company_id is null or actor_role is null or actor_role not in ('manager','admin','sephs_admin')
      or not public.auris_can_access_company(p_company_id) then raise exception 'AURIS_KPI_MONTHLY_DENIED' using errcode='42501';end if;
  if p_operation is null or p_operation not in ('save','clear') or p_year is null or p_month is null
      or p_month not between 1 and 12 or p_year not between 1900 and 9999 then raise exception 'AURIS_KPI_INVALID_PERIOD' using errcode='22023';end if;
  -- Parent first, the same lock order as definition saves. This also serializes different months.
  select * into k from public.kpis_v2 where id=p_kpi_id and company_id=p_company_id for update;
  if not found then raise exception 'AURIS_KPI_NOT_FOUND' using errcode='P0002';end if;
  if k.definition_revision is distinct from p_expected_definition_revision then raise exception 'AURIS_KPI_EDIT_CONFLICT' using errcode='PT409';end if;
  if k.year is distinct from p_year then raise exception 'AURIS_KPI_YEAR_MISMATCH' using errcode='23514';end if;
  if k.approval_status in ('submitted','verified') or k.status='archived' then raise exception 'AURIS_KPI_REVIEW_IN_PROGRESS' using errcode='42501';end if;
  select * into i from public.kpi_indicators where id=p_indicator_id and kpi_id=k.id and company_id=p_company_id;
  if not found then raise exception 'AURIS_KPI_INDICATOR_MISMATCH' using errcode='23503';end if;
  if exists(select 1 from public.kpi_monthly_data where indicator_id=i.id and
      (company_id is distinct from p_company_id or (kpi_id is not null and kpi_id<>k.id))) then raise exception 'AURIS_KPI_HISTORY_SCOPE_MISMATCH' using errcode='23514';end if;
  select * into original from public.kpi_monthly_data where indicator_id=i.id and company_id=p_company_id and year=p_year and month=p_month for update;
  if original.id is distinct from p_expected_id or original.result_revision is distinct from p_expected_revision then
    raise exception 'AURIS_KPI_MONTHLY_CONFLICT' using errcode='PT409';end if;
  if i.source_mode<>'manual' or (original.id is not null and original.entry_mode<>'manual') then raise exception 'AURIS_KPI_MANUAL_SOURCE_REQUIRED' using errcode='42501';end if;
  if p_operation='clear' and original.id is null then raise exception 'AURIS_KPI_MONTHLY_NOT_FOUND' using errcode='P0002';end if;
  if p_operation='save' then
    if p_year>extract(year from today) or (p_year=extract(year from today) and p_month>extract(month from today)) then raise exception 'AURIS_KPI_FUTURE_PERIOD' using errcode='22023';end if;
    if cardinality(k.planned_months)>0 and not p_month=any(k.planned_months) and original.actual is null then raise exception 'AURIS_KPI_UNPLANNED_PERIOD' using errcode='22023';end if;
    if lower(k.frequency) in ('annual','annually') and exists(select 1 from public.kpi_monthly_data where indicator_id=i.id and company_id=p_company_id and year=p_year and month<>p_month and actual is not null) then raise exception 'AURIS_KPI_ANNUAL_RESULT_EXISTS' using errcode='PT409';end if;
    if jsonb_typeof(p_entry) is distinct from 'object' or jsonb_typeof(p_entry->'actual') is distinct from 'number'
        or exists(select 1 from jsonb_each(p_entry) e where e.key in ('explanation','root','evidence') and jsonb_typeof(e.value)<>'string') then raise exception 'AURIS_KPI_INVALID_RESULT' using errcode='22023';end if;
    input_actual:=(p_entry->>'actual')::numeric;
    if input_actual::text in ('NaN','Infinity','-Infinity') then raise exception 'AURIS_KPI_INVALID_RESULT' using errcode='22023';end if;
    comment_text:=btrim(coalesce(p_entry->>'explanation',''))
      ||case when nullif(btrim(p_entry->>'root'),'') is not null then E'\nRoot cause: '||btrim(p_entry->>'root') else '' end
      ||case when nullif(btrim(p_entry->>'evidence'),'') is not null then E'\nEvidence: '||btrim(p_entry->>'evidence') else '' end;
    if length(comment_text)>20000 then raise exception 'AURIS_KPI_INVALID_RESULT' using errcode='22023';end if;
  end if;
  select configuration into config from public.kpi_config_versions where company_id=p_company_id and status='published' order by version_no desc limit 1 for share;
  config:=coalesce(config,'{}');
  if p_operation='save' then
    select m.actual into previous from public.kpi_monthly_data m where indicator_id=i.id and company_id=p_company_id and year=p_year and month<p_month order by month desc limit 1;
    evaluation:=public.kpi_monthly_score(to_jsonb(i),input_actual,previous,config);
    if evaluation->>'status' in ('at_risk','off_track') and (nullif(btrim(p_entry->>'explanation'),'') is null or nullif(btrim(p_entry->>'root'),'') is null) then raise exception 'AURIS_KPI_EXPLANATION_REQUIRED' using errcode='22023';end if;
    if original.id is null then
      insert into public.kpi_monthly_data(company_id,kpi_id,indicator_id,year,month,actual,comment,entered_by)
        values(p_company_id,k.id,i.id,p_year,p_month,input_actual,nullif(comment_text,''),auth.uid()) returning * into saved;
    else
      update public.kpi_monthly_data set actual=input_actual,comment=nullif(comment_text,'') where id=original.id returning * into saved;
    end if;
  else delete from public.kpi_monthly_data where id=original.id;end if;
  -- Derive all months from current stored actuals while the parent lock is held.
  with totals as (
    select m.id,case i.ytd_method
      when 'last' then (select p.actual from public.kpi_monthly_data p where p.indicator_id=i.id and p.company_id=p_company_id and p.year=p_year and p.month<=m.month and p.actual is not null order by p.month desc limit 1)
      when 'average' then floor(avg(p.actual)*100+.5)/100 when 'max' then max(p.actual) when 'min' then min(p.actual)
      else floor(sum(p.actual)*100+.5)/100 end as ytd
    from public.kpi_monthly_data m left join public.kpi_monthly_data p on p.indicator_id=m.indicator_id and p.company_id=m.company_id and p.year=m.year and p.month<=m.month
    where m.indicator_id=i.id and m.company_id=p_company_id and m.year=p_year group by m.id,m.month
  ) update public.kpi_monthly_data m set ytd=t.ytd from totals t where m.id=t.id and m.ytd is distinct from t.ytd;
  reporting_month:=case when p_year<extract(year from today) then 12 when p_year>extract(year from today) then 0 else extract(month from today)::integer end;
  compilation_month:=case when p_year=extract(year from today) and coalesce((config#>>'{cycles,current_period_excluded}')::boolean,true) then reporting_month-1 else reporting_month end;
  derived_status:=public.kpi_monthly_status(k,config,reporting_month,compilation_month);
  perform set_config('auris.kpi_monthly_status','allowed',true);
  update public.kpis_v2 set status=derived_status,updated_at=clock_timestamp() where id=k.id and status is distinct from derived_status;
  perform set_config('auris.kpi_monthly_status',coalesce(prior_setting,''),true);
  if p_operation='save' then select * into saved from public.kpi_monthly_data where id=saved.id;end if;
  insert into public.audit_events(company_id,actor_user_id,actor_role,action,module_name,related_table,related_id,related_ref,summary,details,event_code)
    values(p_company_id,auth.uid(),actor_role,case when p_operation='clear' then 'delete' when original.id is null then 'create' else 'update' end,'kpi','kpi_monthly_data',coalesce(saved.id,original.id),k.code,
      case when p_operation='clear' then 'Monthly KPI result cleared' else 'Monthly KPI result saved' end,
      jsonb_build_object('kpi_id',k.id,'indicator_id',i.id,'year',p_year,'month',p_month,'previous',to_jsonb(original),'result',case when p_operation='save' then to_jsonb(saved) else null end),
      'kpi.monthly_'||case when p_operation='clear' then 'cleared' else 'saved' end);
  if p_operation='save' and lower(k.frequency) in ('annual','annually') and p_month<reporting_month then
    insert into public.audit_events(company_id,actor_user_id,actor_role,action,module_name,related_table,related_id,related_ref,summary,details,event_code)
      values(p_company_id,auth.uid(),actor_role,'late_entry','kpi','kpi_monthly_data',saved.id,k.code,'Annual KPI result entered for an earlier reporting month',
        jsonb_build_object('kpi_id',k.id,'indicator_id',i.id,'reporting_year',p_year,'reporting_month',p_month,'entry_month',reporting_month,'entered_at',clock_timestamp()),'kpi.monthly_late_entry');
  end if;
  return jsonb_build_object('operation',p_operation,'indicator_id',i.id,'year',p_year,'month',p_month,
    'result',case when p_operation='save' then to_jsonb(saved) else null end,
    'kpi',(select to_jsonb(t) from public.kpis_v2 t where id=k.id),
    'monthly',(select coalesce(jsonb_agg(to_jsonb(m) order by month),'[]') from public.kpi_monthly_data m where indicator_id=i.id and company_id=p_company_id and year=p_year));
end;$$;

revoke all on function public.advance_kpi_monthly_revision() from public,anon,authenticated;
revoke all on function public.kpi_monthly_score(jsonb,numeric,numeric,jsonb) from public,anon,authenticated;
revoke all on function public.kpi_monthly_status(public.kpis_v2,jsonb,integer,integer) from public,anon,authenticated;
revoke all on function public.mutate_kpi_monthly_result(uuid,uuid,uuid,integer,integer,bigint,uuid,integer,text,jsonb) from public,anon;
grant execute on function public.mutate_kpi_monthly_result(uuid,uuid,uuid,integer,integer,bigint,uuid,integer,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
