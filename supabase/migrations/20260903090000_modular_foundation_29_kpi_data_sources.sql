-- Phase 29: governed KPI calculations from tenant operational modules.

alter table public.kpi_indicators
  add column if not exists source_mode text not null default 'manual',
  add column if not exists source_metric text,
  add column if not exists source_filter jsonb not null default '{}'::jsonb,
  add column if not exists source_revision integer not null default 1,
  add column if not exists source_updated_at timestamptz,
  add column if not exists source_updated_by uuid references auth.users(id) on delete set null;

alter table public.kpi_indicators drop constraint if exists kpi_indicators_source_mode_check;
alter table public.kpi_indicators add constraint kpi_indicators_source_mode_check check (source_mode in ('manual','module'));
alter table public.kpi_indicators drop constraint if exists kpi_indicators_source_revision_check;
alter table public.kpi_indicators add constraint kpi_indicators_source_revision_check check (source_revision>0);

alter table public.kpi_monthly_data
  add column if not exists entry_mode text not null default 'manual',
  add column if not exists result_revision integer not null default 1,
  add column if not exists source_metric text,
  add column if not exists source_period_start date,
  add column if not exists source_period_end date,
  add column if not exists source_record_count integer,
  add column if not exists source_evidence jsonb not null default '{}'::jsonb,
  add column if not exists calculated_at timestamptz,
  add column if not exists overridden_from numeric,
  add column if not exists override_reason text,
  add column if not exists overridden_by uuid references auth.users(id) on delete set null,
  add column if not exists overridden_at timestamptz;

alter table public.kpi_monthly_data drop constraint if exists kpi_monthly_data_entry_mode_check;
alter table public.kpi_monthly_data add constraint kpi_monthly_data_entry_mode_check check (entry_mode in ('manual','automatic','override'));
alter table public.kpi_monthly_data drop constraint if exists kpi_monthly_data_result_revision_check;
alter table public.kpi_monthly_data add constraint kpi_monthly_data_result_revision_check check (result_revision>0);

create index if not exists idx_kpi_indicators_company_source on public.kpi_indicators(company_id,source_mode,source_metric);
create index if not exists idx_kpi_monthly_data_company_source on public.kpi_monthly_data(company_id,source_metric,year,month);

create or replace function public.configure_kpi_indicator_source(
  p_company_id uuid,p_indicator_id uuid,p_source_mode text,p_source_metric text default null,
  p_source_filter jsonb default '{}'::jsonb,p_expected_revision integer default null
) returns public.kpi_indicators
language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.kpi_indicators; parent public.kpis_v2; actor_role text;
begin
  select * into item from public.kpi_indicators where id=p_indicator_id for update;
  if not found then raise exception 'AURIS_KPI_INDICATOR_NOT_FOUND' using errcode='P0002';end if;
  select * into parent from public.kpis_v2 where id=item.kpi_id;
  if item.company_id<>p_company_id or parent.company_id<>p_company_id or not public.auris_can_access_company(p_company_id) then raise exception 'AURIS_KPI_TENANT_MISMATCH' using errcode='42501';end if;
  select role into actor_role from public.profiles where id=auth.uid() and (company_id=p_company_id or role='sephs_admin');
  if actor_role not in ('hse_officer','hse_manager','admin','sephs_admin') then raise exception 'AURIS_KPI_SOURCE_CONFIG_DENIED' using errcode='42501';end if;
  if parent.approval_status not in ('draft','rejected','revision_requested') then raise exception 'AURIS_KPI_DEFINITION_FROZEN' using errcode='42501';end if;
  if p_expected_revision is not null and item.source_revision<>p_expected_revision then raise exception 'AURIS_KPI_SOURCE_REVISION_CONFLICT' using errcode='40001';end if;
  if p_source_mode not in ('manual','module') then raise exception 'AURIS_KPI_SOURCE_MODE_INVALID' using errcode='22023';end if;
  if p_source_mode='module' and coalesce(p_source_metric,'') not in (
    'events.reported','events.lost_time','observations.reported','observations.closed',
    'inspections.completed','toolbox.completed','training.completed','risk.high_open',
    'actions.closed','actions.overdue_open'
  ) then raise exception 'AURIS_KPI_SOURCE_METRIC_UNSUPPORTED' using errcode='22023';end if;
  if jsonb_typeof(coalesce(p_source_filter,'{}'::jsonb))<>'object' then raise exception 'AURIS_KPI_SOURCE_FILTER_INVALID' using errcode='22023';end if;
  perform set_config('auris.kpi_result_write','allowed',true);
  update public.kpi_indicators set source_mode=p_source_mode,source_metric=case when p_source_mode='module' then p_source_metric end,
    source_filter=coalesce(p_source_filter,'{}'::jsonb),source_revision=source_revision+1,source_updated_at=now(),source_updated_by=auth.uid()
  where id=item.id returning * into item;
  insert into public.audit_events(company_id,actor_user_id,actor_role,action,module_name,related_table,related_id,summary,details,event_code)
  values(p_company_id,auth.uid(),actor_role,'configure','kpi','kpi_indicators',item.id,'KPI indicator data source configured',jsonb_build_object('mode',item.source_mode,'metric',item.source_metric,'filter',item.source_filter,'source_revision',item.source_revision),'kpi.source_configured');
  return item;
end;$$;

create or replace function public.refresh_kpi_indicator_month(
  p_company_id uuid,p_indicator_id uuid,p_year integer,p_month integer,p_expected_source_revision integer default null
) returns public.kpi_monthly_data
language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.kpi_indicators; parent public.kpis_v2; existing public.kpi_monthly_data; saved public.kpi_monthly_data;
  actor_role text; period_start date; period_end date; result_value numeric:=0; record_count integer:=0; ytd_value numeric:=0;
begin
  if p_month<1 or p_month>12 or p_year<2000 or p_year>2200 then raise exception 'AURIS_KPI_PERIOD_INVALID' using errcode='22023';end if;
  select * into item from public.kpi_indicators where id=p_indicator_id for update;
  if not found then raise exception 'AURIS_KPI_INDICATOR_NOT_FOUND' using errcode='P0002';end if;
  select * into parent from public.kpis_v2 where id=item.kpi_id;
  if item.company_id<>p_company_id or parent.company_id<>p_company_id or not public.auris_can_access_company(p_company_id) then raise exception 'AURIS_KPI_TENANT_MISMATCH' using errcode='42501';end if;
  select role into actor_role from public.profiles where id=auth.uid() and (company_id=p_company_id or role='sephs_admin');
  if actor_role not in ('inspector','manager','hse_officer','hse_manager','admin','sephs_admin') then raise exception 'AURIS_KPI_REFRESH_DENIED' using errcode='42501';end if;
  if item.source_mode<>'module' or item.source_metric is null then raise exception 'AURIS_KPI_SOURCE_NOT_CONFIGURED' using errcode='22023';end if;
  if p_expected_source_revision is not null and item.source_revision<>p_expected_source_revision then raise exception 'AURIS_KPI_SOURCE_REVISION_CONFLICT' using errcode='40001';end if;
  period_start:=make_date(p_year,p_month,1);period_end:=(period_start+interval '1 month')::date;
  if item.source_metric='events.reported' then select count(*) into record_count from public.events where company_id=p_company_id and coalesce(event_date,created_at)>=period_start and coalesce(event_date,created_at)<period_end;
  elsif item.source_metric='events.lost_time' then select count(*) into record_count from public.events where company_id=p_company_id and coalesce(event_date,created_at)>=period_start and coalesce(event_date,created_at)<period_end and (coalesce(lost_time_days,0)>0 or event_type='lost_time');
  elsif item.source_metric='observations.reported' then select count(*) into record_count from public.safety_observations where company_id=p_company_id and observation_date>=period_start and observation_date<period_end;
  elsif item.source_metric='observations.closed' then select count(*) into record_count from public.safety_observations where company_id=p_company_id and observation_date>=period_start and observation_date<period_end and status in ('closed','acknowledged');
  elsif item.source_metric='inspections.completed' then select count(*) into record_count from public.inspections where company_id=p_company_id and coalesce(actual_date,inspection_date)>=period_start and coalesce(actual_date,inspection_date)<period_end and status in ('completed','closed','approved');
  elsif item.source_metric='toolbox.completed' then select count(*) into record_count from public.toolbox_talks where company_id=p_company_id and talk_date>=period_start and talk_date<period_end and status='completed';
  elsif item.source_metric='training.completed' then select count(*) into record_count from public.training_plan where company_id=p_company_id and coalesce(actual_date,planned_date)>=period_start and coalesce(actual_date,planned_date)<period_end and status='completed';
  elsif item.source_metric='risk.high_open' then select count(*) into record_count from public.risk_assessments where company_id=p_company_id and coalesce(assessment_date,created_at::date)<period_end and status not in ('closed','archived','rejected') and (overall_risk_level in ('high','critical') or coalesce(overall_risk_score,0)>=15);
  elsif item.source_metric='actions.closed' then select count(*) into record_count from public.action_tracker where company_id=p_company_id and coalesce(completion_date,completed_date)>=period_start and coalesce(completion_date,completed_date)<period_end and status='closed';
  elsif item.source_metric='actions.overdue_open' then select count(*) into record_count from public.action_tracker where company_id=p_company_id and coalesce(target_date,due_date)<period_end and status in ('open','in_progress','overdue');
  else raise exception 'AURIS_KPI_SOURCE_METRIC_UNSUPPORTED' using errcode='22023';end if;
  result_value:=record_count;
  select * into existing from public.kpi_monthly_data where indicator_id=item.id and year=p_year and month=p_month for update;
  perform set_config('auris.kpi_result_write','allowed',true);
  insert into public.kpi_monthly_data(kpi_id,company_id,year,month,actual,ytd,comment,entered_by,entered_at,indicator_id,entry_mode,result_revision,source_metric,source_period_start,source_period_end,source_record_count,source_evidence,calculated_at,overridden_from,override_reason,overridden_by,overridden_at)
  values(item.kpi_id,p_company_id,p_year,p_month,result_value,result_value,'Calculated from AURIS module source',auth.uid(),now(),item.id,'automatic',coalesce(existing.result_revision,0)+1,item.source_metric,period_start,period_end,record_count,jsonb_build_object('metric',item.source_metric,'record_count',record_count,'company_id',p_company_id,'period_start',period_start,'period_end_exclusive',period_end,'source_revision',item.source_revision),now(),null,null,null,null)
  on conflict(indicator_id,year,month) do update set actual=excluded.actual,comment=excluded.comment,entered_by=excluded.entered_by,entered_at=excluded.entered_at,entry_mode='automatic',result_revision=public.kpi_monthly_data.result_revision+1,source_metric=excluded.source_metric,source_period_start=excluded.source_period_start,source_period_end=excluded.source_period_end,source_record_count=excluded.source_record_count,source_evidence=excluded.source_evidence,calculated_at=excluded.calculated_at,overridden_from=null,override_reason=null,overridden_by=null,overridden_at=null
  returning * into saved;
  select case item.ytd_method when 'average' then avg(actual) when 'last' then (array_agg(actual order by month desc))[1] when 'max' then max(actual) when 'min' then min(actual) else sum(actual) end into ytd_value from public.kpi_monthly_data where indicator_id=item.id and year=p_year and month<=p_month and actual is not null;
  update public.kpi_monthly_data set ytd=ytd_value where id=saved.id returning * into saved;
  insert into public.audit_events(company_id,actor_user_id,actor_role,action,module_name,related_table,related_id,summary,details,event_code)
  values(p_company_id,auth.uid(),actor_role,'calculate','kpi','kpi_monthly_data',saved.id,'KPI result refreshed from governed module source',saved.source_evidence||jsonb_build_object('indicator_id',item.id,'result',saved.actual,'result_revision',saved.result_revision),'kpi.source_refreshed');
  return saved;
end;$$;

create or replace function public.override_kpi_monthly_result(
  p_company_id uuid,p_monthly_data_id uuid,p_actual numeric,p_reason text,p_expected_revision integer default null
) returns public.kpi_monthly_data
language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.kpi_monthly_data; indicator public.kpi_indicators; actor_role text; allow_override boolean:=false; saved public.kpi_monthly_data; ytd_value numeric:=0;
begin
  if nullif(trim(p_reason),'') is null then raise exception 'AURIS_KPI_OVERRIDE_REASON_REQUIRED' using errcode='22023';end if;
  select * into item from public.kpi_monthly_data where id=p_monthly_data_id for update;
  if not found then raise exception 'AURIS_KPI_RESULT_NOT_FOUND' using errcode='P0002';end if;
  select * into indicator from public.kpi_indicators where id=item.indicator_id;
  if item.company_id<>p_company_id or indicator.company_id<>p_company_id or not public.auris_can_access_company(p_company_id) then raise exception 'AURIS_KPI_TENANT_MISMATCH' using errcode='42501';end if;
  select role into actor_role from public.profiles where id=auth.uid() and (company_id=p_company_id or role='sephs_admin');
  if actor_role not in ('hse_manager','admin','sephs_admin') then raise exception 'AURIS_KPI_OVERRIDE_DENIED' using errcode='42501';end if;
  select coalesce((configuration#>>'{sources,allow_manual_override}')::boolean,false) into allow_override from public.kpi_config_versions where company_id=p_company_id and status='published' order by version_no desc limit 1;
  if not allow_override then raise exception 'AURIS_KPI_OVERRIDE_DISABLED' using errcode='42501';end if;
  if item.entry_mode not in ('automatic','override') or indicator.source_mode<>'module' then raise exception 'AURIS_KPI_OVERRIDE_SOURCE_REQUIRED' using errcode='22023';end if;
  if p_expected_revision is not null and item.result_revision<>p_expected_revision then raise exception 'AURIS_KPI_RESULT_REVISION_CONFLICT' using errcode='40001';end if;
  perform set_config('auris.kpi_result_write','allowed',true);
  update public.kpi_monthly_data set overridden_from=actual,actual=p_actual,entry_mode='override',override_reason=trim(p_reason),overridden_by=auth.uid(),overridden_at=now(),entered_by=auth.uid(),entered_at=now(),result_revision=result_revision+1 where id=item.id returning * into saved;
  select case indicator.ytd_method when 'average' then avg(actual) when 'last' then (array_agg(actual order by month desc))[1] when 'max' then max(actual) when 'min' then min(actual) else sum(actual) end into ytd_value from public.kpi_monthly_data where indicator_id=indicator.id and year=saved.year and month<=saved.month and actual is not null;
  update public.kpi_monthly_data set ytd=ytd_value where id=saved.id returning * into saved;
  insert into public.audit_events(company_id,actor_user_id,actor_role,action,module_name,related_table,related_id,summary,details,event_code)
  values(p_company_id,auth.uid(),actor_role,'override','kpi','kpi_monthly_data',saved.id,'Automatic KPI result manually overridden',jsonb_build_object('indicator_id',saved.indicator_id,'source_metric',saved.source_metric,'previous_actual',item.actual,'new_actual',saved.actual,'reason',trim(p_reason),'source_evidence',saved.source_evidence,'result_revision',saved.result_revision),'kpi.result_overridden');
  return saved;
end;$$;

create or replace function public.protect_governed_kpi_child()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare parent_id uuid; parent_state text;
begin
  if current_setting('auris.kpi_result_write',true)='allowed' then if tg_op='DELETE' then return old;end if;return new;end if;
  parent_id:=case when tg_op='DELETE' then old.kpi_id else new.kpi_id end;
  select approval_status into parent_state from public.kpis_v2 where id=parent_id;
  if parent_state in ('submitted','verified','approved','locked') then raise exception 'AURIS_KPI_DATA_FROZEN' using errcode='42501';end if;
  if tg_op='DELETE' then return old;end if;return new;
end;$$;

revoke all on function public.configure_kpi_indicator_source(uuid,uuid,text,text,jsonb,integer) from public,anon;
revoke all on function public.refresh_kpi_indicator_month(uuid,uuid,integer,integer,integer) from public,anon;
revoke all on function public.override_kpi_monthly_result(uuid,uuid,numeric,text,integer) from public,anon;
grant execute on function public.configure_kpi_indicator_source(uuid,uuid,text,text,jsonb,integer) to authenticated;
grant execute on function public.refresh_kpi_indicator_month(uuid,uuid,integer,integer,integer) to authenticated;
grant execute on function public.override_kpi_monthly_result(uuid,uuid,numeric,text,integer) to authenticated;

comment on function public.refresh_kpi_indicator_month(uuid,uuid,integer,integer,integer) is 'Calculates one tenant KPI month from a fixed approved AURIS module metric and records source evidence.';
comment on function public.override_kpi_monthly_result(uuid,uuid,numeric,text,integer) is 'Applies a reasoned, revision-safe override when the published company configuration permits it.';

notify pgrst,'reload schema';
