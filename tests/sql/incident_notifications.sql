-- Fictional rollback-only incidents. Notification rows are inspected without
-- running delivery workers or sending any communication.
begin;
grant usage on schema public,auth to authenticated;
grant select on public.profiles to authenticated;
grant select,insert,update on public.events to authenticated;
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create or replace function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;

do $$declare routine oid:=to_regprocedure('public.notify_new_incident()');begin
 if routine is null or not (select prosecdef and prorettype='trigger'::regtype from pg_proc where oid=routine)
   or has_function_privilege('authenticated',routine,'EXECUTE') or has_function_privilege('anon',routine,'EXECUTE') then
   raise exception 'Incident notification producer must be a private trigger function';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.events'::regclass and tgname='trg_notify_incident'
   and tgfoid=routine and tgenabled='O' and not tgisinternal and (tgtype::integer & 1)=1
   and (tgtype::integer & 4)=4 and (tgtype::integer & 16)=16 and (tgtype::integer & 2)=0) then
   raise exception 'Incident publication trigger is not enabled for row INSERT and UPDATE';end if;
end$$;
insert into auth.users(id) values
 ('d1261000-0000-4000-8000-000000000001'),('d1261000-0000-4000-8000-000000000002'),
 ('d1261000-0000-4000-8000-000000000003'),('d1261000-0000-4000-8000-000000000004'),
 ('d1261000-0000-4000-8000-000000000005'),('d1261000-0000-4000-8000-000000000006'),
 ('d1261000-0000-4000-8000-000000000007');
insert into public.companies(id,name) values
 ('d1261000-0000-4000-8000-000000000010','Incident notification fixture A'),
 ('d1261000-0000-4000-8000-000000000020','Incident notification fixture B');
insert into public.profiles(id,company_id,full_name,role,status,email) values
 ('d1261000-0000-4000-8000-000000000001','d1261000-0000-4000-8000-000000000010','Fictional first manager','admin','active','a-incident@example.invalid'),
 ('d1261000-0000-4000-8000-000000000002','d1261000-0000-4000-8000-000000000010','Fictional second manager','hse_manager','active','z-incident@example.invalid'),
 ('d1261000-0000-4000-8000-000000000003','d1261000-0000-4000-8000-000000000010','Inactive incident manager','admin','inactive','inactive-incident@example.invalid'),
 ('d1261000-0000-4000-8000-000000000004','d1261000-0000-4000-8000-000000000020','Foreign incident manager','admin','active','foreign-incident@example.invalid'),
 ('d1261000-0000-4000-8000-000000000005','d1261000-0000-4000-8000-000000000010','Blank email manager','admin','active','  '),
 ('d1261000-0000-4000-8000-000000000006','d1261000-0000-4000-8000-000000000010','Fictional employee reporter','employee','active','employee-incident@example.invalid'),
 ('d1261000-0000-4000-8000-000000000007','d1261000-0000-4000-8000-000000000010','Duplicate second manager email','site_manager','active',' Z-INCIDENT@EXAMPLE.INVALID ');
insert into public.notification_settings(company_id,email_enabled,notify_on_incident) values
 ('d1261000-0000-4000-8000-000000000010',true,true),('d1261000-0000-4000-8000-000000000020',true,true);
insert into public.tools_register(id,company_id,category,name,is_vehicle,registration_number,status,assigned_to_name) values
 ('d1261000-0000-4000-8000-000000000070','d1261000-0000-4000-8000-000000000010','vehicle','Fictional incident vehicle',true,'QA-NOTIFY-70','active','Fictional first manager');
create function public.qa_incident_notification_snapshot() returns jsonb language sql stable security invoker as $$
 select jsonb_build_object(
 'events',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.events x where company_id='d1261000-0000-4000-8000-000000000010'),
 'evidence',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.incident_evidence x where company_id='d1261000-0000-4000-8000-000000000010'),
 'investigations',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.investigations x where company_id='d1261000-0000-4000-8000-000000000010'),
 'records',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.incident_mgmt_records x where company_id='d1261000-0000-4000-8000-000000000010'),
 'history',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.incident_mgmt_audit_events x where company_id='d1261000-0000-4000-8000-000000000010'),
 'actions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.action_tracker x where company_id='d1261000-0000-4000-8000-000000000010'),
 'queue',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.notification_queue x where company_id='d1261000-0000-4000-8000-000000000010'))
$$;
select set_config('request.jwt.claim.sub','d1261000-0000-4000-8000-000000000001',true);
set local role authenticated;
-- This is the reported Save Draft case: settings are enabled and recipient
-- profiles have usable emails, but incomplete drafts must remain private.
insert into public.events(id,company_id,event_type,description,status,created_by) values
 ('d1261000-0000-4000-8000-000000000100','d1261000-0000-4000-8000-000000000010','near_miss','Fictional <unsafe> & discussion','draft','d1261000-0000-4000-8000-000000000001');
update public.events set description='Fictional revised <unsafe> & discussion',event_ref='QA-INC-100' where id='d1261000-0000-4000-8000-000000000100';
reset role;
do $$begin
 if exists(select 1 from public.notification_queue where company_id='d1261000-0000-4000-8000-000000000010') then raise exception 'Saving or editing Draft leaked an outbound notification';end if;
end$$;
select set_config('request.jwt.claim.sub','',true);
insert into public.incident_evidence(id,company_id,event_id,evidence_type,title) values
 ('d1261000-0000-4000-8000-000000000150','d1261000-0000-4000-8000-000000000010','d1261000-0000-4000-8000-000000000100','document','Fictional retained evidence');
insert into public.investigations(id,company_id,event_id,title,status) values
 ('d1261000-0000-4000-8000-000000000151','d1261000-0000-4000-8000-000000000010','d1261000-0000-4000-8000-000000000100','Fictional retained investigation','open');
insert into public.incident_mgmt_records(id,company_id,incident_id,record_type,title,payload) values
 ('d1261000-0000-4000-8000-000000000152','d1261000-0000-4000-8000-000000000010','d1261000-0000-4000-8000-000000000100','timeline','Fictional retained timeline','{"retained":true}');
insert into public.incident_mgmt_audit_events(id,company_id,entity_type,entity_id,action,after_json) values
 ('d1261000-0000-4000-8000-000000000153','d1261000-0000-4000-8000-000000000010','incident','d1261000-0000-4000-8000-000000000100','fixture_history','{"retained":true}');
select set_config('qa.incident.related_before',(public.qa_incident_notification_snapshot()-'events'-'queue')::text,true);
select set_config('qa.incident.origin',(select to_jsonb(e)::text from public.events e where id='d1261000-0000-4000-8000-000000000100'),true);
select set_config('request.jwt.claim.sub','d1261000-0000-4000-8000-000000000001',true);
set local role authenticated;
update public.events set status='submitted' where id='d1261000-0000-4000-8000-000000000100';
reset role;
do $$declare notice record;expected_url text:='https://auris360.app/?goto=events&record=d1261000-0000-4000-8000-000000000100&table=events&company=d1261000-0000-4000-8000-000000000010';begin
 if (select count(*) from public.notification_queue where related_id='d1261000-0000-4000-8000-000000000100')<>2 then raise exception 'First submission must enqueue once per active unique same-company manager email';end if;
 for notice in select * from public.notification_queue where related_id='d1261000-0000-4000-8000-000000000100' loop
   if notice.company_id<>'d1261000-0000-4000-8000-000000000010' or notice.type<>'incident'
     or notice.related_module<>'events' or notice.related_table<>'events' or notice.related_ref<>'QA-INC-100'
     or notice.record_url<>expected_url or notice.to_email not in ('a-incident@example.invalid','z-incident@example.invalid')
     or nullif(btrim(notice.idempotency_key),'') is null or notice.recipient_profile_id is null
     or notice.metadata->'relationship' is distinct from jsonb_build_object('company_id','d1261000-0000-4000-8000-000000000010',
       'module','events','table','events','id','d1261000-0000-4000-8000-000000000100','ref','QA-INC-100','url',expected_url) then
     raise exception 'Published incident notification has an incomplete or cross-company relationship';end if;
   if notice.body_html like '%<unsafe>%' then raise exception 'Incident description was emitted as unescaped HTML';end if;
 end loop;
end$$;
select set_config('qa.incident.published_queue',(select jsonb_agg(to_jsonb(q) order by q.id)::text from public.notification_queue q where related_id='d1261000-0000-4000-8000-000000000100'),true);
set local role authenticated;
update public.events set description='Fictional ordinary saved edit' where id='d1261000-0000-4000-8000-000000000100';
update public.events set status='submitted' where id='d1261000-0000-4000-8000-000000000100';
update public.events set status='triage' where id='d1261000-0000-4000-8000-000000000100';
update public.events set status='under_investigation' where id='d1261000-0000-4000-8000-000000000100';
update public.events set status='closed' where id='d1261000-0000-4000-8000-000000000100';
-- Even a caller retrying Draft then Submit cannot enqueue the same publication.
update public.events set status='draft' where id='d1261000-0000-4000-8000-000000000100';
update public.events set status='submitted' where id='d1261000-0000-4000-8000-000000000100';
reset role;
do $$declare original jsonb:=current_setting('qa.incident.origin')::jsonb;current_row jsonb;begin
 if (select jsonb_agg(to_jsonb(q) order by q.id) from public.notification_queue q where related_id='d1261000-0000-4000-8000-000000000100') is distinct from current_setting('qa.incident.published_queue')::jsonb then
   raise exception 'Ordinary edits, lifecycle changes or submission retries duplicated or changed the publication';end if;
 select to_jsonb(e) into strict current_row from public.events e where id='d1261000-0000-4000-8000-000000000100';
 if current_row->>'id' is distinct from original->>'id' or current_row->>'created_at' is distinct from original->>'created_at'
   or current_row->>'created_by' is distinct from original->>'created_by' or current_row->>'event_ref'<>'QA-INC-100' then raise exception 'Incident publication replaced the saved record identity';end if;
 if public.qa_incident_notification_snapshot()-'events'-'queue' is distinct from current_setting('qa.incident.related_before')::jsonb then raise exception 'Incident publication changed linked evidence, investigation or history';end if;
end$$;
set local role authenticated;
-- A direct submitted incident without a generated reference links by its UUID.
insert into public.events(id,company_id,event_type,status) values
 ('d1261000-0000-4000-8000-000000000101','d1261000-0000-4000-8000-000000000010','near_miss','submitted'),
 ('d1261000-0000-4000-8000-000000000102','d1261000-0000-4000-8000-000000000010','near_miss','cancelled'),
 ('d1261000-0000-4000-8000-000000000103','d1261000-0000-4000-8000-000000000010','near_miss','archived');
reset role;
do $$begin
 if (select count(*) from public.notification_queue where related_id='d1261000-0000-4000-8000-000000000101' and related_ref='d1261000-0000-4000-8000-000000000101')<>2 then raise exception 'Unreferenced submission did not retain an exact UUID relationship';end if;
 if exists(select 1 from public.notification_queue where related_id in ('d1261000-0000-4000-8000-000000000102','d1261000-0000-4000-8000-000000000103')) then raise exception 'Cancelled or archived inserts emitted new-incident alerts';end if;
end$$;

-- A vehicle-linked Draft must also remain private through the Fleet review
-- helper. Submission creates its one review and the normal linked action alert.
select set_config('qa.incident.before_vehicle_draft',public.qa_incident_notification_snapshot()::text,true);
set local role authenticated;
insert into public.events(id,company_id,event_type,status,vehicle_reg,event_ref,created_by) values
 ('d1261000-0000-4000-8000-000000000400','d1261000-0000-4000-8000-000000000010','road_traffic','draft','QA-NOTIFY-70','QA-VEHICLE-400','d1261000-0000-4000-8000-000000000001');
update public.events set vehicle_reg='QA NOTIFY 70' where id='d1261000-0000-4000-8000-000000000400';
reset role;
do $$begin
 if exists(select 1 from public.action_tracker where source_module='event' and source_type='incident' and source_id='d1261000-0000-4000-8000-000000000400')
   or public.qa_incident_notification_snapshot()->'queue' is distinct from current_setting('qa.incident.before_vehicle_draft')::jsonb->'queue' then
   raise exception 'A vehicle-linked Draft created a review action or outbound notification';end if;
end$$;
set local role authenticated;
update public.events set status='submitted' where id='d1261000-0000-4000-8000-000000000400';
reset role;
do $$declare review public.action_tracker;begin
 select * into strict review from public.action_tracker where source_module='event' and source_type='incident' and source_id='d1261000-0000-4000-8000-000000000400';
 if review.company_id<>'d1261000-0000-4000-8000-000000000010' or review.source_ref<>'QA-VEHICLE-400'
   or review.responsible<>'Fictional first manager'
   or review.id<>md5('d1261000-0000-4000-8000-000000000010'||'d1261000-0000-4000-8000-000000000400'||':fleet_incident_review')::uuid then
   raise exception 'Submitted vehicle incident did not create the exact linked review';end if;
 if (select count(*) from public.notification_queue where type='action' and related_id=review.id
   and related_module='actions' and related_table='action_tracker' and nullif(btrim(related_ref),'') is not null
   and to_email='a-incident@example.invalid')<>1
   or (select count(*) from public.notification_queue where type='incident' and related_id='d1261000-0000-4000-8000-000000000400')<>2 then
   raise exception 'Vehicle incident submission did not create its complete manager and review-action notification relationships';end if;
 update public.action_tracker set title='Edited retained Fleet review title',responsible='Unmapped fictional review owner' where id=review.id returning * into review;
 perform set_config('qa.incident.vehicle_review',to_jsonb(review)::text,true);
 perform set_config('qa.incident.vehicle_queue',(public.qa_incident_notification_snapshot()->'queue')::text,true);
end$$;
set local role authenticated;
update public.events set status='submitted',vehicle_reg='QA-NOTIFY-70' where id='d1261000-0000-4000-8000-000000000400';
update public.events set status='triage' where id='d1261000-0000-4000-8000-000000000400';
update public.events set status='closed' where id='d1261000-0000-4000-8000-000000000400';
reset role;
do $$begin
 if (select count(*) from public.action_tracker where source_module='event' and source_type='incident' and source_id='d1261000-0000-4000-8000-000000000400')<>1
   or (select to_jsonb(a) from public.action_tracker a where a.id=(current_setting('qa.incident.vehicle_review')::jsonb->>'id')::uuid) is distinct from current_setting('qa.incident.vehicle_review')::jsonb
   or public.qa_incident_notification_snapshot()->'queue' is distinct from current_setting('qa.incident.vehicle_queue')::jsonb then
   raise exception 'Repeated vehicle incident edits duplicated or changed its review action or notifications';end if;
end$$;

-- An authorised employee can also submit a vehicle report. Retrying its
-- publication retains the review created under the same normal access guards.
select set_config('request.jwt.claim.sub','d1261000-0000-4000-8000-000000000006',true);
set local role authenticated;
insert into public.events(id,company_id,event_type,status,vehicle_reg,created_by) values
 ('d1261000-0000-4000-8000-000000000401','d1261000-0000-4000-8000-000000000010','road_traffic','draft','QA-NOTIFY-70','d1261000-0000-4000-8000-000000000006');
update public.events set status='submitted' where id='d1261000-0000-4000-8000-000000000401';
update public.events set status='submitted' where id='d1261000-0000-4000-8000-000000000401';
reset role;
do $$declare review public.action_tracker;begin
 select * into strict review from public.action_tracker where source_module='event' and source_type='incident' and source_id='d1261000-0000-4000-8000-000000000401';
 if review.created_by<>'d1261000-0000-4000-8000-000000000006'
   or (select count(*) from public.notification_queue where related_id=review.id and type='action')<>1
   or (select count(*) from public.notification_queue where related_id='d1261000-0000-4000-8000-000000000401' and type='incident')<>2 then
   raise exception 'Authorised employee vehicle submission duplicated or lost its review and linked notifications';end if;
end$$;

-- An unrelated row occupying the deterministic review ID must be preserved,
-- including when it belongs to a company hidden from the incident reporter.
select set_config('request.jwt.claim.sub','',true);
insert into public.action_tracker(id,company_id,source_module,source_type,source_id,title,description,status)
 values(md5('d1261000-0000-4000-8000-000000000010'||'d1261000-0000-4000-8000-000000000402'||':fleet_incident_review')::uuid,
 'd1261000-0000-4000-8000-000000000020','manual','other','d1261000-0000-4000-8000-000000000999','Unrelated retained action','Fictional collision guard','open');
select set_config('qa.incident.foreign_collision',(select to_jsonb(a)::text from public.action_tracker a where id=md5('d1261000-0000-4000-8000-000000000010'||'d1261000-0000-4000-8000-000000000402'||':fleet_incident_review')::uuid),true);
select set_config('request.jwt.claim.sub','d1261000-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into public.events(id,company_id,event_type,status,vehicle_reg) values
 ('d1261000-0000-4000-8000-000000000402','d1261000-0000-4000-8000-000000000010','road_traffic','draft','QA-NOTIFY-70');
reset role;
select set_config('qa.incident.collision_before',public.qa_incident_notification_snapshot()::text,true);
set local role authenticated;
do $$declare rejected boolean:=false;begin
 begin update public.events set status='submitted' where id='d1261000-0000-4000-8000-000000000402';exception when others then
   if sqlerrm not like 'The Fleet incident review identity is already in use%' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'A deterministic Fleet review ID collision overwrote an unrelated record';end if;
end$$;
reset role;
do $$begin
 if public.qa_incident_notification_snapshot() is distinct from current_setting('qa.incident.collision_before')::jsonb
   or (select to_jsonb(a) from public.action_tracker a where id=md5('d1261000-0000-4000-8000-000000000010'||'d1261000-0000-4000-8000-000000000402'||':fleet_incident_review')::uuid) is distinct from current_setting('qa.incident.foreign_collision')::jsonb then
   raise exception 'A rejected Fleet identity collision changed an incident, notification or unrelated action';end if;
end$$;

-- Each notification switch suppresses publication without blocking the save.
select set_config('request.jwt.claim.sub','',true);
update public.notification_settings set notify_on_incident=false where company_id='d1261000-0000-4000-8000-000000000010';
select set_config('request.jwt.claim.sub','d1261000-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into public.events(id,company_id,event_type,status) values('d1261000-0000-4000-8000-000000000104','d1261000-0000-4000-8000-000000000010','near_miss','submitted');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.notification_settings set notify_on_incident=true,email_enabled=false where company_id='d1261000-0000-4000-8000-000000000010';
select set_config('request.jwt.claim.sub','d1261000-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into public.events(id,company_id,event_type,status) values('d1261000-0000-4000-8000-000000000105','d1261000-0000-4000-8000-000000000010','near_miss','submitted');
reset role;
do $$begin if exists(select 1 from public.notification_queue where related_id in ('d1261000-0000-4000-8000-000000000104','d1261000-0000-4000-8000-000000000105')) then raise exception 'Disabled incident or email notifications were ignored';end if;end$$;
select set_config('request.jwt.claim.sub','',true);
update public.notification_settings set email_enabled=true where company_id='d1261000-0000-4000-8000-000000000010';
select set_config('request.jwt.claim.sub','d1261000-0000-4000-8000-000000000006',true);
set local role authenticated;
insert into public.events(id,company_id,event_type,status) values('d1261000-0000-4000-8000-000000000106','d1261000-0000-4000-8000-000000000010','near_miss','draft');
update public.events set status='submitted' where id='d1261000-0000-4000-8000-000000000106';
reset role;
do $$begin
 if (select count(*) from public.notification_queue where related_id='d1261000-0000-4000-8000-000000000106')<>2 then raise exception 'An authorised employee report could not notify company managers';end if;
end$$;

-- A failed recipient enqueue rolls back both submission and every earlier
-- recipient row; Draft still remains saved and can be retried successfully.
select set_config('request.jwt.claim.sub','d1261000-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into public.events(id,company_id,event_type,status) values
 ('d1261000-0000-4000-8000-000000000200','d1261000-0000-4000-8000-000000000010','near_miss','draft'),
 ('d1261000-0000-4000-8000-000000000201','d1261000-0000-4000-8000-000000000010','near_miss','draft');
reset role;
select set_config('qa.incident.atomic_before',public.qa_incident_notification_snapshot()::text,true);
create function public.qa_incident_notification_failure() returns trigger language plpgsql as $$begin
 if new.related_id='d1261000-0000-4000-8000-000000000200' and new.to_email='z-incident@example.invalid' then raise exception 'QA incident recipient failure';end if;
 if new.related_id='d1261000-0000-4000-8000-000000000201' and new.to_email='z-incident@example.invalid' then return null;end if;
 return new;end$$;
create trigger qa_incident_notification_failure before insert on public.notification_queue for each row execute function public.qa_incident_notification_failure();
set local role authenticated;
do $$declare rejected boolean:=false;begin
 begin update public.events set status='submitted' where id='d1261000-0000-4000-8000-000000000200';exception when others then if sqlerrm<>'QA incident recipient failure' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'A failed recipient enqueue reported a successful incident submission';end if;
 rejected:=false;begin update public.events set status='submitted' where id='d1261000-0000-4000-8000-000000000201';exception when others then rejected:=true;end;
 if not rejected then raise exception 'A suppressed recipient enqueue reported a successful incident submission';end if;
end$$;
reset role;
do $$begin if public.qa_incident_notification_snapshot() is distinct from current_setting('qa.incident.atomic_before')::jsonb then raise exception 'A failed recipient left partial notification or incident changes';end if;end$$;
drop trigger qa_incident_notification_failure on public.notification_queue;
set local role authenticated;
update public.events set status='submitted' where id in ('d1261000-0000-4000-8000-000000000200','d1261000-0000-4000-8000-000000000201');
reset role;
do $$begin
 if (select count(*) from public.notification_queue where related_id in ('d1261000-0000-4000-8000-000000000200','d1261000-0000-4000-8000-000000000201'))<>4 then raise exception 'Retry after notification failure did not save exactly one publication per recipient';end if;
end$$;

-- Existing tenant/active-user/module permissions remain authoritative.
select set_config('qa.incident.permissions_before',public.qa_incident_notification_snapshot()::text,true);
select set_config('request.jwt.claim.sub','d1261000-0000-4000-8000-000000000004',true);
set local role authenticated;
do $$declare rejected boolean:=false;affected integer;begin
 begin insert into public.events(id,company_id,event_type,status) values('d1261000-0000-4000-8000-000000000300','d1261000-0000-4000-8000-000000000010','near_miss','submitted');exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'A foreign caller saved an incident in another company';end if;
 update public.events set status='draft' where id='d1261000-0000-4000-8000-000000000100';get diagnostics affected=row_count;
 if affected<>0 then raise exception 'A foreign caller edited another company incident';end if;
end$$;
reset role;
select set_config('request.jwt.claim.sub','d1261000-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$declare rejected boolean:=false;begin
 begin insert into public.events(id,company_id,event_type,status) values('d1261000-0000-4000-8000-000000000300','d1261000-0000-4000-8000-000000000010','near_miss','draft');exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'An inactive caller saved an incident';end if;
end$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"events":{"view":true,"create":false,"edit":false}}}' where id='d1261000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','d1261000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare rejected boolean:=false;affected integer:=0;begin
 begin insert into public.events(id,company_id,event_type,status) values('d1261000-0000-4000-8000-000000000300','d1261000-0000-4000-8000-000000000010','near_miss','submitted');exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'Revoked incident creation permission was ignored';end if;
 rejected:=false;begin update public.events set status='draft' where id='d1261000-0000-4000-8000-000000000100';get diagnostics affected=row_count;exception when insufficient_privilege then rejected:=true;end;
 if not rejected and affected<>0 then raise exception 'Revoked incident edit permission was ignored';end if;
end$$;
reset role;
do $$begin if public.qa_incident_notification_snapshot() is distinct from current_setting('qa.incident.permissions_before')::jsonb then raise exception 'Rejected incident writes changed records or notifications';end if;end$$;
select set_config('request.jwt.claim.sub','',true);
-- The queue relationship check continues to reject incomplete producers.
do $$declare rejected boolean:=false;failure_constraint text;begin
 begin insert into public.notification_queue(company_id,type,subject,body_html,to_email,related_table,related_id)
 values('d1261000-0000-4000-8000-000000000010','incident','Invalid relationship fixture','Fictional body','a-incident@example.invalid','events','d1261000-0000-4000-8000-000000000100');
 exception when check_violation then get stacked diagnostics failure_constraint=constraint_name;if failure_constraint<>'notification_queue_workflow_relationship_check' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'Incident fix weakened the queue workflow relationship constraint';end if;
end$$;
rollback;
