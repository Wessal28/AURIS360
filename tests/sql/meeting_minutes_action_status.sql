-- Disposable, rollback-only records. No delivery worker or communication is run.
begin;

-- Reproduce PostgREST table ACLs omitted by the schema-only baseline, while
-- exercising the real tenant policies and lifecycle triggers as authenticated.
grant usage on schema public, auth to authenticated;
grant select on public.profiles, public.people, public.map_activity_log to authenticated;
grant select, insert, update on public.hse_meetings, public.action_tracker to authenticated;
grant select, update on public.meeting_series to authenticated;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;

insert into auth.users(id) values ('c2300000-0000-4000-8000-000000000001');
insert into public.companies(id, name) values
  ('c2300000-0000-4000-8000-000000000010', 'Minutes action status fixture A'),
  ('c2300000-0000-4000-8000-000000000020', 'Minutes action status fixture B');
insert into public.profiles(id, company_id, full_name, role, status) values
  ('c2300000-0000-4000-8000-000000000001', 'c2300000-0000-4000-8000-000000000010',
   'Fictional minutes reviewer', 'admin', 'active');
insert into public.people(id, company_id, first_name, last_name) values
  ('c2300000-0000-4000-8000-000000000030', 'c2300000-0000-4000-8000-000000000010', 'Fictional', 'Owner'),
  ('c2300000-0000-4000-8000-000000000031', 'c2300000-0000-4000-8000-000000000020', 'Foreign', 'Owner');

select set_config('request.jwt.claim.sub', 'c2300000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $$
declare
  company constant uuid := 'c2300000-0000-4000-8000-000000000010';
  minutes_id constant uuid := 'c2300000-0000-4000-8000-000000000050';
  owner_id constant uuid := 'c2300000-0000-4000-8000-000000000030';
  statuses text[] := array['open', 'in_progress', 'pending_closure', 'closed', 'cancelled'];
  recommendation_keys uuid[] := array[
    'c2300000-0000-4000-8000-000000000061', 'c2300000-0000-4000-8000-000000000062',
    'c2300000-0000-4000-8000-000000000063', 'c2300000-0000-4000-8000-000000000064',
    'c2300000-0000-4000-8000-000000000065'
  ]::uuid[];
  new_key constant uuid := 'c2300000-0000-4000-8000-000000000066';
  all_checks jsonb;
  recommendations jsonb := '[]';
  payload jsonb;
  result jsonb;
  snapshot jsonb;
  history_before jsonb;
  action_ids uuid[] := '{}';
  new_action_id uuid;
  current_action public.action_tracker;
  first_version timestamptz;
  current_version timestamptz;
  i integer;
  recorded_status text;
begin
  select jsonb_object_agg(n::text, jsonb_build_object('confirmed', true)) into all_checks
  from generate_series(1, 6) n;
  for i in 1..array_length(statuses, 1) loop
    recommendations := recommendations || jsonb_build_array(jsonb_build_object(
      'key', recommendation_keys[i], 'desc', 'Fictional follow-up ' || statuses[i],
      'person_id', owner_id, 'resp', 'Fictional Owner', 'date', '2026-12-01',
      'prio', 'medium', 'status', 'open'));
  end loop;
  payload := jsonb_build_object('company_id', company, 'title', 'Fictional minutes before editing',
    'meeting_type', 'management_review', 'meeting_date', '2026-11-20T05:00:00Z',
    'meeting_timezone', 'Asia/Dubai', 'minutes', 'Original discussion',
    'status', 'completed', 'recommendations', recommendations);
  result := public.save_hse_minutes(minutes_id, payload, null);
  first_version := (result->'minutes'->>'updated_at')::timestamptz;

  -- Establish real lifecycle states. The closed fixture passes through normal
  -- pending closure approval, producing a genuine immutable closure entry.
  for i in 1..array_length(statuses, 1) loop
    select * into strict current_action from public.action_tracker
    where company_id = company and source_id = minutes_id and meeting_recommendation_key = recommendation_keys[i];
    action_ids := array_append(action_ids, current_action.id);
    update public.action_tracker set
      progress_pct = case when statuses[i] in ('pending_closure', 'closed') then 100 else 25 end,
      evidence = 'Fictional retained evidence ' || statuses[i],
      progress_notes = 'Retain progress notes', requires_verification = true,
      verification_status = 'passed', verification_notes = 'Retain verification notes',
      verified_by = 'Fictional verifier', verified_date = current_date,
      closure_notes = 'Retain closure summary',
      closure_checklist = case when statuses[i] = 'closed' then all_checks else '{"1":{"confirmed":true}}'::jsonb end
    where id = current_action.id;
    if statuses[i] = 'closed' then
      update public.action_tracker set status = 'pending_closure' where id = current_action.id;
      update public.action_tracker set status = 'closed' where id = current_action.id;
    else
      update public.action_tracker set status = statuses[i] where id = current_action.id;
    end if;
  end loop;
  select jsonb_object_agg(a.id::text, to_jsonb(a)) into snapshot
  from public.action_tracker a where a.id = any(action_ids);
  select coalesce(jsonb_agg(to_jsonb(log) order by log.id), '[]') into history_before
  from public.map_activity_log log where action_id = any(action_ids);
  if jsonb_array_length(history_before) <> 1 then
    raise exception 'Fixture did not record exactly one genuine closure decision';
  end if;

  -- This reproduces the reported failure: recorded recommendation status is
  -- changed to closed while linked MAP actions have different live statuses.
  -- Repeat with recorded open to prove edits also cannot reopen terminal work.
  foreach recorded_status in array array['closed', 'closed', 'open'] loop
    select jsonb_agg(rec || jsonb_build_object('status', recorded_status) order by ordinal)
      into recommendations from jsonb_array_elements(payload->'recommendations') with ordinality items(rec, ordinal);
    payload := payload || jsonb_build_object('title', 'Fictional minutes edited successfully',
      'minutes', 'Updated discussion retained', 'recommendations', recommendations);
    current_version := (result->'minutes'->>'updated_at')::timestamptz;
    result := public.save_hse_minutes(minutes_id, payload, current_version);
    if result->'minutes'->>'minutes' is distinct from 'Updated discussion retained'
      or result->'minutes'->>'status' is distinct from 'completed' then
      raise exception 'Ordinary completed-minutes edits were not saved';
    end if;
    if jsonb_array_length(result->'actions') <> 5 then raise exception 'Minutes edit duplicated linked actions';end if;
    for i in 1..array_length(statuses, 1) loop
      select * into strict current_action from public.action_tracker where id = action_ids[i];
      if current_action.status is distinct from statuses[i]
        or current_action.meeting_recommendation_key is distinct from recommendation_keys[i]
        or (to_jsonb(current_action) - array['source_ref', 'updated_at'])
          is distinct from ((snapshot->(action_ids[i]::text)) - array['source_ref', 'updated_at']) then
        raise exception 'Minutes edit rewrote action %, its decision fields, or its identity', statuses[i];
      end if;
      if not exists(select 1 from jsonb_array_elements(result->'minutes'->'recommendations') rec
        where rec->>'key' = recommendation_keys[i]::text and rec->>'action_id' = action_ids[i]::text
          and rec->>'status' = recorded_status) then
        raise exception 'Recorded recommendation status or its action link was not retained';
      end if;
    end loop;
    if (select coalesce(jsonb_agg(to_jsonb(log) order by log.id), '[]')
      from public.map_activity_log log where action_id = any(action_ids)) is distinct from history_before then
      raise exception 'Minutes edit rewrote or duplicated action closure history';
    end if;
  end loop;

  recommendations := (payload->'recommendations') || jsonb_build_array(jsonb_build_object(
    'key', new_key, 'desc', 'New recorded completed recommendation', 'person_id', owner_id,
    'resp', 'Fictional Owner', 'date', '2026-12-02', 'prio', 'medium', 'status', 'closed'));
  payload := jsonb_set(payload, '{recommendations}', recommendations);
  result := public.save_hse_minutes(minutes_id, payload, (result->'minutes'->>'updated_at')::timestamptz);
  select id into strict new_action_id from public.action_tracker
  where company_id = company and source_id = minutes_id and meeting_recommendation_key = new_key and status = 'open';
  if not exists(select 1 from jsonb_array_elements(result->'minutes'->'recommendations') rec
    where rec->>'key' = new_key::text and rec->>'action_id' = new_action_id::text and rec->>'status' = 'closed') then
    raise exception 'Creating an open follow-up lost its recorded closed recommendation';
  end if;
  result := public.save_hse_minutes(minutes_id, payload, (result->'minutes'->>'updated_at')::timestamptz);
  if (select count(*) from public.action_tracker where company_id = company and source_id = minutes_id) <> 6
    or (select id from public.action_tracker where meeting_recommendation_key = new_key and company_id = company) is distinct from new_action_id then
    raise exception 'Repeated recorded-closed recommendation duplicated the new follow-up';
  end if;
  if (select status from public.action_tracker where id = new_action_id) is distinct from 'open' then
    raise exception 'Repeated minutes save closed the new follow-up';
  end if;

  -- Normal MAP approval rules are still active; saving recorded status must not
  -- disable their triggers or make incomplete pending closure approvable.
  begin
    update public.action_tracker set status = 'closed' where id = action_ids[1];
    raise exception 'Direct open-to-closed transition bypassed action approval';
  exception when raise_exception then
    if sqlerrm not like 'Submit the action for closure before approving it.%' then raise;end if;
  end;
  begin
    update public.action_tracker set status = 'closed' where id = action_ids[3];
    raise exception 'Incomplete closure confirmations bypassed action approval';
  exception when raise_exception then
    if sqlerrm not like 'Closure confirmation %' then raise;end if;
  end;
  if (select status from public.action_tracker where id = action_ids[1]) is distinct from 'open'
    or (select status from public.action_tracker where id = action_ids[3]) is distinct from 'pending_closure' then
    raise exception 'Rejected closure changed a live action status';
  end if;

  current_version := (result->'minutes'->>'updated_at')::timestamptz;
  begin
    perform public.save_hse_minutes(minutes_id, payload || '{"minutes":"Stale overwrite"}'::jsonb, first_version);
    raise exception 'Stale minutes edit was accepted';
  exception when raise_exception then
    if sqlerrm not like 'These minutes changed after opening%' then raise;end if;
  end;
  begin
    perform public.save_hse_minutes(minutes_id, payload || '{"company_id":"c2300000-0000-4000-8000-000000000020"}'::jsonb, current_version);
    raise exception 'Minutes edit moved records into another tenant';
  exception when raise_exception then
    if sqlerrm not like 'Manager access to this company is required%' then raise;end if;
  end;
  begin
    perform public.save_hse_minutes(minutes_id,
      jsonb_set(payload, '{recommendations,0,person_id}', '"c2300000-0000-4000-8000-000000000031"'::jsonb), current_version);
    raise exception 'Minutes edit accepted a foreign-company owner';
  exception when raise_exception then
    if sqlerrm not like 'Action owner must be a person in this company%' then raise;end if;
  end;
  if (select updated_at from public.hse_meetings where id = minutes_id) is distinct from current_version
    or (select count(*) from public.action_tracker where source_id = minutes_id and company_id = company) <> 6 then
    raise exception 'Rejected edit left partial minutes or duplicate actions';
  end if;
end $$;
reset role;

-- A privileged fixture maintainer changes permissions, not the application user.
select set_config('request.jwt.claim.sub', '', true);
update public.profiles set permissions = '{"access_v1":{"actions":{"view":true,"edit":false}}}'
where id = 'c2300000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub', 'c2300000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
declare
  payload jsonb;
  previous_version timestamptz;
begin
  select to_jsonb(m), m.updated_at into payload, previous_version from public.hse_meetings m
  where id = 'c2300000-0000-4000-8000-000000000050';
  begin
    perform public.save_hse_minutes('c2300000-0000-4000-8000-000000000050',
      payload || '{"minutes":"Unauthorised action metadata update"}'::jsonb, previous_version);
    raise exception 'Revoked linked action edit permission was ignored';
  exception when insufficient_privilege then null;
  end;
  if (select updated_at from public.hse_meetings where id = 'c2300000-0000-4000-8000-000000000050') is distinct from previous_version then
    raise exception 'Revoked action access left partial minutes edits';
  end if;
end $$;
reset role;
rollback;
