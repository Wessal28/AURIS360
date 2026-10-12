-- Save a monthly vehicle check and its restriction/repair records in one transaction.
-- SECURITY INVOKER deliberately keeps the existing tenant and module RLS checks.
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
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_inspection_date is null or p_checklist is null or jsonb_typeof(p_checklist) <> 'array'
     or jsonb_array_length(p_checklist) = 0 then
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
  if v_failed then
    v_suffix := upper(left(replace(v_inspection_id::text,'-',''),12));
    v_defect_ref := 'DEF-' || extract(year from p_inspection_date)::text || '-' || v_suffix;
    v_service_ref := 'SVC-' || extract(year from p_inspection_date)::text || '-' || v_suffix;
    update public.tools_register set status = 'out_of_service', updated_at = now()
      where id = p_vehicle_id and company_id = p_company_id;
    insert into public.equipment_defects (
      company_id,equipment_id,reference,source,severity,description,reported_by,
      reported_date,status,quarantine_location,release_required,
      corrective_action_reference,created_by
    ) values (
      p_company_id,p_vehicle_id,v_defect_ref,'inspection','critical',p_defects,
      p_inspector_name,p_inspection_date,'quarantined',v_vehicle.location,true,
      v_service_ref,auth.uid()
    );
    insert into public.equipment_maintenance_events (
      company_id,equipment_id,reference,maintenance_type,status,
      problem_description,release_required,release_status,notes,created_by
    ) values (
      p_company_id,p_vehicle_id,v_service_ref,'corrective','requested',
      p_defects,true,'pending','Raised from ' || v_defect_ref,auth.uid()
    );
  end if;
  return v_inspection_id;
end;
$$;

revoke all on function public.record_fleet_monthly_check(uuid,uuid,date,text,jsonb,text,text) from public;
grant execute on function public.record_fleet_monthly_check(uuid,uuid,date,text,jsonb,text,text) to authenticated;
