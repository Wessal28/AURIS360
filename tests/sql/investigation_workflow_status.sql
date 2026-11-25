-- Fictional rollback-only investigation workflow checks. No delivery worker is
-- run; completion must retain source records and linked evidence and actions.
begin;
grant usage on schema public,auth to authenticated;
grant select on public.profiles to authenticated;
grant select,insert,update on public.investigations to authenticated;
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create or replace function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;

do $$declare actual_states text[];begin
 select array_agg(match[1] order by match[1]) into actual_states from pg_constraint c
 cross join lateral regexp_matches(pg_get_expr(c.conbin,c.conrelid),$literal$'([^']*)'$literal$,'g') matches(match)
 where c.conrelid='public.investigations'::regclass and c.conname='investigations_status_check' and c.contype='c' and c.convalidated;
 if actual_states is distinct from array['closed','completed','in_progress','open','revision_requested','submitted']::text[] then
   raise exception 'The investigation CHECK differs from all six deployed workflow states';end if;
 if not (select relrowsecurity from pg_class where oid='public.investigations'::regclass) then raise exception 'Investigation row security is disabled';end if;
end$$;
insert into auth.users(id) values
 ('d1262000-0000-4000-8000-000000000001'),('d1262000-0000-4000-8000-000000000002'),('d1262000-0000-4000-8000-000000000003');
insert into public.companies(id,name) values
 ('d1262000-0000-4000-8000-000000000010','Investigation workflow fixture A'),
 ('d1262000-0000-4000-8000-000000000020','Investigation workflow fixture B');
insert into public.profiles(id,company_id,full_name,role,status) values
 ('d1262000-0000-4000-8000-000000000001','d1262000-0000-4000-8000-000000000010','Fictional investigation editor','admin','active'),
 ('d1262000-0000-4000-8000-000000000002','d1262000-0000-4000-8000-000000000020','Foreign investigation editor','admin','active'),
 ('d1262000-0000-4000-8000-000000000003','d1262000-0000-4000-8000-000000000010','Inactive investigation editor','admin','inactive');
insert into public.events(id,company_id,event_type,status,event_ref) values
 ('d1262000-0000-4000-8000-000000000100','d1262000-0000-4000-8000-000000000010','near_miss','open','QA-INC-100'),
 ('d1262000-0000-4000-8000-000000000101','d1262000-0000-4000-8000-000000000020','near_miss','open','QA-INC-101');
insert into public.investigations(id,company_id,event_id,title,description,root_causes,contributing_factors,corrective_actions,
 investigation_ref,investigation_method,five_whys,fishbone_causes,timeline_events,status,created_by) values
 ('d1262000-0000-4000-8000-000000000200','d1262000-0000-4000-8000-000000000010','d1262000-0000-4000-8000-000000000100',
  'Fictional retained investigation','Retain the investigation findings','Retain verified root causes','Retain contributing factors',
  '[{"description":"Retain linked corrective action","status":"open"}]','QA-INV-200','5why','["Retain original why"]','{"people":"Retain original analysis"}',
  '[{"time":"08:00","description":"Retain original chronology"}]','open','d1262000-0000-4000-8000-000000000001'),
 ('d1262000-0000-4000-8000-000000000201','d1262000-0000-4000-8000-000000000010','d1262000-0000-4000-8000-000000000100',
  'Fictional retained in-progress investigation','Retain unrelated content',null,null,null,'QA-INV-201','5why','[]','{}','[]','in_progress','d1262000-0000-4000-8000-000000000001'),
 ('d1262000-0000-4000-8000-000000000202','d1262000-0000-4000-8000-000000000010','d1262000-0000-4000-8000-000000000100',
  'Fictional retained closed investigation','Retain closed content',null,null,null,'QA-INV-202','5why','[]','{}','[]','closed','d1262000-0000-4000-8000-000000000001'),
 ('d1262000-0000-4000-8000-000000000203','d1262000-0000-4000-8000-000000000020','d1262000-0000-4000-8000-000000000101',
  'Fictional foreign investigation','Retain foreign content',null,null,null,'QA-INV-203','5why','[]','{}','[]','closed','d1262000-0000-4000-8000-000000000002');
update public.events set investigation_id='d1262000-0000-4000-8000-000000000200' where id='d1262000-0000-4000-8000-000000000100';
insert into public.incident_evidence(id,company_id,event_id,investigation_id,evidence_type,title,file_url) values
 ('d1262000-0000-4000-8000-000000000210','d1262000-0000-4000-8000-000000000010','d1262000-0000-4000-8000-000000000100',
  'd1262000-0000-4000-8000-000000000200','document','Fictional retained evidence','https://example.invalid/retained-investigation.pdf');
insert into public.incident_mgmt_records(id,company_id,incident_id,investigation_id,record_type,title,payload) values
 ('d1262000-0000-4000-8000-000000000211','d1262000-0000-4000-8000-000000000010','d1262000-0000-4000-8000-000000000100',
  'd1262000-0000-4000-8000-000000000200','timeline','Fictional retained investigation timeline','{"verified":true}');
insert into public.incident_mgmt_audit_events(id,company_id,entity_type,entity_id,action,after_json) values
 ('d1262000-0000-4000-8000-000000000212','d1262000-0000-4000-8000-000000000010','investigation','d1262000-0000-4000-8000-000000000200','fixture_history','{"retained":true}');
insert into public.action_tracker(id,company_id,source_module,source_type,source_id,source_ref,title,description,status) values
 ('d1262000-0000-4000-8000-000000000213','d1262000-0000-4000-8000-000000000010','investigation','incident','d1262000-0000-4000-8000-000000000200',
  'QA-INV-200','Fictional retained corrective action','Retain the independent action workflow','open');
create function public.qa_investigation_snapshot() returns jsonb language sql stable security invoker as $$
 select jsonb_build_object(
 'investigations',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.investigations x where company_id in ('d1262000-0000-4000-8000-000000000010','d1262000-0000-4000-8000-000000000020')),
 'events',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.events x where company_id='d1262000-0000-4000-8000-000000000010'),
 'evidence',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.incident_evidence x where company_id='d1262000-0000-4000-8000-000000000010'),
 'records',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.incident_mgmt_records x where company_id='d1262000-0000-4000-8000-000000000010'),
 'history',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.incident_mgmt_audit_events x where company_id='d1262000-0000-4000-8000-000000000010'),
 'actions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.action_tracker x where company_id='d1262000-0000-4000-8000-000000000010'),
 'queue',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.notification_queue x where company_id='d1262000-0000-4000-8000-000000000010'))
$$;
select set_config('qa.investigation.before',public.qa_investigation_snapshot()::text,true);
select set_config('qa.investigation.original',(select to_jsonb(i)::text from public.investigations i where id='d1262000-0000-4000-8000-000000000200'),true);
select set_config('request.jwt.claim.sub','d1262000-0000-4000-8000-000000000001',true);
set local role authenticated;
-- Each deployed choice can be saved and reopened on the same record. Completing
-- an investigation does not rewrite its findings or close its independent MAP action.
do $$declare state text;returned public.investigations;original jsonb:=current_setting('qa.investigation.original')::jsonb;ordinal integer:=0;begin
 foreach state in array array['open','submitted','revision_requested','in_progress','completed','closed'] loop
   update public.investigations set status=state,updated_at=clock_timestamp()
     where id='d1262000-0000-4000-8000-000000000200' returning * into strict returned;
   if returned.status is distinct from state or (to_jsonb(returned)-'status'-'updated_at') is distinct from (original-'status'-'updated_at') then
     raise exception 'Saving investigation workflow state % changed its identity, links or content',state;end if;
   insert into public.investigations(id,company_id,event_id,title,status,created_by)
     values(('d1262000-0000-4000-8000-'||lpad((300+ordinal)::text,12,'0'))::uuid,'d1262000-0000-4000-8000-000000000010',
       'd1262000-0000-4000-8000-000000000100','Fictional new '||state,state,'d1262000-0000-4000-8000-000000000001') returning * into strict returned;
   if returned.status is distinct from state then raise exception 'A new investigation did not retain workflow state %',state;end if;
   ordinal:=ordinal+1;
 end loop;
end$$;
reset role;
do $$declare before_rows jsonb:=current_setting('qa.investigation.before')::jsonb;begin
 if public.qa_investigation_snapshot()-'investigations' is distinct from before_rows-'investigations' then
   raise exception 'Investigation status changes rewrote the incident, evidence, timeline, history, action or notification';end if;
 if exists(select 1 from public.investigations i join jsonb_array_elements(before_rows->'investigations') old_record on old_record->>'id'=i.id::text
   where i.id<>'d1262000-0000-4000-8000-000000000200' and to_jsonb(i) is distinct from old_record) then
   raise exception 'Investigation completion changed another existing investigation';end if;
 if (select status from public.action_tracker where id='d1262000-0000-4000-8000-000000000213')<>'open' then raise exception 'Investigation completion closed a separate corrective action';end if;
end$$;
select set_config('qa.investigation.invalid_before',public.qa_investigation_snapshot()::text,true);
set local role authenticated;
do $$declare invalid_state text;rejected boolean;failure_constraint text;begin
 foreach invalid_state in array array['draft','arbitrary_unknown_status'] loop
   rejected:=false;begin
     update public.investigations set status=invalid_state,description='Must not overwrite retained findings'
      where id='d1262000-0000-4000-8000-000000000200';
   exception when check_violation then get stacked diagnostics failure_constraint=constraint_name;
     if failure_constraint<>'investigations_status_check' then raise;end if;rejected:=true;end;
   if not rejected then raise exception 'Unsupported investigation status % was accepted on update',invalid_state;end if;
   rejected:=false;begin
     insert into public.investigations(id,company_id,title,status) values('d1262000-0000-4000-8000-000000000399',
       'd1262000-0000-4000-8000-000000000010','Must not create investigation',invalid_state);
   exception when check_violation then get stacked diagnostics failure_constraint=constraint_name;
     if failure_constraint<>'investigations_status_check' then raise;end if;rejected:=true;end;
   if not rejected then raise exception 'Unsupported investigation status % was accepted on insert',invalid_state;end if;
 end loop;
end$$;
reset role;
do $$begin if public.qa_investigation_snapshot() is distinct from current_setting('qa.investigation.invalid_before')::jsonb then raise exception 'Rejected status writes left partial investigation or linked changes';end if;end$$;
-- Retain the existing nullable status and open default rather than coercing data.
set local role authenticated;
insert into public.investigations(id,company_id,title,status) values('d1262000-0000-4000-8000-000000000310','d1262000-0000-4000-8000-000000000010','Fictional explicit NULL',null);
insert into public.investigations(id,company_id,title) values('d1262000-0000-4000-8000-000000000311','d1262000-0000-4000-8000-000000000010','Fictional omitted status');
do $$begin
 if (select status from public.investigations where id='d1262000-0000-4000-8000-000000000310') is not null
   or (select status from public.investigations where id='d1262000-0000-4000-8000-000000000311') is distinct from 'open' then
   raise exception 'Existing NULL or open-default status semantics changed';end if;
end$$;
reset role;

-- Tenant policies, inactive-account guards and module permissions must still
-- govern writes even though the CHECK now accepts the Completed value.
select set_config('qa.investigation.denied_before',public.qa_investigation_snapshot()::text,true);
select set_config('request.jwt.claim.sub','d1262000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$declare rejected boolean:=false;affected integer;begin
 begin insert into public.investigations(id,company_id,title,status) values('d1262000-0000-4000-8000-000000000312','d1262000-0000-4000-8000-000000000010','Foreign attempted save','completed');exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'A foreign caller created an investigation in another company';end if;
 update public.investigations set status='completed' where id='d1262000-0000-4000-8000-000000000200';get diagnostics affected=row_count;
 if affected<>0 then raise exception 'A foreign caller completed another company investigation';end if;
end$$;
reset role;
select set_config('request.jwt.claim.sub','d1262000-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$declare rejected boolean:=false;begin
 begin insert into public.investigations(id,company_id,title,status) values('d1262000-0000-4000-8000-000000000312','d1262000-0000-4000-8000-000000000010','Inactive attempted save','completed');exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'An inactive caller saved an investigation';end if;
end$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"events":{"view":true,"create":false,"edit":false}}}' where id='d1262000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','d1262000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare rejected boolean:=false;affected integer:=0;begin
 begin insert into public.investigations(id,company_id,title,status) values('d1262000-0000-4000-8000-000000000312','d1262000-0000-4000-8000-000000000010','Revoked attempted save','completed');exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'Revoked investigation creation permission was ignored';end if;
 rejected:=false;begin update public.investigations set status='completed' where id='d1262000-0000-4000-8000-000000000200';get diagnostics affected=row_count;exception when insufficient_privilege then rejected:=true;end;
 if not rejected and affected<>0 then raise exception 'Revoked investigation edit permission was ignored';end if;
end$$;
reset role;
do $$begin if public.qa_investigation_snapshot() is distinct from current_setting('qa.investigation.denied_before')::jsonb then raise exception 'A rejected guarded save changed investigations or linked records';end if;end$$;
rollback;
