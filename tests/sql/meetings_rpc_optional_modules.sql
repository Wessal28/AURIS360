-- Embedded only by meetings-rpc-isolation-fixture.cjs in the disposable replay.
-- The wrapper hides all four optional communications tables and rolls back.
begin;
grant usage on schema public,auth to authenticated;
grant select on public.profiles,public.people to authenticated;
grant select,insert,update on public.hse_meetings,public.action_tracker to authenticated;
grant select,update on public.meeting_series to authenticated;
insert into auth.users(id) values('c1820000-0000-4000-8000-000000000001');
insert into public.companies(id,name) values('c1820000-0000-4000-8000-000000000010','Fictional isolated minutes repair');
insert into public.profiles(id,company_id,full_name,role,status) values('c1820000-0000-4000-8000-000000000001','c1820000-0000-4000-8000-000000000010','Fictional minutes admin','admin','active');
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create or replace function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
select set_config('request.jwt.claim.sub','c1820000-0000-4000-8000-000000000001',true);
insert into public.people(id,company_id,first_name,last_name) values('c1820000-0000-4000-8000-000000000030','c1820000-0000-4000-8000-000000000010','Fictional','Owner');
insert into public.meeting_series(id,company_id,title,meeting_type,recurrence,next_date) values('c1820000-0000-4000-8000-000000000040','c1820000-0000-4000-8000-000000000010','Fictional schedule','management_review','quarterly','2026-10-18');
set local role authenticated;
do $$
declare payload jsonb; result jsonb; first_updated timestamptz; action_id uuid;
  minutes_id uuid:='c1820000-0000-4000-8000-000000000050';
begin
  payload:=jsonb_build_object('company_id','c1820000-0000-4000-8000-000000000010','title','Fictional isolated minutes','meeting_type','management_review','meeting_date','2026-10-18T05:00:00Z','meeting_timezone','Asia/Dubai','series_id','c1820000-0000-4000-8000-000000000040','next_meeting_date','2027-01-18','status','draft','recommendations','[{"key":"c1820000-0000-4000-8000-000000000060","desc":"Fictional follow-up","person_id":"c1820000-0000-4000-8000-000000000030","date":"2026-11-01","prio":"medium","status":"open"}]'::jsonb);
  result:=public.save_hse_minutes(minutes_id,payload,null);
  action_id:=(result->'actions'->0->>'id')::uuid;
  first_updated:=(result->'minutes'->>'updated_at')::timestamptz;
  if result->'minutes'->>'id' is distinct from minutes_id::text or jsonb_array_length(result->'actions')<>1
    or result->'actions'->0->>'assigned_to_name' is distinct from 'Fictional Owner'
  then raise exception 'Isolated minutes repair did not save minutes and their exact linked action';end if;
  result:=public.save_hse_minutes(minutes_id,payload,first_updated);
  if (result->'actions'->0->>'id')::uuid is distinct from action_id or jsonb_array_length(result->'actions')<>1
  then raise exception 'Isolated minutes update duplicated its linked action';end if;
  begin
    perform public.save_hse_minutes(minutes_id,payload,first_updated);
    raise exception 'Isolated minutes repair accepted a stale save';
  exception when raise_exception then
    if sqlerrm not like 'These minutes changed after opening%' then raise;end if;
  end;
  result:=public.save_hse_minutes(minutes_id,jsonb_set(payload,'{status}','"completed"'),(result->'minutes'->>'updated_at')::timestamptz);
  if result->'minutes'->>'status' is distinct from 'completed'
    or (select next_date from public.meeting_series where id='c1820000-0000-4000-8000-000000000040') is distinct from '2027-01-18'::date
  then raise exception 'Isolated completed minutes did not advance their schedule';end if;
end $$;
reset role;
rollback;
