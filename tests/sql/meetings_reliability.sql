-- Disposable CI fixtures only; no meeting or communication is sent.
begin;
-- The schema-only baseline omits Supabase's existing table ACLs. Reproduce the
-- caller grants here, retaining all real row policies; rollback removes them.
grant usage on schema public,auth to authenticated;
grant select on public.profiles,public.people to authenticated;
grant select,insert,update on public.hse_meetings,public.action_tracker to authenticated;
grant select,update on public.meeting_series to authenticated;
insert into auth.users(id) values('c1800000-0000-4000-8000-000000000001');
insert into public.companies(id,name) values('c1800000-0000-4000-8000-000000000010','Meetings test A'),('c1800000-0000-4000-8000-000000000020','Meetings test B');
-- The action assignee must resolve to a profile with an email so saving
-- minutes exercises the real assignment notification trigger.
insert into public.profiles(id,company_id,full_name,role,status,email)
values('c1800000-0000-4000-8000-000000000001','c1800000-0000-4000-8000-000000000010','Fictional Owner','admin','active','meetings-fixture@example.com');
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
select set_config('request.jwt.claim.sub','c1800000-0000-4000-8000-000000000001',true);
create or replace function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
insert into public.people(id,company_id,first_name,last_name) values('c1800000-0000-4000-8000-000000000030','c1800000-0000-4000-8000-000000000010','Fictional','Owner'),('c1800000-0000-4000-8000-000000000031','c1800000-0000-4000-8000-000000000020','Foreign','Owner');
insert into public.meeting_series(id,company_id,title,meeting_type,recurrence,next_date) values('c1800000-0000-4000-8000-000000000040','c1800000-0000-4000-8000-000000000010','Fictional schedule','management_review','quarterly','2026-10-18');
set local role authenticated;
do $$ declare payload jsonb; result jsonb; m uuid:='c1800000-0000-4000-8000-000000000050'; a uuid; first_updated timestamptz; begin
 payload:=jsonb_build_object('company_id','c1800000-0000-4000-8000-000000000010','title','Fictional minutes','meeting_type','management_review','meeting_date','2026-10-18T05:00:00Z','meeting_timezone','Asia/Dubai','series_id','c1800000-0000-4000-8000-000000000040','next_meeting_date','2027-01-18','status','draft','recommendations','[{"key":"c1800000-0000-4000-8000-000000000060","desc":"Fictional follow-up","person_id":"c1800000-0000-4000-8000-000000000030","resp":"incorrect input name","date":"2026-11-01","prio":"medium","status":"open"}]'::jsonb);
 result:=public.save_hse_minutes(m,payload,null);a:=(result->'actions'->0->>'id')::uuid;first_updated:=(result->'minutes'->>'updated_at')::timestamptz;
 if result->'minutes'->>'meeting_timezone'<>'Asia/Dubai' or (result->'minutes'->>'meeting_date')::timestamptz<>'2026-10-18T05:00Z'::timestamptz then raise exception 'meeting instant changed';end if;
 if (select next_date from public.meeting_series where id='c1800000-0000-4000-8000-000000000040')<>'2026-10-18'::date then raise exception 'draft consumed the schedule occurrence';end if;
 result:=public.save_hse_minutes(m,payload,first_updated);
 if (result->'actions'->0->>'id')::uuid<>a or jsonb_array_length(result->'actions')<>1 then raise exception 'repeated save duplicated actions';end if;
 if result->'actions'->0->>'assigned_to_name'<>'Fictional Owner' then raise exception 'owner identity was not verified';end if;
 update public.action_tracker set status='pending_closure',progress_pct=100,evidence='Fictional controlled evidence',verification_status='passed',closure_notes='Fixture reviewed',closure_checklist=(select jsonb_object_agg(n::text,jsonb_build_object('confirmed',true)) from generate_series(1,6) n) where id=a;
 update public.action_tracker set status='closed' where id=a;
 result:=public.save_hse_minutes(m,payload,(result->'minutes'->>'updated_at')::timestamptz);
 if result->'actions'->0->>'status'<>'closed' then raise exception 'resaving minutes reopened a completed action';end if;
 begin
   perform public.save_hse_minutes(m,payload,first_updated);raise exception 'stale minutes overwrite accepted';
 exception when raise_exception then if sqlerrm not like 'These minutes changed after opening%' then raise;end if;end;
 begin
   perform public.save_hse_minutes(m,jsonb_set(payload,'{recommendations,0,person_id}','"c1800000-0000-4000-8000-000000000031"'),null);raise exception 'foreign owner accepted';
 exception when raise_exception then if sqlerrm not like 'Action owner must be a person in this company%' then raise;end if;end;
 if (select count(*) from public.action_tracker where source_id=m)<>1 then raise exception 'failed save left partial actions';end if;
 payload:=jsonb_set(payload,'{status}','"completed"');
 payload:=jsonb_set(payload,'{recommendations}',(payload->'recommendations')||'[{"key":"c1800000-0000-4000-8000-000000000061","desc":"Fictional follow-up added at completion","person_id":"c1800000-0000-4000-8000-000000000030","date":"2026-11-05","prio":"medium","status":"open"}]'::jsonb);
 result:=public.save_hse_minutes(m,payload,(result->'minutes'->>'updated_at')::timestamptz);
 if result->'minutes'->>'status'<>'completed' or jsonb_array_length(result->'actions')<>2
   then raise exception 'completing minutes did not save the additional assigned action';end if;
 if (select next_date from public.meeting_series where id='c1800000-0000-4000-8000-000000000040')<>'2027-01-18'::date then raise exception 'completion did not advance recurrence';end if;
 result:=public.save_hse_minutes(m,payload,(result->'minutes'->>'updated_at')::timestamptz);
 if jsonb_array_length(result->'actions')<>2 then raise exception 'resaving completed minutes duplicated actions';end if;
end $$;
reset role;
-- Inspect the durable queue as the fixture owner without granting callers
-- access to the queue or running a delivery worker.
do $$begin
 if (select count(*) from public.notification_queue
     where type='action' and to_email='meetings-fixture@example.com')<>2
   then raise exception 'each assigned action must enqueue once across repeat minutes saves';end if;
 if exists(
   select 1 from public.action_tracker a
   where a.company_id='c1800000-0000-4000-8000-000000000010'
     and a.source_module='meeting' and a.source_id='c1800000-0000-4000-8000-000000000050'
     and 1<>(select count(*) from public.notification_queue q
       where q.company_id=a.company_id and q.type='action' and q.to_email='meetings-fixture@example.com'
         and q.related_module='actions' and q.related_table='action_tracker' and q.related_id=a.id
         and q.related_ref=coalesce(nullif(btrim(a.action_ref),''),a.id::text)
         and q.record_url='https://auris360.app/?goto=actions&record='||a.id::text||'&table=action_tracker&company='||a.company_id::text)
 ) then raise exception 'assignment notification did not link to the exact saved action';end if;
end $$;
-- An ambiguous same-company name still saves the action without choosing an
-- arbitrary email recipient.
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id) values('c1800000-0000-4000-8000-000000000002');
insert into public.profiles(id,company_id,full_name,role,status,email)
values('c1800000-0000-4000-8000-000000000002','c1800000-0000-4000-8000-000000000010','Fictional Owner','admin','active','another-meetings-fixture@example.com');
select set_config('request.jwt.claim.sub','c1800000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare
  result jsonb;
begin
  result:=public.save_hse_minutes('c1800000-0000-4000-8000-000000000051',
    '{"company_id":"c1800000-0000-4000-8000-000000000010","title":"Fictional minutes with ambiguous assignee email","meeting_type":"management_review","meeting_date":"2026-10-19T05:00:00Z","meeting_timezone":"Asia/Dubai","status":"completed","recommendations":[{"key":"c1800000-0000-4000-8000-000000000062","desc":"Fictional assigned follow-up","person_id":"c1800000-0000-4000-8000-000000000030","date":"2026-11-05","prio":"medium","status":"open"}]}'::jsonb,null);
  if result->'minutes'->>'status'<>'completed' or jsonb_array_length(result->'actions')<>1
    or result->'actions'->0->>'assigned_to_id' is distinct from 'c1800000-0000-4000-8000-000000000030'
    then raise exception 'ambiguous email prevented saving the assigned action';end if;
end $$;
reset role;
do $$begin
 if exists(
   select 1 from public.notification_queue q join public.action_tracker a on q.related_id=a.id
   where a.company_id='c1800000-0000-4000-8000-000000000010'
     and a.source_module='meeting' and a.source_id='c1800000-0000-4000-8000-000000000051'
     and q.type='action'
 ) then raise exception 'ambiguous name was used to choose a notification recipient';end if;
end $$;
-- Exercise real table RLS as the authenticated caller, including the corrected
-- distinction between Minutes access and Schedule access.
-- Prepare the test restriction with the local maintenance identity. The user
-- cannot change their own permissions; restore that identity before RLS checks.
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"meetings.schedule":{"view":false},"meetings.minutes":{"view":true,"edit":true}}}' where id='c1800000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','c1800000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$begin
 if not exists(select 1 from public.hse_meetings where id='c1800000-0000-4000-8000-000000000050') then raise exception 'minutes access incorrectly depends on Schedule access';end if;
 insert into public.safety_awareness_topics(company_id,plan_year,planned_month,theme,discussion_points) values('c1800000-0000-4000-8000-000000000010',2026,10,'Fictional topic',array['Discussion one']);
 if not exists(select 1 from public.safety_awareness_topics where theme='Fictional topic') then raise exception 'awareness load failed';end if;
 begin
  insert into public.safety_awareness_topics(company_id,plan_year,planned_month,theme,discussion_points) values('c1800000-0000-4000-8000-000000000020',2026,10,'Foreign topic',array['Private']);
  raise exception 'foreign awareness save accepted';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
