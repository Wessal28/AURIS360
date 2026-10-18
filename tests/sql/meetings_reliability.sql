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
insert into public.profiles(id,company_id,full_name,role,status) values('c1800000-0000-4000-8000-000000000001','c1800000-0000-4000-8000-000000000010','Meeting test admin','admin','active');
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
 result:=public.save_hse_minutes(m,jsonb_set(payload,'{status}','"completed"'),(result->'minutes'->>'updated_at')::timestamptz);
 if (select next_date from public.meeting_series where id='c1800000-0000-4000-8000-000000000040')<>'2027-01-18'::date then raise exception 'completion did not advance recurrence';end if;
end $$;
reset role;
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
