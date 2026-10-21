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

-- An additional deployment-specific row policy must remain authoritative even
-- when the user has module-level action permissions.
create policy qa_isolated_action_update_denied on public.action_tracker as restrictive for update to authenticated using(false) with check(false);
set local role authenticated;
do $$
declare payload jsonb; previous_title text;
begin
  select to_jsonb(m),m.title into payload,previous_title from public.hse_meetings m where id='c1820000-0000-4000-8000-000000000050';
  begin
    perform public.save_hse_minutes('c1820000-0000-4000-8000-000000000050',jsonb_set(payload,'{title}','"Blocked by additional row policy"'),null);
    raise exception 'An additional action row policy was silently bypassed';
  exception when insufficient_privilege then null;
  end;
  if (select title from public.hse_meetings where id='c1820000-0000-4000-8000-000000000050') is distinct from previous_title
    or (select count(*) from public.action_tracker where source_id='c1820000-0000-4000-8000-000000000050')<>1
  then raise exception 'An action row policy rejection left partial minutes or duplicate actions';end if;
end $$;
reset role;
drop policy qa_isolated_action_update_denied on public.action_tracker;

-- A custom BEFORE trigger can suppress an UPDATE after the row was locked.
-- The RPC must confirm its UPDATE result and roll back all related writes.
create function public.qa_isolated_suppress_action_update() returns trigger language plpgsql as $$begin return null;end $$;
create trigger qa_isolated_suppress_action_update before update on public.action_tracker for each row execute function public.qa_isolated_suppress_action_update();
set local role authenticated;
do $$
declare payload jsonb; previous_title text;
begin
  select to_jsonb(m),m.title into payload,previous_title from public.hse_meetings m where id='c1820000-0000-4000-8000-000000000050';
  begin
    perform public.save_hse_minutes('c1820000-0000-4000-8000-000000000050',jsonb_set(payload,'{title}','"Suppressed linked action update"'),null);
    raise exception 'A suppressed action update was silently accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'The linked Master Action could not be updated. No minutes were saved' then raise;end if;
  end;
  if (select title from public.hse_meetings where id='c1820000-0000-4000-8000-000000000050') is distinct from previous_title
    or (select count(*) from public.action_tracker where source_id='c1820000-0000-4000-8000-000000000050')<>1
  then raise exception 'A suppressed linked action update left partial minutes or duplicate actions';end if;
end $$;
reset role;
drop trigger qa_isolated_suppress_action_update on public.action_tracker;
drop function public.qa_isolated_suppress_action_update();

-- The independently restored helpers must enforce section permissions, not
-- merely make the RPC callable. Prepare restrictions as the maintenance role.
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"meetings.minutes":{"view":true,"edit":false}}}' where id='c1820000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','c1820000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare payload jsonb;
begin
  if public.user_access_allowed('meetings.minutes','edit') or not public.user_access_allowed('meetings.minutes','view')
  then raise exception 'Restored helper did not retain explicit section permissions';end if;
  select to_jsonb(m) into payload from public.hse_meetings m where id='c1820000-0000-4000-8000-000000000050';
  begin
    perform public.save_hse_minutes('c1820000-0000-4000-8000-000000000050',payload,null);
    raise exception 'Restored helper allowed a revoked minutes save';
  exception when raise_exception then
    if sqlerrm<>'Minutes editing access is required' then raise;end if;
  end;
  begin
    update public.hse_meetings set title='Unauthorised direct edit' where id='c1820000-0000-4000-8000-000000000050';
    raise exception 'Restored trigger helper allowed a revoked direct edit';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Trigger checks must also protect writes through a definer routine, for which
-- row policies alone would not be sufficient.
create function public.qa_isolated_minutes_guard() returns void language sql security definer set search_path=pg_catalog,public as $$
  update public.hse_meetings set title='Unauthorised definer edit' where id='c1820000-0000-4000-8000-000000000050'
$$;
grant execute on function public.qa_isolated_minutes_guard() to authenticated;
set local role authenticated;
do $$begin
  begin
    perform public.qa_isolated_minutes_guard();
    raise exception 'Restored trigger helper allowed a definer routine to bypass revoked minutes access';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"meetings":{"view":false}}}' where id='c1820000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','c1820000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$begin
  if public.user_access_allowed('meetings.minutes','view') then raise exception 'Restored helper ignored a parent module restriction';end if;
  if exists(select 1 from public.hse_meetings where id='c1820000-0000-4000-8000-000000000050')
  then raise exception 'Restored helper disclosed minutes from a hidden module';end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"actions":{"view":true,"create":false}}}' where id='c1820000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','c1820000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare payload jsonb;
begin
  select to_jsonb(m) into payload from public.hse_meetings m where id='c1820000-0000-4000-8000-000000000050';
  begin
    perform public.save_hse_minutes('c1820000-0000-4000-8000-000000000051',payload,null);
    raise exception 'Restored helper allowed a revoked linked action creation';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.action_tracker(company_id,title,description,status,priority,source_module,source_type,source_id)
    values('c1820000-0000-4000-8000-000000000010','Unauthorised direct action','Unauthorised direct action','open','medium','meeting','meeting','c1820000-0000-4000-8000-000000000051');
    raise exception 'Restored action policies allowed a revoked direct creation';
  exception when insufficient_privilege then null;
  end;
  if exists(select 1 from public.hse_meetings where id='c1820000-0000-4000-8000-000000000051')
    or exists(select 1 from public.action_tracker where source_id='c1820000-0000-4000-8000-000000000051')
  then raise exception 'Revoked linked action creation left partial minutes or actions';end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"actions":{"view":true,"edit":false}}}' where id='c1820000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','c1820000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare payload jsonb; previous_title text; affected integer;
begin
  select to_jsonb(m),m.title into payload,previous_title from public.hse_meetings m where id='c1820000-0000-4000-8000-000000000050';
  begin
    perform public.save_hse_minutes('c1820000-0000-4000-8000-000000000050',jsonb_set(payload,'{title}','"Unauthorised linked action edit"'),null);
    raise exception 'Restored helper allowed a revoked linked action write';
  exception when insufficient_privilege then null;
  end;
  update public.action_tracker set title='Unauthorised direct action edit' where source_id='c1820000-0000-4000-8000-000000000050';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Restored action policies allowed a revoked direct edit';end if;
  if (select title from public.hse_meetings where id='c1820000-0000-4000-8000-000000000050') is distinct from previous_title
    or (select count(*) from public.action_tracker where source_id='c1820000-0000-4000-8000-000000000050')<>1
  then raise exception 'A revoked linked action write left partial minutes or duplicate actions';end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"actions":{"view":false}}}' where id='c1820000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','c1820000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare payload jsonb; result jsonb;
begin
  select to_jsonb(m) into payload from public.hse_meetings m where id='c1820000-0000-4000-8000-000000000050';
  begin
    perform public.save_hse_minutes('c1820000-0000-4000-8000-000000000050',payload,null);
    raise exception 'Minutes RPC synchronized recommendations without action viewing access';
  exception when insufficient_privilege then null;
  end;
  result:=public.save_hse_minutes('c1820000-0000-4000-8000-000000000050',jsonb_set(payload,'{recommendations}','[]'::jsonb),null);
  if result->'minutes'->>'id' is distinct from 'c1820000-0000-4000-8000-000000000050'
    or result->'actions' is distinct from '[]'::jsonb
  then raise exception 'A minutes-only save disclosed hidden linked action records';end if;
  if exists(select 1 from public.action_tracker where source_id='c1820000-0000-4000-8000-000000000050')
  then raise exception 'Restored action view policy disclosed a hidden action';end if;
end $$;
reset role;
rollback;
