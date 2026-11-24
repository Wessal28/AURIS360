-- Restore Fleet monthly inspection saving without changing existing records.
-- The RPC retains caller RLS and commits a failed check only with its restriction,
-- defect and corrective maintenance task.
begin;
set local lock_timeout = '5s';

do $preflight$
declare missing text[] := '{}'; required record; routine oid;
begin
  if to_regprocedure('auth.uid()') is null or to_regprocedure('public.user_access_allowed(text,text)') is null then
    raise exception 'Fleet inspection setup requires the existing authentication and user access helpers.';
  end if;
  for required in select spec.table_name, unnest(string_to_array(spec.columns,',')) as column_name
    from (values
      ('profiles','id,company_id,role,status'),
      ('tools_register','id,company_id,is_vehicle,status,updated_at,location'),
      ('tool_inspections','id,company_id,tool_id,inspection_date,inspection_type,inspected_by_name,overall_result,checklist_results,defects_found,actions_taken,next_inspection_date,notes,created_by'),
      ('equipment_defects','id,company_id,equipment_id,reference,source,severity,description,reported_by,reported_date,status,quarantine_location,release_required,corrective_action_reference,created_by'),
      ('equipment_maintenance_events','id,company_id,equipment_id,reference,maintenance_type,status,problem_description,release_required,release_status,notes,created_by')
    ) spec(table_name,columns) loop
    if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||required.table_name)
      and attname=required.column_name and attnum>0 and not attisdropped) then
      missing:=array_append(missing,required.table_name||'.'||required.column_name);
    end if;
  end loop;
  if cardinality(missing)>0 then
    raise exception 'Fleet inspection prerequisites are incomplete' using detail=array_to_string(missing,', '),
      hint='Restore the listed core schema prerequisites first; existing inspections must be retained.';
  end if;
  if exists(select 1 from pg_class where oid=any(array[
    'public.tools_register'::regclass,'public.tool_inspections'::regclass,
    'public.equipment_defects'::regclass,'public.equipment_maintenance_events'::regclass]) and not relrowsecurity) then
    raise exception 'Fleet inspection tables must retain their row-level security policies.';
  end if;
  routine:=to_regprocedure('public.record_fleet_monthly_check(uuid,uuid,date,text,jsonb,text,text)');
  if routine is not null and not exists(select 1 from pg_proc where oid=routine and not prosecdef
    and prorettype='uuid'::regtype and proargnames=array['p_company_id','p_vehicle_id','p_inspection_date',
      'p_inspector_name','p_checklist','p_defects','p_actions']::text[]) then
    raise exception 'The existing Fleet inspection function has a different signature or execution security. Review it before applying this repair.';
  end if;
end;
$preflight$;

create or replace function public.record_fleet_monthly_check(
  p_company_id uuid,
  p_vehicle_id uuid,
  p_inspection_date date,
  p_inspector_name text,
  p_checklist jsonb,
  p_defects text,
  p_actions text
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_vehicle public.tools_register%rowtype;
  v_inspection_id uuid;
  v_failed boolean;
  v_suffix text;
  v_defect_ref text;
  v_service_ref text;
  v_defect_id uuid;
  v_service_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if not exists (select 1 from public.profiles actor where actor.id=auth.uid()
    and actor.status='active' and actor.role in ('manager','admin','sephs_admin','hse_manager','hse_officer','site_manager','auditor','hr')
    and (actor.company_id=p_company_id or actor.role='sephs_admin'))
    or not coalesce(public.user_access_allowed('fleet','create'),false) then
    raise exception 'Manager access to this company and Fleet inspection creation is required' using errcode='42501';
  end if;
  if p_inspection_date is null or jsonb_typeof(p_checklist) is distinct from 'array' then
    raise exception 'A date and answered checklist are required';
  end if;
  if jsonb_array_length(p_checklist) = 0 then
    raise exception 'A date and answered checklist are required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_checklist) as item
    where coalesce(item->>'result','') not in ('ok','fail','na')
       or nullif(btrim(item->>'item'),'') is null
       or (item->>'result' in ('fail','na') and nullif(btrim(item->>'note'),'') is null)
  ) then
    raise exception 'Every checklist item needs a valid answer and failed or N/A items need a reason';
  end if;
  select * into v_vehicle from public.tools_register
    where id = p_vehicle_id and company_id = p_company_id and is_vehicle = true
    for update;
  if not found then
    raise exception 'Vehicle is unavailable in the selected company';
  end if;
  select exists(select 1 from jsonb_array_elements(p_checklist) as item where item->>'result' = 'fail') into v_failed;
  if v_failed and (nullif(btrim(p_defects),'') is null or nullif(btrim(p_actions),'') is null) then
    raise exception 'Failed checks require defect details and corrective actions';
  end if;
  insert into public.tool_inspections (
    company_id, tool_id, inspection_date, inspection_type, inspected_by_name,
    overall_result, checklist_results, defects_found, actions_taken,
    next_inspection_date, notes, created_by
  ) values (
    p_company_id, p_vehicle_id, p_inspection_date, 'periodic', p_inspector_name,
    case when v_failed then 'fail' else 'pass' end, p_checklist,
    nullif(btrim(p_defects),''), nullif(btrim(p_actions),''),
    p_inspection_date + 30, 'Fleet monthly check', auth.uid()
  ) returning id into v_inspection_id;
  if not found or v_inspection_id is null then
    raise exception 'The vehicle inspection could not be created. No check was saved' using errcode='42501';
  end if;
  if v_failed then
    v_suffix := upper(left(replace(v_inspection_id::text,'-',''),12));
    v_defect_ref := 'DEF-' || extract(year from p_inspection_date)::text || '-' || v_suffix;
    v_service_ref := 'SVC-' || extract(year from p_inspection_date)::text || '-' || v_suffix;
    update public.tools_register set status = 'out_of_service', updated_at = now()
      where id = p_vehicle_id and company_id = p_company_id;
    if not found then
      raise exception 'The failed vehicle could not be restricted. No check was saved' using errcode='42501';
    end if;
    insert into public.equipment_defects (
      company_id,equipment_id,reference,source,severity,description,reported_by,
      reported_date,status,quarantine_location,release_required,
      corrective_action_reference,created_by
    ) values (
      p_company_id,p_vehicle_id,v_defect_ref,'inspection','critical',p_defects,
      p_inspector_name,p_inspection_date,'quarantined',v_vehicle.location,true,
      v_service_ref,auth.uid()
    ) returning id into v_defect_id;
    if not found or v_defect_id is null then
      raise exception 'The vehicle defect could not be created. No check was saved' using errcode='42501';
    end if;
    insert into public.equipment_maintenance_events (
      company_id,equipment_id,reference,maintenance_type,status,
      problem_description,release_required,release_status,notes,created_by
    ) values (
      p_company_id,p_vehicle_id,v_service_ref,'corrective','requested',
      p_defects,true,'pending','Raised from ' || v_defect_ref,auth.uid()
    ) returning id into v_service_id;
    if not found or v_service_id is null then
      raise exception 'The vehicle repair task could not be created. No check was saved' using errcode='42501';
    end if;
  end if;
  return v_inspection_id;
end;
$$;

revoke all on function public.record_fleet_monthly_check(uuid,uuid,date,text,jsonb,text,text) from public, anon;
grant execute on function public.record_fleet_monthly_check(uuid,uuid,date,text,jsonb,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
