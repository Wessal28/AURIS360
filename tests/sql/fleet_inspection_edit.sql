-- Fictional authenticated/RLS checks; all fixture records and helper objects roll back.
begin;

grant usage on schema public, auth to authenticated;
grant select on public.profiles to authenticated;
grant select,insert,update on public.tools_register,public.tool_inspections,
  public.equipment_defects,public.equipment_maintenance_events to authenticated;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;

insert into auth.users(id) values
 ('f2240000-0000-4000-8000-000000000001'),('f2240000-0000-4000-8000-000000000002'),
 ('f2240000-0000-4000-8000-000000000003'),('f2240000-0000-4000-8000-000000000004');
insert into public.companies(id,name) values
 ('f2240000-0000-4000-8000-000000000010','Fleet edit fixture A'),
 ('f2240000-0000-4000-8000-000000000020','Fleet edit fixture B');
insert into public.profiles(id,company_id,full_name,role,status) values
 ('f2240000-0000-4000-8000-000000000001','f2240000-0000-4000-8000-000000000010','Fixture editor','admin','active'),
 ('f2240000-0000-4000-8000-000000000002','f2240000-0000-4000-8000-000000000010','Fixture viewer','employee','active'),
 ('f2240000-0000-4000-8000-000000000003','f2240000-0000-4000-8000-000000000010','Inactive editor','admin','inactive'),
 ('f2240000-0000-4000-8000-000000000004','f2240000-0000-4000-8000-000000000020','Foreign editor','admin','active');
insert into public.tools_register(id,company_id,category,name,is_vehicle,registration_number,status,location) values
 ('f2240000-0000-4000-8000-000000000101','f2240000-0000-4000-8000-000000000010','vehicle','Editable vehicle',true,'QA-EDIT-101','active','Fixture yard'),
 ('f2240000-0000-4000-8000-000000000102','f2240000-0000-4000-8000-000000000010','vehicle','Rollback vehicle',true,'QA-EDIT-102','active','Fixture yard'),
 ('f2240000-0000-4000-8000-000000000103','f2240000-0000-4000-8000-000000000020','vehicle','Foreign vehicle',true,'QA-EDIT-103','active','Foreign yard'),
 ('f2240000-0000-4000-8000-000000000104','f2240000-0000-4000-8000-000000000010','vehicle','Released failed inspection vehicle',true,'QA-EDIT-104','active','Fixture yard');

create function public.qa_fleet_edit_snapshot(target uuid) returns jsonb language sql stable security invoker as $$
 select to_jsonb(i) from public.tool_inspections i where i.id=target
$$;
select set_config('request.jwt.claim.sub','f2240000-0000-4000-8000-000000000001',true);
set local role authenticated;

do $$
declare company constant uuid:='f2240000-0000-4000-8000-000000000010';
 vehicle constant uuid:='f2240000-0000-4000-8000-000000000101'; target uuid; result uuid;
 original jsonb; before_edit jsonb; after_edit jsonb; stale boolean:=false;
 passed constant jsonb:='[{"item":"Original custom check","result":"ok","note":""}]';
 amended constant jsonb:='[{"item":"Original custom check","result":"ok","note":""},{"item":"Attachment","result":"na","note":"Not fitted"}]';
begin
 target:=public.record_fleet_monthly_check(company,vehicle,'2026-11-24','Original inspector',passed,null,null);
 perform set_config('qa.fleet.edit_id',target::text,true);
 original:=public.qa_fleet_edit_snapshot(target);
 result:=public.update_fleet_monthly_check(company,target,original,'2026-11-25','Replacement inspector',amended,'Cosmetic note','Observe next inspection');
 after_edit:=public.qa_fleet_edit_snapshot(target);
 if result is distinct from target or (select count(*) from public.tool_inspections where company_id=company)<>1
   or after_edit->>'inspection_date'<>'2026-11-25' or after_edit->>'inspected_by_name'<>'Replacement inspector'
   or after_edit->'checklist_results' is distinct from amended
   or after_edit->>'next_inspection_date'<>'2026-12-25' or after_edit->>'defects_found'<>'Cosmetic note'
   or after_edit->>'actions_taken'<>'Observe next inspection' or after_edit->>'overall_result'<>'pass'
   or (after_edit->>'fleet_edit_revision')::int<>1 then
   raise exception 'Editing did not update and confirm the same inspection with its selected values';
 end if;
 if after_edit->'created_by' is distinct from original->'created_by'
   or after_edit->'created_at' is distinct from original->'created_at'
   or after_edit->'tool_id' is distinct from original->'tool_id'
   or after_edit->'company_id' is distinct from original->'company_id' then
   raise exception 'Editing rewrote the original inspection identity, actor or creation history';
 end if;
 if not exists(select 1 from public.fleet_inspection_edit_audit where inspection_id=target and company_id=company
   and changed_by=auth.uid() and before_record=original and after_record=after_edit) then
   raise exception 'Editing did not retain its exact before/after snapshots and authenticated actor';
 end if;
 begin perform public.update_fleet_monthly_check(company,target,original,'2026-11-26','Stale edit',passed,null,null);
 exception when others then stale:=true;end;
 if not stale or public.qa_fleet_edit_snapshot(target) is distinct from after_edit
   or (select count(*) from public.fleet_inspection_edit_audit where inspection_id=target)<>1 then
   raise exception 'A stale form overwrote the saved inspection or appended misleading audit history';
 end if;
 stale:=false;
 begin perform public.update_fleet_monthly_check(company,target,
   jsonb_set(after_edit,'{checklist_results}',jsonb_build_array(amended->1,amended->0)),
   '2026-11-26','Reordered expected checklist',passed,null,null);
 exception when serialization_failure then stale:=true;end;
 if not stale then raise exception 'A reordered expected checklist passed the concurrency check';end if;

 before_edit:=after_edit;
 result:=public.update_fleet_monthly_check(company,target,before_edit,'2027-01-02','Failure inspector',
   '[{"item":"Original custom check","result":"fail","note":"Fictional brake defect"}]','Fictional brake defect','Restrict and repair');
 after_edit:=public.qa_fleet_edit_snapshot(target);
 if result<>target or after_edit->>'overall_result'<>'fail' or (after_edit->>'fleet_edit_revision')::int<>2
   or (select status from public.tools_register where id=vehicle)<>'out_of_service'
   or (select count(*) from public.equipment_defects where equipment_id=vehicle)<>1
   or (select count(*) from public.equipment_maintenance_events where equipment_id=vehicle)<>1 then
   raise exception 'Changing pass to fail did not atomically restrict and create exactly one repair chain';
 end if;
 if not exists(select 1 from public.equipment_defects d join public.equipment_maintenance_events m
   on m.company_id=d.company_id and m.reference=d.corrective_action_reference
   where d.company_id=company and d.equipment_id=vehicle and m.equipment_id=vehicle
     and d.source='inspection' and d.status='quarantined' and d.release_required
     and m.status='requested' and m.release_status='pending' and m.release_required) then
   raise exception 'The new failed inspection repair chain is not linked and quarantined';
 end if;
 perform set_config('qa.fleet.defect_before',(select to_jsonb(d)::text from public.equipment_defects d where d.equipment_id=vehicle),true);
 perform set_config('qa.fleet.repair_before',(select to_jsonb(m)::text from public.equipment_maintenance_events m where m.equipment_id=vehicle),true);

 -- Date changes across years must find the existing chain by the same inspection, not add another.
 result:=public.update_fleet_monthly_check(company,target,after_edit,'2028-01-03','Corrected inspector',
   '[{"item":"Original custom check","result":"fail","note":"Clarified finding"}]','Clarified finding','Same repair already arranged');
 if result<>target or (select count(*) from public.equipment_defects where equipment_id=vehicle)<>1
   or (select count(*) from public.equipment_maintenance_events where equipment_id=vehicle)<>1
   or (select to_jsonb(d) from public.equipment_defects d where d.equipment_id=vehicle) is distinct from current_setting('qa.fleet.defect_before')::jsonb
   or (select to_jsonb(m) from public.equipment_maintenance_events m where m.equipment_id=vehicle) is distinct from current_setting('qa.fleet.repair_before')::jsonb then
   raise exception 'Editing a failed inspection duplicated or rewrote its existing defect/repair history';
 end if;
 result:=public.update_fleet_monthly_check(company,target,public.qa_fleet_edit_snapshot(target),'2028-01-04','Correction inspector',passed,'Corrected inspection answer','Repair workflow retained');
 if result<>target or (select status from public.tools_register where id=vehicle)<>'out_of_service'
   or (select to_jsonb(d) from public.equipment_defects d where d.equipment_id=vehicle) is distinct from current_setting('qa.fleet.defect_before')::jsonb
   or (select to_jsonb(m) from public.equipment_maintenance_events m where m.equipment_id=vehicle) is distinct from current_setting('qa.fleet.repair_before')::jsonb then
   raise exception 'A corrected passing answer released the vehicle or changed its safety followups';
 end if;
end $$;

select set_config('qa.fleet.released_fail_id',public.record_fleet_monthly_check(
 'f2240000-0000-4000-8000-000000000010','f2240000-0000-4000-8000-000000000104','2026-11-24','Original failed inspector',
 '[{"item":"Historic failed check","result":"fail","note":"Original defect"}]','Original defect','Repair before use')::text,true);
reset role;

-- An authorized, separately completed repair is retained by later descriptive edits.
update public.equipment_defects set status='closed',verification_result='Fictional independent check',verified_by='Fixture verifier',verified_at=now()
 where equipment_id in ('f2240000-0000-4000-8000-000000000101','f2240000-0000-4000-8000-000000000104');
update public.equipment_maintenance_events set status='completed',completed_date='2028-01-05',work_performed='Fictional completed repair',
 post_work_test_reference='QA-TEST-1',release_authority='Fixture authority',release_status='released',release_date='2028-01-05'
 where equipment_id in ('f2240000-0000-4000-8000-000000000101','f2240000-0000-4000-8000-000000000104');
update public.tools_register set status='active' where id in ('f2240000-0000-4000-8000-000000000101','f2240000-0000-4000-8000-000000000104');
set local role authenticated;
do $$
declare target uuid:=current_setting('qa.fleet.edit_id')::uuid; before_defect jsonb; before_repair jsonb; rejected boolean:=false;
begin
 select to_jsonb(d) into before_defect from public.equipment_defects d where d.equipment_id='f2240000-0000-4000-8000-000000000101';
 select to_jsonb(m) into before_repair from public.equipment_maintenance_events m where m.equipment_id='f2240000-0000-4000-8000-000000000101';
 perform public.update_fleet_monthly_check('f2240000-0000-4000-8000-000000000010',target,public.qa_fleet_edit_snapshot(target),'2028-01-06','Post-repair name correction',
   '[{"item":"Original custom check","result":"ok","note":""}]',null,'Existing repair was completed separately');
 if (select status from public.tools_register where id='f2240000-0000-4000-8000-000000000101')<>'active'
   or (select to_jsonb(d) from public.equipment_defects d where d.equipment_id='f2240000-0000-4000-8000-000000000101') is distinct from before_defect
   or (select to_jsonb(m) from public.equipment_maintenance_events m where m.equipment_id='f2240000-0000-4000-8000-000000000101') is distinct from before_repair then
   raise exception 'Descriptive edit reopened or altered a completed repair';
 end if;
 begin perform public.update_fleet_monthly_check('f2240000-0000-4000-8000-000000000010',target,public.qa_fleet_edit_snapshot(target),'2028-01-07','New failure',
   '[{"item":"Original custom check","result":"fail","note":"A new defect"}]','A new defect','New repair needed');
 exception when others then rejected:=true;end;
 if not rejected then raise exception 'A new failure reused an already released safety chain';end if;

 target:=current_setting('qa.fleet.released_fail_id')::uuid;
 select to_jsonb(d) into before_defect from public.equipment_defects d where d.equipment_id='f2240000-0000-4000-8000-000000000104';
 select to_jsonb(m) into before_repair from public.equipment_maintenance_events m where m.equipment_id='f2240000-0000-4000-8000-000000000104';
 perform public.update_fleet_monthly_check('f2240000-0000-4000-8000-000000000010',target,public.qa_fleet_edit_snapshot(target),'2026-11-25','Corrected historic inspector',
   '[{"item":"Historic failed check","result":"fail","note":"Clarified historic defect"}]','Clarified historic defect','Original repair retained');
 if (select status from public.tools_register where id='f2240000-0000-4000-8000-000000000104')<>'active'
   or (select to_jsonb(d) from public.equipment_defects d where d.equipment_id='f2240000-0000-4000-8000-000000000104') is distinct from before_defect
   or (select to_jsonb(m) from public.equipment_maintenance_events m where m.equipment_id='f2240000-0000-4000-8000-000000000104') is distinct from before_repair then
   raise exception 'Descriptive edits to a historical failed inspection reopened a released safety chain';
 end if;
end $$;

-- Employee, inactive and foreign-company actors cannot edit this client's inspection.
do $$declare actor uuid; rejected boolean; target uuid:=current_setting('qa.fleet.edit_id')::uuid;begin
 foreach actor in array array['f2240000-0000-4000-8000-000000000002'::uuid,'f2240000-0000-4000-8000-000000000003'::uuid,'f2240000-0000-4000-8000-000000000004'::uuid] loop
   perform set_config('request.jwt.claim.sub',actor::text,true);rejected:=false;
   begin perform public.update_fleet_monthly_check('f2240000-0000-4000-8000-000000000010',target,coalesce(public.qa_fleet_edit_snapshot(target),'{}'),
     '2028-01-08','Unauthorized','[{"item":"Check","result":"ok","note":""}]',null,null);
   exception when others then rejected:=true;end;
   if not rejected then raise exception 'Unauthorized or inactive caller edited the inspection';end if;
 end loop;
 perform set_config('request.jwt.claim.sub','f2240000-0000-4000-8000-000000000001',true);
end $$;
reset role;

-- Shared Tools table protection still applies to the invoker RPC.
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"tools":{"view":true,"edit":false}}}' where id='f2240000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','f2240000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare rejected boolean:=false;target uuid:=current_setting('qa.fleet.edit_id')::uuid;before_edit jsonb;begin
 if public.user_access_allowed('tools','edit') then raise exception 'Fixture did not deny shared Tools edit';end if;
 before_edit:=public.qa_fleet_edit_snapshot(target);
 begin perform public.update_fleet_monthly_check('f2240000-0000-4000-8000-000000000010',target,before_edit,'2028-01-08','Unauthorized Tools edit',
   '[{"item":"Check","result":"ok","note":""}]',null,null);exception when others then rejected:=true;end;
 if not rejected or public.qa_fleet_edit_snapshot(target) is distinct from before_edit then raise exception 'The updater bypassed shared Tools edit protection';end if;
end $$;
reset role;

-- Fleet edit permission is checked separately from shared Tools table permissions.
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"fleet":{"view":true,"edit":false}}}' where id='f2240000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','f2240000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare rejected boolean:=false;target uuid:=current_setting('qa.fleet.edit_id')::uuid;begin
 if public.user_access_allowed('fleet','edit') then raise exception 'Fixture did not deny Fleet edit';end if;
 begin perform public.update_fleet_monthly_check('f2240000-0000-4000-8000-000000000010',target,public.qa_fleet_edit_snapshot(target),'2028-01-08','Forbidden',
   '[{"item":"Check","result":"ok","note":""}]',null,null);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Revoked Fleet edit permission was ignored';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions=null where id='f2240000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','f2240000-0000-4000-8000-000000000001',true);
set local role authenticated;

-- Invalid data, signed-off inspections and ordinary equipment records remain protected.
do $$declare target uuid; rejected boolean; invalid jsonb;begin
 target:=public.record_fleet_monthly_check('f2240000-0000-4000-8000-000000000010','f2240000-0000-4000-8000-000000000102','2026-11-24','Fixture inspector',
   '[{"item":"Rollback check","result":"ok","note":""}]',null,null);
 perform set_config('qa.fleet.rollback_id',target::text,true);
 rejected:=false;
 begin perform public.update_fleet_monthly_check('f2240000-0000-4000-8000-000000000010',target,
   public.qa_fleet_edit_snapshot(target)-'defects_found','2026-11-25','Inspector',
   '[{"item":"Rollback check","result":"ok","note":""}]',null,null);
 exception when serialization_failure then rejected:=true;end;
 if not rejected then raise exception 'An expected snapshot missing a nullable key passed concurrency validation';end if;
 foreach invalid in array array[null::jsonb,'{}'::jsonb,'[]'::jsonb,'[{"item":"Check","result":"fail","note":""}]'::jsonb,'[{"item":"Check","result":"na","note":""}]'::jsonb] loop
   rejected:=false;begin perform public.update_fleet_monthly_check('f2240000-0000-4000-8000-000000000010',target,public.qa_fleet_edit_snapshot(target),'2026-11-25','Inspector',invalid,'Defect','Action');
   exception when others then rejected:=true;end;if not rejected then raise exception 'Invalid edited checklist was saved';end if;
 end loop;
 rejected:=false;begin perform public.update_fleet_monthly_check('f2240000-0000-4000-8000-000000000010',target,public.qa_fleet_edit_snapshot(target),'2026-11-25',' ',
   '[{"item":"Check","result":"ok","note":""}]',null,null);exception when others then rejected:=true;end;
 if not rejected then raise exception 'A blank edited inspector was saved';end if;
end $$;
reset role;
update public.tool_inspections set signed_off=true where id=current_setting('qa.fleet.rollback_id')::uuid;
set local role authenticated;
do $$declare rejected boolean:=false;target uuid:=current_setting('qa.fleet.rollback_id')::uuid;begin
 begin perform public.update_fleet_monthly_check('f2240000-0000-4000-8000-000000000010',target,public.qa_fleet_edit_snapshot(target),'2026-11-25','Inspector',
   '[{"item":"Check","result":"ok","note":""}]',null,null);exception when others then rejected:=true;end;
 if not rejected then raise exception 'A signed-off inspection was edited';end if;
end $$;
reset role;
update public.tool_inspections set signed_off=false where id=current_setting('qa.fleet.rollback_id')::uuid;

update public.tool_inspections set notes='Equipment periodic inspection' where id=current_setting('qa.fleet.rollback_id')::uuid;
set local role authenticated;
do $$declare rejected boolean:=false;target uuid:=current_setting('qa.fleet.rollback_id')::uuid;begin
 begin perform public.update_fleet_monthly_check('f2240000-0000-4000-8000-000000000010',target,public.qa_fleet_edit_snapshot(target),'2026-11-25','Inspector',
   '[{"item":"Check","result":"ok","note":""}]',null,null);exception when others then rejected:=true;end;
 if not rejected then raise exception 'An ordinary equipment inspection was edited as a Fleet monthly check';end if;
end $$;
reset role;
update public.tool_inspections set notes='Fleet monthly check' where id=current_setting('qa.fleet.rollback_id')::uuid;
set local role authenticated;
do $$declare rejected boolean:=false;target uuid:=current_setting('qa.fleet.rollback_id')::uuid;expected jsonb;revision int;begin
 expected:=public.qa_fleet_edit_snapshot(target);revision:=(expected->>'fleet_edit_revision')::int;
 perform public.update_fleet_monthly_check('f2240000-0000-4000-8000-000000000010',target,expected,'2026-11-24','Fixture inspector',
   '[{"item":"Rollback check","result":"ok","note":""}]',null,null);
 begin perform public.update_fleet_monthly_check('f2240000-0000-4000-8000-000000000010',target,expected,'2026-11-24','Fixture inspector',
   '[{"item":"Rollback check","result":"ok","note":""}]',null,null);exception when serialization_failure then rejected:=true;end;
 if not rejected or ((public.qa_fleet_edit_snapshot(target))->>'fleet_edit_revision')::integer<>revision+1 then
   raise exception 'An already consumed revision accepted a second identical edit';
 end if;
end $$;
reset role;

-- Suppressing any required write must roll back the complete edit and its history.
create function public.qa_fleet_edit_suppress() returns trigger language plpgsql as $$begin return null;end $$;
create function public.qa_fleet_edit_assert_rollback(expected_error text) returns void language plpgsql security invoker as $$
declare target uuid:=current_setting('qa.fleet.rollback_id')::uuid; snapshot jsonb; defects jsonb; repairs jsonb; audits jsonb; vehicle jsonb; rejected boolean:=false; actual_error text;
begin
 snapshot:=public.qa_fleet_edit_snapshot(target);
 select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]') into defects from public.equipment_defects d where d.company_id='f2240000-0000-4000-8000-000000000010';
 select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') into repairs from public.equipment_maintenance_events m where m.company_id='f2240000-0000-4000-8000-000000000010';
 select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') into audits from public.fleet_inspection_edit_audit a where a.company_id='f2240000-0000-4000-8000-000000000010';
 select to_jsonb(v) into vehicle from public.tools_register v where v.id='f2240000-0000-4000-8000-000000000102';
 begin perform public.update_fleet_monthly_check('f2240000-0000-4000-8000-000000000010',target,snapshot,'2026-11-26','Changed inspector',
   '[{"item":"Rollback check","result":"fail","note":"Fictional failure"}]','Fictional failure','Repair before use');
 exception when others then rejected:=true;get stacked diagnostics actual_error=message_text;end;
 if not rejected then raise exception 'An incomplete Fleet edit reported success';end if;
 if actual_error is distinct from expected_error then raise exception 'Suppressed mutation raised unrelated error: %',actual_error;end if;
 if public.qa_fleet_edit_snapshot(target) is distinct from snapshot
   or (select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]') from public.equipment_defects d where d.company_id='f2240000-0000-4000-8000-000000000010') is distinct from defects
   or (select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') from public.equipment_maintenance_events m where m.company_id='f2240000-0000-4000-8000-000000000010') is distinct from repairs
   or (select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from public.fleet_inspection_edit_audit a where a.company_id='f2240000-0000-4000-8000-000000000010') is distinct from audits
   or (select to_jsonb(v) from public.tools_register v where v.id='f2240000-0000-4000-8000-000000000102') is distinct from vehicle then
   raise exception 'An incomplete Fleet edit left partial inspection, restriction, repair or audit writes';
 end if;
end $$;
create trigger qa_fleet_edit_skip before update on public.tool_inspections for each row execute function public.qa_fleet_edit_suppress();
set local role authenticated;
select public.qa_fleet_edit_assert_rollback('The inspection could not be updated. No changes were saved');
reset role;
drop trigger qa_fleet_edit_skip on public.tool_inspections;
create trigger qa_fleet_edit_skip before update on public.tools_register for each row execute function public.qa_fleet_edit_suppress();
set local role authenticated;
select public.qa_fleet_edit_assert_rollback('The failed vehicle could not be restricted. No changes were saved');
reset role;
drop trigger qa_fleet_edit_skip on public.tools_register;
create trigger qa_fleet_edit_skip before insert on public.equipment_defects for each row execute function public.qa_fleet_edit_suppress();
set local role authenticated;
select public.qa_fleet_edit_assert_rollback('The linked defect could not be created. No changes were saved');
reset role;
drop trigger qa_fleet_edit_skip on public.equipment_defects;
create trigger qa_fleet_edit_skip before insert on public.equipment_maintenance_events for each row execute function public.qa_fleet_edit_suppress();
set local role authenticated;
select public.qa_fleet_edit_assert_rollback('The linked repair task could not be created. No changes were saved');
reset role;
drop trigger qa_fleet_edit_skip on public.equipment_maintenance_events;
create trigger qa_fleet_edit_skip before insert on public.fleet_inspection_edit_audit for each row execute function public.qa_fleet_edit_suppress();
set local role authenticated;
select public.qa_fleet_edit_assert_rollback('The inspection edit history could not be recorded. No changes were saved');
reset role;
drop trigger qa_fleet_edit_skip on public.fleet_inspection_edit_audit;

-- Audit history cannot be forged, edited or deleted through the application role.
set local role authenticated;
do $$declare rejected boolean; target uuid:=current_setting('qa.fleet.edit_id')::uuid;begin
 rejected:=false;begin insert into public.fleet_inspection_edit_audit(company_id,inspection_id,changed_by,before_record,after_record)
   values('f2240000-0000-4000-8000-000000000010',target,auth.uid(),'{}','{}');exception when others then rejected:=true;end;
 if not rejected then raise exception 'An application caller forged Fleet edit history';end if;
 rejected:=false;begin update public.fleet_inspection_edit_audit set before_record='{}' where inspection_id=target;exception when others then rejected:=true;end;
 if not rejected then raise exception 'An application caller edited Fleet edit history';end if;
 rejected:=false;begin delete from public.fleet_inspection_edit_audit where inspection_id=target;exception when others then rejected:=true;end;
 if not rejected then raise exception 'An application caller deleted Fleet edit history';end if;
 perform set_config('request.jwt.claim.sub','f2240000-0000-4000-8000-000000000004',true);
 if exists(select 1 from public.fleet_inspection_edit_audit where company_id='f2240000-0000-4000-8000-000000000010') then
   raise exception 'Foreign company can read Fleet inspection edit history';
 end if;
end $$;
reset role;

-- A newly discovered failure on an old record cannot inherit an old service release.
select set_config('request.jwt.claim.sub','',true);
insert into public.tools_register(id,company_id,category,name,is_vehicle,registration_number,status,location) values
 ('f2240000-0000-4000-8000-000000000105','f2240000-0000-4000-8000-000000000010','vehicle','Historical correction vehicle',true,'QA-EDIT-105','active','Fixture yard');
insert into public.tool_inspections(id,company_id,tool_id,inspection_type,inspection_date,inspected_by_name,overall_result,checklist_results,
 next_inspection_date,notes,created_by,created_at) values
 ('f2240050-0000-4000-8000-000000000501','f2240000-0000-4000-8000-000000000010','f2240000-0000-4000-8000-000000000105','periodic','2026-01-01',
 'Historic inspector','pass','[{"item":"Historical check","result":"ok","note":""}]','2026-01-31','Fleet monthly check',
 'f2240000-0000-4000-8000-000000000001','2000-01-01T00:00:00Z');
insert into public.equipment_maintenance_events(company_id,equipment_id,reference,maintenance_type,status,problem_description,completed_date,work_performed,
 post_work_test_reference,release_authority,release_status,release_date,updated_at) values
 ('f2240000-0000-4000-8000-000000000010','f2240000-0000-4000-8000-000000000105','QA-OLD-RELEASE','corrective','completed','Historical fixture repair','2001-01-01','Old repair',
 'QA-OLD-TEST','Fixture authority','released','2001-01-01','2001-01-01T00:00:00Z');
select set_config('request.jwt.claim.sub','f2240000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.update_fleet_monthly_check('f2240000-0000-4000-8000-000000000010','f2240050-0000-4000-8000-000000000501',
 public.qa_fleet_edit_snapshot('f2240050-0000-4000-8000-000000000501'),'2026-01-01','Correction inspector',
 '[{"item":"Historical check","result":"fail","note":"Failure discovered during correction"}]',
 'Failure discovered during correction','Create a current restriction and repair');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.equipment_defects set status='closed',verification_result='Fictional repair verification',verified_by='Fixture verifier',verified_at=now()
 where equipment_id='f2240000-0000-4000-8000-000000000105';
select set_config('request.jwt.claim.sub','f2240000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare rejected boolean:=false;message text;begin
 begin update public.tools_register set status='active' where id='f2240000-0000-4000-8000-000000000105';
 exception when others then rejected:=true;get stacked diagnostics message=message_text;end;
 if not rejected or message not ilike '%authorised service release%' then
   raise exception 'The failed correction inherited an old release or failed for the wrong reason: %',message;
 end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.equipment_maintenance_events set status='completed',completed_date='2026-11-24',work_performed='New fictional repair',
 post_work_test_reference='QA-NEW-TEST',release_authority='Fixture authority',release_status='released',release_date='2026-11-24',
 updated_at=clock_timestamp()+interval '1 second'
 where equipment_id='f2240000-0000-4000-8000-000000000105' and reference<>'QA-OLD-RELEASE';
select set_config('request.jwt.claim.sub','f2240000-0000-4000-8000-000000000001',true);
set local role authenticated;
update public.tools_register set status='active' where id='f2240000-0000-4000-8000-000000000105';
do $$begin
 if (select status from public.tools_register where id='f2240000-0000-4000-8000-000000000105')<>'active' then
   raise exception 'The corrected failure could not be released after its new authorized repair';
 end if;
end $$;
reset role;

rollback;
