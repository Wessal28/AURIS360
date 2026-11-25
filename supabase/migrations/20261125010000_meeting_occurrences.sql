-- A planned occurrence keeps its original date when its minutes are rescheduled.
-- Installation changes no existing minutes, action decisions or record versions.
begin;
set local lock_timeout = '5s';

do $preflight$
declare routine regprocedure := to_regprocedure('public.save_hse_minutes(uuid,jsonb,timestamptz)');
begin
  if routine is null or not exists(select 1 from pg_proc where oid=routine and not prosecdef
    and prorettype='jsonb'::regtype and proargnames=array['p_id','p_minutes','p_expected_updated_at']::text[]) then
    raise exception 'Install the reviewed HSE minutes saving service before meeting occurrence support';
  end if;
  if to_regprocedure('public.user_access_allowed(text,text)') is null
    or to_regprocedure('public.auth_company_id()') is null or to_regprocedure('public.is_sephs_admin()') is null
    or to_regprocedure('auth.uid()') is null then
    raise exception 'The company and section access helpers are required';
  end if;
  if not exists(select 1 from pg_class where oid=to_regclass('public.hse_meetings') and relrowsecurity)
    or not exists(select 1 from pg_class where oid=to_regclass('public.meeting_series') and relrowsecurity) then
    raise exception 'Meeting and schedule row security must be enabled';
  end if;
  if exists(select 1 from (values
      ('public.profiles','id'),('public.profiles','company_id'),('public.profiles','role'),('public.profiles','status'),
      ('public.meeting_series','id'),('public.meeting_series','company_id'),('public.meeting_series','next_date'),('public.meeting_series','active'),
      ('public.hse_meetings','id'),('public.hse_meetings','company_id'),('public.hse_meetings','series_id'),
      ('public.hse_meetings','meeting_date'),('public.hse_meetings','meeting_timezone'),('public.hse_meetings','status'),('public.hse_meetings','updated_at')
    ) required(relation_name,column_name) where not exists(select 1 from pg_attribute
      where attrelid=to_regclass(required.relation_name) and attname=required.column_name and attnum>0 and not attisdropped)) then
    raise exception 'The meeting occurrence prerequisites differ from the reviewed schema';
  end if;
  if exists(select 1 from pg_attribute where attrelid=to_regclass('public.meeting_series') and attname='agenda_anchor_date'
    and attnum>0 and not attisdropped and atttypid<>'date'::regtype)
    or exists(select 1 from pg_attribute where attrelid=to_regclass('public.hse_meetings') and attname='scheduled_date'
    and attnum>0 and not attisdropped and atttypid<>'date'::regtype) then
    raise exception 'Existing meeting occurrence columns require review';
  end if;
end;
$preflight$;

alter table public.meeting_series add column if not exists agenda_anchor_date date;
alter table public.hse_meetings add column if not exists scheduled_date date;
create unique index if not exists hse_meetings_scheduled_occurrence_key
  on public.hse_meetings(company_id,series_id,scheduled_date)
  where series_id is not null and scheduled_date is not null;

create or replace function public.preserve_meeting_agenda_anchor() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if new.agenda_anchor_date is null then
    if tg_op='UPDATE' then
      new.agenda_anchor_date:=coalesce(old.agenda_anchor_date,old.next_date,new.next_date);
    else new.agenda_anchor_date:=new.next_date;end if;
  end if;
  return new;
end $$;
revoke all on function public.preserve_meeting_agenda_anchor() from public,anon,authenticated;
drop trigger if exists preserve_meeting_agenda_anchor on public.meeting_series;
create trigger preserve_meeting_agenda_anchor before insert or update on public.meeting_series
  for each row execute function public.preserve_meeting_agenda_anchor();

create table if not exists public.meeting_occurrence_exceptions(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  series_id uuid not null references public.meeting_series(id) on delete cascade,
  scheduled_date date not null,
  status text not null default 'cancelled' check(status in ('active','cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  unique(company_id,series_id,scheduled_date)
);
alter table public.meeting_occurrence_exceptions enable row level security;
revoke all on public.meeting_occurrence_exceptions from public,anon,authenticated;
grant select,insert,update on public.meeting_occurrence_exceptions to authenticated;
drop policy if exists meeting_occurrence_read on public.meeting_occurrence_exceptions;
create policy meeting_occurrence_read on public.meeting_occurrence_exceptions for select to authenticated using(
  (company_id=public.auth_company_id() or public.is_sephs_admin())
  and public.user_access_allowed('meetings','view') and public.user_access_allowed('meetings.schedule','view')
);
drop policy if exists meeting_occurrence_insert on public.meeting_occurrence_exceptions;
create policy meeting_occurrence_insert on public.meeting_occurrence_exceptions for insert to authenticated with check(
  (company_id=public.auth_company_id() or public.is_sephs_admin())
  and public.user_access_allowed('meetings','edit') and public.user_access_allowed('meetings.schedule','edit')
  and public.user_access_allowed('meetings.minutes','view')
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active'
    and (p.role='sephs_admin' or (p.company_id=meeting_occurrence_exceptions.company_id
      and p.role in ('admin','company_admin','hse_manager','hse_officer','manager','site_manager'))))
);
drop policy if exists meeting_occurrence_update on public.meeting_occurrence_exceptions;
create policy meeting_occurrence_update on public.meeting_occurrence_exceptions for update to authenticated using(
  (company_id=public.auth_company_id() or public.is_sephs_admin())
  and public.user_access_allowed('meetings','edit') and public.user_access_allowed('meetings.schedule','edit')
  and public.user_access_allowed('meetings.minutes','view')
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active'
    and (p.role='sephs_admin' or (p.company_id=meeting_occurrence_exceptions.company_id
      and p.role in ('admin','company_admin','hse_manager','hse_officer','manager','site_manager'))))
) with check(
  (company_id=public.auth_company_id() or public.is_sephs_admin())
  and public.user_access_allowed('meetings','edit') and public.user_access_allowed('meetings.schedule','edit')
  and public.user_access_allowed('meetings.minutes','view')
);

create or replace function public.guard_meeting_occurrence_exception() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare owner_write boolean:=current_user=(select pg_get_userbyid(relowner) from pg_class where oid='public.meeting_occurrence_exceptions'::regclass);
begin
  -- The owner-only DELETE audit trigger below can retain a trusted OLD identity.
  if not owner_write and (auth.uid() is null or public.user_access_allowed('meetings.minutes','view') is not true) then
    raise exception 'Access to saved meeting minutes is required' using errcode='42501';
  end if;
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.company_id is distinct from old.company_id
    or new.series_id is distinct from old.series_id or new.scheduled_date is distinct from old.scheduled_date) then
    raise exception 'A meeting occurrence identity cannot be changed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('meeting-occurrence/'||new.company_id::text||'/'||new.series_id::text||'/'||new.scheduled_date::text,0));
  if not exists(select 1 from public.meeting_series s where s.id=new.series_id and s.company_id=new.company_id) then
    raise exception 'Meeting schedule is unavailable for this company';
  end if;
  if new.status='cancelled' and exists(select 1 from public.hse_meetings m
    where m.company_id=new.company_id and m.series_id=new.series_id
      and (m.scheduled_date=new.scheduled_date or (m.scheduled_date is null and
        (m.meeting_date at time zone case when exists(select 1 from pg_timezone_names z where z.name=m.meeting_timezone)
          then m.meeting_timezone else 'UTC' end)::date=new.scheduled_date))) then
    raise exception 'This occurrence has saved minutes. Cancel its minutes instead';
  end if;
  if tg_op='INSERT' then new.created_at:=clock_timestamp();new.created_by:=auth.uid();
  else new.created_at:=old.created_at;new.created_by:=old.created_by;end if;
  new.updated_at:=clock_timestamp();new.updated_by:=auth.uid();
  return new;
end $$;
revoke all on function public.guard_meeting_occurrence_exception() from public,anon,authenticated;
drop trigger if exists guard_meeting_occurrence_exception on public.meeting_occurrence_exceptions;
create trigger guard_meeting_occurrence_exception before insert or update on public.meeting_occurrence_exceptions
  for each row execute function public.guard_meeting_occurrence_exception();

create or replace function public.guard_meeting_occurrence_identity() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and old.scheduled_date is not null then
    if new.scheduled_date is distinct from old.scheduled_date or new.series_id is distinct from old.series_id
      or new.company_id is distinct from old.company_id then
      raise exception 'The original meeting occurrence cannot be changed';
    end if;
    -- An already-bound identity stays valid for minutes editors even when
    -- their separate schedule-view permission has subsequently been revoked.
    return new;
  end if;
  if new.scheduled_date is not null then
    if new.company_id is null or new.series_id is null then raise exception 'An occurrence requires its company and meeting schedule';end if;
    if not exists(select 1 from public.meeting_series s where s.id=new.series_id and s.company_id=new.company_id) then
      raise exception 'Meeting schedule is unavailable for this company';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('meeting-occurrence/'||new.company_id::text||'/'||new.series_id::text||'/'||new.scheduled_date::text,0));
    if exists(select 1 from public.meeting_occurrence_exceptions e where e.company_id=new.company_id
      and e.series_id=new.series_id and e.scheduled_date=new.scheduled_date and e.status='cancelled') then
      raise exception 'This meeting occurrence was cancelled. Restore it before creating minutes';
    end if;
    if exists(select 1 from public.hse_meetings m where m.company_id=new.company_id and m.series_id=new.series_id
      and m.id<>new.id and (m.scheduled_date=new.scheduled_date or (m.scheduled_date is null and
        (m.meeting_date at time zone case when exists(select 1 from pg_timezone_names z where z.name=m.meeting_timezone)
          then m.meeting_timezone else 'UTC' end)::date=new.scheduled_date))) then
      raise exception 'This occurrence already has saved minutes. Open the existing minutes';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_meeting_occurrence_identity() from public,anon,authenticated;
drop trigger if exists guard_meeting_occurrence_identity on public.hse_meetings;
create trigger guard_meeting_occurrence_identity before insert or update on public.hse_meetings
  for each row execute function public.guard_meeting_occurrence_identity();

create or replace function public.save_hse_minutes_occurrence(p_id uuid,p_minutes jsonb,p_expected_updated_at timestamptz default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare company uuid:=nullif(p_minutes->>'company_id','')::uuid;
  series uuid:=nullif(p_minutes->>'series_id','')::uuid;
  origin date; previous public.hse_meetings; saved public.hse_meetings;
  schedule public.meeting_series; result jsonb; existing boolean;
begin
  if auth.uid() is null or company is null or p_id is null or not exists(select 1 from public.profiles p
    where p.id=auth.uid() and p.status='active' and (p.role='sephs_admin' or (p.company_id=company
      and p.role in ('admin','company_admin','hse_manager','hse_officer','manager','site_manager')))) then
    raise exception 'Manager access to this company is required' using errcode='42501';
  end if;
  if public.user_access_allowed('meetings','edit') is not true or public.user_access_allowed('meetings.minutes','edit') is not true then
    raise exception 'Minutes editing access is required' using errcode='42501';
  end if;
  if not exists(select 1 from pg_timezone_names where name=p_minutes->>'meeting_timezone') then raise exception 'Record a valid meeting timezone';end if;
  perform pg_advisory_xact_lock(hashtextextended('meeting/'||p_id::text,0));
  select * into previous from public.hse_meetings where id=p_id and company_id=company for update;
  existing:=found;
  if existing then
    if previous.updated_at is distinct from p_expected_updated_at then
      raise exception 'These minutes changed after opening. Reload before saving' using errcode='40001';
    end if;
    if previous.scheduled_date is not null and previous.series_id is distinct from series then
      raise exception 'The original meeting occurrence cannot be changed';
    end if;
  elsif p_expected_updated_at is not null then
    raise exception 'These minutes are no longer available. Reload before saving' using errcode='40001';
  end if;
  if nullif(p_minutes->>'scheduled_date','') is not null then
    if p_minutes->>'scheduled_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Record a valid scheduled meeting date';end if;
    origin:=(p_minutes->>'scheduled_date')::date;
  end if;
  if previous.scheduled_date is not null then
    if origin is not null and origin<>previous.scheduled_date then raise exception 'The original meeting occurrence cannot be changed';end if;
    origin:=previous.scheduled_date;
  end if;
  if series is null then
    if origin is not null then raise exception 'An occurrence requires its meeting schedule';end if;
  -- Older same-day minutes can be distinct real records. Leave them unbound
  -- until the caller has positively identified an original planned occurrence.
  elsif origin is not null or not existing then
    if previous.scheduled_date is null then
      select * into schedule from public.meeting_series where id=series and company_id=company;
      if not found then raise exception 'Meeting schedule is unavailable for this company';end if;
      if not existing and schedule.active is not true then raise exception 'This meeting schedule is inactive';end if;
    end if;
    if origin is null then
      origin:=((p_minutes->>'meeting_date')::timestamptz at time zone (p_minutes->>'meeting_timezone'))::date;
    end if;
    if origin is null then raise exception 'Record the original scheduled meeting date';end if;
    perform pg_advisory_xact_lock(hashtextextended('meeting-occurrence/'||company::text||'/'||series::text||'/'||origin::text,0));
    if exists(select 1 from public.meeting_occurrence_exceptions e where e.company_id=company and e.series_id=series
      and e.scheduled_date=origin and e.status='cancelled') then
      raise exception 'This meeting occurrence was cancelled. Restore it before creating minutes';
    end if;
    if exists(select 1 from public.hse_meetings m where m.company_id=company and m.series_id=series and m.id<>p_id
      and (m.scheduled_date=origin or (m.scheduled_date is null and
        (m.meeting_date at time zone case when exists(select 1 from pg_timezone_names z where z.name=m.meeting_timezone)
          then m.meeting_timezone else 'UTC' end)::date=origin))) then
      raise exception 'This occurrence already has saved minutes. Open the existing minutes';
    end if;
  end if;
  -- Keep the reviewed minutes/action workflow and its stable record identifiers.
  result:=public.save_hse_minutes(p_id,p_minutes,p_expected_updated_at);
  select * into saved from public.hse_meetings where id=p_id and company_id=company;
  if not found or saved.series_id is distinct from series then raise exception 'The saved minutes could not be confirmed';end if;
  if series is not null and origin is not null and saved.scheduled_date is distinct from origin then
    update public.hse_meetings set scheduled_date=origin where id=p_id and company_id=company and series_id=series returning * into saved;
    if not found or saved.scheduled_date is distinct from origin then raise exception 'The original meeting occurrence could not be saved';end if;
  end if;
  if saved.id is distinct from p_id or saved.company_id is distinct from company or saved.series_id is distinct from series
    or saved.scheduled_date is distinct from origin then raise exception 'The saved meeting occurrence could not be confirmed';end if;
  return jsonb_set(result,'{minutes}',to_jsonb(saved));
end $$;
revoke all on function public.save_hse_minutes_occurrence(uuid,jsonb,timestamptz) from public,anon;
grant execute on function public.save_hse_minutes_occurrence(uuid,jsonb,timestamptz) to authenticated;

create or replace function public.set_meeting_occurrence(p_series_id uuid,p_scheduled_date date,p_command text,p_expected_updated_at timestamptz default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare schedule public.meeting_series; previous public.meeting_occurrence_exceptions; saved public.meeting_occurrence_exceptions;
  target_status text;
begin
  if p_scheduled_date is null or p_command is null or p_command not in ('cancel','restore') then raise exception 'Choose a scheduled date and cancel or restore command';end if;
  select * into schedule from public.meeting_series where id=p_series_id;
  if not found then raise exception 'Meeting schedule is unavailable for this company';end if;
  if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active'
    and (p.role='sephs_admin' or (p.company_id=schedule.company_id and p.role in ('admin','company_admin','hse_manager','hse_officer','manager','site_manager'))))
    or public.user_access_allowed('meetings','edit') is not true or public.user_access_allowed('meetings.schedule','edit') is not true
    or public.user_access_allowed('meetings.minutes','view') is not true then
    raise exception 'Meeting schedule editing and minutes viewing access are required' using errcode='42501';
  end if;
  if p_command='cancel' and schedule.active is not true then raise exception 'This meeting schedule is inactive';end if;
  target_status:=case p_command when 'cancel' then 'cancelled' else 'active' end;
  perform pg_advisory_xact_lock(hashtextextended('meeting-occurrence/'||schedule.company_id::text||'/'||p_series_id::text||'/'||p_scheduled_date::text,0));
  select * into previous from public.meeting_occurrence_exceptions where company_id=schedule.company_id
    and series_id=p_series_id and scheduled_date=p_scheduled_date for update;
  if found then
    if previous.updated_at is distinct from p_expected_updated_at then raise exception 'This occurrence changed after opening. Refresh the agenda' using errcode='40001';end if;
    update public.meeting_occurrence_exceptions set status=target_status where id=previous.id and company_id=schedule.company_id
      and updated_at is not distinct from p_expected_updated_at returning * into saved;
  else
    if p_command='restore' then raise exception 'This occurrence has no cancellation to restore';end if;
    if p_expected_updated_at is not null then raise exception 'This occurrence changed after opening. Refresh the agenda' using errcode='40001';end if;
    insert into public.meeting_occurrence_exceptions(company_id,series_id,scheduled_date,status)
      values(schedule.company_id,p_series_id,p_scheduled_date,target_status) returning * into saved;
  end if;
  if not found or saved.id is null or saved.company_id is distinct from schedule.company_id or saved.series_id is distinct from p_series_id
    or saved.scheduled_date is distinct from p_scheduled_date or saved.status is distinct from target_status then
    raise exception 'The meeting occurrence change could not be confirmed';
  end if;
  return to_jsonb(saved);
end $$;
revoke all on function public.set_meeting_occurrence(uuid,date,text,timestamptz) from public,anon;
grant execute on function public.set_meeting_occurrence(uuid,date,text,timestamptz) to authenticated;

-- Deleting cancelled minutes must not recreate their old planned slot. This
-- narrowly scoped owner trigger copies only the deleted row's trusted identity.
create or replace function public.retain_cancelled_meeting_occurrence() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.status='cancelled' and old.scheduled_date is null and old.series_id is not null
    and exists(select 1 from public.meeting_series s where s.id=old.series_id and s.company_id=old.company_id) then
    raise exception 'Open and save these cancelled minutes with a confirmed original scheduled date before permanently deleting them';
  end if;
  if old.status='cancelled' and old.scheduled_date is not null and old.series_id is not null
    and exists(select 1 from public.meeting_series s where s.id=old.series_id and s.company_id=old.company_id) then
    perform pg_advisory_xact_lock(hashtextextended('meeting-occurrence/'||old.company_id::text||'/'||old.series_id::text||'/'||old.scheduled_date::text,0));
    insert into public.meeting_occurrence_exceptions(company_id,series_id,scheduled_date,status)
      values(old.company_id,old.series_id,old.scheduled_date,'cancelled')
      on conflict(company_id,series_id,scheduled_date) do update set status='cancelled';
    if not found then raise exception 'The cancelled meeting occurrence could not be retained';end if;
  end if;
  return old;
end $$;
revoke all on function public.retain_cancelled_meeting_occurrence() from public,anon,authenticated;
drop trigger if exists retain_cancelled_meeting_occurrence on public.hse_meetings;
create trigger retain_cancelled_meeting_occurrence after delete on public.hse_meetings
  for each row execute function public.retain_cancelled_meeting_occurrence();

notify pgrst,'reload schema';
commit;
