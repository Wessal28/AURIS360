-- Repair the deployment contract for atomic HSE minutes saving.
-- Safe to re-run after a missing or partially applied meetings reliability
-- upgrade. This installs the same reviewed transaction; it does not rewrite
-- minutes, delete linked actions, fabricate approvals or bypass tenant rules.
-- Frontend JSON argument names must match the public routine below exactly.
-- Run against the intended Supabase project with its normal migration role;
-- successful web deployment alone does not install database routines.
-- This repair is intentionally limited to minutes and linked actions.
-- Safety Awareness, Toolbox Talks, Alerts and Bulletins are separate features
-- and do not need to be installed for this repair to succeed.

begin;
-- Report missing minutes prerequisites together before changing the schema.
-- Permission helpers are required; this repair never substitutes weaker rules.
do $minutes_preflight$
declare missing text[]:='{}'; item record; field text; signature text;
begin
  for item in select * from (values
    ('profiles',array['id','company_id','status','role','permissions']),
    ('people',array['id','company_id','first_name','last_name']),
    ('hse_meetings',array['id','company_id','title','created_by','updated_at','recommendations','series_id','meeting_type','meeting_date','location','chaired_by','attendees','apologies','minutes','next_meeting_date','agenda_items','status','chair_person_id','attendee_person_ids']),
    ('action_tracker',array['id','company_id','source_module','source_type','source_id','description','created_at','status','source_ref','title','responsible','assigned_to_id','assigned_to_name','target_date','priority','created_by','updated_at']),
    ('meeting_series',array['id','company_id','next_date','updated_at'])
  ) as required(table_name,column_names) loop
    if to_regclass('public.'||item.table_name) is null then
      missing:=array_append(missing,'table public.'||item.table_name);
    else
      foreach field in array item.column_names loop
        if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||item.table_name) and attname=field and attnum>0 and not attisdropped) then
          missing:=array_append(missing,'column public.'||item.table_name||'.'||field);
        end if;
      end loop;
    end if;
  end loop;
  foreach signature in array array['auth.uid()','public.user_access_allowed(text,text)','public.guard_module_user_access()'] loop
    if to_regprocedure(signature) is null then missing:=array_append(missing,'function '||signature);end if;
  end loop;
  for item in select * from (values
    ('hse_meetings','meeting_timezone','text'::regtype),
    ('action_tracker','meeting_recommendation_key','uuid'::regtype)
  ) as expected(table_name,column_name,column_type) loop
    if exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||item.table_name) and attname=item.column_name and attnum>0 and not attisdropped and atttypid<>item.column_type) then
      missing:=array_append(missing,'expected '||item.column_type::text||' type for public.'||item.table_name||'.'||item.column_name);
    end if;
  end loop;
  if cardinality(missing)>0 then
    raise exception using message='Minutes repair prerequisites are incomplete',detail=array_to_string(missing,'; '),hint='Apply the listed core schema prerequisites first. Permission helpers are provided by the reviewed People/user-access migrations; do not disable access checks.';
  end if;
end $minutes_preflight$;

-- Do not reinterpret old timestamps: new saves record the explicit IANA timezone.
alter table public.hse_meetings add column if not exists meeting_timezone text;
alter table public.action_tracker add column if not exists meeting_recommendation_key uuid;
create unique index if not exists meeting_action_identity on public.action_tracker(company_id,source_id,meeting_recommendation_key)
  where source_module='meeting' and source_type='meeting' and meeting_recommendation_key is not null;
alter table public.hse_meetings drop constraint if exists hse_meetings_meeting_type_check;
alter table public.hse_meetings add constraint hse_meetings_meeting_type_check check(meeting_type in ('toolbox_talk','safety_committee','hse_committee','management_review','emergency_drill','other'));

-- Minutes use the Minutes permission; schedules use the Schedule permission.
drop policy if exists user_section_access on public.hse_meetings;
create policy user_section_access on public.hse_meetings as restrictive for all to authenticated
  using(public.user_access_allowed('meetings.minutes','view')) with check(public.user_access_allowed('meetings.minutes','view'));
drop trigger if exists section_user_access_guard on public.hse_meetings;
create trigger section_user_access_guard before insert or update or delete on public.hse_meetings for each row execute function public.guard_module_user_access('meetings.minutes');
drop policy if exists meeting_series_user_access on public.meeting_series;
create policy meeting_series_user_access on public.meeting_series as restrictive for all to authenticated
  using(public.user_access_allowed('meetings','view') and public.user_access_allowed('meetings.schedule','view'))
  with check(public.user_access_allowed('meetings','view') and public.user_access_allowed('meetings.schedule','view'));
drop trigger if exists module_user_access_guard on public.meeting_series;
create trigger module_user_access_guard before insert or update or delete on public.meeting_series for each row execute function public.guard_module_user_access('meetings');
drop trigger if exists section_user_access_guard on public.meeting_series;
create trigger section_user_access_guard before insert or update or delete on public.meeting_series for each row execute function public.guard_module_user_access('meetings.schedule');

create or replace function public.save_hse_minutes(p_id uuid,p_minutes jsonb,p_expected_updated_at timestamptz default null) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare c uuid:=(p_minutes->>'company_id')::uuid; m public.hse_meetings; old_m public.hse_meetings;
  rec jsonb; old_rec jsonb; key uuid; owner uuid; owner_name text; action_row public.action_tracker;
  payload jsonb:='[]'; actions_json jsonb; action_status text; old_recommendations jsonb;
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
  old_recommendations:=coalesce(old_m.recommendations,'[]');
  if jsonb_typeof(old_recommendations)='string' then
    begin old_recommendations:=(old_recommendations #>> '{}')::jsonb;
    exception when invalid_text_representation then old_recommendations:='[]';end;
  end if;
  if jsonb_typeof(old_recommendations)<>'array' then old_recommendations:='[]';end if;
  for rec in select * from jsonb_array_elements(coalesce(p_minutes->'recommendations','[]')) loop
    if rec->>'_kind'='mom_meta' then payload:=payload||jsonb_build_array(rec);continue;end if;
    if nullif(btrim(rec->>'desc'),'') is null then continue;end if;
    key:=coalesce(nullif(rec->>'key','')::uuid,gen_random_uuid());owner:=nullif(rec->>'person_id','')::uuid;owner_name:=nullif(rec->>'resp','');
    if owner is not null then
      select concat_ws(' ',first_name,last_name) into owner_name from public.people where id=owner and company_id=c;
      if not found then raise exception 'Action owner must be a person in this company';end if;
    end if;
    select * into action_row from public.action_tracker where company_id=c and source_module='meeting' and source_id=p_id
      and source_type='meeting' and meeting_recommendation_key=key for update;
    if not found then
      select * into action_row from public.action_tracker where company_id=c and source_module='meeting' and source_id=p_id
        and (source_type is null or source_type='meeting') and meeting_recommendation_key is null
        and description=rec->>'desc' order by created_at limit 1 for update;
    end if;
    select x into old_rec from jsonb_array_elements(old_recommendations) x
      where x->>'key'=key::text or (x->>'key' is null and x->>'desc'=rec->>'desc') limit 1;
    action_status:=coalesce(rec->>'status','open');
    if action_row.id is not null and action_status is not distinct from coalesce(old_rec->>'status','open') then action_status:=action_row.status;end if;
    if action_row.id is null then
      insert into public.action_tracker(company_id,source_module,source_type,source_id,source_ref,meeting_recommendation_key,title,description,responsible,assigned_to_id,assigned_to_name,target_date,priority,status,created_by)
      values(c,'meeting','meeting',p_id,p_minutes->>'title',key,rec->>'desc',rec->>'desc',owner_name,owner,owner_name,nullif(rec->>'date','')::date,coalesce(rec->>'prio','medium'),action_status,auth.uid()) returning * into action_row;
    else
      update public.action_tracker set meeting_recommendation_key=key,source_type='meeting',source_ref=p_minutes->>'title',title=rec->>'desc',description=rec->>'desc',responsible=owner_name,assigned_to_id=owner,assigned_to_name=owner_name,
        target_date=nullif(rec->>'date','')::date,priority=coalesce(rec->>'prio','medium'),status=action_status,updated_at=now() where id=action_row.id and company_id=c returning * into action_row;
    end if;
    payload:=payload||jsonb_build_array(rec||jsonb_build_object('key',key,'action_id',action_row.id,'resp',owner_name,'status',action_status));
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
  select coalesce(jsonb_agg(to_jsonb(a)),'[]') into actions_json from public.action_tracker a where company_id=c and source_module='meeting' and source_id=p_id and (source_type='meeting' or source_type is null);
  return jsonb_build_object('minutes',to_jsonb(m),'actions',actions_json);
end $$;
revoke all on function public.save_hse_minutes(uuid,jsonb,timestamptz) from public,anon;
grant execute on function public.save_hse_minutes(uuid,jsonb,timestamptz) to authenticated;
notify pgrst,'reload schema';

commit;
