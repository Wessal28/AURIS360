-- Fictional, rollback-only checks. No delivery worker or production records are used.
begin;

grant usage on schema public, auth to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update on public.tools_register, public.tool_inspections,
  public.equipment_defects, public.equipment_maintenance_events to authenticated;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;

insert into auth.users(id) values
  ('f1240000-0000-4000-8000-000000000001'),
  ('f1240000-0000-4000-8000-000000000002'),
  ('f1240000-0000-4000-8000-000000000003'),
  ('f1240000-0000-4000-8000-000000000004'),
  ('f1240000-0000-4000-8000-000000000005');
insert into public.companies(id, name) values
  ('f1240000-0000-4000-8000-000000000010', 'Fleet save fixture A'),
  ('f1240000-0000-4000-8000-000000000020', 'Fleet save fixture B');
insert into public.profiles(id, company_id, full_name, role, status) values
  ('f1240000-0000-4000-8000-000000000001', 'f1240000-0000-4000-8000-000000000010', 'Fictional fleet manager', 'admin', 'active'),
  ('f1240000-0000-4000-8000-000000000002', 'f1240000-0000-4000-8000-000000000010', 'Fictional employee', 'employee', 'active'),
  ('f1240000-0000-4000-8000-000000000003', 'f1240000-0000-4000-8000-000000000010', 'Inactive fleet manager', 'admin', 'inactive'),
  ('f1240000-0000-4000-8000-000000000004', 'f1240000-0000-4000-8000-000000000020', 'Fictional SEPHS administrator', 'sephs_admin', 'active'),
  ('f1240000-0000-4000-8000-000000000005', 'f1240000-0000-4000-8000-000000000010', 'Fictional HSE manager', 'hse_manager', 'active');
insert into public.tools_register(id, company_id, category, name, is_vehicle, registration_number, status, location) values
  ('f1240000-0000-4000-8000-000000000101', 'f1240000-0000-4000-8000-000000000010', 'vehicle', 'Fixture vehicle A', true, 'QA-A-101', 'active', 'Fictional yard'),
  ('f1240000-0000-4000-8000-000000000102', 'f1240000-0000-4000-8000-000000000010', 'hand_tool', 'Not a vehicle', false, null, 'active', 'Fictional yard'),
  ('f1240000-0000-4000-8000-000000000103', 'f1240000-0000-4000-8000-000000000020', 'vehicle', 'Foreign fixture vehicle', true, 'QA-B-103', 'active', 'Foreign yard'),
  ('f1240000-0000-4000-8000-000000000104', 'f1240000-0000-4000-8000-000000000010', 'vehicle', 'Suppression rollback vehicle', true, 'QA-A-104', 'active', 'Fictional yard');

select set_config('request.jwt.claim.sub', 'f1240000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $$
declare
  company constant uuid := 'f1240000-0000-4000-8000-000000000010';
  vehicle constant uuid := 'f1240000-0000-4000-8000-000000000101';
  passed constant jsonb := '[{"item":"Brakes checked","result":"ok","note":""},{"item":"Optional attachment","result":"na","note":"Not fitted"}]';
  failed constant jsonb := '[{"item":"Brakes checked","result":"fail","note":"Fictional leaking seal"}]';
  first_id uuid;
  failed_id uuid;
  next_id uuid;
  expected_defect_ref text;
  expected_service_ref text;
begin
  first_id := public.record_fleet_monthly_check(
    p_company_id => company, p_vehicle_id => vehicle, p_inspection_date => '2026-11-24',
    p_inspector_name => 'Fictional inspector', p_checklist => passed, p_defects => '', p_actions => '');
  if first_id is null or not exists (
    select 1 from public.tool_inspections where id=first_id and company_id=company and tool_id=vehicle
      and inspection_type='periodic' and inspection_date='2026-11-24' and next_inspection_date='2026-11-24'::date+30
      and overall_result='pass' and checklist_results=passed and notes='Fleet monthly check'
      and inspected_by_name='Fictional inspector' and created_by=auth.uid()
  ) then raise exception 'Passed inspection was not saved with its date, checklist, identity and next due date';end if;
  if (select status from public.tools_register where id=vehicle) is distinct from 'active'
    or exists(select 1 from public.equipment_defects where equipment_id=vehicle)
    or exists(select 1 from public.equipment_maintenance_events where equipment_id=vehicle) then
    raise exception 'Passed inspection created a restriction or repair';
  end if;

  failed_id := public.record_fleet_monthly_check(company, vehicle, '2026-11-25', 'Fictional inspector', failed,
    'Fictional brake seal leak', 'Restrict and arrange repair');
  expected_defect_ref := 'DEF-2026-' || upper(left(replace(failed_id::text, '-', ''), 12));
  expected_service_ref := 'SVC-2026-' || upper(left(replace(failed_id::text, '-', ''), 12));
  if failed_id is null or failed_id=first_id or not exists (
    select 1 from public.tool_inspections where id=failed_id and company_id=company and tool_id=vehicle
      and overall_result='fail' and defects_found='Fictional brake seal leak'
      and actions_taken='Restrict and arrange repair' and next_inspection_date='2026-11-25'::date+30
  ) then raise exception 'Failed inspection was not saved';end if;
  if (select status from public.tools_register where id=vehicle) is distinct from 'out_of_service' then
    raise exception 'Failed vehicle was not restricted';
  end if;
  if not exists(select 1 from public.equipment_defects where company_id=company and equipment_id=vehicle
    and reference=expected_defect_ref and source='inspection' and status='quarantined' and severity='critical'
    and release_required and corrective_action_reference=expected_service_ref and quarantine_location='Fictional yard') then
    raise exception 'Failed inspection did not create the linked quarantined defect';
  end if;
  if not exists(select 1 from public.equipment_maintenance_events where company_id=company and equipment_id=vehicle
    and reference=expected_service_ref and maintenance_type='corrective' and status='requested'
    and release_required and release_status='pending' and problem_description='Fictional brake seal leak'
    and notes='Raised from '||expected_defect_ref) then
    raise exception 'Failed inspection did not create the linked corrective service';
  end if;

  next_id := public.record_fleet_monthly_check(company, vehicle, '2026-11-26', 'Fictional inspector', passed, null, null);
  if next_id is null or next_id in (first_id, failed_id)
    or (select status from public.tools_register where id=vehicle) is distinct from 'out_of_service'
    or (select count(*) from public.tool_inspections where tool_id=vehicle and company_id=company)<>3
    or (select count(*) from public.equipment_defects where equipment_id=vehicle and company_id=company)<>1
    or (select count(*) from public.equipment_maintenance_events where equipment_id=vehicle and company_id=company)<>1 then
    raise exception 'A later passing check released the restricted vehicle or altered its existing inspection/repair records';
  end if;
end $$;

-- Invalid inputs and another tenant's vehicle must fail before committing data.
do $$
declare
  company constant uuid := 'f1240000-0000-4000-8000-000000000010';
  vehicle constant uuid := 'f1240000-0000-4000-8000-000000000101';
  checklist jsonb;
  rejected boolean;
  target uuid;
begin
  foreach checklist in array array[
    null::jsonb, '{}'::jsonb, '[]'::jsonb, '[{}]'::jsonb,
    '[{"item":"Brakes","result":"unchecked"}]'::jsonb,
    '[{"item":"Brakes","result":"na","note":""}]'::jsonb,
    '[{"item":"Brakes","result":"fail","note":""}]'::jsonb,
    '[{"item":"","result":"ok"}]'::jsonb
  ] loop
    rejected:=false;
    begin perform public.record_fleet_monthly_check(company,vehicle,'2026-11-27','Inspector',checklist,null,null);
    exception when others then rejected:=true;end;
    if not rejected then raise exception 'Invalid checklist was accepted: %', checklist;end if;
  end loop;
  foreach target in array array['f1240000-0000-4000-8000-000000000102'::uuid,'f1240000-0000-4000-8000-000000000103'::uuid] loop
    rejected:=false;
    begin perform public.record_fleet_monthly_check(company,target,'2026-11-27','Inspector','[{"item":"Brakes","result":"ok"}]',null,null);
    exception when others then rejected:=true;end;
    if not rejected then raise exception 'Non-vehicle or foreign-company inspection was accepted';end if;
  end loop;
  rejected:=false;
  begin perform public.record_fleet_monthly_check('f1240000-0000-4000-8000-000000000020','f1240000-0000-4000-8000-000000000103','2026-11-27','Inspector','[{"item":"Brakes","result":"ok"}]',null,null);
  exception when others then rejected:=true;end;
  if not rejected then raise exception 'Caller selected a different company without access';end if;
  rejected:=false;
  begin perform public.record_fleet_monthly_check(company,vehicle,null,'Inspector','[{"item":"Brakes","result":"ok"}]',null,null);
  exception when others then rejected:=true;end;
  if not rejected then raise exception 'Missing inspection date was accepted';end if;
  rejected:=false;
  begin perform public.record_fleet_monthly_check(company,vehicle,'2026-11-27','Inspector','[{"item":"Brakes","result":"fail","note":"Leak"}]','Leak',null);
  exception when others then rejected:=true;end;
  if not rejected then raise exception 'Failed checklist without corrective actions was accepted';end if;
  if (select count(*) from public.tool_inspections where company_id=company)<>3
    or (select count(*) from public.equipment_defects where company_id=company)<>1
    or (select count(*) from public.equipment_maintenance_events where company_id=company)<>1 then
    raise exception 'Rejected inputs left partial inspection or repair records';
  end if;
end $$;

-- Inactive and ordinary employee callers cannot invoke the manager-only save.
do $$
declare actor uuid; rejected boolean;
begin
  foreach actor in array array['f1240000-0000-4000-8000-000000000002'::uuid,'f1240000-0000-4000-8000-000000000003'::uuid] loop
    perform set_config('request.jwt.claim.sub',actor::text,true);
    rejected:=false;
    begin perform public.record_fleet_monthly_check('f1240000-0000-4000-8000-000000000010','f1240000-0000-4000-8000-000000000104','2026-11-27','Inspector','[{"item":"Brakes","result":"ok"}]',null,null);
    exception when others then rejected:=true;end;
    if not rejected then raise exception 'Inactive or employee caller saved a vehicle inspection';end if;
  end loop;
end $$;
reset role;

-- Permission changes are installed by the fixture maintainer, not the caller.
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"fleet":{"view":true,"create":false}}}'
where id='f1240000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','f1240000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare rejected boolean:=false;begin
  if public.user_access_allowed('fleet','create') then raise exception 'Fixture did not deny Fleet create';end if;
  begin perform public.record_fleet_monthly_check('f1240000-0000-4000-8000-000000000010','f1240000-0000-4000-8000-000000000104','2026-11-27','Inspector','[{"item":"Brakes","result":"ok"}]',null,null);
  exception when others then rejected:=true;end;
  if not rejected then raise exception 'Revoked Fleet permission was ignored';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"tools":{"view":true,"create":false}}}'
where id='f1240000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','f1240000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare rejected boolean:=false;begin
  if public.user_access_allowed('tools','create') then raise exception 'Fixture did not deny underlying Tools create';end if;
  begin perform public.record_fleet_monthly_check('f1240000-0000-4000-8000-000000000010','f1240000-0000-4000-8000-000000000104','2026-11-27','Inspector','[{"item":"Brakes","result":"ok"}]',null,null);
  exception when others then rejected:=true;end;
  if not rejected then raise exception 'Underlying Tools row policy was bypassed';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions=null where id='f1240000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','f1240000-0000-4000-8000-000000000001',true);

-- Every required mutation is confirmed. A custom trigger suppressing any one
-- of them must roll back the inspection, restriction, defect and service.
create function public.qa_fleet_suppress_write() returns trigger language plpgsql as $$begin return null;end $$;
create function public.qa_fleet_expect_suppressed_rollback(expected_error text) returns void language plpgsql security invoker as $$
declare inspection_count bigint; defect_count bigint; service_count bigint; before_vehicle jsonb; rejected boolean:=false; actual_error text;
begin
  select count(*) into inspection_count from public.tool_inspections where company_id='f1240000-0000-4000-8000-000000000010';
  select count(*) into defect_count from public.equipment_defects where company_id='f1240000-0000-4000-8000-000000000010';
  select count(*) into service_count from public.equipment_maintenance_events where company_id='f1240000-0000-4000-8000-000000000010';
  select to_jsonb(v) into before_vehicle from public.tools_register v where id='f1240000-0000-4000-8000-000000000104';
  begin perform public.record_fleet_monthly_check('f1240000-0000-4000-8000-000000000010','f1240000-0000-4000-8000-000000000104','2026-11-28','Inspector','[{"item":"Brakes","result":"fail","note":"Fictional defect"}]','Fictional defect','Repair before use');
  exception when others then rejected:=true;get stacked diagnostics actual_error=message_text;end;
  if not rejected then raise exception 'Suppressed Fleet mutation reported success';end if;
  if actual_error is distinct from expected_error then
    raise exception 'Suppressed mutation raised an unrelated error: %',actual_error;
  end if;
  if (select count(*) from public.tool_inspections where company_id='f1240000-0000-4000-8000-000000000010')<>inspection_count
    or (select count(*) from public.equipment_defects where company_id='f1240000-0000-4000-8000-000000000010')<>defect_count
    or (select count(*) from public.equipment_maintenance_events where company_id='f1240000-0000-4000-8000-000000000010')<>service_count
    or (select to_jsonb(v) from public.tools_register v where id='f1240000-0000-4000-8000-000000000104') is distinct from before_vehicle then
    raise exception 'Suppressed Fleet mutation left partial inspection, restriction or repair records';
  end if;
end $$;

create trigger qa_fleet_suppress_inspection before insert on public.tool_inspections for each row execute function public.qa_fleet_suppress_write();
set local role authenticated;
select public.qa_fleet_expect_suppressed_rollback('The vehicle inspection could not be created. No check was saved');
reset role;
drop trigger qa_fleet_suppress_inspection on public.tool_inspections;
create trigger qa_fleet_suppress_restriction before update on public.tools_register for each row execute function public.qa_fleet_suppress_write();
set local role authenticated;
select public.qa_fleet_expect_suppressed_rollback('The failed vehicle could not be restricted. No check was saved');
reset role;
drop trigger qa_fleet_suppress_restriction on public.tools_register;
create trigger qa_fleet_suppress_defect before insert on public.equipment_defects for each row execute function public.qa_fleet_suppress_write();
set local role authenticated;
select public.qa_fleet_expect_suppressed_rollback('The vehicle defect could not be created. No check was saved');
reset role;
drop trigger qa_fleet_suppress_defect on public.equipment_defects;
create trigger qa_fleet_suppress_service before insert on public.equipment_maintenance_events for each row execute function public.qa_fleet_suppress_write();
set local role authenticated;
select public.qa_fleet_expect_suppressed_rollback('The vehicle repair task could not be created. No check was saved');
reset role;
drop trigger qa_fleet_suppress_service on public.equipment_maintenance_events;

-- HSE managers offered the save action by the application can use the same RPC.
select set_config('request.jwt.claim.sub','f1240000-0000-4000-8000-000000000005',true);
set local role authenticated;
select public.record_fleet_monthly_check('f1240000-0000-4000-8000-000000000010','f1240000-0000-4000-8000-000000000104','2026-11-29','HSE inspector','[{"item":"Brakes","result":"ok"}]',null,null);
reset role;

-- A SEPHS administrator can explicitly inspect a selected client company.
select set_config('request.jwt.claim.sub','f1240000-0000-4000-8000-000000000004',true);
set local role authenticated;
select public.record_fleet_monthly_check('f1240000-0000-4000-8000-000000000010','f1240000-0000-4000-8000-000000000104','2026-11-29','SEPHS inspector','[{"item":"Brakes","result":"ok"}]',null,null);
reset role;
do $$begin
  if (select count(*) from public.tool_inspections where company_id='f1240000-0000-4000-8000-000000000010')<>5
    or (select status from public.tools_register where id='f1240000-0000-4000-8000-000000000103') is distinct from 'active'
    or exists(select 1 from public.tool_inspections where company_id='f1240000-0000-4000-8000-000000000020') then
    raise exception 'Fleet permission or tenant checks left extra or foreign records';
  end if;
end $$;

rollback;
