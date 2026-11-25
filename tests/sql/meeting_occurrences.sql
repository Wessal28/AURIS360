-- Fictional, rollback-only meeting occurrence checks. No messages are sent.
begin;
do $$declare signature text; arguments text[]; proc record;begin
 for signature,arguments in select * from (values
   ('public.save_hse_minutes_occurrence(uuid,jsonb,timestamptz)',array['p_id','p_minutes','p_expected_updated_at']),
   ('public.set_meeting_occurrence(uuid,date,text,timestamptz)',array['p_series_id','p_scheduled_date','p_command','p_expected_updated_at'])
 ) contracts(signature,arguments) loop
   select p.proargnames,p.prosecdef,p.prorettype::regtype::text result,
     has_function_privilege('authenticated',p.oid,'execute') allowed,has_function_privilege('anon',p.oid,'execute') anonymous
     into proc from pg_proc p where p.oid=to_regprocedure(signature);
   if not found or proc.proargnames is distinct from arguments or proc.prosecdef or proc.result<>'jsonb' or not proc.allowed or proc.anonymous then
     raise exception 'Occurrence RPC signature, invoker security or authenticated-only execution differs: %',signature;end if;
 end loop;
 if not (select relrowsecurity from pg_class where oid='public.meeting_occurrence_exceptions'::regclass)
   or not has_table_privilege('authenticated','public.meeting_occurrence_exceptions','SELECT')
   or not has_table_privilege('authenticated','public.meeting_occurrence_exceptions','INSERT')
   or not has_table_privilege('authenticated','public.meeting_occurrence_exceptions','UPDATE')
   or has_table_privilege('authenticated','public.meeting_occurrence_exceptions','DELETE')
   or has_table_privilege('anon','public.meeting_occurrence_exceptions','SELECT,INSERT,UPDATE,DELETE') then
   raise exception 'Occurrence exception RLS or authenticated-only table access differs';end if;
end$$;
grant usage on schema public,auth to authenticated;
grant select on public.profiles,public.people,public.map_activity_log to authenticated;
grant select,insert,update on public.hse_meetings,public.action_tracker to authenticated;
grant select,update on public.meeting_series to authenticated;
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create or replace function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;

insert into auth.users(id) values
 ('d1250000-0000-4000-8000-000000000001'),('d1250000-0000-4000-8000-000000000002'),
 ('d1250000-0000-4000-8000-000000000003'),('d1250000-0000-4000-8000-000000000004');
insert into public.companies(id,name) values
 ('d1250000-0000-4000-8000-000000000010','Occurrence fixture A'),
 ('d1250000-0000-4000-8000-000000000020','Occurrence fixture B');
insert into public.profiles(id,company_id,full_name,role,status) values
 ('d1250000-0000-4000-8000-000000000001','d1250000-0000-4000-8000-000000000010','Fictional meeting editor','admin','active'),
 ('d1250000-0000-4000-8000-000000000002','d1250000-0000-4000-8000-000000000010','Fictional employee','employee','active'),
 ('d1250000-0000-4000-8000-000000000003','d1250000-0000-4000-8000-000000000010','Inactive meeting editor','admin','inactive'),
 ('d1250000-0000-4000-8000-000000000004','d1250000-0000-4000-8000-000000000020','Foreign meeting editor','admin','active');
insert into public.people(id,company_id,first_name,last_name) values
 ('d1250000-0000-4000-8000-000000000030','d1250000-0000-4000-8000-000000000010','Fictional','Owner');
insert into public.meeting_series(id,company_id,title,meeting_type,recurrence,next_date) values
 ('d1250000-0000-4000-8000-000000000040','d1250000-0000-4000-8000-000000000010','Fictional quarterly review','management_review','quarterly','2026-01-17'),
 ('d1250000-0000-4000-8000-000000000041','d1250000-0000-4000-8000-000000000020','Foreign quarterly review','management_review','quarterly','2026-01-17');

create function public.qa_occurrence_body(scheduled date,actual timestamptz,recorded_status text default 'draft') returns jsonb language sql immutable as $$
 select jsonb_build_object('company_id','d1250000-0000-4000-8000-000000000010','series_id','d1250000-0000-4000-8000-000000000040',
 'title','Fictional quarterly review','meeting_type','management_review','meeting_date',actual,'meeting_timezone','Asia/Dubai',
 'scheduled_date',scheduled,'next_meeting_date','2026-04-17','status',recorded_status,'minutes','Fictional discussion retained',
 'recommendations',jsonb_build_array(jsonb_build_object('key','d1250000-0000-4000-8000-000000000060','desc','Fictional retained follow-up',
   'person_id','d1250000-0000-4000-8000-000000000030','resp','Fictional Owner','date','2026-12-01','prio','medium','status','open')))
$$;
create function public.qa_occurrence_snapshot() returns jsonb language sql stable security invoker as $$
 select jsonb_build_object(
 'minutes',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.hse_meetings x where company_id='d1250000-0000-4000-8000-000000000010'),
 'series',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.meeting_series x where company_id='d1250000-0000-4000-8000-000000000010'),
 'actions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.action_tracker x where company_id='d1250000-0000-4000-8000-000000000010'),
 'history',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.map_activity_log x where company_id='d1250000-0000-4000-8000-000000000010'),
 'exceptions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.meeting_occurrence_exceptions x where company_id='d1250000-0000-4000-8000-000000000010'))
$$;
select set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000001',true);
set local role authenticated;

-- Moving a scheduled meeting keeps its original occurrence claim, record ID,
-- recommendation identity, real action closure decision and closure history.
do $$
declare target constant uuid:='d1250000-0000-4000-8000-000000000050'; result jsonb; body jsonb;
 origin jsonb; linked_action_id uuid; action_before jsonb; history_before jsonb; stale timestamptz; current_version timestamptz; before_rows jsonb;
 rejected boolean;
begin
 body:=public.qa_occurrence_body('2026-01-17','2026-01-17T05:00:00Z');
 result:=public.save_hse_minutes_occurrence(target,body,null);
 if result->'minutes'->>'id' is distinct from target::text or result->'minutes'->>'scheduled_date' is distinct from '2026-01-17'
   or (result->'minutes'->>'meeting_date')::timestamptz is distinct from '2026-01-17T05:00Z'::timestamptz then
   raise exception 'The first scheduled save did not keep its exact record and original date';
 end if;
 origin:=result->'minutes';stale:=(origin->>'updated_at')::timestamptz;
 linked_action_id:=(result->'actions'->0->>'id')::uuid;
 update public.action_tracker set progress_pct=100,evidence='Fictional retained evidence',requires_verification=true,verification_status='passed',
   closure_notes='Fictional verified closure',closure_checklist=(select jsonb_object_agg(n::text,jsonb_build_object('confirmed',true)) from generate_series(1,6) n)
 where id=linked_action_id;
 update public.action_tracker set status='pending_closure' where id=linked_action_id;
 update public.action_tracker set status='closed' where id=linked_action_id;
 select to_jsonb(a)-'updated_at' into action_before from public.action_tracker a where id=linked_action_id;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into history_before from public.map_activity_log x where x.action_id=linked_action_id;
 if jsonb_array_length(history_before)<>1 then raise exception 'The occurrence fixture did not create one genuine closure decision';end if;
 body:=public.qa_occurrence_body('2026-01-17','2026-01-24T05:00:00Z','completed');
 result:=public.save_hse_minutes_occurrence(target,body,stale);
 if result->'minutes'->>'id' is distinct from target::text or result->'minutes'->>'scheduled_date' is distinct from '2026-01-17'
   or (result->'minutes'->>'meeting_date')::timestamptz is distinct from '2026-01-24T05:00Z'::timestamptz
   or result->'minutes'->>'created_by' is distinct from origin->>'created_by'
   or result->'minutes'->>'created_at' is distinct from origin->>'created_at' then
   raise exception 'Changing the meeting date replaced its identity or occurrence origin';
 end if;
 if (select agenda_anchor_date from public.meeting_series where id='d1250000-0000-4000-8000-000000000040') is distinct from '2026-01-17'::date
   or (select next_date from public.meeting_series where id='d1250000-0000-4000-8000-000000000040') is distinct from '2026-04-17'::date then
   raise exception 'Completing a moved meeting shifted the recurrence anchor';
 end if;
 if (select count(*) from public.hse_meetings where company_id='d1250000-0000-4000-8000-000000000010')<>1
   or (select count(*) from public.action_tracker where source_id=target)<>1
   or (select to_jsonb(a)-'updated_at' from public.action_tracker a where id=linked_action_id) is distinct from action_before
   or (select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.map_activity_log x where x.action_id=linked_action_id) is distinct from history_before then
   raise exception 'Moving minutes duplicated or altered the linked action or closure decision';
 end if;
 if not exists(select 1 from jsonb_array_elements(result->'minutes'->'recommendations') r
   where r->>'action_id'=linked_action_id::text and r->>'key'='d1250000-0000-4000-8000-000000000060') then
   raise exception 'Moving minutes lost the action recommendation link';
 end if;
 current_version:=(result->'minutes'->>'updated_at')::timestamptz;
 before_rows:=public.qa_occurrence_snapshot();
 rejected:=false;begin perform public.save_hse_minutes_occurrence(target,body,stale);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Stale meeting date edits overwrote newer minutes';end if;
 rejected:=false;begin perform public.save_hse_minutes_occurrence('d1250000-0000-4000-8000-000000000051',body,null);exception when others then rejected:=true;end;
 if not rejected then raise exception 'A second minutes ID claimed the same scheduled occurrence';end if;
 rejected:=false;begin perform public.save_hse_minutes_occurrence(target,body||'{"scheduled_date":"2026-04-17"}',current_version);exception when others then rejected:=true;end;
 if not rejected then raise exception 'A date edit reassigned the original occurrence claim';end if;
 rejected:=false;begin update public.hse_meetings set scheduled_date=null where id=target;exception when others then rejected:=true;end;
 if not rejected then raise exception 'A direct update detached an already-bound occurrence';end if;
 rejected:=false;begin update public.hse_meetings set scheduled_date='2026-04-17' where id=target;exception when others then rejected:=true;end;
 if not rejected then raise exception 'A direct update reassigned an already-bound occurrence';end if;
 rejected:=false;begin update public.hse_meetings set series_id=null where id=target;exception when others then rejected:=true;end;
 if not rejected then raise exception 'A direct update detached a bound occurrence from its series';end if;
 if public.qa_occurrence_snapshot() is distinct from before_rows then raise exception 'Rejected date edits or duplicate claims left partial records';end if;
 -- Older clients must continue updating the same already-bound occurrence.
 result:=public.save_hse_minutes(target,(body-'scheduled_date')||'{"meeting_date":"2026-01-31T05:00:00Z"}',current_version);
 if result->'minutes'->>'scheduled_date' is distinct from '2026-01-17'
   or result->'minutes'->>'id' is distinct from target::text then raise exception 'The old save route discarded the existing occurrence origin';end if;
 -- Cancellation retains the minutes and closed follow-up instead of deleting them.
 update public.hse_meetings set status='cancelled',updated_at=clock_timestamp() where id=target;
 if not exists(select 1 from public.hse_meetings where id=target and scheduled_date='2026-01-17' and status='cancelled')
   or not exists(select 1 from public.action_tracker where id=linked_action_id and status='closed') then
   raise exception 'Cancelling saved minutes removed their occurrence claim or linked action';
 end if;
 rejected:=false;begin perform public.save_hse_minutes_occurrence('d1250000-0000-4000-8000-000000000051',body,null);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Cancelled minutes allowed a duplicate record to claim their original occurrence';end if;
 rejected:=false;begin perform public.set_meeting_occurrence('d1250000-0000-4000-8000-000000000040','2026-01-17','cancel',null);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Cancelling a planned occurrence hid retained cancelled minutes';end if;
end $$;

-- A single planned date can be removed and restored without touching its series
-- or the minutes, actions and history of other dates.
do $$
declare result jsonb; exception_row public.meeting_occurrence_exceptions; before_rows jsonb; rejected boolean; stale timestamptz;
 body jsonb:=public.qa_occurrence_body('2026-04-17','2026-04-24T05:00:00Z')||'{"recommendations":[]}';
begin
 before_rows:=public.qa_occurrence_snapshot();
 result:=public.set_meeting_occurrence('d1250000-0000-4000-8000-000000000040','2026-04-17','cancel',null);
 select * into strict exception_row from public.meeting_occurrence_exceptions where series_id='d1250000-0000-4000-8000-000000000040' and scheduled_date='2026-04-17';
 if exception_row.status<>'cancelled' or exception_row.created_by<>auth.uid() or result->>'id' is distinct from exception_row.id::text then raise exception 'Planned occurrence cancellation was not recorded under its actor';end if;
 stale:=exception_row.updated_at;
 if public.qa_occurrence_snapshot()-'exceptions' is distinct from before_rows-'exceptions' then raise exception 'Cancelling one planned occurrence changed unrelated records';end if;
 rejected:=false;begin perform public.save_hse_minutes_occurrence('d1250000-0000-4000-8000-000000000052',body,null);exception when others then rejected:=true;end;
 if not rejected then raise exception 'A cancelled occurrence accepted a new minutes record';end if;
 result:=public.set_meeting_occurrence('d1250000-0000-4000-8000-000000000040','2026-04-17','restore',exception_row.updated_at);
 select * into strict exception_row from public.meeting_occurrence_exceptions where id=exception_row.id;
 if exception_row.status='cancelled' then raise exception 'Restoring a planned occurrence left it cancelled';end if;
 rejected:=false;begin perform public.set_meeting_occurrence('d1250000-0000-4000-8000-000000000040','2026-04-17','cancel',stale);exception when others then rejected:=true;end;
 if not rejected then raise exception 'A stale occurrence command overwrote a newer restore';end if;
 rejected:=false;begin perform public.set_meeting_occurrence('d1250000-0000-4000-8000-000000000040','2026-04-17','restore',stale);exception when others then rejected:=true;end;
 if not rejected then raise exception 'A stale restore overwrote a newer occurrence version';end if;
 rejected:=false;begin perform public.set_meeting_occurrence('d1250000-0000-4000-8000-000000000040','2026-07-17','restore',null);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Restoring a missing exception fabricated an occurrence state';end if;
 result:=public.save_hse_minutes_occurrence('d1250000-0000-4000-8000-000000000052',body,null);
 if result->'minutes'->>'scheduled_date'<>'2026-04-17' or (select count(*) from public.hse_meetings where id='d1250000-0000-4000-8000-000000000052')<>1 then
   raise exception 'Restored occurrence did not save exactly one claimed meeting';end if;
 rejected:=false;begin perform public.set_meeting_occurrence('d1250000-0000-4000-8000-000000000040','2026-04-17','cancel',exception_row.updated_at);exception when others then rejected:=true;end;
 if not rejected then raise exception 'A planned-slot cancellation hid an already-saved meeting';end if;
end $$;

-- First editing an older, unbound record claims its original date without
-- replacing it. Exact-date legacy minutes must also block slot cancellation.
savepoint qa_legacy_origin;
do $$declare result jsonb; original jsonb; rejected boolean:=false;begin
 result:=public.save_hse_minutes('d1250000-0000-4000-8000-000000000054',
   (public.qa_occurrence_body('2026-10-17','2026-10-17T05:00:00Z')-'scheduled_date')||'{"recommendations":[]}',null);
 original:=result->'minutes';
 if original->>'scheduled_date' is not null then raise exception 'Legacy save unexpectedly claimed a planned date';end if;
 begin perform public.set_meeting_occurrence('d1250000-0000-4000-8000-000000000040','2026-10-17','cancel',null);exception when others then rejected:=true;end;
 if not rejected then raise exception 'A planned-slot cancellation hid exact-date legacy minutes';end if;
 result:=public.save_hse_minutes_occurrence('d1250000-0000-4000-8000-000000000054',
   public.qa_occurrence_body('2026-10-17','2026-10-24T05:00:00Z')||'{"recommendations":[]}',(original->>'updated_at')::timestamptz);
 if result->'minutes'->>'id' is distinct from original->>'id'
   or result->'minutes'->>'scheduled_date' is distinct from '2026-10-17'
   or result->'minutes'->>'created_at' is distinct from original->>'created_at'
   or result->'minutes'->>'created_by' is distinct from original->>'created_by'
   or (result->'minutes'->>'meeting_date')::timestamptz is distinct from '2026-10-24T05:00Z'::timestamptz then
   raise exception 'Binding and moving legacy minutes changed their record identity or original date';end if;
end$$;
rollback to savepoint qa_legacy_origin;
release savepoint qa_legacy_origin;

-- Existing same-day legacy records retain independent identities. Ordinary
-- edits do not guess their original slots or force them into a uniqueness claim.
savepoint qa_ambiguous_legacy_origins;
reset role;
select set_config('request.jwt.claim.sub','',true);
grant delete on public.hse_meetings to authenticated;
select set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare result jsonb;first_row jsonb;second_row jsonb;before_rows jsonb;rejected boolean:=false;begin
 result:=public.save_hse_minutes('d1250000-0000-4000-8000-000000000054',
   (public.qa_occurrence_body('2026-10-17','2026-10-17T05:00:00Z')-'scheduled_date')||'{"recommendations":[]}',null);
 first_row:=result->'minutes';
 result:=public.save_hse_minutes('d1250000-0000-4000-8000-000000000057',
   (public.qa_occurrence_body('2026-10-17','2026-10-17T05:00:00Z')-'scheduled_date')||'{"recommendations":[]}',null);
 second_row:=result->'minutes';
 result:=public.save_hse_minutes_occurrence('d1250000-0000-4000-8000-000000000054',
   (public.qa_occurrence_body('2026-10-17','2026-10-24T05:00:00Z')-'scheduled_date')||'{"recommendations":[]}',(first_row->>'updated_at')::timestamptz);
 first_row:=result->'minutes';
 if first_row->>'scheduled_date' is not null or first_row->>'id'<>'d1250000-0000-4000-8000-000000000054' then raise exception 'An ordinary legacy edit guessed its original occurrence';end if;
 result:=public.save_hse_minutes_occurrence('d1250000-0000-4000-8000-000000000057',
   public.qa_occurrence_body('2026-10-17','2026-10-31T05:00:00Z')||'{"scheduled_date":null,"recommendations":[]}',(second_row->>'updated_at')::timestamptz);
 if result->'minutes'->>'scheduled_date' is not null or result->'minutes'->>'id'<>'d1250000-0000-4000-8000-000000000057'
   or (select count(*) from public.hse_meetings where id in ('d1250000-0000-4000-8000-000000000054','d1250000-0000-4000-8000-000000000057'))<>2 then
   raise exception 'Editing ambiguous legacy minutes merged, rebound or lost a record';end if;
 result:=public.save_hse_minutes_occurrence('d1250000-0000-4000-8000-000000000054',
   (public.qa_occurrence_body('2026-10-17','2026-10-24T05:00:00Z','cancelled')-'scheduled_date')||'{"recommendations":[]}',(first_row->>'updated_at')::timestamptz);
 before_rows:=public.qa_occurrence_snapshot();
 begin delete from public.hse_meetings where id='d1250000-0000-4000-8000-000000000054';exception when others then rejected:=true;end;
 if not rejected then raise exception 'Legacy minutes without a confirmed origin were permanently deleted';end if;
 if public.qa_occurrence_snapshot() is distinct from before_rows then raise exception 'Blocked legacy deletion changed records';end if;
 result:=public.save_hse_minutes_occurrence('d1250000-0000-4000-8000-000000000058',
   (public.qa_occurrence_body('2027-01-17','2027-01-17T05:00:00Z')-'scheduled_date')||'{"recommendations":[]}',null);
 if result->'minutes'->>'scheduled_date' is distinct from '2027-01-17' then raise exception 'A new scheduled meeting without an explicit origin failed to claim its starting date';end if;
end$$;
rollback to savepoint qa_ambiguous_legacy_origins;
release savepoint qa_ambiguous_legacy_origins;

-- Downstream triggers may suppress a write without raising. A successful old
-- minutes save must roll back if binding its original occurrence did not persist.
reset role;
select set_config('request.jwt.claim.sub','',true);
create function public.qa_suppress_occurrence_binding() returns trigger language plpgsql as $$begin
 if new.id='d1250000-0000-4000-8000-000000000053' and old.scheduled_date is null and new.scheduled_date is not null then return null;end if;
 return new;end$$;
create trigger qa_suppress_occurrence_binding before update on public.hse_meetings for each row execute function public.qa_suppress_occurrence_binding();
select set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare rejected boolean:=false;before_rows jsonb:=public.qa_occurrence_snapshot();begin
 begin perform public.save_hse_minutes_occurrence('d1250000-0000-4000-8000-000000000053',public.qa_occurrence_body('2026-07-17','2026-07-24T05:00:00Z'),null);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Suppressed occurrence binding reported a successful minutes save';end if;
 if public.qa_occurrence_snapshot() is distinct from before_rows then raise exception 'Suppressed occurrence binding left minutes or follow-up actions';end if;
end$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
drop trigger qa_suppress_occurrence_binding on public.hse_meetings;
create function public.qa_suppress_occurrence_exception() returns trigger language plpgsql as $$begin
 if new.series_id='d1250000-0000-4000-8000-000000000040' and new.scheduled_date='2026-07-17' then return null;end if;
 return new;end$$;
create trigger qa_suppress_occurrence_exception before insert on public.meeting_occurrence_exceptions for each row execute function public.qa_suppress_occurrence_exception();
select set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare rejected boolean:=false;before_rows jsonb:=public.qa_occurrence_snapshot();begin
 begin perform public.set_meeting_occurrence('d1250000-0000-4000-8000-000000000040','2026-07-17','cancel',null);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Suppressed exception insertion reported a successful cancellation';end if;
 if public.qa_occurrence_snapshot() is distinct from before_rows then raise exception 'Suppressed occurrence cancellation left partial writes';end if;
end$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
drop trigger qa_suppress_occurrence_exception on public.meeting_occurrence_exceptions;
select set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.set_meeting_occurrence('d1250000-0000-4000-8000-000000000040','2026-07-17','cancel',null);
reset role;
select set_config('request.jwt.claim.sub','',true);
create trigger qa_suppress_occurrence_exception before update on public.meeting_occurrence_exceptions for each row execute function public.qa_suppress_occurrence_exception();
select set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare rejected boolean:=false;before_rows jsonb:=public.qa_occurrence_snapshot();version timestamptz;begin
 select updated_at into strict version from public.meeting_occurrence_exceptions where series_id='d1250000-0000-4000-8000-000000000040' and scheduled_date='2026-07-17';
 begin perform public.set_meeting_occurrence('d1250000-0000-4000-8000-000000000040','2026-07-17','restore',version);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Suppressed exception update reported a successful restore';end if;
 if public.qa_occurrence_snapshot() is distinct from before_rows then raise exception 'Suppressed occurrence restore changed records';end if;
end$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
drop trigger qa_suppress_occurrence_exception on public.meeting_occurrence_exceptions;
select set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000001',true);
set local role authenticated;

-- Permanently deleting already-cancelled minutes leaves a cancellation marker.
-- If that marker cannot be saved, the deletion must roll back with the minutes.
reset role;
select set_config('request.jwt.claim.sub','',true);
savepoint qa_deleted_minutes_origin;
grant delete on public.hse_meetings to authenticated;
create function public.qa_suppress_deleted_occurrence() returns trigger language plpgsql as $$begin
 if new.series_id='d1250000-0000-4000-8000-000000000040' and new.scheduled_date='2026-10-17' then return null;end if;
 return new;end$$;
create trigger qa_suppress_deleted_occurrence before insert on public.meeting_occurrence_exceptions for each row execute function public.qa_suppress_deleted_occurrence();
select set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.save_hse_minutes_occurrence('d1250000-0000-4000-8000-000000000055',
 public.qa_occurrence_body('2026-10-17','2026-10-24T05:00:00Z','cancelled')||'{"recommendations":[]}',null);
do $$declare rejected boolean:=false;before_rows jsonb:=public.qa_occurrence_snapshot();begin
 begin delete from public.hse_meetings where id='d1250000-0000-4000-8000-000000000055';exception when others then rejected:=true;end;
 if not rejected then raise exception 'Deleting cancelled minutes succeeded without retaining their occurrence';end if;
 if public.qa_occurrence_snapshot() is distinct from before_rows then raise exception 'Failed cancellation-marker save partially deleted minutes';end if;
end$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
drop trigger qa_suppress_deleted_occurrence on public.meeting_occurrence_exceptions;
select set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare marker public.meeting_occurrence_exceptions;result jsonb;rejected boolean:=false;begin
 delete from public.hse_meetings where id='d1250000-0000-4000-8000-000000000055';
 if exists(select 1 from public.hse_meetings where id='d1250000-0000-4000-8000-000000000055') then raise exception 'Cancelled minutes were not deleted';end if;
 select * into strict marker from public.meeting_occurrence_exceptions where series_id='d1250000-0000-4000-8000-000000000040' and scheduled_date='2026-10-17';
 if marker.status<>'cancelled' or marker.company_id<>'d1250000-0000-4000-8000-000000000010' or marker.created_by<>auth.uid() or marker.updated_by<>auth.uid() then
   raise exception 'Deleting cancelled minutes lost their exact planned origin or actor';end if;
 begin perform public.save_hse_minutes_occurrence('d1250000-0000-4000-8000-000000000056',public.qa_occurrence_body('2026-10-17','2026-10-24T05:00:00Z')||'{"recommendations":[]}',null);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Deleting cancelled minutes regenerated their planned occurrence';end if;
 perform public.set_meeting_occurrence(marker.series_id,marker.scheduled_date,'restore',marker.updated_at);
 result:=public.save_hse_minutes_occurrence('d1250000-0000-4000-8000-000000000056',public.qa_occurrence_body('2026-10-17','2026-10-24T05:00:00Z')||'{"recommendations":[]}',null);
 if result->'minutes'->>'scheduled_date' is distinct from '2026-10-17' then raise exception 'Restored deleted occurrence could not create replacement minutes';end if;
end$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
rollback to savepoint qa_deleted_minutes_origin;
release savepoint qa_deleted_minutes_origin;
select set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000001',true);
set local role authenticated;

-- Revoked access and another tenant cannot move minutes or cancel an occurrence.
do $$declare actor uuid; rejected boolean;before_rows jsonb;affected integer;begin
 before_rows:=public.qa_occurrence_snapshot();
 foreach actor in array array['d1250000-0000-4000-8000-000000000002'::uuid,'d1250000-0000-4000-8000-000000000003'::uuid,'d1250000-0000-4000-8000-000000000004'::uuid] loop
   perform set_config('request.jwt.claim.sub',actor::text,true);
   rejected:=false;begin perform public.set_meeting_occurrence('d1250000-0000-4000-8000-000000000040','2026-10-17','cancel',null);exception when others then rejected:=true;end;
   if not rejected then raise exception 'Inactive, employee or foreign caller cancelled an occurrence';end if;
   rejected:=false;begin perform public.save_hse_minutes_occurrence('d1250000-0000-4000-8000-000000000053',public.qa_occurrence_body('2026-10-17','2026-10-17T05:00:00Z')||'{"recommendations":[]}',null);exception when others then rejected:=true;end;
   if not rejected then raise exception 'Inactive, employee or foreign caller saved an occurrence';end if;
   rejected:=false;begin insert into public.meeting_occurrence_exceptions(company_id,series_id,scheduled_date,status)
    values('d1250000-0000-4000-8000-000000000010','d1250000-0000-4000-8000-000000000040','2026-10-17','cancelled');exception when others then rejected:=true;end;
   if not rejected then raise exception 'Direct table access bypassed occurrence cancellation permission';end if;
   affected:=0;begin update public.meeting_occurrence_exceptions set status='active'
     where series_id='d1250000-0000-4000-8000-000000000040' and scheduled_date='2026-07-17';get diagnostics affected=row_count;exception when others then affected:=0;end;
   if affected<>0 then raise exception 'Direct table access changed an occurrence without permission';end if;
 end loop;
 perform set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000001',true);
 if public.qa_occurrence_snapshot() is distinct from before_rows then raise exception 'An unauthorized occurrence command left partial writes';end if;
 perform set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000004',true);
 if exists(select 1 from public.meeting_occurrence_exceptions where company_id='d1250000-0000-4000-8000-000000000010') then
   raise exception 'A foreign company read occurrence exceptions';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"meetings.minutes":{"view":true,"edit":false}}}' where id='d1250000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare rejected boolean:=false;begin
 begin perform public.save_hse_minutes_occurrence('d1250000-0000-4000-8000-000000000053',public.qa_occurrence_body('2026-10-17','2026-10-17T05:00:00Z')||'{"recommendations":[]}',null);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Revoked minutes edit permission was ignored';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"meetings.schedule":{"view":true,"edit":false}}}' where id='d1250000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare rejected boolean:=false;begin
 begin perform public.set_meeting_occurrence('d1250000-0000-4000-8000-000000000040','2026-10-17','cancel',null);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Revoked schedule edit permission was ignored';end if;
end$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"meetings.minutes":{"view":false,"edit":false}}}' where id='d1250000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare rejected boolean:=false;begin
 begin perform public.set_meeting_occurrence('d1250000-0000-4000-8000-000000000040','2026-10-17','cancel',null);exception when others then rejected:=true;end;
 if not rejected then raise exception 'A caller unable to see saved minutes cancelled an occurrence';end if;
end$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"meetings.schedule":{"view":false,"edit":false}}}' where id='d1250000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare result jsonb;version timestamptz;begin
 if exists(select 1 from public.meeting_series where id='d1250000-0000-4000-8000-000000000040') then raise exception 'Schedule view revocation did not hide the fixture schedule';end if;
 select updated_at into strict version from public.hse_meetings where id='d1250000-0000-4000-8000-000000000052';
 result:=public.save_hse_minutes_occurrence('d1250000-0000-4000-8000-000000000052',
   public.qa_occurrence_body('2026-04-17','2026-04-25T05:00:00Z')||'{"recommendations":[]}',version);
 if result->'minutes'->>'id' is distinct from 'd1250000-0000-4000-8000-000000000052'
   or result->'minutes'->>'scheduled_date' is distinct from '2026-04-17'
   or (result->'minutes'->>'meeting_date')::timestamptz is distinct from '2026-04-25T05:00Z'::timestamptz then
   raise exception 'A minutes editor could not edit an already-bound record without schedule view access';end if;
end$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions=null where id='d1250000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','d1250000-0000-4000-8000-000000000001',true);
set local role authenticated;
-- The original meeting, its cancelled state and its closed action are still there.
do $$begin
 if (select count(*) from public.hse_meetings where company_id='d1250000-0000-4000-8000-000000000010')<>2
   or (select count(*) from public.action_tracker where company_id='d1250000-0000-4000-8000-000000000010')<>1
   or not exists(select 1 from public.hse_meetings where id='d1250000-0000-4000-8000-000000000050' and status='cancelled' and scheduled_date='2026-01-17') then
   raise exception 'Rejected occurrence operations left duplicate or missing records';end if;
end $$;
reset role;
rollback;
