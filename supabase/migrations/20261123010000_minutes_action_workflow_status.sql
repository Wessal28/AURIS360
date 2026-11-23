-- Minutes retain the status recorded at the meeting. Linked Master Actions
-- keep their own approval workflow; new follow-ups start open. No stored rows
-- are changed by installing this repair.
begin;
set local lock_timeout = '5s';

do $preflight$
declare routine regprocedure := to_regprocedure('public.save_hse_minutes(uuid,jsonb,timestamptz)');
begin
  if routine is null then
    raise exception 'Install the HSE minutes saving service before applying this repair.';
  end if;
  if not exists (select 1 from pg_proc where oid=routine and not prosecdef
    and proargnames=array['p_id','p_minutes','p_expected_updated_at']::text[]) then
    raise exception 'The existing minutes saving signature or execution security differs. Review it before applying this repair.';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid=to_regclass('public.action_tracker')
    and tgfoid=to_regprocedure('public.guard_action_closure()') and tgenabled in ('O','A') and not tgisinternal) then
    raise exception 'The Master Action Plan closure guard must be enabled before applying this repair.';
  end if;
end;
$preflight$;

create or replace function public.save_hse_minutes(p_id uuid,p_minutes jsonb,p_expected_updated_at timestamptz default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare c uuid:=(p_minutes->>'company_id')::uuid; m public.hse_meetings; old_m public.hse_meetings;
  rec jsonb; key uuid; owner uuid; owner_name text; action_row public.action_tracker;
  payload jsonb:='[]'; actions_json jsonb;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and status='active' and
    (role='sephs_admin' or (company_id=c and role in ('admin','company_admin','hse_manager','hse_officer','manager','site_manager')))) then raise exception 'Manager access to this company is required';end if;
  if not public.user_access_allowed('meetings','edit') or not public.user_access_allowed('meetings.minutes','edit') then raise exception 'Minutes editing access is required';end if;
  if nullif(btrim(p_minutes->>'title'),'') is null then raise exception 'Enter a meeting title';end if;
  if not exists(select 1 from pg_timezone_names where name=p_minutes->>'meeting_timezone') then raise exception 'Record a valid meeting timezone';end if;
  if p_minutes->>'meeting_date' is null then raise exception 'Enter a meeting date and time';end if;
  if (p_minutes->>'meeting_date') !~* '(z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Save the meeting instant with an explicit UTC offset';end if;
  perform pg_advisory_xact_lock(hashtextextended('meeting/'||p_id::text,0));
  select * into old_m from public.hse_meetings where id=p_id for update;
  if found then
    if old_m.company_id is distinct from c then raise exception 'These minutes belong to another company';end if;
    if p_expected_updated_at is not null and old_m.updated_at is distinct from p_expected_updated_at then raise exception 'These minutes changed after opening. Reload before saving';end if;
  elsif exists(select 1 from public.hse_meetings where id=p_id) then raise exception 'These minutes are unavailable for this company';end if;
  if nullif(p_minutes->>'series_id','') is not null and nullif(p_minutes->>'series_id','')::uuid is distinct from old_m.series_id and not exists(select 1 from public.meeting_series where id=(p_minutes->>'series_id')::uuid and company_id=c) then raise exception 'Meeting schedule is unavailable for this company';end if;
  if old_m.id is null then
    insert into public.hse_meetings(id,company_id,title,created_by) values(p_id,c,p_minutes->>'title',auth.uid()) returning * into m;
  end if;
  for rec in select * from jsonb_array_elements(coalesce(p_minutes->'recommendations','[]')) loop
    if rec->>'_kind'='mom_meta' then payload:=payload||jsonb_build_array(rec);continue;end if;
    if nullif(btrim(rec->>'desc'),'') is null then continue;end if;
    if not public.user_access_allowed('actions','view') then raise exception 'Access to linked Master Actions is required' using errcode='42501';end if;
    key:=coalesce(nullif(rec->>'key','')::uuid,gen_random_uuid());owner:=nullif(rec->>'person_id','')::uuid;owner_name:=nullif(rec->>'resp','');
    if owner is not null then
      select concat_ws(' ',first_name,last_name) into owner_name from public.people where id=owner and company_id=c;
      if not found then raise exception 'Action owner must be a person in this company';end if;
    end if;
    select * into action_row from public.action_tracker where company_id=c and source_module='meeting' and source_id=p_id
      and source_type='meeting' and meeting_recommendation_key=key;
    if not found then
      select * into action_row from public.action_tracker where company_id=c and source_module='meeting' and source_id=p_id
        and (source_type is null or source_type='meeting') and meeting_recommendation_key is null
        and description=rec->>'desc' order by created_at limit 1;
    end if;
    -- Identify under SELECT policy first: FOR UPDATE can hide an existing row
    -- when UPDATE access is denied and must never turn it into a new action.
    if action_row.id is not null then
      if not public.user_access_allowed('actions','edit') then raise exception 'Editing linked Master Actions is not permitted' using errcode='42501';end if;
      select * into action_row from public.action_tracker where id=action_row.id and company_id=c for update;
      if not found or action_row.id is null then raise exception 'The linked Master Action could not be locked. No minutes were saved' using errcode='42501';end if;
    end if;
    -- Recorded minutes do not approve, reopen or otherwise transition Master Actions.
    if action_row.id is null then
      if not public.user_access_allowed('actions','create') then raise exception 'Creating linked Master Actions is not permitted' using errcode='42501';end if;
      insert into public.action_tracker(company_id,source_module,source_type,source_id,source_ref,meeting_recommendation_key,title,description,responsible,assigned_to_id,assigned_to_name,target_date,priority,status,created_by)
      values(c,'meeting','meeting',p_id,p_minutes->>'title',key,rec->>'desc',rec->>'desc',owner_name,owner,owner_name,nullif(rec->>'date','')::date,coalesce(rec->>'prio','medium'),'open',auth.uid()) returning * into action_row;
      if not found or action_row.id is null then raise exception 'The linked Master Action could not be created. No minutes were saved' using errcode='42501';end if;
    else
      if not public.user_access_allowed('actions','edit') then raise exception 'Editing linked Master Actions is not permitted' using errcode='42501';end if;
      update public.action_tracker set meeting_recommendation_key=key,source_type='meeting',source_ref=p_minutes->>'title',title=rec->>'desc',description=rec->>'desc',responsible=owner_name,assigned_to_id=owner,assigned_to_name=owner_name,
        target_date=nullif(rec->>'date','')::date,priority=coalesce(rec->>'prio','medium'),updated_at=now() where id=action_row.id and company_id=c returning * into action_row;
      if not found or action_row.id is null then raise exception 'The linked Master Action could not be updated. No minutes were saved' using errcode='42501';end if;
    end if;
    payload:=payload||jsonb_build_array(rec||jsonb_build_object('key',key,'action_id',action_row.id,'resp',owner_name,'status',coalesce(nullif(rec->>'status',''),'open')));
  end loop;
  update public.hse_meetings set title=p_minutes->>'title',meeting_type=p_minutes->>'meeting_type',meeting_date=(p_minutes->>'meeting_date')::timestamptz,
    meeting_timezone=p_minutes->>'meeting_timezone',location=p_minutes->>'location',chaired_by=p_minutes->>'chaired_by',attendees=p_minutes->>'attendees',apologies=p_minutes->>'apologies',
    minutes=p_minutes->>'minutes',series_id=nullif(p_minutes->>'series_id','')::uuid,next_meeting_date=nullif(p_minutes->>'next_meeting_date','')::date,
    agenda_items=coalesce(p_minutes->'agenda_items','[]'),recommendations=payload,status=coalesce(p_minutes->>'status','draft'),
    chair_person_id=nullif(p_minutes->>'chair_person_id','')::uuid,attendee_person_ids=coalesce(array(select jsonb_array_elements_text(p_minutes->'attendee_person_ids')::uuid),'{}'::uuid[]),updated_at=clock_timestamp()
    where id=p_id and company_id=c returning * into m;
  if not found then raise exception 'The saved minutes could not be confirmed';end if;
  if m.series_id is not null and m.next_meeting_date is not null and m.status='completed' then
    update public.meeting_series set next_date=m.next_meeting_date,updated_at=now() where id=m.series_id and company_id=c and (next_date is null or next_date<=(m.meeting_date at time zone m.meeting_timezone)::date or next_date=old_m.next_meeting_date);
  end if;
  if public.user_access_allowed('actions','view') then
    select coalesce(jsonb_agg(to_jsonb(a)),'[]') into actions_json from public.action_tracker a where company_id=c and source_module='meeting' and source_id=p_id and (source_type='meeting' or source_type is null);
  else actions_json:='[]'::jsonb;end if;
  return jsonb_build_object('minutes',to_jsonb(m),'actions',actions_json);
end $$;
revoke all on function public.save_hse_minutes(uuid,jsonb,timestamptz) from public,anon;
grant execute on function public.save_hse_minutes(uuid,jsonb,timestamptz) to authenticated;
notify pgrst,'reload schema';

commit;
