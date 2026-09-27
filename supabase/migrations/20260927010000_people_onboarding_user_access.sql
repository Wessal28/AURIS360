begin;
-- Per-user restrictions supplement existing tenant and role policies; they never grant access.
alter table public.profiles add column if not exists person_id uuid references public.people(id) on delete set null;
create unique index if not exists profiles_person_id_unique on public.profiles(person_id) where person_id is not null;

create or replace function public.user_access_allowed(module_key text, access_action text default 'view') returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare actor public.profiles; rules jsonb; rule jsonb;
begin
  select * into actor from public.profiles where id=auth.uid();
  if not found or actor.status is distinct from 'active' then return false; end if;
  if actor.role='sephs_admin' then return true; end if;
  rules:=actor.permissions->'access_v1';
  if rules is null then return true; end if;
  if module_key like 'settings.%' and (rules->'settings'->>'view'='false' or rules->'settings'->>access_action='false') then return false; end if;
  rule:=rules->module_key;
  return coalesce(rule->>'view','true')<>'false' and coalesce(rule->>access_action,'true')<>'false';
end $$;
revoke all on function public.user_access_allowed(text,text) from public;
grant execute on function public.user_access_allowed(text,text) to authenticated;

create or replace function public.guard_profile_user_access() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor public.profiles;
begin
  if auth.uid() is null then return new; end if;
  if tg_op='INSERT' then
    if coalesce(new.permissions,'{}'::jsonb)<>'{}'::jsonb or new.person_id is not null or coalesce(new.role,'user') not in ('user','employee') then
      raise exception 'User access and privileged accounts must be provisioned by an administrator' using errcode='42501';
    end if;
    return new;
  end if;
  if new.permissions is distinct from old.permissions or new.person_id is distinct from old.person_id then
    select * into actor from public.profiles where id=auth.uid();
    if actor.status is distinct from 'active' or actor.id=old.id or old.role='sephs_admin'
       or not public.user_access_allowed('users','edit')
       or not (actor.role='sephs_admin' or (actor.role='admin' and actor.company_id=old.company_id and new.company_id=old.company_id)) then
      raise exception 'Only an authorised administrator can change another user access' using errcode='42501';
    end if;
  end if;
  if auth.uid()=old.id and (new.role is distinct from old.role or new.company_id is distinct from old.company_id or new.status is distinct from old.status) then
    raise exception 'You cannot change your own role, company or account status' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists profile_user_access_guard on public.profiles;
create trigger profile_user_access_guard before insert or update on public.profiles for each row execute function public.guard_profile_user_access();
drop policy if exists user_profile_view on public.profiles;
create policy user_profile_view on public.profiles as restrictive for select to authenticated using (id=auth.uid() or public.user_access_allowed('users','view'));
drop policy if exists user_profile_create on public.profiles;
create policy user_profile_create on public.profiles as restrictive for insert to authenticated with check (id=auth.uid() or public.user_access_allowed('users','create'));
drop policy if exists user_profile_edit on public.profiles;
create policy user_profile_edit on public.profiles as restrictive for update to authenticated using ((id=auth.uid() and public.user_access_allowed('settings.personal','edit')) or (id<>auth.uid() and public.user_access_allowed('users','edit'))) with check ((id=auth.uid() and public.user_access_allowed('settings.personal','edit')) or (id<>auth.uid() and public.user_access_allowed('users','edit')));
drop policy if exists user_profile_delete on public.profiles;
create policy user_profile_delete on public.profiles as restrictive for delete to authenticated using (public.user_access_allowed('users','delete'));

-- Triggers also guard writes performed by SECURITY DEFINER RPCs, which bypass RLS.
create or replace function public.guard_module_user_access() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare action_key text;
begin
  if auth.uid() is not null then
    action_key:=case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'edit' else 'delete' end;
    if not public.user_access_allowed(tg_argv[0],action_key) then
      raise exception 'User access does not permit % in %',action_key,tg_argv[0] using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

do $access$ begin
  if to_regclass('public.people') is not null then
    execute $statement$drop policy if exists user_module_view on public.people;$statement$;
    execute $statement$drop policy if exists user_module_create on public.people;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.people;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.people;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.people;$statement$;
    execute $statement$alter table public.people enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.people as restrictive for select to authenticated using (public.user_access_allowed('people','view'));$statement$;
    execute $statement$create policy user_module_create on public.people as restrictive for insert to authenticated with check (public.user_access_allowed('people','create'));$statement$;
    execute $statement$create policy user_module_edit on public.people as restrictive for update to authenticated using (public.user_access_allowed('people','edit')) with check (public.user_access_allowed('people','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.people as restrictive for delete to authenticated using (public.user_access_allowed('people','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.people for each row execute function public.guard_module_user_access('people');$statement$;
  else
    raise notice 'Skipping unavailable table public.people';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.people_certifications') is not null then
    execute $statement$drop policy if exists user_module_view on public.people_certifications;$statement$;
    execute $statement$drop policy if exists user_module_create on public.people_certifications;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.people_certifications;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.people_certifications;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.people_certifications;$statement$;
    execute $statement$alter table public.people_certifications enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.people_certifications as restrictive for select to authenticated using (public.user_access_allowed('people','view'));$statement$;
    execute $statement$create policy user_module_create on public.people_certifications as restrictive for insert to authenticated with check (public.user_access_allowed('people','create'));$statement$;
    execute $statement$create policy user_module_edit on public.people_certifications as restrictive for update to authenticated using (public.user_access_allowed('people','edit')) with check (public.user_access_allowed('people','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.people_certifications as restrictive for delete to authenticated using (public.user_access_allowed('people','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.people_certifications for each row execute function public.guard_module_user_access('people');$statement$;
  else
    raise notice 'Skipping unavailable table public.people_certifications';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.events') is not null then
    execute $statement$drop policy if exists user_module_view on public.events;$statement$;
    execute $statement$drop policy if exists user_module_create on public.events;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.events;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.events;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.events;$statement$;
    execute $statement$alter table public.events enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.events as restrictive for select to authenticated using (public.user_access_allowed('events','view'));$statement$;
    execute $statement$create policy user_module_create on public.events as restrictive for insert to authenticated with check (public.user_access_allowed('events','create'));$statement$;
    execute $statement$create policy user_module_edit on public.events as restrictive for update to authenticated using (public.user_access_allowed('events','edit')) with check (public.user_access_allowed('events','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.events as restrictive for delete to authenticated using (public.user_access_allowed('events','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.events for each row execute function public.guard_module_user_access('events');$statement$;
  else
    raise notice 'Skipping unavailable table public.events';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.inspections') is not null then
    execute $statement$drop policy if exists user_module_view on public.inspections;$statement$;
    execute $statement$drop policy if exists user_module_create on public.inspections;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.inspections;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.inspections;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.inspections;$statement$;
    execute $statement$alter table public.inspections enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.inspections as restrictive for select to authenticated using (public.user_access_allowed('inspection','view'));$statement$;
    execute $statement$create policy user_module_create on public.inspections as restrictive for insert to authenticated with check (public.user_access_allowed('inspection','create'));$statement$;
    execute $statement$create policy user_module_edit on public.inspections as restrictive for update to authenticated using (public.user_access_allowed('inspection','edit')) with check (public.user_access_allowed('inspection','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.inspections as restrictive for delete to authenticated using (public.user_access_allowed('inspection','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.inspections for each row execute function public.guard_module_user_access('inspection');$statement$;
  else
    raise notice 'Skipping unavailable table public.inspections';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.toolbox_talks') is not null then
    execute $statement$drop policy if exists user_module_view on public.toolbox_talks;$statement$;
    execute $statement$drop policy if exists user_module_create on public.toolbox_talks;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.toolbox_talks;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.toolbox_talks;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.toolbox_talks;$statement$;
    execute $statement$alter table public.toolbox_talks enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.toolbox_talks as restrictive for select to authenticated using (public.user_access_allowed('meetings','view'));$statement$;
    execute $statement$create policy user_module_create on public.toolbox_talks as restrictive for insert to authenticated with check (public.user_access_allowed('meetings','create'));$statement$;
    execute $statement$create policy user_module_edit on public.toolbox_talks as restrictive for update to authenticated using (public.user_access_allowed('meetings','edit')) with check (public.user_access_allowed('meetings','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.toolbox_talks as restrictive for delete to authenticated using (public.user_access_allowed('meetings','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.toolbox_talks for each row execute function public.guard_module_user_access('meetings');$statement$;
  else
    raise notice 'Skipping unavailable table public.toolbox_talks';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.hse_meetings') is not null then
    execute $statement$drop policy if exists user_module_view on public.hse_meetings;$statement$;
    execute $statement$drop policy if exists user_module_create on public.hse_meetings;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.hse_meetings;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.hse_meetings;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.hse_meetings;$statement$;
    execute $statement$alter table public.hse_meetings enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.hse_meetings as restrictive for select to authenticated using (public.user_access_allowed('meetings','view'));$statement$;
    execute $statement$create policy user_module_create on public.hse_meetings as restrictive for insert to authenticated with check (public.user_access_allowed('meetings','create'));$statement$;
    execute $statement$create policy user_module_edit on public.hse_meetings as restrictive for update to authenticated using (public.user_access_allowed('meetings','edit')) with check (public.user_access_allowed('meetings','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.hse_meetings as restrictive for delete to authenticated using (public.user_access_allowed('meetings','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.hse_meetings for each row execute function public.guard_module_user_access('meetings');$statement$;
  else
    raise notice 'Skipping unavailable table public.hse_meetings';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.meeting_actions') is not null then
    execute $statement$drop policy if exists user_module_view on public.meeting_actions;$statement$;
    execute $statement$drop policy if exists user_module_create on public.meeting_actions;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.meeting_actions;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.meeting_actions;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.meeting_actions;$statement$;
    execute $statement$alter table public.meeting_actions enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.meeting_actions as restrictive for select to authenticated using (public.user_access_allowed('meetings','view'));$statement$;
    execute $statement$create policy user_module_create on public.meeting_actions as restrictive for insert to authenticated with check (public.user_access_allowed('meetings','create'));$statement$;
    execute $statement$create policy user_module_edit on public.meeting_actions as restrictive for update to authenticated using (public.user_access_allowed('meetings','edit')) with check (public.user_access_allowed('meetings','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.meeting_actions as restrictive for delete to authenticated using (public.user_access_allowed('meetings','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.meeting_actions for each row execute function public.guard_module_user_access('meetings');$statement$;
  else
    raise notice 'Skipping unavailable table public.meeting_actions';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.work_schedule') is not null then
    execute $statement$drop policy if exists user_module_view on public.work_schedule;$statement$;
    execute $statement$drop policy if exists user_module_create on public.work_schedule;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.work_schedule;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.work_schedule;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.work_schedule;$statement$;
    execute $statement$alter table public.work_schedule enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.work_schedule as restrictive for select to authenticated using (public.user_access_allowed('workschedule','view'));$statement$;
    execute $statement$create policy user_module_create on public.work_schedule as restrictive for insert to authenticated with check (public.user_access_allowed('workschedule','create'));$statement$;
    execute $statement$create policy user_module_edit on public.work_schedule as restrictive for update to authenticated using (public.user_access_allowed('workschedule','edit')) with check (public.user_access_allowed('workschedule','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.work_schedule as restrictive for delete to authenticated using (public.user_access_allowed('workschedule','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.work_schedule for each row execute function public.guard_module_user_access('workschedule');$statement$;
  else
    raise notice 'Skipping unavailable table public.work_schedule';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.work_schedule_links') is not null then
    execute $statement$drop policy if exists user_module_view on public.work_schedule_links;$statement$;
    execute $statement$drop policy if exists user_module_create on public.work_schedule_links;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.work_schedule_links;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.work_schedule_links;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.work_schedule_links;$statement$;
    execute $statement$alter table public.work_schedule_links enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.work_schedule_links as restrictive for select to authenticated using (public.user_access_allowed('workschedule','view'));$statement$;
    execute $statement$create policy user_module_create on public.work_schedule_links as restrictive for insert to authenticated with check (public.user_access_allowed('workschedule','create'));$statement$;
    execute $statement$create policy user_module_edit on public.work_schedule_links as restrictive for update to authenticated using (public.user_access_allowed('workschedule','edit')) with check (public.user_access_allowed('workschedule','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.work_schedule_links as restrictive for delete to authenticated using (public.user_access_allowed('workschedule','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.work_schedule_links for each row execute function public.guard_module_user_access('workschedule');$statement$;
  else
    raise notice 'Skipping unavailable table public.work_schedule_links';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.permits') is not null then
    execute $statement$drop policy if exists user_module_view on public.permits;$statement$;
    execute $statement$drop policy if exists user_module_create on public.permits;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.permits;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.permits;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.permits;$statement$;
    execute $statement$alter table public.permits enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.permits as restrictive for select to authenticated using (public.user_access_allowed('permit','view'));$statement$;
    execute $statement$create policy user_module_create on public.permits as restrictive for insert to authenticated with check (public.user_access_allowed('permit','create'));$statement$;
    execute $statement$create policy user_module_edit on public.permits as restrictive for update to authenticated using (public.user_access_allowed('permit','edit')) with check (public.user_access_allowed('permit','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.permits as restrictive for delete to authenticated using (public.user_access_allowed('permit','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.permits for each row execute function public.guard_module_user_access('permit');$statement$;
  else
    raise notice 'Skipping unavailable table public.permits';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.risk_assessments') is not null then
    execute $statement$drop policy if exists user_module_view on public.risk_assessments;$statement$;
    execute $statement$drop policy if exists user_module_create on public.risk_assessments;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.risk_assessments;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.risk_assessments;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.risk_assessments;$statement$;
    execute $statement$alter table public.risk_assessments enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.risk_assessments as restrictive for select to authenticated using (public.user_access_allowed('risk','view'));$statement$;
    execute $statement$create policy user_module_create on public.risk_assessments as restrictive for insert to authenticated with check (public.user_access_allowed('risk','create'));$statement$;
    execute $statement$create policy user_module_edit on public.risk_assessments as restrictive for update to authenticated using (public.user_access_allowed('risk','edit')) with check (public.user_access_allowed('risk','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.risk_assessments as restrictive for delete to authenticated using (public.user_access_allowed('risk','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.risk_assessments for each row execute function public.guard_module_user_access('risk');$statement$;
  else
    raise notice 'Skipping unavailable table public.risk_assessments';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.risk_assessment_items') is not null then
    execute $statement$drop policy if exists user_module_view on public.risk_assessment_items;$statement$;
    execute $statement$drop policy if exists user_module_create on public.risk_assessment_items;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.risk_assessment_items;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.risk_assessment_items;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.risk_assessment_items;$statement$;
    execute $statement$alter table public.risk_assessment_items enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.risk_assessment_items as restrictive for select to authenticated using (public.user_access_allowed('risk','view'));$statement$;
    execute $statement$create policy user_module_create on public.risk_assessment_items as restrictive for insert to authenticated with check (public.user_access_allowed('risk','create'));$statement$;
    execute $statement$create policy user_module_edit on public.risk_assessment_items as restrictive for update to authenticated using (public.user_access_allowed('risk','edit')) with check (public.user_access_allowed('risk','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.risk_assessment_items as restrictive for delete to authenticated using (public.user_access_allowed('risk','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.risk_assessment_items for each row execute function public.guard_module_user_access('risk');$statement$;
  else
    raise notice 'Skipping unavailable table public.risk_assessment_items';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.risk_assessment_operational_records') is not null then
    execute $statement$drop policy if exists user_module_view on public.risk_assessment_operational_records;$statement$;
    execute $statement$drop policy if exists user_module_create on public.risk_assessment_operational_records;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.risk_assessment_operational_records;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.risk_assessment_operational_records;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.risk_assessment_operational_records;$statement$;
    execute $statement$alter table public.risk_assessment_operational_records enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.risk_assessment_operational_records as restrictive for select to authenticated using (public.user_access_allowed('risk','view'));$statement$;
    execute $statement$create policy user_module_create on public.risk_assessment_operational_records as restrictive for insert to authenticated with check (public.user_access_allowed('risk','create'));$statement$;
    execute $statement$create policy user_module_edit on public.risk_assessment_operational_records as restrictive for update to authenticated using (public.user_access_allowed('risk','edit')) with check (public.user_access_allowed('risk','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.risk_assessment_operational_records as restrictive for delete to authenticated using (public.user_access_allowed('risk','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.risk_assessment_operational_records for each row execute function public.guard_module_user_access('risk');$statement$;
  else
    raise notice 'Skipping unavailable table public.risk_assessment_operational_records';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.risk_assessment_relationships') is not null then
    execute $statement$drop policy if exists user_module_view on public.risk_assessment_relationships;$statement$;
    execute $statement$drop policy if exists user_module_create on public.risk_assessment_relationships;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.risk_assessment_relationships;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.risk_assessment_relationships;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.risk_assessment_relationships;$statement$;
    execute $statement$alter table public.risk_assessment_relationships enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.risk_assessment_relationships as restrictive for select to authenticated using (public.user_access_allowed('risk','view'));$statement$;
    execute $statement$create policy user_module_create on public.risk_assessment_relationships as restrictive for insert to authenticated with check (public.user_access_allowed('risk','create'));$statement$;
    execute $statement$create policy user_module_edit on public.risk_assessment_relationships as restrictive for update to authenticated using (public.user_access_allowed('risk','edit')) with check (public.user_access_allowed('risk','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.risk_assessment_relationships as restrictive for delete to authenticated using (public.user_access_allowed('risk','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.risk_assessment_relationships for each row execute function public.guard_module_user_access('risk');$statement$;
  else
    raise notice 'Skipping unavailable table public.risk_assessment_relationships';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.tools_register') is not null then
    execute $statement$drop policy if exists user_module_view on public.tools_register;$statement$;
    execute $statement$drop policy if exists user_module_create on public.tools_register;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.tools_register;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.tools_register;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.tools_register;$statement$;
    execute $statement$alter table public.tools_register enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.tools_register as restrictive for select to authenticated using (public.user_access_allowed('tools','view'));$statement$;
    execute $statement$create policy user_module_create on public.tools_register as restrictive for insert to authenticated with check (public.user_access_allowed('tools','create'));$statement$;
    execute $statement$create policy user_module_edit on public.tools_register as restrictive for update to authenticated using (public.user_access_allowed('tools','edit')) with check (public.user_access_allowed('tools','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.tools_register as restrictive for delete to authenticated using (public.user_access_allowed('tools','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.tools_register for each row execute function public.guard_module_user_access('tools');$statement$;
  else
    raise notice 'Skipping unavailable table public.tools_register';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.tool_inspections') is not null then
    execute $statement$drop policy if exists user_module_view on public.tool_inspections;$statement$;
    execute $statement$drop policy if exists user_module_create on public.tool_inspections;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.tool_inspections;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.tool_inspections;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.tool_inspections;$statement$;
    execute $statement$alter table public.tool_inspections enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.tool_inspections as restrictive for select to authenticated using (public.user_access_allowed('tools','view'));$statement$;
    execute $statement$create policy user_module_create on public.tool_inspections as restrictive for insert to authenticated with check (public.user_access_allowed('tools','create'));$statement$;
    execute $statement$create policy user_module_edit on public.tool_inspections as restrictive for update to authenticated using (public.user_access_allowed('tools','edit')) with check (public.user_access_allowed('tools','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.tool_inspections as restrictive for delete to authenticated using (public.user_access_allowed('tools','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.tool_inspections for each row execute function public.guard_module_user_access('tools');$statement$;
  else
    raise notice 'Skipping unavailable table public.tool_inspections';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.ppe_catalogue') is not null then
    execute $statement$drop policy if exists user_module_view on public.ppe_catalogue;$statement$;
    execute $statement$drop policy if exists user_module_create on public.ppe_catalogue;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.ppe_catalogue;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.ppe_catalogue;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.ppe_catalogue;$statement$;
    execute $statement$alter table public.ppe_catalogue enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.ppe_catalogue as restrictive for select to authenticated using (public.user_access_allowed('ppe','view'));$statement$;
    execute $statement$create policy user_module_create on public.ppe_catalogue as restrictive for insert to authenticated with check (public.user_access_allowed('ppe','create'));$statement$;
    execute $statement$create policy user_module_edit on public.ppe_catalogue as restrictive for update to authenticated using (public.user_access_allowed('ppe','edit')) with check (public.user_access_allowed('ppe','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.ppe_catalogue as restrictive for delete to authenticated using (public.user_access_allowed('ppe','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.ppe_catalogue for each row execute function public.guard_module_user_access('ppe');$statement$;
  else
    raise notice 'Skipping unavailable table public.ppe_catalogue';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.ppe_inspections') is not null then
    execute $statement$drop policy if exists user_module_view on public.ppe_inspections;$statement$;
    execute $statement$drop policy if exists user_module_create on public.ppe_inspections;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.ppe_inspections;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.ppe_inspections;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.ppe_inspections;$statement$;
    execute $statement$alter table public.ppe_inspections enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.ppe_inspections as restrictive for select to authenticated using (public.user_access_allowed('ppe','view'));$statement$;
    execute $statement$create policy user_module_create on public.ppe_inspections as restrictive for insert to authenticated with check (public.user_access_allowed('ppe','create'));$statement$;
    execute $statement$create policy user_module_edit on public.ppe_inspections as restrictive for update to authenticated using (public.user_access_allowed('ppe','edit')) with check (public.user_access_allowed('ppe','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.ppe_inspections as restrictive for delete to authenticated using (public.user_access_allowed('ppe','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.ppe_inspections for each row execute function public.guard_module_user_access('ppe');$statement$;
  else
    raise notice 'Skipping unavailable table public.ppe_inspections';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.ppe_issuance') is not null then
    execute $statement$drop policy if exists user_module_view on public.ppe_issuance;$statement$;
    execute $statement$drop policy if exists user_module_create on public.ppe_issuance;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.ppe_issuance;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.ppe_issuance;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.ppe_issuance;$statement$;
    execute $statement$alter table public.ppe_issuance enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.ppe_issuance as restrictive for select to authenticated using (public.user_access_allowed('ppe','view'));$statement$;
    execute $statement$create policy user_module_create on public.ppe_issuance as restrictive for insert to authenticated with check (public.user_access_allowed('ppe','create'));$statement$;
    execute $statement$create policy user_module_edit on public.ppe_issuance as restrictive for update to authenticated using (public.user_access_allowed('ppe','edit')) with check (public.user_access_allowed('ppe','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.ppe_issuance as restrictive for delete to authenticated using (public.user_access_allowed('ppe','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.ppe_issuance for each row execute function public.guard_module_user_access('ppe');$statement$;
  else
    raise notice 'Skipping unavailable table public.ppe_issuance';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.ppe_replacements') is not null then
    execute $statement$drop policy if exists user_module_view on public.ppe_replacements;$statement$;
    execute $statement$drop policy if exists user_module_create on public.ppe_replacements;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.ppe_replacements;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.ppe_replacements;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.ppe_replacements;$statement$;
    execute $statement$alter table public.ppe_replacements enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.ppe_replacements as restrictive for select to authenticated using (public.user_access_allowed('ppe','view'));$statement$;
    execute $statement$create policy user_module_create on public.ppe_replacements as restrictive for insert to authenticated with check (public.user_access_allowed('ppe','create'));$statement$;
    execute $statement$create policy user_module_edit on public.ppe_replacements as restrictive for update to authenticated using (public.user_access_allowed('ppe','edit')) with check (public.user_access_allowed('ppe','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.ppe_replacements as restrictive for delete to authenticated using (public.user_access_allowed('ppe','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.ppe_replacements for each row execute function public.guard_module_user_access('ppe');$statement$;
  else
    raise notice 'Skipping unavailable table public.ppe_replacements';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.documents') is not null then
    execute $statement$drop policy if exists user_module_view on public.documents;$statement$;
    execute $statement$drop policy if exists user_module_create on public.documents;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.documents;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.documents;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.documents;$statement$;
    execute $statement$alter table public.documents enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.documents as restrictive for select to authenticated using (public.user_access_allowed('documents','view'));$statement$;
    execute $statement$create policy user_module_create on public.documents as restrictive for insert to authenticated with check (public.user_access_allowed('documents','create'));$statement$;
    execute $statement$create policy user_module_edit on public.documents as restrictive for update to authenticated using (public.user_access_allowed('documents','edit')) with check (public.user_access_allowed('documents','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.documents as restrictive for delete to authenticated using (public.user_access_allowed('documents','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.documents for each row execute function public.guard_module_user_access('documents');$statement$;
  else
    raise notice 'Skipping unavailable table public.documents';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.training_needs') is not null then
    execute $statement$drop policy if exists user_module_view on public.training_needs;$statement$;
    execute $statement$drop policy if exists user_module_create on public.training_needs;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.training_needs;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.training_needs;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.training_needs;$statement$;
    execute $statement$alter table public.training_needs enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.training_needs as restrictive for select to authenticated using (public.user_access_allowed('training','view'));$statement$;
    execute $statement$create policy user_module_create on public.training_needs as restrictive for insert to authenticated with check (public.user_access_allowed('training','create'));$statement$;
    execute $statement$create policy user_module_edit on public.training_needs as restrictive for update to authenticated using (public.user_access_allowed('training','edit')) with check (public.user_access_allowed('training','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.training_needs as restrictive for delete to authenticated using (public.user_access_allowed('training','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.training_needs for each row execute function public.guard_module_user_access('training');$statement$;
  else
    raise notice 'Skipping unavailable table public.training_needs';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.kpis') is not null then
    execute $statement$drop policy if exists user_module_view on public.kpis;$statement$;
    execute $statement$drop policy if exists user_module_create on public.kpis;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.kpis;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.kpis;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.kpis;$statement$;
    execute $statement$alter table public.kpis enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.kpis as restrictive for select to authenticated using (public.user_access_allowed('kpi','view'));$statement$;
    execute $statement$create policy user_module_create on public.kpis as restrictive for insert to authenticated with check (public.user_access_allowed('kpi','create'));$statement$;
    execute $statement$create policy user_module_edit on public.kpis as restrictive for update to authenticated using (public.user_access_allowed('kpi','edit')) with check (public.user_access_allowed('kpi','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.kpis as restrictive for delete to authenticated using (public.user_access_allowed('kpi','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.kpis for each row execute function public.guard_module_user_access('kpi');$statement$;
  else
    raise notice 'Skipping unavailable table public.kpis';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.kpis_v2') is not null then
    execute $statement$drop policy if exists user_module_view on public.kpis_v2;$statement$;
    execute $statement$drop policy if exists user_module_create on public.kpis_v2;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.kpis_v2;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.kpis_v2;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.kpis_v2;$statement$;
    execute $statement$alter table public.kpis_v2 enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.kpis_v2 as restrictive for select to authenticated using (public.user_access_allowed('kpi','view'));$statement$;
    execute $statement$create policy user_module_create on public.kpis_v2 as restrictive for insert to authenticated with check (public.user_access_allowed('kpi','create'));$statement$;
    execute $statement$create policy user_module_edit on public.kpis_v2 as restrictive for update to authenticated using (public.user_access_allowed('kpi','edit')) with check (public.user_access_allowed('kpi','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.kpis_v2 as restrictive for delete to authenticated using (public.user_access_allowed('kpi','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.kpis_v2 for each row execute function public.guard_module_user_access('kpi');$statement$;
  else
    raise notice 'Skipping unavailable table public.kpis_v2';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.kpi_indicators') is not null then
    execute $statement$drop policy if exists user_module_view on public.kpi_indicators;$statement$;
    execute $statement$drop policy if exists user_module_create on public.kpi_indicators;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.kpi_indicators;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.kpi_indicators;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.kpi_indicators;$statement$;
    execute $statement$alter table public.kpi_indicators enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.kpi_indicators as restrictive for select to authenticated using (public.user_access_allowed('kpi','view'));$statement$;
    execute $statement$create policy user_module_create on public.kpi_indicators as restrictive for insert to authenticated with check (public.user_access_allowed('kpi','create'));$statement$;
    execute $statement$create policy user_module_edit on public.kpi_indicators as restrictive for update to authenticated using (public.user_access_allowed('kpi','edit')) with check (public.user_access_allowed('kpi','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.kpi_indicators as restrictive for delete to authenticated using (public.user_access_allowed('kpi','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.kpi_indicators for each row execute function public.guard_module_user_access('kpi');$statement$;
  else
    raise notice 'Skipping unavailable table public.kpi_indicators';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.kpi_monthly_data') is not null then
    execute $statement$drop policy if exists user_module_view on public.kpi_monthly_data;$statement$;
    execute $statement$drop policy if exists user_module_create on public.kpi_monthly_data;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.kpi_monthly_data;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.kpi_monthly_data;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.kpi_monthly_data;$statement$;
    execute $statement$alter table public.kpi_monthly_data enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.kpi_monthly_data as restrictive for select to authenticated using (public.user_access_allowed('kpi','view'));$statement$;
    execute $statement$create policy user_module_create on public.kpi_monthly_data as restrictive for insert to authenticated with check (public.user_access_allowed('kpi','create'));$statement$;
    execute $statement$create policy user_module_edit on public.kpi_monthly_data as restrictive for update to authenticated using (public.user_access_allowed('kpi','edit')) with check (public.user_access_allowed('kpi','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.kpi_monthly_data as restrictive for delete to authenticated using (public.user_access_allowed('kpi','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.kpi_monthly_data for each row execute function public.guard_module_user_access('kpi');$statement$;
  else
    raise notice 'Skipping unavailable table public.kpi_monthly_data';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.company_settings') is not null then
    execute $statement$drop policy if exists user_module_view on public.company_settings;$statement$;
    execute $statement$drop policy if exists user_module_create on public.company_settings;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.company_settings;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.company_settings;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.company_settings;$statement$;
    execute $statement$alter table public.company_settings enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.company_settings as restrictive for select to authenticated using (public.user_access_allowed('settings.company','view'));$statement$;
    execute $statement$create policy user_module_create on public.company_settings as restrictive for insert to authenticated with check (public.user_access_allowed('settings.company','create'));$statement$;
    execute $statement$create policy user_module_edit on public.company_settings as restrictive for update to authenticated using (public.user_access_allowed('settings.company','edit')) with check (public.user_access_allowed('settings.company','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.company_settings as restrictive for delete to authenticated using (public.user_access_allowed('settings.company','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.company_settings for each row execute function public.guard_module_user_access('settings.company');$statement$;
  else
    raise notice 'Skipping unavailable table public.company_settings';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.approval_workflows') is not null then
    execute $statement$drop policy if exists user_module_view on public.approval_workflows;$statement$;
    execute $statement$drop policy if exists user_module_create on public.approval_workflows;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.approval_workflows;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.approval_workflows;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.approval_workflows;$statement$;
    execute $statement$alter table public.approval_workflows enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.approval_workflows as restrictive for select to authenticated using (public.user_access_allowed('settings.workflows','view'));$statement$;
    execute $statement$create policy user_module_create on public.approval_workflows as restrictive for insert to authenticated with check (public.user_access_allowed('settings.workflows','create'));$statement$;
    execute $statement$create policy user_module_edit on public.approval_workflows as restrictive for update to authenticated using (public.user_access_allowed('settings.workflows','edit')) with check (public.user_access_allowed('settings.workflows','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.approval_workflows as restrictive for delete to authenticated using (public.user_access_allowed('settings.workflows','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.approval_workflows for each row execute function public.guard_module_user_access('settings.workflows');$statement$;
  else
    raise notice 'Skipping unavailable table public.approval_workflows';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.approval_workflow_steps') is not null then
    execute $statement$drop policy if exists user_module_view on public.approval_workflow_steps;$statement$;
    execute $statement$drop policy if exists user_module_create on public.approval_workflow_steps;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.approval_workflow_steps;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.approval_workflow_steps;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.approval_workflow_steps;$statement$;
    execute $statement$alter table public.approval_workflow_steps enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.approval_workflow_steps as restrictive for select to authenticated using (public.user_access_allowed('settings.workflows','view'));$statement$;
    execute $statement$create policy user_module_create on public.approval_workflow_steps as restrictive for insert to authenticated with check (public.user_access_allowed('settings.workflows','create'));$statement$;
    execute $statement$create policy user_module_edit on public.approval_workflow_steps as restrictive for update to authenticated using (public.user_access_allowed('settings.workflows','edit')) with check (public.user_access_allowed('settings.workflows','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.approval_workflow_steps as restrictive for delete to authenticated using (public.user_access_allowed('settings.workflows','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.approval_workflow_steps for each row execute function public.guard_module_user_access('settings.workflows');$statement$;
  else
    raise notice 'Skipping unavailable table public.approval_workflow_steps';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.notification_settings') is not null then
    execute $statement$drop policy if exists user_module_view on public.notification_settings;$statement$;
    execute $statement$drop policy if exists user_module_create on public.notification_settings;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.notification_settings;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.notification_settings;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.notification_settings;$statement$;
    execute $statement$alter table public.notification_settings enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.notification_settings as restrictive for select to authenticated using (public.user_access_allowed('settings.notifications','view'));$statement$;
    execute $statement$create policy user_module_create on public.notification_settings as restrictive for insert to authenticated with check (public.user_access_allowed('settings.notifications','create'));$statement$;
    execute $statement$create policy user_module_edit on public.notification_settings as restrictive for update to authenticated using (public.user_access_allowed('settings.notifications','edit')) with check (public.user_access_allowed('settings.notifications','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.notification_settings as restrictive for delete to authenticated using (public.user_access_allowed('settings.notifications','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.notification_settings for each row execute function public.guard_module_user_access('settings.notifications');$statement$;
  else
    raise notice 'Skipping unavailable table public.notification_settings';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.notification_escalation_settings') is not null then
    execute $statement$drop policy if exists user_module_view on public.notification_escalation_settings;$statement$;
    execute $statement$drop policy if exists user_module_create on public.notification_escalation_settings;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.notification_escalation_settings;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.notification_escalation_settings;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.notification_escalation_settings;$statement$;
    execute $statement$alter table public.notification_escalation_settings enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.notification_escalation_settings as restrictive for select to authenticated using (public.user_access_allowed('settings.notifications','view'));$statement$;
    execute $statement$create policy user_module_create on public.notification_escalation_settings as restrictive for insert to authenticated with check (public.user_access_allowed('settings.notifications','create'));$statement$;
    execute $statement$create policy user_module_edit on public.notification_escalation_settings as restrictive for update to authenticated using (public.user_access_allowed('settings.notifications','edit')) with check (public.user_access_allowed('settings.notifications','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.notification_escalation_settings as restrictive for delete to authenticated using (public.user_access_allowed('settings.notifications','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.notification_escalation_settings for each row execute function public.guard_module_user_access('settings.notifications');$statement$;
  else
    raise notice 'Skipping unavailable table public.notification_escalation_settings';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.notification_acknowledgement_settings') is not null then
    execute $statement$drop policy if exists user_module_view on public.notification_acknowledgement_settings;$statement$;
    execute $statement$drop policy if exists user_module_create on public.notification_acknowledgement_settings;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.notification_acknowledgement_settings;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.notification_acknowledgement_settings;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.notification_acknowledgement_settings;$statement$;
    execute $statement$alter table public.notification_acknowledgement_settings enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.notification_acknowledgement_settings as restrictive for select to authenticated using (public.user_access_allowed('settings.notifications','view'));$statement$;
    execute $statement$create policy user_module_create on public.notification_acknowledgement_settings as restrictive for insert to authenticated with check (public.user_access_allowed('settings.notifications','create'));$statement$;
    execute $statement$create policy user_module_edit on public.notification_acknowledgement_settings as restrictive for update to authenticated using (public.user_access_allowed('settings.notifications','edit')) with check (public.user_access_allowed('settings.notifications','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.notification_acknowledgement_settings as restrictive for delete to authenticated using (public.user_access_allowed('settings.notifications','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.notification_acknowledgement_settings for each row execute function public.guard_module_user_access('settings.notifications');$statement$;
  else
    raise notice 'Skipping unavailable table public.notification_acknowledgement_settings';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.investigations') is not null then
    execute $statement$drop policy if exists user_module_view on public.investigations;$statement$;
    execute $statement$drop policy if exists user_module_create on public.investigations;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.investigations;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.investigations;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.investigations;$statement$;
    execute $statement$alter table public.investigations enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.investigations as restrictive for select to authenticated using (public.user_access_allowed('events','view'));$statement$;
    execute $statement$create policy user_module_create on public.investigations as restrictive for insert to authenticated with check (public.user_access_allowed('events','create'));$statement$;
    execute $statement$create policy user_module_edit on public.investigations as restrictive for update to authenticated using (public.user_access_allowed('events','edit')) with check (public.user_access_allowed('events','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.investigations as restrictive for delete to authenticated using (public.user_access_allowed('events','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.investigations for each row execute function public.guard_module_user_access('events');$statement$;
  else
    raise notice 'Skipping unavailable table public.investigations';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.incident_evidence') is not null then
    execute $statement$drop policy if exists user_module_view on public.incident_evidence;$statement$;
    execute $statement$drop policy if exists user_module_create on public.incident_evidence;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.incident_evidence;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.incident_evidence;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.incident_evidence;$statement$;
    execute $statement$alter table public.incident_evidence enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.incident_evidence as restrictive for select to authenticated using (public.user_access_allowed('events','view'));$statement$;
    execute $statement$create policy user_module_create on public.incident_evidence as restrictive for insert to authenticated with check (public.user_access_allowed('events','create'));$statement$;
    execute $statement$create policy user_module_edit on public.incident_evidence as restrictive for update to authenticated using (public.user_access_allowed('events','edit')) with check (public.user_access_allowed('events','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.incident_evidence as restrictive for delete to authenticated using (public.user_access_allowed('events','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.incident_evidence for each row execute function public.guard_module_user_access('events');$statement$;
  else
    raise notice 'Skipping unavailable table public.incident_evidence';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.incident_mgmt_records') is not null then
    execute $statement$drop policy if exists user_module_view on public.incident_mgmt_records;$statement$;
    execute $statement$drop policy if exists user_module_create on public.incident_mgmt_records;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.incident_mgmt_records;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.incident_mgmt_records;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.incident_mgmt_records;$statement$;
    execute $statement$alter table public.incident_mgmt_records enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.incident_mgmt_records as restrictive for select to authenticated using (public.user_access_allowed('events','view'));$statement$;
    execute $statement$create policy user_module_create on public.incident_mgmt_records as restrictive for insert to authenticated with check (public.user_access_allowed('events','create'));$statement$;
    execute $statement$create policy user_module_edit on public.incident_mgmt_records as restrictive for update to authenticated using (public.user_access_allowed('events','edit')) with check (public.user_access_allowed('events','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.incident_mgmt_records as restrictive for delete to authenticated using (public.user_access_allowed('events','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.incident_mgmt_records for each row execute function public.guard_module_user_access('events');$statement$;
  else
    raise notice 'Skipping unavailable table public.incident_mgmt_records';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.incident_mgmt_config_records') is not null then
    execute $statement$drop policy if exists user_module_view on public.incident_mgmt_config_records;$statement$;
    execute $statement$drop policy if exists user_module_create on public.incident_mgmt_config_records;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.incident_mgmt_config_records;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.incident_mgmt_config_records;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.incident_mgmt_config_records;$statement$;
    execute $statement$alter table public.incident_mgmt_config_records enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.incident_mgmt_config_records as restrictive for select to authenticated using (public.user_access_allowed('events','view'));$statement$;
    execute $statement$create policy user_module_create on public.incident_mgmt_config_records as restrictive for insert to authenticated with check (public.user_access_allowed('events','create'));$statement$;
    execute $statement$create policy user_module_edit on public.incident_mgmt_config_records as restrictive for update to authenticated using (public.user_access_allowed('events','edit')) with check (public.user_access_allowed('events','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.incident_mgmt_config_records as restrictive for delete to authenticated using (public.user_access_allowed('events','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.incident_mgmt_config_records for each row execute function public.guard_module_user_access('events');$statement$;
  else
    raise notice 'Skipping unavailable table public.incident_mgmt_config_records';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.bbs_observation_details') is not null then
    execute $statement$drop policy if exists user_module_view on public.bbs_observation_details;$statement$;
    execute $statement$drop policy if exists user_module_create on public.bbs_observation_details;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.bbs_observation_details;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.bbs_observation_details;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.bbs_observation_details;$statement$;
    execute $statement$alter table public.bbs_observation_details enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.bbs_observation_details as restrictive for select to authenticated using (public.user_access_allowed('observation','view'));$statement$;
    execute $statement$create policy user_module_create on public.bbs_observation_details as restrictive for insert to authenticated with check (public.user_access_allowed('observation','create'));$statement$;
    execute $statement$create policy user_module_edit on public.bbs_observation_details as restrictive for update to authenticated using (public.user_access_allowed('observation','edit')) with check (public.user_access_allowed('observation','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.bbs_observation_details as restrictive for delete to authenticated using (public.user_access_allowed('observation','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.bbs_observation_details for each row execute function public.guard_module_user_access('observation');$statement$;
  else
    raise notice 'Skipping unavailable table public.bbs_observation_details';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.bbs_observation_responses') is not null then
    execute $statement$drop policy if exists user_module_view on public.bbs_observation_responses;$statement$;
    execute $statement$drop policy if exists user_module_create on public.bbs_observation_responses;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.bbs_observation_responses;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.bbs_observation_responses;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.bbs_observation_responses;$statement$;
    execute $statement$alter table public.bbs_observation_responses enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.bbs_observation_responses as restrictive for select to authenticated using (public.user_access_allowed('observation','view'));$statement$;
    execute $statement$create policy user_module_create on public.bbs_observation_responses as restrictive for insert to authenticated with check (public.user_access_allowed('observation','create'));$statement$;
    execute $statement$create policy user_module_edit on public.bbs_observation_responses as restrictive for update to authenticated using (public.user_access_allowed('observation','edit')) with check (public.user_access_allowed('observation','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.bbs_observation_responses as restrictive for delete to authenticated using (public.user_access_allowed('observation','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.bbs_observation_responses for each row execute function public.guard_module_user_access('observation');$statement$;
  else
    raise notice 'Skipping unavailable table public.bbs_observation_responses';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.bbs_observation_barriers') is not null then
    execute $statement$drop policy if exists user_module_view on public.bbs_observation_barriers;$statement$;
    execute $statement$drop policy if exists user_module_create on public.bbs_observation_barriers;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.bbs_observation_barriers;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.bbs_observation_barriers;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.bbs_observation_barriers;$statement$;
    execute $statement$alter table public.bbs_observation_barriers enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.bbs_observation_barriers as restrictive for select to authenticated using (public.user_access_allowed('observation','view'));$statement$;
    execute $statement$create policy user_module_create on public.bbs_observation_barriers as restrictive for insert to authenticated with check (public.user_access_allowed('observation','create'));$statement$;
    execute $statement$create policy user_module_edit on public.bbs_observation_barriers as restrictive for update to authenticated using (public.user_access_allowed('observation','edit')) with check (public.user_access_allowed('observation','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.bbs_observation_barriers as restrictive for delete to authenticated using (public.user_access_allowed('observation','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.bbs_observation_barriers for each row execute function public.guard_module_user_access('observation');$statement$;
  else
    raise notice 'Skipping unavailable table public.bbs_observation_barriers';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.bbs_programmes') is not null then
    execute $statement$drop policy if exists user_module_view on public.bbs_programmes;$statement$;
    execute $statement$drop policy if exists user_module_create on public.bbs_programmes;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.bbs_programmes;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.bbs_programmes;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.bbs_programmes;$statement$;
    execute $statement$alter table public.bbs_programmes enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.bbs_programmes as restrictive for select to authenticated using (public.user_access_allowed('observation','view'));$statement$;
    execute $statement$create policy user_module_create on public.bbs_programmes as restrictive for insert to authenticated with check (public.user_access_allowed('observation','create'));$statement$;
    execute $statement$create policy user_module_edit on public.bbs_programmes as restrictive for update to authenticated using (public.user_access_allowed('observation','edit')) with check (public.user_access_allowed('observation','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.bbs_programmes as restrictive for delete to authenticated using (public.user_access_allowed('observation','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.bbs_programmes for each row execute function public.guard_module_user_access('observation');$statement$;
  else
    raise notice 'Skipping unavailable table public.bbs_programmes';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.bbs_feedback') is not null then
    execute $statement$drop policy if exists user_module_view on public.bbs_feedback;$statement$;
    execute $statement$drop policy if exists user_module_create on public.bbs_feedback;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.bbs_feedback;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.bbs_feedback;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.bbs_feedback;$statement$;
    execute $statement$alter table public.bbs_feedback enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.bbs_feedback as restrictive for select to authenticated using (public.user_access_allowed('observation','view'));$statement$;
    execute $statement$create policy user_module_create on public.bbs_feedback as restrictive for insert to authenticated with check (public.user_access_allowed('observation','create'));$statement$;
    execute $statement$create policy user_module_edit on public.bbs_feedback as restrictive for update to authenticated using (public.user_access_allowed('observation','edit')) with check (public.user_access_allowed('observation','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.bbs_feedback as restrictive for delete to authenticated using (public.user_access_allowed('observation','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.bbs_feedback for each row execute function public.guard_module_user_access('observation');$statement$;
  else
    raise notice 'Skipping unavailable table public.bbs_feedback';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.bbs_quality_reviews') is not null then
    execute $statement$drop policy if exists user_module_view on public.bbs_quality_reviews;$statement$;
    execute $statement$drop policy if exists user_module_create on public.bbs_quality_reviews;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.bbs_quality_reviews;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.bbs_quality_reviews;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.bbs_quality_reviews;$statement$;
    execute $statement$alter table public.bbs_quality_reviews enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.bbs_quality_reviews as restrictive for select to authenticated using (public.user_access_allowed('observation','view'));$statement$;
    execute $statement$create policy user_module_create on public.bbs_quality_reviews as restrictive for insert to authenticated with check (public.user_access_allowed('observation','create'));$statement$;
    execute $statement$create policy user_module_edit on public.bbs_quality_reviews as restrictive for update to authenticated using (public.user_access_allowed('observation','edit')) with check (public.user_access_allowed('observation','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.bbs_quality_reviews as restrictive for delete to authenticated using (public.user_access_allowed('observation','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.bbs_quality_reviews for each row execute function public.guard_module_user_access('observation');$statement$;
  else
    raise notice 'Skipping unavailable table public.bbs_quality_reviews';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.bbs_recognitions') is not null then
    execute $statement$drop policy if exists user_module_view on public.bbs_recognitions;$statement$;
    execute $statement$drop policy if exists user_module_create on public.bbs_recognitions;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.bbs_recognitions;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.bbs_recognitions;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.bbs_recognitions;$statement$;
    execute $statement$alter table public.bbs_recognitions enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.bbs_recognitions as restrictive for select to authenticated using (public.user_access_allowed('observation','view'));$statement$;
    execute $statement$create policy user_module_create on public.bbs_recognitions as restrictive for insert to authenticated with check (public.user_access_allowed('observation','create'));$statement$;
    execute $statement$create policy user_module_edit on public.bbs_recognitions as restrictive for update to authenticated using (public.user_access_allowed('observation','edit')) with check (public.user_access_allowed('observation','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.bbs_recognitions as restrictive for delete to authenticated using (public.user_access_allowed('observation','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.bbs_recognitions for each row execute function public.guard_module_user_access('observation');$statement$;
  else
    raise notice 'Skipping unavailable table public.bbs_recognitions';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.bbs_themes') is not null then
    execute $statement$drop policy if exists user_module_view on public.bbs_themes;$statement$;
    execute $statement$drop policy if exists user_module_create on public.bbs_themes;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.bbs_themes;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.bbs_themes;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.bbs_themes;$statement$;
    execute $statement$alter table public.bbs_themes enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.bbs_themes as restrictive for select to authenticated using (public.user_access_allowed('observation','view'));$statement$;
    execute $statement$create policy user_module_create on public.bbs_themes as restrictive for insert to authenticated with check (public.user_access_allowed('observation','create'));$statement$;
    execute $statement$create policy user_module_edit on public.bbs_themes as restrictive for update to authenticated using (public.user_access_allowed('observation','edit')) with check (public.user_access_allowed('observation','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.bbs_themes as restrictive for delete to authenticated using (public.user_access_allowed('observation','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.bbs_themes for each row execute function public.guard_module_user_access('observation');$statement$;
  else
    raise notice 'Skipping unavailable table public.bbs_themes';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.inspection_items') is not null then
    execute $statement$drop policy if exists user_module_view on public.inspection_items;$statement$;
    execute $statement$drop policy if exists user_module_create on public.inspection_items;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.inspection_items;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.inspection_items;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.inspection_items;$statement$;
    execute $statement$alter table public.inspection_items enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.inspection_items as restrictive for select to authenticated using (public.user_access_allowed('inspection','view'));$statement$;
    execute $statement$create policy user_module_create on public.inspection_items as restrictive for insert to authenticated with check (public.user_access_allowed('inspection','create'));$statement$;
    execute $statement$create policy user_module_edit on public.inspection_items as restrictive for update to authenticated using (public.user_access_allowed('inspection','edit')) with check (public.user_access_allowed('inspection','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.inspection_items as restrictive for delete to authenticated using (public.user_access_allowed('inspection','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.inspection_items for each row execute function public.guard_module_user_access('inspection');$statement$;
  else
    raise notice 'Skipping unavailable table public.inspection_items';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.inspection_actions') is not null then
    execute $statement$drop policy if exists user_module_view on public.inspection_actions;$statement$;
    execute $statement$drop policy if exists user_module_create on public.inspection_actions;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.inspection_actions;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.inspection_actions;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.inspection_actions;$statement$;
    execute $statement$alter table public.inspection_actions enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.inspection_actions as restrictive for select to authenticated using (public.user_access_allowed('inspection','view'));$statement$;
    execute $statement$create policy user_module_create on public.inspection_actions as restrictive for insert to authenticated with check (public.user_access_allowed('inspection','create'));$statement$;
    execute $statement$create policy user_module_edit on public.inspection_actions as restrictive for update to authenticated using (public.user_access_allowed('inspection','edit')) with check (public.user_access_allowed('inspection','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.inspection_actions as restrictive for delete to authenticated using (public.user_access_allowed('inspection','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.inspection_actions for each row execute function public.guard_module_user_access('inspection');$statement$;
  else
    raise notice 'Skipping unavailable table public.inspection_actions';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.prestart_inspections') is not null then
    execute $statement$drop policy if exists user_module_view on public.prestart_inspections;$statement$;
    execute $statement$drop policy if exists user_module_create on public.prestart_inspections;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.prestart_inspections;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.prestart_inspections;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.prestart_inspections;$statement$;
    execute $statement$alter table public.prestart_inspections enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.prestart_inspections as restrictive for select to authenticated using (public.user_access_allowed('inspection','view'));$statement$;
    execute $statement$create policy user_module_create on public.prestart_inspections as restrictive for insert to authenticated with check (public.user_access_allowed('inspection','create'));$statement$;
    execute $statement$create policy user_module_edit on public.prestart_inspections as restrictive for update to authenticated using (public.user_access_allowed('inspection','edit')) with check (public.user_access_allowed('inspection','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.prestart_inspections as restrictive for delete to authenticated using (public.user_access_allowed('inspection','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.prestart_inspections for each row execute function public.guard_module_user_access('inspection');$statement$;
  else
    raise notice 'Skipping unavailable table public.prestart_inspections';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.checklist_templates') is not null then
    execute $statement$drop policy if exists user_module_view on public.checklist_templates;$statement$;
    execute $statement$drop policy if exists user_module_create on public.checklist_templates;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.checklist_templates;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.checklist_templates;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.checklist_templates;$statement$;
    execute $statement$alter table public.checklist_templates enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.checklist_templates as restrictive for select to authenticated using (public.user_access_allowed('inspection','view'));$statement$;
    execute $statement$create policy user_module_create on public.checklist_templates as restrictive for insert to authenticated with check (public.user_access_allowed('inspection','create'));$statement$;
    execute $statement$create policy user_module_edit on public.checklist_templates as restrictive for update to authenticated using (public.user_access_allowed('inspection','edit')) with check (public.user_access_allowed('inspection','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.checklist_templates as restrictive for delete to authenticated using (public.user_access_allowed('inspection','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.checklist_templates for each row execute function public.guard_module_user_access('inspection');$statement$;
  else
    raise notice 'Skipping unavailable table public.checklist_templates';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.action_tracker') is not null then
    execute $statement$drop policy if exists user_module_view on public.action_tracker;$statement$;
    execute $statement$drop policy if exists user_module_create on public.action_tracker;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.action_tracker;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.action_tracker;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.action_tracker;$statement$;
    execute $statement$alter table public.action_tracker enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.action_tracker as restrictive for select to authenticated using (public.user_access_allowed('actions','view'));$statement$;
    execute $statement$create policy user_module_create on public.action_tracker as restrictive for insert to authenticated with check (public.user_access_allowed('actions','create'));$statement$;
    execute $statement$create policy user_module_edit on public.action_tracker as restrictive for update to authenticated using (public.user_access_allowed('actions','edit')) with check (public.user_access_allowed('actions','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.action_tracker as restrictive for delete to authenticated using (public.user_access_allowed('actions','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.action_tracker for each row execute function public.guard_module_user_access('actions');$statement$;
  else
    raise notice 'Skipping unavailable table public.action_tracker';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.jsa_records') is not null then
    execute $statement$drop policy if exists user_module_view on public.jsa_records;$statement$;
    execute $statement$drop policy if exists user_module_create on public.jsa_records;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.jsa_records;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.jsa_records;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.jsa_records;$statement$;
    execute $statement$alter table public.jsa_records enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.jsa_records as restrictive for select to authenticated using (public.user_access_allowed('risk','view'));$statement$;
    execute $statement$create policy user_module_create on public.jsa_records as restrictive for insert to authenticated with check (public.user_access_allowed('risk','create'));$statement$;
    execute $statement$create policy user_module_edit on public.jsa_records as restrictive for update to authenticated using (public.user_access_allowed('risk','edit')) with check (public.user_access_allowed('risk','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.jsa_records as restrictive for delete to authenticated using (public.user_access_allowed('risk','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.jsa_records for each row execute function public.guard_module_user_access('risk');$statement$;
  else
    raise notice 'Skipping unavailable table public.jsa_records';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.equipment_assurance_records') is not null then
    execute $statement$drop policy if exists user_module_view on public.equipment_assurance_records;$statement$;
    execute $statement$drop policy if exists user_module_create on public.equipment_assurance_records;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.equipment_assurance_records;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.equipment_assurance_records;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.equipment_assurance_records;$statement$;
    execute $statement$alter table public.equipment_assurance_records enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.equipment_assurance_records as restrictive for select to authenticated using (public.user_access_allowed('tools','view'));$statement$;
    execute $statement$create policy user_module_create on public.equipment_assurance_records as restrictive for insert to authenticated with check (public.user_access_allowed('tools','create'));$statement$;
    execute $statement$create policy user_module_edit on public.equipment_assurance_records as restrictive for update to authenticated using (public.user_access_allowed('tools','edit')) with check (public.user_access_allowed('tools','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.equipment_assurance_records as restrictive for delete to authenticated using (public.user_access_allowed('tools','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.equipment_assurance_records for each row execute function public.guard_module_user_access('tools');$statement$;
  else
    raise notice 'Skipping unavailable table public.equipment_assurance_records';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.equipment_assurance_profiles') is not null then
    execute $statement$drop policy if exists user_module_view on public.equipment_assurance_profiles;$statement$;
    execute $statement$drop policy if exists user_module_create on public.equipment_assurance_profiles;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.equipment_assurance_profiles;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.equipment_assurance_profiles;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.equipment_assurance_profiles;$statement$;
    execute $statement$alter table public.equipment_assurance_profiles enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.equipment_assurance_profiles as restrictive for select to authenticated using (public.user_access_allowed('tools','view'));$statement$;
    execute $statement$create policy user_module_create on public.equipment_assurance_profiles as restrictive for insert to authenticated with check (public.user_access_allowed('tools','create'));$statement$;
    execute $statement$create policy user_module_edit on public.equipment_assurance_profiles as restrictive for update to authenticated using (public.user_access_allowed('tools','edit')) with check (public.user_access_allowed('tools','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.equipment_assurance_profiles as restrictive for delete to authenticated using (public.user_access_allowed('tools','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.equipment_assurance_profiles for each row execute function public.guard_module_user_access('tools');$statement$;
  else
    raise notice 'Skipping unavailable table public.equipment_assurance_profiles';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.equipment_defects') is not null then
    execute $statement$drop policy if exists user_module_view on public.equipment_defects;$statement$;
    execute $statement$drop policy if exists user_module_create on public.equipment_defects;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.equipment_defects;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.equipment_defects;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.equipment_defects;$statement$;
    execute $statement$alter table public.equipment_defects enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.equipment_defects as restrictive for select to authenticated using (public.user_access_allowed('tools','view'));$statement$;
    execute $statement$create policy user_module_create on public.equipment_defects as restrictive for insert to authenticated with check (public.user_access_allowed('tools','create'));$statement$;
    execute $statement$create policy user_module_edit on public.equipment_defects as restrictive for update to authenticated using (public.user_access_allowed('tools','edit')) with check (public.user_access_allowed('tools','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.equipment_defects as restrictive for delete to authenticated using (public.user_access_allowed('tools','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.equipment_defects for each row execute function public.guard_module_user_access('tools');$statement$;
  else
    raise notice 'Skipping unavailable table public.equipment_defects';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.equipment_movements') is not null then
    execute $statement$drop policy if exists user_module_view on public.equipment_movements;$statement$;
    execute $statement$drop policy if exists user_module_create on public.equipment_movements;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.equipment_movements;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.equipment_movements;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.equipment_movements;$statement$;
    execute $statement$alter table public.equipment_movements enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.equipment_movements as restrictive for select to authenticated using (public.user_access_allowed('tools','view'));$statement$;
    execute $statement$create policy user_module_create on public.equipment_movements as restrictive for insert to authenticated with check (public.user_access_allowed('tools','create'));$statement$;
    execute $statement$create policy user_module_edit on public.equipment_movements as restrictive for update to authenticated using (public.user_access_allowed('tools','edit')) with check (public.user_access_allowed('tools','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.equipment_movements as restrictive for delete to authenticated using (public.user_access_allowed('tools','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.equipment_movements for each row execute function public.guard_module_user_access('tools');$statement$;
  else
    raise notice 'Skipping unavailable table public.equipment_movements';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.equipment_maintenance_events') is not null then
    execute $statement$drop policy if exists user_module_view on public.equipment_maintenance_events;$statement$;
    execute $statement$drop policy if exists user_module_create on public.equipment_maintenance_events;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.equipment_maintenance_events;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.equipment_maintenance_events;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.equipment_maintenance_events;$statement$;
    execute $statement$alter table public.equipment_maintenance_events enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.equipment_maintenance_events as restrictive for select to authenticated using (public.user_access_allowed('tools','view'));$statement$;
    execute $statement$create policy user_module_create on public.equipment_maintenance_events as restrictive for insert to authenticated with check (public.user_access_allowed('tools','create'));$statement$;
    execute $statement$create policy user_module_edit on public.equipment_maintenance_events as restrictive for update to authenticated using (public.user_access_allowed('tools','edit')) with check (public.user_access_allowed('tools','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.equipment_maintenance_events as restrictive for delete to authenticated using (public.user_access_allowed('tools','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.equipment_maintenance_events for each row execute function public.guard_module_user_access('tools');$statement$;
  else
    raise notice 'Skipping unavailable table public.equipment_maintenance_events';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.fuel_consumption') is not null then
    execute $statement$drop policy if exists user_module_view on public.fuel_consumption;$statement$;
    execute $statement$drop policy if exists user_module_create on public.fuel_consumption;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.fuel_consumption;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.fuel_consumption;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.fuel_consumption;$statement$;
    execute $statement$alter table public.fuel_consumption enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.fuel_consumption as restrictive for select to authenticated using (public.user_access_allowed('fleet','view'));$statement$;
    execute $statement$create policy user_module_create on public.fuel_consumption as restrictive for insert to authenticated with check (public.user_access_allowed('fleet','create'));$statement$;
    execute $statement$create policy user_module_edit on public.fuel_consumption as restrictive for update to authenticated using (public.user_access_allowed('fleet','edit')) with check (public.user_access_allowed('fleet','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.fuel_consumption as restrictive for delete to authenticated using (public.user_access_allowed('fleet','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.fuel_consumption for each row execute function public.guard_module_user_access('fleet');$statement$;
  else
    raise notice 'Skipping unavailable table public.fuel_consumption';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.atex_areas') is not null then
    execute $statement$drop policy if exists user_module_view on public.atex_areas;$statement$;
    execute $statement$drop policy if exists user_module_create on public.atex_areas;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.atex_areas;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.atex_areas;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.atex_areas;$statement$;
    execute $statement$alter table public.atex_areas enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.atex_areas as restrictive for select to authenticated using (public.user_access_allowed('atex','view'));$statement$;
    execute $statement$create policy user_module_create on public.atex_areas as restrictive for insert to authenticated with check (public.user_access_allowed('atex','create'));$statement$;
    execute $statement$create policy user_module_edit on public.atex_areas as restrictive for update to authenticated using (public.user_access_allowed('atex','edit')) with check (public.user_access_allowed('atex','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.atex_areas as restrictive for delete to authenticated using (public.user_access_allowed('atex','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.atex_areas for each row execute function public.guard_module_user_access('atex');$statement$;
  else
    raise notice 'Skipping unavailable table public.atex_areas';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.fire_certificates') is not null then
    execute $statement$drop policy if exists user_module_view on public.fire_certificates;$statement$;
    execute $statement$drop policy if exists user_module_create on public.fire_certificates;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.fire_certificates;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.fire_certificates;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.fire_certificates;$statement$;
    execute $statement$alter table public.fire_certificates enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.fire_certificates as restrictive for select to authenticated using (public.user_access_allowed('fire','view'));$statement$;
    execute $statement$create policy user_module_create on public.fire_certificates as restrictive for insert to authenticated with check (public.user_access_allowed('fire','create'));$statement$;
    execute $statement$create policy user_module_edit on public.fire_certificates as restrictive for update to authenticated using (public.user_access_allowed('fire','edit')) with check (public.user_access_allowed('fire','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.fire_certificates as restrictive for delete to authenticated using (public.user_access_allowed('fire','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.fire_certificates for each row execute function public.guard_module_user_access('fire');$statement$;
  else
    raise notice 'Skipping unavailable table public.fire_certificates';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.fire_equipment') is not null then
    execute $statement$drop policy if exists user_module_view on public.fire_equipment;$statement$;
    execute $statement$drop policy if exists user_module_create on public.fire_equipment;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.fire_equipment;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.fire_equipment;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.fire_equipment;$statement$;
    execute $statement$alter table public.fire_equipment enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.fire_equipment as restrictive for select to authenticated using (public.user_access_allowed('fire','view'));$statement$;
    execute $statement$create policy user_module_create on public.fire_equipment as restrictive for insert to authenticated with check (public.user_access_allowed('fire','create'));$statement$;
    execute $statement$create policy user_module_edit on public.fire_equipment as restrictive for update to authenticated using (public.user_access_allowed('fire','edit')) with check (public.user_access_allowed('fire','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.fire_equipment as restrictive for delete to authenticated using (public.user_access_allowed('fire','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.fire_equipment for each row execute function public.guard_module_user_access('fire');$statement$;
  else
    raise notice 'Skipping unavailable table public.fire_equipment';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.fire_inspections') is not null then
    execute $statement$drop policy if exists user_module_view on public.fire_inspections;$statement$;
    execute $statement$drop policy if exists user_module_create on public.fire_inspections;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.fire_inspections;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.fire_inspections;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.fire_inspections;$statement$;
    execute $statement$alter table public.fire_inspections enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.fire_inspections as restrictive for select to authenticated using (public.user_access_allowed('fire','view'));$statement$;
    execute $statement$create policy user_module_create on public.fire_inspections as restrictive for insert to authenticated with check (public.user_access_allowed('fire','create'));$statement$;
    execute $statement$create policy user_module_edit on public.fire_inspections as restrictive for update to authenticated using (public.user_access_allowed('fire','edit')) with check (public.user_access_allowed('fire','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.fire_inspections as restrictive for delete to authenticated using (public.user_access_allowed('fire','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.fire_inspections for each row execute function public.guard_module_user_access('fire');$statement$;
  else
    raise notice 'Skipping unavailable table public.fire_inspections';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.fire_inspection_findings') is not null then
    execute $statement$drop policy if exists user_module_view on public.fire_inspection_findings;$statement$;
    execute $statement$drop policy if exists user_module_create on public.fire_inspection_findings;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.fire_inspection_findings;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.fire_inspection_findings;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.fire_inspection_findings;$statement$;
    execute $statement$alter table public.fire_inspection_findings enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.fire_inspection_findings as restrictive for select to authenticated using (public.user_access_allowed('fire','view'));$statement$;
    execute $statement$create policy user_module_create on public.fire_inspection_findings as restrictive for insert to authenticated with check (public.user_access_allowed('fire','create'));$statement$;
    execute $statement$create policy user_module_edit on public.fire_inspection_findings as restrictive for update to authenticated using (public.user_access_allowed('fire','edit')) with check (public.user_access_allowed('fire','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.fire_inspection_findings as restrictive for delete to authenticated using (public.user_access_allowed('fire','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.fire_inspection_findings for each row execute function public.guard_module_user_access('fire');$statement$;
  else
    raise notice 'Skipping unavailable table public.fire_inspection_findings';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.fire_layouts') is not null then
    execute $statement$drop policy if exists user_module_view on public.fire_layouts;$statement$;
    execute $statement$drop policy if exists user_module_create on public.fire_layouts;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.fire_layouts;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.fire_layouts;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.fire_layouts;$statement$;
    execute $statement$alter table public.fire_layouts enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.fire_layouts as restrictive for select to authenticated using (public.user_access_allowed('fire','view'));$statement$;
    execute $statement$create policy user_module_create on public.fire_layouts as restrictive for insert to authenticated with check (public.user_access_allowed('fire','create'));$statement$;
    execute $statement$create policy user_module_edit on public.fire_layouts as restrictive for update to authenticated using (public.user_access_allowed('fire','edit')) with check (public.user_access_allowed('fire','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.fire_layouts as restrictive for delete to authenticated using (public.user_access_allowed('fire','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.fire_layouts for each row execute function public.guard_module_user_access('fire');$statement$;
  else
    raise notice 'Skipping unavailable table public.fire_layouts';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.fire_layout_symbols') is not null then
    execute $statement$drop policy if exists user_module_view on public.fire_layout_symbols;$statement$;
    execute $statement$drop policy if exists user_module_create on public.fire_layout_symbols;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.fire_layout_symbols;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.fire_layout_symbols;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.fire_layout_symbols;$statement$;
    execute $statement$alter table public.fire_layout_symbols enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.fire_layout_symbols as restrictive for select to authenticated using (public.user_access_allowed('fire','view'));$statement$;
    execute $statement$create policy user_module_create on public.fire_layout_symbols as restrictive for insert to authenticated with check (public.user_access_allowed('fire','create'));$statement$;
    execute $statement$create policy user_module_edit on public.fire_layout_symbols as restrictive for update to authenticated using (public.user_access_allowed('fire','edit')) with check (public.user_access_allowed('fire','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.fire_layout_symbols as restrictive for delete to authenticated using (public.user_access_allowed('fire','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.fire_layout_symbols for each row execute function public.guard_module_user_access('fire');$statement$;
  else
    raise notice 'Skipping unavailable table public.fire_layout_symbols';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.chemical_register') is not null then
    execute $statement$drop policy if exists user_module_view on public.chemical_register;$statement$;
    execute $statement$drop policy if exists user_module_create on public.chemical_register;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.chemical_register;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.chemical_register;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.chemical_register;$statement$;
    execute $statement$alter table public.chemical_register enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.chemical_register as restrictive for select to authenticated using (public.user_access_allowed('chemical','view'));$statement$;
    execute $statement$create policy user_module_create on public.chemical_register as restrictive for insert to authenticated with check (public.user_access_allowed('chemical','create'));$statement$;
    execute $statement$create policy user_module_edit on public.chemical_register as restrictive for update to authenticated using (public.user_access_allowed('chemical','edit')) with check (public.user_access_allowed('chemical','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.chemical_register as restrictive for delete to authenticated using (public.user_access_allowed('chemical','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.chemical_register for each row execute function public.guard_module_user_access('chemical');$statement$;
  else
    raise notice 'Skipping unavailable table public.chemical_register';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.chemical_sds_versions') is not null then
    execute $statement$drop policy if exists user_module_view on public.chemical_sds_versions;$statement$;
    execute $statement$drop policy if exists user_module_create on public.chemical_sds_versions;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.chemical_sds_versions;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.chemical_sds_versions;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.chemical_sds_versions;$statement$;
    execute $statement$alter table public.chemical_sds_versions enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.chemical_sds_versions as restrictive for select to authenticated using (public.user_access_allowed('chemical','view'));$statement$;
    execute $statement$create policy user_module_create on public.chemical_sds_versions as restrictive for insert to authenticated with check (public.user_access_allowed('chemical','create'));$statement$;
    execute $statement$create policy user_module_edit on public.chemical_sds_versions as restrictive for update to authenticated using (public.user_access_allowed('chemical','edit')) with check (public.user_access_allowed('chemical','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.chemical_sds_versions as restrictive for delete to authenticated using (public.user_access_allowed('chemical','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.chemical_sds_versions for each row execute function public.guard_module_user_access('chemical');$statement$;
  else
    raise notice 'Skipping unavailable table public.chemical_sds_versions';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.chemical_inventory_events') is not null then
    execute $statement$drop policy if exists user_module_view on public.chemical_inventory_events;$statement$;
    execute $statement$drop policy if exists user_module_create on public.chemical_inventory_events;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.chemical_inventory_events;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.chemical_inventory_events;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.chemical_inventory_events;$statement$;
    execute $statement$alter table public.chemical_inventory_events enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.chemical_inventory_events as restrictive for select to authenticated using (public.user_access_allowed('chemical','view'));$statement$;
    execute $statement$create policy user_module_create on public.chemical_inventory_events as restrictive for insert to authenticated with check (public.user_access_allowed('chemical','create'));$statement$;
    execute $statement$create policy user_module_edit on public.chemical_inventory_events as restrictive for update to authenticated using (public.user_access_allowed('chemical','edit')) with check (public.user_access_allowed('chemical','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.chemical_inventory_events as restrictive for delete to authenticated using (public.user_access_allowed('chemical','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.chemical_inventory_events for each row execute function public.guard_module_user_access('chemical');$statement$;
  else
    raise notice 'Skipping unavailable table public.chemical_inventory_events';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.chemical_use_approvals') is not null then
    execute $statement$drop policy if exists user_module_view on public.chemical_use_approvals;$statement$;
    execute $statement$drop policy if exists user_module_create on public.chemical_use_approvals;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.chemical_use_approvals;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.chemical_use_approvals;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.chemical_use_approvals;$statement$;
    execute $statement$alter table public.chemical_use_approvals enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.chemical_use_approvals as restrictive for select to authenticated using (public.user_access_allowed('chemical','view'));$statement$;
    execute $statement$create policy user_module_create on public.chemical_use_approvals as restrictive for insert to authenticated with check (public.user_access_allowed('chemical','create'));$statement$;
    execute $statement$create policy user_module_edit on public.chemical_use_approvals as restrictive for update to authenticated using (public.user_access_allowed('chemical','edit')) with check (public.user_access_allowed('chemical','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.chemical_use_approvals as restrictive for delete to authenticated using (public.user_access_allowed('chemical','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.chemical_use_approvals for each row execute function public.guard_module_user_access('chemical');$statement$;
  else
    raise notice 'Skipping unavailable table public.chemical_use_approvals';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.emergency_equipment') is not null then
    execute $statement$drop policy if exists user_module_view on public.emergency_equipment;$statement$;
    execute $statement$drop policy if exists user_module_create on public.emergency_equipment;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.emergency_equipment;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.emergency_equipment;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.emergency_equipment;$statement$;
    execute $statement$alter table public.emergency_equipment enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.emergency_equipment as restrictive for select to authenticated using (public.user_access_allowed('emergency','view'));$statement$;
    execute $statement$create policy user_module_create on public.emergency_equipment as restrictive for insert to authenticated with check (public.user_access_allowed('emergency','create'));$statement$;
    execute $statement$create policy user_module_edit on public.emergency_equipment as restrictive for update to authenticated using (public.user_access_allowed('emergency','edit')) with check (public.user_access_allowed('emergency','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.emergency_equipment as restrictive for delete to authenticated using (public.user_access_allowed('emergency','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.emergency_equipment for each row execute function public.guard_module_user_access('emergency');$statement$;
  else
    raise notice 'Skipping unavailable table public.emergency_equipment';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.emergency_drills') is not null then
    execute $statement$drop policy if exists user_module_view on public.emergency_drills;$statement$;
    execute $statement$drop policy if exists user_module_create on public.emergency_drills;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.emergency_drills;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.emergency_drills;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.emergency_drills;$statement$;
    execute $statement$alter table public.emergency_drills enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.emergency_drills as restrictive for select to authenticated using (public.user_access_allowed('emergency','view'));$statement$;
    execute $statement$create policy user_module_create on public.emergency_drills as restrictive for insert to authenticated with check (public.user_access_allowed('emergency','create'));$statement$;
    execute $statement$create policy user_module_edit on public.emergency_drills as restrictive for update to authenticated using (public.user_access_allowed('emergency','edit')) with check (public.user_access_allowed('emergency','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.emergency_drills as restrictive for delete to authenticated using (public.user_access_allowed('emergency','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.emergency_drills for each row execute function public.guard_module_user_access('emergency');$statement$;
  else
    raise notice 'Skipping unavailable table public.emergency_drills';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.emergency_plans') is not null then
    execute $statement$drop policy if exists user_module_view on public.emergency_plans;$statement$;
    execute $statement$drop policy if exists user_module_create on public.emergency_plans;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.emergency_plans;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.emergency_plans;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.emergency_plans;$statement$;
    execute $statement$alter table public.emergency_plans enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.emergency_plans as restrictive for select to authenticated using (public.user_access_allowed('emergency','view'));$statement$;
    execute $statement$create policy user_module_create on public.emergency_plans as restrictive for insert to authenticated with check (public.user_access_allowed('emergency','create'));$statement$;
    execute $statement$create policy user_module_edit on public.emergency_plans as restrictive for update to authenticated using (public.user_access_allowed('emergency','edit')) with check (public.user_access_allowed('emergency','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.emergency_plans as restrictive for delete to authenticated using (public.user_access_allowed('emergency','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.emergency_plans for each row execute function public.guard_module_user_access('emergency');$statement$;
  else
    raise notice 'Skipping unavailable table public.emergency_plans';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.emergency_activations') is not null then
    execute $statement$drop policy if exists user_module_view on public.emergency_activations;$statement$;
    execute $statement$drop policy if exists user_module_create on public.emergency_activations;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.emergency_activations;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.emergency_activations;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.emergency_activations;$statement$;
    execute $statement$alter table public.emergency_activations enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.emergency_activations as restrictive for select to authenticated using (public.user_access_allowed('emergency','view'));$statement$;
    execute $statement$create policy user_module_create on public.emergency_activations as restrictive for insert to authenticated with check (public.user_access_allowed('emergency','create'));$statement$;
    execute $statement$create policy user_module_edit on public.emergency_activations as restrictive for update to authenticated using (public.user_access_allowed('emergency','edit')) with check (public.user_access_allowed('emergency','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.emergency_activations as restrictive for delete to authenticated using (public.user_access_allowed('emergency','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.emergency_activations for each row execute function public.guard_module_user_access('emergency');$statement$;
  else
    raise notice 'Skipping unavailable table public.emergency_activations';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.ert_members') is not null then
    execute $statement$drop policy if exists user_module_view on public.ert_members;$statement$;
    execute $statement$drop policy if exists user_module_create on public.ert_members;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.ert_members;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.ert_members;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.ert_members;$statement$;
    execute $statement$alter table public.ert_members enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.ert_members as restrictive for select to authenticated using (public.user_access_allowed('emergency','view'));$statement$;
    execute $statement$create policy user_module_create on public.ert_members as restrictive for insert to authenticated with check (public.user_access_allowed('emergency','create'));$statement$;
    execute $statement$create policy user_module_edit on public.ert_members as restrictive for update to authenticated using (public.user_access_allowed('emergency','edit')) with check (public.user_access_allowed('emergency','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.ert_members as restrictive for delete to authenticated using (public.user_access_allowed('emergency','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.ert_members for each row execute function public.guard_module_user_access('emergency');$statement$;
  else
    raise notice 'Skipping unavailable table public.ert_members';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.muster_points') is not null then
    execute $statement$drop policy if exists user_module_view on public.muster_points;$statement$;
    execute $statement$drop policy if exists user_module_create on public.muster_points;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.muster_points;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.muster_points;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.muster_points;$statement$;
    execute $statement$alter table public.muster_points enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.muster_points as restrictive for select to authenticated using (public.user_access_allowed('emergency','view'));$statement$;
    execute $statement$create policy user_module_create on public.muster_points as restrictive for insert to authenticated with check (public.user_access_allowed('emergency','create'));$statement$;
    execute $statement$create policy user_module_edit on public.muster_points as restrictive for update to authenticated using (public.user_access_allowed('emergency','edit')) with check (public.user_access_allowed('emergency','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.muster_points as restrictive for delete to authenticated using (public.user_access_allowed('emergency','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.muster_points for each row execute function public.guard_module_user_access('emergency');$statement$;
  else
    raise notice 'Skipping unavailable table public.muster_points';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.bcp_records') is not null then
    execute $statement$drop policy if exists user_module_view on public.bcp_records;$statement$;
    execute $statement$drop policy if exists user_module_create on public.bcp_records;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.bcp_records;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.bcp_records;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.bcp_records;$statement$;
    execute $statement$alter table public.bcp_records enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.bcp_records as restrictive for select to authenticated using (public.user_access_allowed('emergency','view'));$statement$;
    execute $statement$create policy user_module_create on public.bcp_records as restrictive for insert to authenticated with check (public.user_access_allowed('emergency','create'));$statement$;
    execute $statement$create policy user_module_edit on public.bcp_records as restrictive for update to authenticated using (public.user_access_allowed('emergency','edit')) with check (public.user_access_allowed('emergency','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.bcp_records as restrictive for delete to authenticated using (public.user_access_allowed('emergency','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.bcp_records for each row execute function public.guard_module_user_access('emergency');$statement$;
  else
    raise notice 'Skipping unavailable table public.bcp_records';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.contractors') is not null then
    execute $statement$drop policy if exists user_module_view on public.contractors;$statement$;
    execute $statement$drop policy if exists user_module_create on public.contractors;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.contractors;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.contractors;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.contractors;$statement$;
    execute $statement$alter table public.contractors enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.contractors as restrictive for select to authenticated using (public.user_access_allowed('contractor','view'));$statement$;
    execute $statement$create policy user_module_create on public.contractors as restrictive for insert to authenticated with check (public.user_access_allowed('contractor','create'));$statement$;
    execute $statement$create policy user_module_edit on public.contractors as restrictive for update to authenticated using (public.user_access_allowed('contractor','edit')) with check (public.user_access_allowed('contractor','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.contractors as restrictive for delete to authenticated using (public.user_access_allowed('contractor','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.contractors for each row execute function public.guard_module_user_access('contractor');$statement$;
  else
    raise notice 'Skipping unavailable table public.contractors';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.contractor_documents') is not null then
    execute $statement$drop policy if exists user_module_view on public.contractor_documents;$statement$;
    execute $statement$drop policy if exists user_module_create on public.contractor_documents;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.contractor_documents;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.contractor_documents;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.contractor_documents;$statement$;
    execute $statement$alter table public.contractor_documents enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.contractor_documents as restrictive for select to authenticated using (public.user_access_allowed('contractor','view'));$statement$;
    execute $statement$create policy user_module_create on public.contractor_documents as restrictive for insert to authenticated with check (public.user_access_allowed('contractor','create'));$statement$;
    execute $statement$create policy user_module_edit on public.contractor_documents as restrictive for update to authenticated using (public.user_access_allowed('contractor','edit')) with check (public.user_access_allowed('contractor','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.contractor_documents as restrictive for delete to authenticated using (public.user_access_allowed('contractor','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.contractor_documents for each row execute function public.guard_module_user_access('contractor');$statement$;
  else
    raise notice 'Skipping unavailable table public.contractor_documents';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.contractor_authorisations') is not null then
    execute $statement$drop policy if exists user_module_view on public.contractor_authorisations;$statement$;
    execute $statement$drop policy if exists user_module_create on public.contractor_authorisations;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.contractor_authorisations;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.contractor_authorisations;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.contractor_authorisations;$statement$;
    execute $statement$alter table public.contractor_authorisations enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.contractor_authorisations as restrictive for select to authenticated using (public.user_access_allowed('contractor','view'));$statement$;
    execute $statement$create policy user_module_create on public.contractor_authorisations as restrictive for insert to authenticated with check (public.user_access_allowed('contractor','create'));$statement$;
    execute $statement$create policy user_module_edit on public.contractor_authorisations as restrictive for update to authenticated using (public.user_access_allowed('contractor','edit')) with check (public.user_access_allowed('contractor','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.contractor_authorisations as restrictive for delete to authenticated using (public.user_access_allowed('contractor','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.contractor_authorisations for each row execute function public.guard_module_user_access('contractor');$statement$;
  else
    raise notice 'Skipping unavailable table public.contractor_authorisations';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.contractor_evaluations') is not null then
    execute $statement$drop policy if exists user_module_view on public.contractor_evaluations;$statement$;
    execute $statement$drop policy if exists user_module_create on public.contractor_evaluations;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.contractor_evaluations;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.contractor_evaluations;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.contractor_evaluations;$statement$;
    execute $statement$alter table public.contractor_evaluations enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.contractor_evaluations as restrictive for select to authenticated using (public.user_access_allowed('contractor','view'));$statement$;
    execute $statement$create policy user_module_create on public.contractor_evaluations as restrictive for insert to authenticated with check (public.user_access_allowed('contractor','create'));$statement$;
    execute $statement$create policy user_module_edit on public.contractor_evaluations as restrictive for update to authenticated using (public.user_access_allowed('contractor','edit')) with check (public.user_access_allowed('contractor','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.contractor_evaluations as restrictive for delete to authenticated using (public.user_access_allowed('contractor','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.contractor_evaluations for each row execute function public.guard_module_user_access('contractor');$statement$;
  else
    raise notice 'Skipping unavailable table public.contractor_evaluations';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.contractor_incidents') is not null then
    execute $statement$drop policy if exists user_module_view on public.contractor_incidents;$statement$;
    execute $statement$drop policy if exists user_module_create on public.contractor_incidents;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.contractor_incidents;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.contractor_incidents;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.contractor_incidents;$statement$;
    execute $statement$alter table public.contractor_incidents enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.contractor_incidents as restrictive for select to authenticated using (public.user_access_allowed('contractor','view'));$statement$;
    execute $statement$create policy user_module_create on public.contractor_incidents as restrictive for insert to authenticated with check (public.user_access_allowed('contractor','create'));$statement$;
    execute $statement$create policy user_module_edit on public.contractor_incidents as restrictive for update to authenticated using (public.user_access_allowed('contractor','edit')) with check (public.user_access_allowed('contractor','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.contractor_incidents as restrictive for delete to authenticated using (public.user_access_allowed('contractor','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.contractor_incidents for each row execute function public.guard_module_user_access('contractor');$statement$;
  else
    raise notice 'Skipping unavailable table public.contractor_incidents';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.contractor_preassessments') is not null then
    execute $statement$drop policy if exists user_module_view on public.contractor_preassessments;$statement$;
    execute $statement$drop policy if exists user_module_create on public.contractor_preassessments;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.contractor_preassessments;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.contractor_preassessments;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.contractor_preassessments;$statement$;
    execute $statement$alter table public.contractor_preassessments enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.contractor_preassessments as restrictive for select to authenticated using (public.user_access_allowed('contractor','view'));$statement$;
    execute $statement$create policy user_module_create on public.contractor_preassessments as restrictive for insert to authenticated with check (public.user_access_allowed('contractor','create'));$statement$;
    execute $statement$create policy user_module_edit on public.contractor_preassessments as restrictive for update to authenticated using (public.user_access_allowed('contractor','edit')) with check (public.user_access_allowed('contractor','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.contractor_preassessments as restrictive for delete to authenticated using (public.user_access_allowed('contractor','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.contractor_preassessments for each row execute function public.guard_module_user_access('contractor');$statement$;
  else
    raise notice 'Skipping unavailable table public.contractor_preassessments';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.contractor_assurance_profiles') is not null then
    execute $statement$drop policy if exists user_module_view on public.contractor_assurance_profiles;$statement$;
    execute $statement$drop policy if exists user_module_create on public.contractor_assurance_profiles;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.contractor_assurance_profiles;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.contractor_assurance_profiles;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.contractor_assurance_profiles;$statement$;
    execute $statement$alter table public.contractor_assurance_profiles enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.contractor_assurance_profiles as restrictive for select to authenticated using (public.user_access_allowed('contractor','view'));$statement$;
    execute $statement$create policy user_module_create on public.contractor_assurance_profiles as restrictive for insert to authenticated with check (public.user_access_allowed('contractor','create'));$statement$;
    execute $statement$create policy user_module_edit on public.contractor_assurance_profiles as restrictive for update to authenticated using (public.user_access_allowed('contractor','edit')) with check (public.user_access_allowed('contractor','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.contractor_assurance_profiles as restrictive for delete to authenticated using (public.user_access_allowed('contractor','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.contractor_assurance_profiles for each row execute function public.guard_module_user_access('contractor');$statement$;
  else
    raise notice 'Skipping unavailable table public.contractor_assurance_profiles';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.contractor_mobilisation_gates') is not null then
    execute $statement$drop policy if exists user_module_view on public.contractor_mobilisation_gates;$statement$;
    execute $statement$drop policy if exists user_module_create on public.contractor_mobilisation_gates;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.contractor_mobilisation_gates;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.contractor_mobilisation_gates;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.contractor_mobilisation_gates;$statement$;
    execute $statement$alter table public.contractor_mobilisation_gates enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.contractor_mobilisation_gates as restrictive for select to authenticated using (public.user_access_allowed('contractor','view'));$statement$;
    execute $statement$create policy user_module_create on public.contractor_mobilisation_gates as restrictive for insert to authenticated with check (public.user_access_allowed('contractor','create'));$statement$;
    execute $statement$create policy user_module_edit on public.contractor_mobilisation_gates as restrictive for update to authenticated using (public.user_access_allowed('contractor','edit')) with check (public.user_access_allowed('contractor','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.contractor_mobilisation_gates as restrictive for delete to authenticated using (public.user_access_allowed('contractor','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.contractor_mobilisation_gates for each row execute function public.guard_module_user_access('contractor');$statement$;
  else
    raise notice 'Skipping unavailable table public.contractor_mobilisation_gates';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.contractor_work_packages') is not null then
    execute $statement$drop policy if exists user_module_view on public.contractor_work_packages;$statement$;
    execute $statement$drop policy if exists user_module_create on public.contractor_work_packages;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.contractor_work_packages;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.contractor_work_packages;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.contractor_work_packages;$statement$;
    execute $statement$alter table public.contractor_work_packages enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.contractor_work_packages as restrictive for select to authenticated using (public.user_access_allowed('contractor','view'));$statement$;
    execute $statement$create policy user_module_create on public.contractor_work_packages as restrictive for insert to authenticated with check (public.user_access_allowed('contractor','create'));$statement$;
    execute $statement$create policy user_module_edit on public.contractor_work_packages as restrictive for update to authenticated using (public.user_access_allowed('contractor','edit')) with check (public.user_access_allowed('contractor','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.contractor_work_packages as restrictive for delete to authenticated using (public.user_access_allowed('contractor','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.contractor_work_packages for each row execute function public.guard_module_user_access('contractor');$statement$;
  else
    raise notice 'Skipping unavailable table public.contractor_work_packages';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.document_control_records') is not null then
    execute $statement$drop policy if exists user_module_view on public.document_control_records;$statement$;
    execute $statement$drop policy if exists user_module_create on public.document_control_records;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.document_control_records;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.document_control_records;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.document_control_records;$statement$;
    execute $statement$alter table public.document_control_records enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.document_control_records as restrictive for select to authenticated using (public.user_access_allowed('documents','view'));$statement$;
    execute $statement$create policy user_module_create on public.document_control_records as restrictive for insert to authenticated with check (public.user_access_allowed('documents','create'));$statement$;
    execute $statement$create policy user_module_edit on public.document_control_records as restrictive for update to authenticated using (public.user_access_allowed('documents','edit')) with check (public.user_access_allowed('documents','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.document_control_records as restrictive for delete to authenticated using (public.user_access_allowed('documents','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.document_control_records for each row execute function public.guard_module_user_access('documents');$statement$;
  else
    raise notice 'Skipping unavailable table public.document_control_records';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.document_control_revisions') is not null then
    execute $statement$drop policy if exists user_module_view on public.document_control_revisions;$statement$;
    execute $statement$drop policy if exists user_module_create on public.document_control_revisions;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.document_control_revisions;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.document_control_revisions;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.document_control_revisions;$statement$;
    execute $statement$alter table public.document_control_revisions enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.document_control_revisions as restrictive for select to authenticated using (public.user_access_allowed('documents','view'));$statement$;
    execute $statement$create policy user_module_create on public.document_control_revisions as restrictive for insert to authenticated with check (public.user_access_allowed('documents','create'));$statement$;
    execute $statement$create policy user_module_edit on public.document_control_revisions as restrictive for update to authenticated using (public.user_access_allowed('documents','edit')) with check (public.user_access_allowed('documents','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.document_control_revisions as restrictive for delete to authenticated using (public.user_access_allowed('documents','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.document_control_revisions for each row execute function public.guard_module_user_access('documents');$statement$;
  else
    raise notice 'Skipping unavailable table public.document_control_revisions';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.document_control_files') is not null then
    execute $statement$drop policy if exists user_module_view on public.document_control_files;$statement$;
    execute $statement$drop policy if exists user_module_create on public.document_control_files;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.document_control_files;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.document_control_files;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.document_control_files;$statement$;
    execute $statement$alter table public.document_control_files enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.document_control_files as restrictive for select to authenticated using (public.user_access_allowed('documents','view'));$statement$;
    execute $statement$create policy user_module_create on public.document_control_files as restrictive for insert to authenticated with check (public.user_access_allowed('documents','create'));$statement$;
    execute $statement$create policy user_module_edit on public.document_control_files as restrictive for update to authenticated using (public.user_access_allowed('documents','edit')) with check (public.user_access_allowed('documents','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.document_control_files as restrictive for delete to authenticated using (public.user_access_allowed('documents','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.document_control_files for each row execute function public.guard_module_user_access('documents');$statement$;
  else
    raise notice 'Skipping unavailable table public.document_control_files';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.document_control_config') is not null then
    execute $statement$drop policy if exists user_module_view on public.document_control_config;$statement$;
    execute $statement$drop policy if exists user_module_create on public.document_control_config;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.document_control_config;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.document_control_config;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.document_control_config;$statement$;
    execute $statement$alter table public.document_control_config enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.document_control_config as restrictive for select to authenticated using (public.user_access_allowed('documents','view'));$statement$;
    execute $statement$create policy user_module_create on public.document_control_config as restrictive for insert to authenticated with check (public.user_access_allowed('documents','create'));$statement$;
    execute $statement$create policy user_module_edit on public.document_control_config as restrictive for update to authenticated using (public.user_access_allowed('documents','edit')) with check (public.user_access_allowed('documents','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.document_control_config as restrictive for delete to authenticated using (public.user_access_allowed('documents','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.document_control_config for each row execute function public.guard_module_user_access('documents');$statement$;
  else
    raise notice 'Skipping unavailable table public.document_control_config';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.doc_revisions') is not null then
    execute $statement$drop policy if exists user_module_view on public.doc_revisions;$statement$;
    execute $statement$drop policy if exists user_module_create on public.doc_revisions;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.doc_revisions;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.doc_revisions;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.doc_revisions;$statement$;
    execute $statement$alter table public.doc_revisions enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.doc_revisions as restrictive for select to authenticated using (public.user_access_allowed('documents','view'));$statement$;
    execute $statement$create policy user_module_create on public.doc_revisions as restrictive for insert to authenticated with check (public.user_access_allowed('documents','create'));$statement$;
    execute $statement$create policy user_module_edit on public.doc_revisions as restrictive for update to authenticated using (public.user_access_allowed('documents','edit')) with check (public.user_access_allowed('documents','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.doc_revisions as restrictive for delete to authenticated using (public.user_access_allowed('documents','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.doc_revisions for each row execute function public.guard_module_user_access('documents');$statement$;
  else
    raise notice 'Skipping unavailable table public.doc_revisions';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.doc_controlled_copies') is not null then
    execute $statement$drop policy if exists user_module_view on public.doc_controlled_copies;$statement$;
    execute $statement$drop policy if exists user_module_create on public.doc_controlled_copies;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.doc_controlled_copies;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.doc_controlled_copies;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.doc_controlled_copies;$statement$;
    execute $statement$alter table public.doc_controlled_copies enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.doc_controlled_copies as restrictive for select to authenticated using (public.user_access_allowed('documents','view'));$statement$;
    execute $statement$create policy user_module_create on public.doc_controlled_copies as restrictive for insert to authenticated with check (public.user_access_allowed('documents','create'));$statement$;
    execute $statement$create policy user_module_edit on public.doc_controlled_copies as restrictive for update to authenticated using (public.user_access_allowed('documents','edit')) with check (public.user_access_allowed('documents','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.doc_controlled_copies as restrictive for delete to authenticated using (public.user_access_allowed('documents','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.doc_controlled_copies for each row execute function public.guard_module_user_access('documents');$statement$;
  else
    raise notice 'Skipping unavailable table public.doc_controlled_copies';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.doc_acknowledgements') is not null then
    execute $statement$drop policy if exists user_module_view on public.doc_acknowledgements;$statement$;
    execute $statement$drop policy if exists user_module_create on public.doc_acknowledgements;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.doc_acknowledgements;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.doc_acknowledgements;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.doc_acknowledgements;$statement$;
    execute $statement$alter table public.doc_acknowledgements enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.doc_acknowledgements as restrictive for select to authenticated using (public.user_access_allowed('documents','view'));$statement$;
    execute $statement$create policy user_module_create on public.doc_acknowledgements as restrictive for insert to authenticated with check (public.user_access_allowed('documents','create'));$statement$;
    execute $statement$create policy user_module_edit on public.doc_acknowledgements as restrictive for update to authenticated using (public.user_access_allowed('documents','edit')) with check (public.user_access_allowed('documents','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.doc_acknowledgements as restrictive for delete to authenticated using (public.user_access_allowed('documents','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.doc_acknowledgements for each row execute function public.guard_module_user_access('documents');$statement$;
  else
    raise notice 'Skipping unavailable table public.doc_acknowledgements';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.induction_records') is not null then
    execute $statement$drop policy if exists user_module_view on public.induction_records;$statement$;
    execute $statement$drop policy if exists user_module_create on public.induction_records;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.induction_records;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.induction_records;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.induction_records;$statement$;
    execute $statement$alter table public.induction_records enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.induction_records as restrictive for select to authenticated using (public.user_access_allowed('training','view'));$statement$;
    execute $statement$create policy user_module_create on public.induction_records as restrictive for insert to authenticated with check (public.user_access_allowed('training','create'));$statement$;
    execute $statement$create policy user_module_edit on public.induction_records as restrictive for update to authenticated using (public.user_access_allowed('training','edit')) with check (public.user_access_allowed('training','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.induction_records as restrictive for delete to authenticated using (public.user_access_allowed('training','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.induction_records for each row execute function public.guard_module_user_access('training');$statement$;
  else
    raise notice 'Skipping unavailable table public.induction_records';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.competencies') is not null then
    execute $statement$drop policy if exists user_module_view on public.competencies;$statement$;
    execute $statement$drop policy if exists user_module_create on public.competencies;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.competencies;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.competencies;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.competencies;$statement$;
    execute $statement$alter table public.competencies enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.competencies as restrictive for select to authenticated using (public.user_access_allowed('training','view'));$statement$;
    execute $statement$create policy user_module_create on public.competencies as restrictive for insert to authenticated with check (public.user_access_allowed('training','create'));$statement$;
    execute $statement$create policy user_module_edit on public.competencies as restrictive for update to authenticated using (public.user_access_allowed('training','edit')) with check (public.user_access_allowed('training','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.competencies as restrictive for delete to authenticated using (public.user_access_allowed('training','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.competencies for each row execute function public.guard_module_user_access('training');$statement$;
  else
    raise notice 'Skipping unavailable table public.competencies';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.competency_matrix') is not null then
    execute $statement$drop policy if exists user_module_view on public.competency_matrix;$statement$;
    execute $statement$drop policy if exists user_module_create on public.competency_matrix;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.competency_matrix;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.competency_matrix;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.competency_matrix;$statement$;
    execute $statement$alter table public.competency_matrix enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.competency_matrix as restrictive for select to authenticated using (public.user_access_allowed('training','view'));$statement$;
    execute $statement$create policy user_module_create on public.competency_matrix as restrictive for insert to authenticated with check (public.user_access_allowed('training','create'));$statement$;
    execute $statement$create policy user_module_edit on public.competency_matrix as restrictive for update to authenticated using (public.user_access_allowed('training','edit')) with check (public.user_access_allowed('training','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.competency_matrix as restrictive for delete to authenticated using (public.user_access_allowed('training','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.competency_matrix for each row execute function public.guard_module_user_access('training');$statement$;
  else
    raise notice 'Skipping unavailable table public.competency_matrix';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.training_plan') is not null then
    execute $statement$drop policy if exists user_module_view on public.training_plan;$statement$;
    execute $statement$drop policy if exists user_module_create on public.training_plan;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.training_plan;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.training_plan;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.training_plan;$statement$;
    execute $statement$alter table public.training_plan enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.training_plan as restrictive for select to authenticated using (public.user_access_allowed('training','view'));$statement$;
    execute $statement$create policy user_module_create on public.training_plan as restrictive for insert to authenticated with check (public.user_access_allowed('training','create'));$statement$;
    execute $statement$create policy user_module_edit on public.training_plan as restrictive for update to authenticated using (public.user_access_allowed('training','edit')) with check (public.user_access_allowed('training','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.training_plan as restrictive for delete to authenticated using (public.user_access_allowed('training','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.training_plan for each row execute function public.guard_module_user_access('training');$statement$;
  else
    raise notice 'Skipping unavailable table public.training_plan';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_measurements') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_measurements;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_measurements;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_measurements;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_measurements;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_measurements;$statement$;
    execute $statement$alter table public.noise_measurements enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_measurements as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_measurements as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_measurements as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_measurements as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_measurements for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_measurements';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_surveys') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_surveys;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_surveys;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_surveys;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_surveys;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_surveys;$statement$;
    execute $statement$alter table public.noise_surveys enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_surveys as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_surveys as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_surveys as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_surveys as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_surveys for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_surveys';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_mgmt_assessment_profiles') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_mgmt_assessment_profiles;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_mgmt_assessment_profiles;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_mgmt_assessment_profiles;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_mgmt_assessment_profiles;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_mgmt_assessment_profiles;$statement$;
    execute $statement$alter table public.noise_mgmt_assessment_profiles enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_mgmt_assessment_profiles as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_mgmt_assessment_profiles as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_mgmt_assessment_profiles as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_mgmt_assessment_profiles as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_mgmt_assessment_profiles for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_mgmt_assessment_profiles';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_mgmt_control_plans') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_mgmt_control_plans;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_mgmt_control_plans;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_mgmt_control_plans;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_mgmt_control_plans;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_mgmt_control_plans;$statement$;
    execute $statement$alter table public.noise_mgmt_control_plans enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_mgmt_control_plans as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_mgmt_control_plans as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_mgmt_control_plans as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_mgmt_control_plans as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_mgmt_control_plans for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_mgmt_control_plans';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_mgmt_exposure_assessments') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_mgmt_exposure_assessments;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_mgmt_exposure_assessments;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_mgmt_exposure_assessments;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_mgmt_exposure_assessments;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_mgmt_exposure_assessments;$statement$;
    execute $statement$alter table public.noise_mgmt_exposure_assessments enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_mgmt_exposure_assessments as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_mgmt_exposure_assessments as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_mgmt_exposure_assessments as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_mgmt_exposure_assessments as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_mgmt_exposure_assessments for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_mgmt_exposure_assessments';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_mgmt_field_surveys') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_mgmt_field_surveys;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_mgmt_field_surveys;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_mgmt_field_surveys;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_mgmt_field_surveys;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_mgmt_field_surveys;$statement$;
    execute $statement$alter table public.noise_mgmt_field_surveys enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_mgmt_field_surveys as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_mgmt_field_surveys as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_mgmt_field_surveys as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_mgmt_field_surveys as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_mgmt_field_surveys for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_mgmt_field_surveys';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_mgmt_health_statuses') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_mgmt_health_statuses;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_mgmt_health_statuses;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_mgmt_health_statuses;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_mgmt_health_statuses;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_mgmt_health_statuses;$statement$;
    execute $statement$alter table public.noise_mgmt_health_statuses enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_mgmt_health_statuses as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_mgmt_health_statuses as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_mgmt_health_statuses as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_mgmt_health_statuses as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_mgmt_health_statuses for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_mgmt_health_statuses';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_mgmt_hearing_protectors') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_mgmt_hearing_protectors;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_mgmt_hearing_protectors;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_mgmt_hearing_protectors;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_mgmt_hearing_protectors;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_mgmt_hearing_protectors;$statement$;
    execute $statement$alter table public.noise_mgmt_hearing_protectors enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_mgmt_hearing_protectors as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_mgmt_hearing_protectors as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_mgmt_hearing_protectors as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_mgmt_hearing_protectors as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_mgmt_hearing_protectors for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_mgmt_hearing_protectors';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_mgmt_instruments') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_mgmt_instruments;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_mgmt_instruments;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_mgmt_instruments;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_mgmt_instruments;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_mgmt_instruments;$statement$;
    execute $statement$alter table public.noise_mgmt_instruments enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_mgmt_instruments as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_mgmt_instruments as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_mgmt_instruments as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_mgmt_instruments as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_mgmt_instruments for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_mgmt_instruments';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_mgmt_maps') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_mgmt_maps;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_mgmt_maps;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_mgmt_maps;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_mgmt_maps;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_mgmt_maps;$statement$;
    execute $statement$alter table public.noise_mgmt_maps enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_mgmt_maps as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_mgmt_maps as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_mgmt_maps as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_mgmt_maps as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_mgmt_maps for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_mgmt_maps';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_mgmt_measurement_plans') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_mgmt_measurement_plans;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_mgmt_measurement_plans;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_mgmt_measurement_plans;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_mgmt_measurement_plans;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_mgmt_measurement_plans;$statement$;
    execute $statement$alter table public.noise_mgmt_measurement_plans enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_mgmt_measurement_plans as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_mgmt_measurement_plans as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_mgmt_measurement_plans as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_mgmt_measurement_plans as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_mgmt_measurement_plans for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_mgmt_measurement_plans';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_mgmt_measurements') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_mgmt_measurements;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_mgmt_measurements;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_mgmt_measurements;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_mgmt_measurements;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_mgmt_measurements;$statement$;
    execute $statement$alter table public.noise_mgmt_measurements enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_mgmt_measurements as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_mgmt_measurements as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_mgmt_measurements as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_mgmt_measurements as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_mgmt_measurements for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_mgmt_measurements';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_mgmt_programmes') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_mgmt_programmes;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_mgmt_programmes;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_mgmt_programmes;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_mgmt_programmes;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_mgmt_programmes;$statement$;
    execute $statement$alter table public.noise_mgmt_programmes enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_mgmt_programmes as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_mgmt_programmes as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_mgmt_programmes as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_mgmt_programmes as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_mgmt_programmes for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_mgmt_programmes';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_mgmt_reports') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_mgmt_reports;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_mgmt_reports;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_mgmt_reports;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_mgmt_reports;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_mgmt_reports;$statement$;
    execute $statement$alter table public.noise_mgmt_reports enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_mgmt_reports as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_mgmt_reports as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_mgmt_reports as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_mgmt_reports as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_mgmt_reports for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_mgmt_reports';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_mgmt_segs') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_mgmt_segs;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_mgmt_segs;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_mgmt_segs;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_mgmt_segs;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_mgmt_segs;$statement$;
    execute $statement$alter table public.noise_mgmt_segs enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_mgmt_segs as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_mgmt_segs as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_mgmt_segs as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_mgmt_segs as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_mgmt_segs for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_mgmt_segs';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_mgmt_sources') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_mgmt_sources;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_mgmt_sources;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_mgmt_sources;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_mgmt_sources;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_mgmt_sources;$statement$;
    execute $statement$alter table public.noise_mgmt_sources enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_mgmt_sources as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_mgmt_sources as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_mgmt_sources as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_mgmt_sources as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_mgmt_sources for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_mgmt_sources';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.noise_mgmt_tasks') is not null then
    execute $statement$drop policy if exists user_module_view on public.noise_mgmt_tasks;$statement$;
    execute $statement$drop policy if exists user_module_create on public.noise_mgmt_tasks;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.noise_mgmt_tasks;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.noise_mgmt_tasks;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.noise_mgmt_tasks;$statement$;
    execute $statement$alter table public.noise_mgmt_tasks enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.noise_mgmt_tasks as restrictive for select to authenticated using (public.user_access_allowed('noise','view'));$statement$;
    execute $statement$create policy user_module_create on public.noise_mgmt_tasks as restrictive for insert to authenticated with check (public.user_access_allowed('noise','create'));$statement$;
    execute $statement$create policy user_module_edit on public.noise_mgmt_tasks as restrictive for update to authenticated using (public.user_access_allowed('noise','edit')) with check (public.user_access_allowed('noise','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.noise_mgmt_tasks as restrictive for delete to authenticated using (public.user_access_allowed('noise','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.noise_mgmt_tasks for each row execute function public.guard_module_user_access('noise');$statement$;
  else
    raise notice 'Skipping unavailable table public.noise_mgmt_tasks';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.master_data_records') is not null then
    execute $statement$drop policy if exists user_module_view on public.master_data_records;$statement$;
    execute $statement$drop policy if exists user_module_create on public.master_data_records;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.master_data_records;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.master_data_records;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.master_data_records;$statement$;
    execute $statement$alter table public.master_data_records enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.master_data_records as restrictive for select to authenticated using (public.user_access_allowed('master-data','view'));$statement$;
    execute $statement$create policy user_module_create on public.master_data_records as restrictive for insert to authenticated with check (public.user_access_allowed('master-data','create'));$statement$;
    execute $statement$create policy user_module_edit on public.master_data_records as restrictive for update to authenticated using (public.user_access_allowed('master-data','edit')) with check (public.user_access_allowed('master-data','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.master_data_records as restrictive for delete to authenticated using (public.user_access_allowed('master-data','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.master_data_records for each row execute function public.guard_module_user_access('master-data');$statement$;
  else
    raise notice 'Skipping unavailable table public.master_data_records';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.master_data_revisions') is not null then
    execute $statement$drop policy if exists user_module_view on public.master_data_revisions;$statement$;
    execute $statement$drop policy if exists user_module_create on public.master_data_revisions;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.master_data_revisions;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.master_data_revisions;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.master_data_revisions;$statement$;
    execute $statement$alter table public.master_data_revisions enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.master_data_revisions as restrictive for select to authenticated using (public.user_access_allowed('master-data','view'));$statement$;
    execute $statement$create policy user_module_create on public.master_data_revisions as restrictive for insert to authenticated with check (public.user_access_allowed('master-data','create'));$statement$;
    execute $statement$create policy user_module_edit on public.master_data_revisions as restrictive for update to authenticated using (public.user_access_allowed('master-data','edit')) with check (public.user_access_allowed('master-data','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.master_data_revisions as restrictive for delete to authenticated using (public.user_access_allowed('master-data','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.master_data_revisions for each row execute function public.guard_module_user_access('master-data');$statement$;
  else
    raise notice 'Skipping unavailable table public.master_data_revisions';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.master_data_dependencies') is not null then
    execute $statement$drop policy if exists user_module_view on public.master_data_dependencies;$statement$;
    execute $statement$drop policy if exists user_module_create on public.master_data_dependencies;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.master_data_dependencies;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.master_data_dependencies;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.master_data_dependencies;$statement$;
    execute $statement$alter table public.master_data_dependencies enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.master_data_dependencies as restrictive for select to authenticated using (public.user_access_allowed('master-data','view'));$statement$;
    execute $statement$create policy user_module_create on public.master_data_dependencies as restrictive for insert to authenticated with check (public.user_access_allowed('master-data','create'));$statement$;
    execute $statement$create policy user_module_edit on public.master_data_dependencies as restrictive for update to authenticated using (public.user_access_allowed('master-data','edit')) with check (public.user_access_allowed('master-data','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.master_data_dependencies as restrictive for delete to authenticated using (public.user_access_allowed('master-data','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.master_data_dependencies for each row execute function public.guard_module_user_access('master-data');$statement$;
  else
    raise notice 'Skipping unavailable table public.master_data_dependencies';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.master_data_import_batches') is not null then
    execute $statement$drop policy if exists user_module_view on public.master_data_import_batches;$statement$;
    execute $statement$drop policy if exists user_module_create on public.master_data_import_batches;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.master_data_import_batches;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.master_data_import_batches;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.master_data_import_batches;$statement$;
    execute $statement$alter table public.master_data_import_batches enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.master_data_import_batches as restrictive for select to authenticated using (public.user_access_allowed('master-data','view'));$statement$;
    execute $statement$create policy user_module_create on public.master_data_import_batches as restrictive for insert to authenticated with check (public.user_access_allowed('master-data','create'));$statement$;
    execute $statement$create policy user_module_edit on public.master_data_import_batches as restrictive for update to authenticated using (public.user_access_allowed('master-data','edit')) with check (public.user_access_allowed('master-data','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.master_data_import_batches as restrictive for delete to authenticated using (public.user_access_allowed('master-data','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.master_data_import_batches for each row execute function public.guard_module_user_access('master-data');$statement$;
  else
    raise notice 'Skipping unavailable table public.master_data_import_batches';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.master_data_import_rows') is not null then
    execute $statement$drop policy if exists user_module_view on public.master_data_import_rows;$statement$;
    execute $statement$drop policy if exists user_module_create on public.master_data_import_rows;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.master_data_import_rows;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.master_data_import_rows;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.master_data_import_rows;$statement$;
    execute $statement$alter table public.master_data_import_rows enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.master_data_import_rows as restrictive for select to authenticated using (public.user_access_allowed('master-data','view'));$statement$;
    execute $statement$create policy user_module_create on public.master_data_import_rows as restrictive for insert to authenticated with check (public.user_access_allowed('master-data','create'));$statement$;
    execute $statement$create policy user_module_edit on public.master_data_import_rows as restrictive for update to authenticated using (public.user_access_allowed('master-data','edit')) with check (public.user_access_allowed('master-data','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.master_data_import_rows as restrictive for delete to authenticated using (public.user_access_allowed('master-data','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.master_data_import_rows for each row execute function public.guard_module_user_access('master-data');$statement$;
  else
    raise notice 'Skipping unavailable table public.master_data_import_rows';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.medical_surveillance') is not null then
    execute $statement$drop policy if exists user_module_view on public.medical_surveillance;$statement$;
    execute $statement$drop policy if exists user_module_create on public.medical_surveillance;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.medical_surveillance;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.medical_surveillance;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.medical_surveillance;$statement$;
    execute $statement$alter table public.medical_surveillance enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.medical_surveillance as restrictive for select to authenticated using (public.user_access_allowed('ohealth','view'));$statement$;
    execute $statement$create policy user_module_create on public.medical_surveillance as restrictive for insert to authenticated with check (public.user_access_allowed('ohealth','create'));$statement$;
    execute $statement$create policy user_module_edit on public.medical_surveillance as restrictive for update to authenticated using (public.user_access_allowed('ohealth','edit')) with check (public.user_access_allowed('ohealth','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.medical_surveillance as restrictive for delete to authenticated using (public.user_access_allowed('ohealth','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.medical_surveillance for each row execute function public.guard_module_user_access('ohealth');$statement$;
  else
    raise notice 'Skipping unavailable table public.medical_surveillance';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.occupational_diseases') is not null then
    execute $statement$drop policy if exists user_module_view on public.occupational_diseases;$statement$;
    execute $statement$drop policy if exists user_module_create on public.occupational_diseases;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.occupational_diseases;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.occupational_diseases;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.occupational_diseases;$statement$;
    execute $statement$alter table public.occupational_diseases enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.occupational_diseases as restrictive for select to authenticated using (public.user_access_allowed('ohealth','view'));$statement$;
    execute $statement$create policy user_module_create on public.occupational_diseases as restrictive for insert to authenticated with check (public.user_access_allowed('ohealth','create'));$statement$;
    execute $statement$create policy user_module_edit on public.occupational_diseases as restrictive for update to authenticated using (public.user_access_allowed('ohealth','edit')) with check (public.user_access_allowed('ohealth','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.occupational_diseases as restrictive for delete to authenticated using (public.user_access_allowed('ohealth','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.occupational_diseases for each row execute function public.guard_module_user_access('ohealth');$statement$;
  else
    raise notice 'Skipping unavailable table public.occupational_diseases';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.audiometry_records') is not null then
    execute $statement$drop policy if exists user_module_view on public.audiometry_records;$statement$;
    execute $statement$drop policy if exists user_module_create on public.audiometry_records;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.audiometry_records;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.audiometry_records;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.audiometry_records;$statement$;
    execute $statement$alter table public.audiometry_records enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.audiometry_records as restrictive for select to authenticated using (public.user_access_allowed('ohealth','view'));$statement$;
    execute $statement$create policy user_module_create on public.audiometry_records as restrictive for insert to authenticated with check (public.user_access_allowed('ohealth','create'));$statement$;
    execute $statement$create policy user_module_edit on public.audiometry_records as restrictive for update to authenticated using (public.user_access_allowed('ohealth','edit')) with check (public.user_access_allowed('ohealth','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.audiometry_records as restrictive for delete to authenticated using (public.user_access_allowed('ohealth','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.audiometry_records for each row execute function public.guard_module_user_access('ohealth');$statement$;
  else
    raise notice 'Skipping unavailable table public.audiometry_records';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.exposure_monitoring') is not null then
    execute $statement$drop policy if exists user_module_view on public.exposure_monitoring;$statement$;
    execute $statement$drop policy if exists user_module_create on public.exposure_monitoring;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.exposure_monitoring;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.exposure_monitoring;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.exposure_monitoring;$statement$;
    execute $statement$alter table public.exposure_monitoring enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.exposure_monitoring as restrictive for select to authenticated using (public.user_access_allowed('ohealth','view'));$statement$;
    execute $statement$create policy user_module_create on public.exposure_monitoring as restrictive for insert to authenticated with check (public.user_access_allowed('ohealth','create'));$statement$;
    execute $statement$create policy user_module_edit on public.exposure_monitoring as restrictive for update to authenticated using (public.user_access_allowed('ohealth','edit')) with check (public.user_access_allowed('ohealth','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.exposure_monitoring as restrictive for delete to authenticated using (public.user_access_allowed('ohealth','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.exposure_monitoring for each row execute function public.guard_module_user_access('ohealth');$statement$;
  else
    raise notice 'Skipping unavailable table public.exposure_monitoring';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.esg_targets') is not null then
    execute $statement$drop policy if exists user_module_view on public.esg_targets;$statement$;
    execute $statement$drop policy if exists user_module_create on public.esg_targets;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.esg_targets;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.esg_targets;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.esg_targets;$statement$;
    execute $statement$alter table public.esg_targets enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.esg_targets as restrictive for select to authenticated using (public.user_access_allowed('esg','view'));$statement$;
    execute $statement$create policy user_module_create on public.esg_targets as restrictive for insert to authenticated with check (public.user_access_allowed('esg','create'));$statement$;
    execute $statement$create policy user_module_edit on public.esg_targets as restrictive for update to authenticated using (public.user_access_allowed('esg','edit')) with check (public.user_access_allowed('esg','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.esg_targets as restrictive for delete to authenticated using (public.user_access_allowed('esg','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.esg_targets for each row execute function public.guard_module_user_access('esg');$statement$;
  else
    raise notice 'Skipping unavailable table public.esg_targets';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.environmental_inspections') is not null then
    execute $statement$drop policy if exists user_module_view on public.environmental_inspections;$statement$;
    execute $statement$drop policy if exists user_module_create on public.environmental_inspections;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.environmental_inspections;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.environmental_inspections;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.environmental_inspections;$statement$;
    execute $statement$alter table public.environmental_inspections enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.environmental_inspections as restrictive for select to authenticated using (public.user_access_allowed('esg','view'));$statement$;
    execute $statement$create policy user_module_create on public.environmental_inspections as restrictive for insert to authenticated with check (public.user_access_allowed('esg','create'));$statement$;
    execute $statement$create policy user_module_edit on public.environmental_inspections as restrictive for update to authenticated using (public.user_access_allowed('esg','edit')) with check (public.user_access_allowed('esg','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.environmental_inspections as restrictive for delete to authenticated using (public.user_access_allowed('esg','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.environmental_inspections for each row execute function public.guard_module_user_access('esg');$statement$;
  else
    raise notice 'Skipping unavailable table public.environmental_inspections';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.hazardous_waste') is not null then
    execute $statement$drop policy if exists user_module_view on public.hazardous_waste;$statement$;
    execute $statement$drop policy if exists user_module_create on public.hazardous_waste;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.hazardous_waste;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.hazardous_waste;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.hazardous_waste;$statement$;
    execute $statement$alter table public.hazardous_waste enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.hazardous_waste as restrictive for select to authenticated using (public.user_access_allowed('esg','view'));$statement$;
    execute $statement$create policy user_module_create on public.hazardous_waste as restrictive for insert to authenticated with check (public.user_access_allowed('esg','create'));$statement$;
    execute $statement$create policy user_module_edit on public.hazardous_waste as restrictive for update to authenticated using (public.user_access_allowed('esg','edit')) with check (public.user_access_allowed('esg','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.hazardous_waste as restrictive for delete to authenticated using (public.user_access_allowed('esg','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.hazardous_waste for each row execute function public.guard_module_user_access('esg');$statement$;
  else
    raise notice 'Skipping unavailable table public.hazardous_waste';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.waste_records') is not null then
    execute $statement$drop policy if exists user_module_view on public.waste_records;$statement$;
    execute $statement$drop policy if exists user_module_create on public.waste_records;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.waste_records;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.waste_records;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.waste_records;$statement$;
    execute $statement$alter table public.waste_records enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.waste_records as restrictive for select to authenticated using (public.user_access_allowed('esg','view'));$statement$;
    execute $statement$create policy user_module_create on public.waste_records as restrictive for insert to authenticated with check (public.user_access_allowed('esg','create'));$statement$;
    execute $statement$create policy user_module_edit on public.waste_records as restrictive for update to authenticated using (public.user_access_allowed('esg','edit')) with check (public.user_access_allowed('esg','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.waste_records as restrictive for delete to authenticated using (public.user_access_allowed('esg','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.waste_records for each row execute function public.guard_module_user_access('esg');$statement$;
  else
    raise notice 'Skipping unavailable table public.waste_records';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.water_usage') is not null then
    execute $statement$drop policy if exists user_module_view on public.water_usage;$statement$;
    execute $statement$drop policy if exists user_module_create on public.water_usage;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.water_usage;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.water_usage;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.water_usage;$statement$;
    execute $statement$alter table public.water_usage enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.water_usage as restrictive for select to authenticated using (public.user_access_allowed('esg','view'));$statement$;
    execute $statement$create policy user_module_create on public.water_usage as restrictive for insert to authenticated with check (public.user_access_allowed('esg','create'));$statement$;
    execute $statement$create policy user_module_edit on public.water_usage as restrictive for update to authenticated using (public.user_access_allowed('esg','edit')) with check (public.user_access_allowed('esg','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.water_usage as restrictive for delete to authenticated using (public.user_access_allowed('esg','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.water_usage for each row execute function public.guard_module_user_access('esg');$statement$;
  else
    raise notice 'Skipping unavailable table public.water_usage';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.legal_register') is not null then
    execute $statement$drop policy if exists user_module_view on public.legal_register;$statement$;
    execute $statement$drop policy if exists user_module_create on public.legal_register;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.legal_register;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.legal_register;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.legal_register;$statement$;
    execute $statement$alter table public.legal_register enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.legal_register as restrictive for select to authenticated using (public.user_access_allowed('legal','view'));$statement$;
    execute $statement$create policy user_module_create on public.legal_register as restrictive for insert to authenticated with check (public.user_access_allowed('legal','create'));$statement$;
    execute $statement$create policy user_module_edit on public.legal_register as restrictive for update to authenticated using (public.user_access_allowed('legal','edit')) with check (public.user_access_allowed('legal','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.legal_register as restrictive for delete to authenticated using (public.user_access_allowed('legal','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.legal_register for each row execute function public.guard_module_user_access('legal');$statement$;
  else
    raise notice 'Skipping unavailable table public.legal_register';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.legal_requirements') is not null then
    execute $statement$drop policy if exists user_module_view on public.legal_requirements;$statement$;
    execute $statement$drop policy if exists user_module_create on public.legal_requirements;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.legal_requirements;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.legal_requirements;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.legal_requirements;$statement$;
    execute $statement$alter table public.legal_requirements enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.legal_requirements as restrictive for select to authenticated using (public.user_access_allowed('legal','view'));$statement$;
    execute $statement$create policy user_module_create on public.legal_requirements as restrictive for insert to authenticated with check (public.user_access_allowed('legal','create'));$statement$;
    execute $statement$create policy user_module_edit on public.legal_requirements as restrictive for update to authenticated using (public.user_access_allowed('legal','edit')) with check (public.user_access_allowed('legal','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.legal_requirements as restrictive for delete to authenticated using (public.user_access_allowed('legal','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.legal_requirements for each row execute function public.guard_module_user_access('legal');$statement$;
  else
    raise notice 'Skipping unavailable table public.legal_requirements';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.legal_changes') is not null then
    execute $statement$drop policy if exists user_module_view on public.legal_changes;$statement$;
    execute $statement$drop policy if exists user_module_create on public.legal_changes;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.legal_changes;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.legal_changes;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.legal_changes;$statement$;
    execute $statement$alter table public.legal_changes enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.legal_changes as restrictive for select to authenticated using (public.user_access_allowed('legal','view'));$statement$;
    execute $statement$create policy user_module_create on public.legal_changes as restrictive for insert to authenticated with check (public.user_access_allowed('legal','create'));$statement$;
    execute $statement$create policy user_module_edit on public.legal_changes as restrictive for update to authenticated using (public.user_access_allowed('legal','edit')) with check (public.user_access_allowed('legal','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.legal_changes as restrictive for delete to authenticated using (public.user_access_allowed('legal','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.legal_changes for each row execute function public.guard_module_user_access('legal');$statement$;
  else
    raise notice 'Skipping unavailable table public.legal_changes';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.legislative_changes') is not null then
    execute $statement$drop policy if exists user_module_view on public.legislative_changes;$statement$;
    execute $statement$drop policy if exists user_module_create on public.legislative_changes;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.legislative_changes;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.legislative_changes;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.legislative_changes;$statement$;
    execute $statement$alter table public.legislative_changes enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.legislative_changes as restrictive for select to authenticated using (public.user_access_allowed('legal','view'));$statement$;
    execute $statement$create policy user_module_create on public.legislative_changes as restrictive for insert to authenticated with check (public.user_access_allowed('legal','create'));$statement$;
    execute $statement$create policy user_module_edit on public.legislative_changes as restrictive for update to authenticated using (public.user_access_allowed('legal','edit')) with check (public.user_access_allowed('legal','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.legislative_changes as restrictive for delete to authenticated using (public.user_access_allowed('legal','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.legislative_changes for each row execute function public.guard_module_user_access('legal');$statement$;
  else
    raise notice 'Skipping unavailable table public.legislative_changes';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.legal_compliance_records') is not null then
    execute $statement$drop policy if exists user_module_view on public.legal_compliance_records;$statement$;
    execute $statement$drop policy if exists user_module_create on public.legal_compliance_records;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.legal_compliance_records;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.legal_compliance_records;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.legal_compliance_records;$statement$;
    execute $statement$alter table public.legal_compliance_records enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.legal_compliance_records as restrictive for select to authenticated using (public.user_access_allowed('legal','view'));$statement$;
    execute $statement$create policy user_module_create on public.legal_compliance_records as restrictive for insert to authenticated with check (public.user_access_allowed('legal','create'));$statement$;
    execute $statement$create policy user_module_edit on public.legal_compliance_records as restrictive for update to authenticated using (public.user_access_allowed('legal','edit')) with check (public.user_access_allowed('legal','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.legal_compliance_records as restrictive for delete to authenticated using (public.user_access_allowed('legal','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.legal_compliance_records for each row execute function public.guard_module_user_access('legal');$statement$;
  else
    raise notice 'Skipping unavailable table public.legal_compliance_records';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.legal_compliance_relationships') is not null then
    execute $statement$drop policy if exists user_module_view on public.legal_compliance_relationships;$statement$;
    execute $statement$drop policy if exists user_module_create on public.legal_compliance_relationships;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.legal_compliance_relationships;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.legal_compliance_relationships;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.legal_compliance_relationships;$statement$;
    execute $statement$alter table public.legal_compliance_relationships enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.legal_compliance_relationships as restrictive for select to authenticated using (public.user_access_allowed('legal','view'));$statement$;
    execute $statement$create policy user_module_create on public.legal_compliance_relationships as restrictive for insert to authenticated with check (public.user_access_allowed('legal','create'));$statement$;
    execute $statement$create policy user_module_edit on public.legal_compliance_relationships as restrictive for update to authenticated using (public.user_access_allowed('legal','edit')) with check (public.user_access_allowed('legal','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.legal_compliance_relationships as restrictive for delete to authenticated using (public.user_access_allowed('legal','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.legal_compliance_relationships for each row execute function public.guard_module_user_access('legal');$statement$;
  else
    raise notice 'Skipping unavailable table public.legal_compliance_relationships';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.compliance_assessments') is not null then
    execute $statement$drop policy if exists user_module_view on public.compliance_assessments;$statement$;
    execute $statement$drop policy if exists user_module_create on public.compliance_assessments;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.compliance_assessments;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.compliance_assessments;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.compliance_assessments;$statement$;
    execute $statement$alter table public.compliance_assessments enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.compliance_assessments as restrictive for select to authenticated using (public.user_access_allowed('legal','view'));$statement$;
    execute $statement$create policy user_module_create on public.compliance_assessments as restrictive for insert to authenticated with check (public.user_access_allowed('legal','create'));$statement$;
    execute $statement$create policy user_module_edit on public.compliance_assessments as restrictive for update to authenticated using (public.user_access_allowed('legal','edit')) with check (public.user_access_allowed('legal','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.compliance_assessments as restrictive for delete to authenticated using (public.user_access_allowed('legal','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.compliance_assessments for each row execute function public.guard_module_user_access('legal');$statement$;
  else
    raise notice 'Skipping unavailable table public.compliance_assessments';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.compliance_audits') is not null then
    execute $statement$drop policy if exists user_module_view on public.compliance_audits;$statement$;
    execute $statement$drop policy if exists user_module_create on public.compliance_audits;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.compliance_audits;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.compliance_audits;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.compliance_audits;$statement$;
    execute $statement$alter table public.compliance_audits enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.compliance_audits as restrictive for select to authenticated using (public.user_access_allowed('legal','view'));$statement$;
    execute $statement$create policy user_module_create on public.compliance_audits as restrictive for insert to authenticated with check (public.user_access_allowed('legal','create'));$statement$;
    execute $statement$create policy user_module_edit on public.compliance_audits as restrictive for update to authenticated using (public.user_access_allowed('legal','edit')) with check (public.user_access_allowed('legal','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.compliance_audits as restrictive for delete to authenticated using (public.user_access_allowed('legal','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.compliance_audits for each row execute function public.guard_module_user_access('legal');$statement$;
  else
    raise notice 'Skipping unavailable table public.compliance_audits';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.compliance_calendar') is not null then
    execute $statement$drop policy if exists user_module_view on public.compliance_calendar;$statement$;
    execute $statement$drop policy if exists user_module_create on public.compliance_calendar;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.compliance_calendar;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.compliance_calendar;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.compliance_calendar;$statement$;
    execute $statement$alter table public.compliance_calendar enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.compliance_calendar as restrictive for select to authenticated using (public.user_access_allowed('legal','view'));$statement$;
    execute $statement$create policy user_module_create on public.compliance_calendar as restrictive for insert to authenticated with check (public.user_access_allowed('legal','create'));$statement$;
    execute $statement$create policy user_module_edit on public.compliance_calendar as restrictive for update to authenticated using (public.user_access_allowed('legal','edit')) with check (public.user_access_allowed('legal','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.compliance_calendar as restrictive for delete to authenticated using (public.user_access_allowed('legal','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.compliance_calendar for each row execute function public.guard_module_user_access('legal');$statement$;
  else
    raise notice 'Skipping unavailable table public.compliance_calendar';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.compliance_gaps') is not null then
    execute $statement$drop policy if exists user_module_view on public.compliance_gaps;$statement$;
    execute $statement$drop policy if exists user_module_create on public.compliance_gaps;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.compliance_gaps;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.compliance_gaps;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.compliance_gaps;$statement$;
    execute $statement$alter table public.compliance_gaps enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.compliance_gaps as restrictive for select to authenticated using (public.user_access_allowed('legal','view'));$statement$;
    execute $statement$create policy user_module_create on public.compliance_gaps as restrictive for insert to authenticated with check (public.user_access_allowed('legal','create'));$statement$;
    execute $statement$create policy user_module_edit on public.compliance_gaps as restrictive for update to authenticated using (public.user_access_allowed('legal','edit')) with check (public.user_access_allowed('legal','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.compliance_gaps as restrictive for delete to authenticated using (public.user_access_allowed('legal','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.compliance_gaps for each row execute function public.guard_module_user_access('legal');$statement$;
  else
    raise notice 'Skipping unavailable table public.compliance_gaps';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.sop_documents') is not null then
    execute $statement$drop policy if exists user_module_view on public.sop_documents;$statement$;
    execute $statement$drop policy if exists user_module_create on public.sop_documents;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.sop_documents;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.sop_documents;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.sop_documents;$statement$;
    execute $statement$alter table public.sop_documents enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.sop_documents as restrictive for select to authenticated using (public.user_access_allowed('sop','view'));$statement$;
    execute $statement$create policy user_module_create on public.sop_documents as restrictive for insert to authenticated with check (public.user_access_allowed('sop','create'));$statement$;
    execute $statement$create policy user_module_edit on public.sop_documents as restrictive for update to authenticated using (public.user_access_allowed('sop','edit')) with check (public.user_access_allowed('sop','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.sop_documents as restrictive for delete to authenticated using (public.user_access_allowed('sop','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.sop_documents for each row execute function public.guard_module_user_access('sop');$statement$;
  else
    raise notice 'Skipping unavailable table public.sop_documents';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.sop_video_evidence') is not null then
    execute $statement$drop policy if exists user_module_view on public.sop_video_evidence;$statement$;
    execute $statement$drop policy if exists user_module_create on public.sop_video_evidence;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.sop_video_evidence;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.sop_video_evidence;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.sop_video_evidence;$statement$;
    execute $statement$alter table public.sop_video_evidence enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.sop_video_evidence as restrictive for select to authenticated using (public.user_access_allowed('sop','view'));$statement$;
    execute $statement$create policy user_module_create on public.sop_video_evidence as restrictive for insert to authenticated with check (public.user_access_allowed('sop','create'));$statement$;
    execute $statement$create policy user_module_edit on public.sop_video_evidence as restrictive for update to authenticated using (public.user_access_allowed('sop','edit')) with check (public.user_access_allowed('sop','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.sop_video_evidence as restrictive for delete to authenticated using (public.user_access_allowed('sop','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.sop_video_evidence for each row execute function public.guard_module_user_access('sop');$statement$;
  else
    raise notice 'Skipping unavailable table public.sop_video_evidence';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.sop_video_projects') is not null then
    execute $statement$drop policy if exists user_module_view on public.sop_video_projects;$statement$;
    execute $statement$drop policy if exists user_module_create on public.sop_video_projects;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.sop_video_projects;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.sop_video_projects;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.sop_video_projects;$statement$;
    execute $statement$alter table public.sop_video_projects enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.sop_video_projects as restrictive for select to authenticated using (public.user_access_allowed('sop','view'));$statement$;
    execute $statement$create policy user_module_create on public.sop_video_projects as restrictive for insert to authenticated with check (public.user_access_allowed('sop','create'));$statement$;
    execute $statement$create policy user_module_edit on public.sop_video_projects as restrictive for update to authenticated using (public.user_access_allowed('sop','edit')) with check (public.user_access_allowed('sop','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.sop_video_projects as restrictive for delete to authenticated using (public.user_access_allowed('sop','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.sop_video_projects for each row execute function public.guard_module_user_access('sop');$statement$;
  else
    raise notice 'Skipping unavailable table public.sop_video_projects';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.sop_video_relationships') is not null then
    execute $statement$drop policy if exists user_module_view on public.sop_video_relationships;$statement$;
    execute $statement$drop policy if exists user_module_create on public.sop_video_relationships;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.sop_video_relationships;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.sop_video_relationships;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.sop_video_relationships;$statement$;
    execute $statement$alter table public.sop_video_relationships enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.sop_video_relationships as restrictive for select to authenticated using (public.user_access_allowed('sop','view'));$statement$;
    execute $statement$create policy user_module_create on public.sop_video_relationships as restrictive for insert to authenticated with check (public.user_access_allowed('sop','create'));$statement$;
    execute $statement$create policy user_module_edit on public.sop_video_relationships as restrictive for update to authenticated using (public.user_access_allowed('sop','edit')) with check (public.user_access_allowed('sop','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.sop_video_relationships as restrictive for delete to authenticated using (public.user_access_allowed('sop','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.sop_video_relationships for each row execute function public.guard_module_user_access('sop');$statement$;
  else
    raise notice 'Skipping unavailable table public.sop_video_relationships';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.swms_configuration_versions') is not null then
    execute $statement$drop policy if exists user_module_view on public.swms_configuration_versions;$statement$;
    execute $statement$drop policy if exists user_module_create on public.swms_configuration_versions;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.swms_configuration_versions;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.swms_configuration_versions;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.swms_configuration_versions;$statement$;
    execute $statement$alter table public.swms_configuration_versions enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.swms_configuration_versions as restrictive for select to authenticated using (public.user_access_allowed('swms','view'));$statement$;
    execute $statement$create policy user_module_create on public.swms_configuration_versions as restrictive for insert to authenticated with check (public.user_access_allowed('swms','create'));$statement$;
    execute $statement$create policy user_module_edit on public.swms_configuration_versions as restrictive for update to authenticated using (public.user_access_allowed('swms','edit')) with check (public.user_access_allowed('swms','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.swms_configuration_versions as restrictive for delete to authenticated using (public.user_access_allowed('swms','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.swms_configuration_versions for each row execute function public.guard_module_user_access('swms');$statement$;
  else
    raise notice 'Skipping unavailable table public.swms_configuration_versions';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.swms_operational_records') is not null then
    execute $statement$drop policy if exists user_module_view on public.swms_operational_records;$statement$;
    execute $statement$drop policy if exists user_module_create on public.swms_operational_records;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.swms_operational_records;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.swms_operational_records;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.swms_operational_records;$statement$;
    execute $statement$alter table public.swms_operational_records enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.swms_operational_records as restrictive for select to authenticated using (public.user_access_allowed('swms','view'));$statement$;
    execute $statement$create policy user_module_create on public.swms_operational_records as restrictive for insert to authenticated with check (public.user_access_allowed('swms','create'));$statement$;
    execute $statement$create policy user_module_edit on public.swms_operational_records as restrictive for update to authenticated using (public.user_access_allowed('swms','edit')) with check (public.user_access_allowed('swms','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.swms_operational_records as restrictive for delete to authenticated using (public.user_access_allowed('swms','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.swms_operational_records for each row execute function public.guard_module_user_access('swms');$statement$;
  else
    raise notice 'Skipping unavailable table public.swms_operational_records';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.swms_relationships') is not null then
    execute $statement$drop policy if exists user_module_view on public.swms_relationships;$statement$;
    execute $statement$drop policy if exists user_module_create on public.swms_relationships;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.swms_relationships;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.swms_relationships;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.swms_relationships;$statement$;
    execute $statement$alter table public.swms_relationships enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.swms_relationships as restrictive for select to authenticated using (public.user_access_allowed('swms','view'));$statement$;
    execute $statement$create policy user_module_create on public.swms_relationships as restrictive for insert to authenticated with check (public.user_access_allowed('swms','create'));$statement$;
    execute $statement$create policy user_module_edit on public.swms_relationships as restrictive for update to authenticated using (public.user_access_allowed('swms','edit')) with check (public.user_access_allowed('swms','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.swms_relationships as restrictive for delete to authenticated using (public.user_access_allowed('swms','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.swms_relationships for each row execute function public.guard_module_user_access('swms');$statement$;
  else
    raise notice 'Skipping unavailable table public.swms_relationships';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.moc_change_requests') is not null then
    execute $statement$drop policy if exists user_module_view on public.moc_change_requests;$statement$;
    execute $statement$drop policy if exists user_module_create on public.moc_change_requests;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.moc_change_requests;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.moc_change_requests;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.moc_change_requests;$statement$;
    execute $statement$alter table public.moc_change_requests enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.moc_change_requests as restrictive for select to authenticated using (public.user_access_allowed('moc','view'));$statement$;
    execute $statement$create policy user_module_create on public.moc_change_requests as restrictive for insert to authenticated with check (public.user_access_allowed('moc','create'));$statement$;
    execute $statement$create policy user_module_edit on public.moc_change_requests as restrictive for update to authenticated using (public.user_access_allowed('moc','edit')) with check (public.user_access_allowed('moc','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.moc_change_requests as restrictive for delete to authenticated using (public.user_access_allowed('moc','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.moc_change_requests for each row execute function public.guard_module_user_access('moc');$statement$;
  else
    raise notice 'Skipping unavailable table public.moc_change_requests';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.objectives') is not null then
    execute $statement$drop policy if exists user_module_view on public.objectives;$statement$;
    execute $statement$drop policy if exists user_module_create on public.objectives;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.objectives;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.objectives;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.objectives;$statement$;
    execute $statement$alter table public.objectives enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.objectives as restrictive for select to authenticated using (public.user_access_allowed('kpi','view'));$statement$;
    execute $statement$create policy user_module_create on public.objectives as restrictive for insert to authenticated with check (public.user_access_allowed('kpi','create'));$statement$;
    execute $statement$create policy user_module_edit on public.objectives as restrictive for update to authenticated using (public.user_access_allowed('kpi','edit')) with check (public.user_access_allowed('kpi','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.objectives as restrictive for delete to authenticated using (public.user_access_allowed('kpi','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.objectives for each row execute function public.guard_module_user_access('kpi');$statement$;
  else
    raise notice 'Skipping unavailable table public.objectives';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.kpi_config_versions') is not null then
    execute $statement$drop policy if exists user_module_view on public.kpi_config_versions;$statement$;
    execute $statement$drop policy if exists user_module_create on public.kpi_config_versions;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.kpi_config_versions;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.kpi_config_versions;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.kpi_config_versions;$statement$;
    execute $statement$alter table public.kpi_config_versions enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.kpi_config_versions as restrictive for select to authenticated using (public.user_access_allowed('kpi','view'));$statement$;
    execute $statement$create policy user_module_create on public.kpi_config_versions as restrictive for insert to authenticated with check (public.user_access_allowed('kpi','create'));$statement$;
    execute $statement$create policy user_module_edit on public.kpi_config_versions as restrictive for update to authenticated using (public.user_access_allowed('kpi','edit')) with check (public.user_access_allowed('kpi','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.kpi_config_versions as restrictive for delete to authenticated using (public.user_access_allowed('kpi','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.kpi_config_versions for each row execute function public.guard_module_user_access('kpi');$statement$;
  else
    raise notice 'Skipping unavailable table public.kpi_config_versions';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.kpi_config_audit') is not null then
    execute $statement$drop policy if exists user_module_view on public.kpi_config_audit;$statement$;
    execute $statement$drop policy if exists user_module_create on public.kpi_config_audit;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.kpi_config_audit;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.kpi_config_audit;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.kpi_config_audit;$statement$;
    execute $statement$alter table public.kpi_config_audit enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.kpi_config_audit as restrictive for select to authenticated using (public.user_access_allowed('kpi','view'));$statement$;
    execute $statement$create policy user_module_create on public.kpi_config_audit as restrictive for insert to authenticated with check (public.user_access_allowed('kpi','create'));$statement$;
    execute $statement$create policy user_module_edit on public.kpi_config_audit as restrictive for update to authenticated using (public.user_access_allowed('kpi','edit')) with check (public.user_access_allowed('kpi','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.kpi_config_audit as restrictive for delete to authenticated using (public.user_access_allowed('kpi','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.kpi_config_audit for each row execute function public.guard_module_user_access('kpi');$statement$;
  else
    raise notice 'Skipping unavailable table public.kpi_config_audit';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.kpi_monthly_reviews') is not null then
    execute $statement$drop policy if exists user_module_view on public.kpi_monthly_reviews;$statement$;
    execute $statement$drop policy if exists user_module_create on public.kpi_monthly_reviews;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.kpi_monthly_reviews;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.kpi_monthly_reviews;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.kpi_monthly_reviews;$statement$;
    execute $statement$alter table public.kpi_monthly_reviews enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.kpi_monthly_reviews as restrictive for select to authenticated using (public.user_access_allowed('kpi','view'));$statement$;
    execute $statement$create policy user_module_create on public.kpi_monthly_reviews as restrictive for insert to authenticated with check (public.user_access_allowed('kpi','create'));$statement$;
    execute $statement$create policy user_module_edit on public.kpi_monthly_reviews as restrictive for update to authenticated using (public.user_access_allowed('kpi','edit')) with check (public.user_access_allowed('kpi','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.kpi_monthly_reviews as restrictive for delete to authenticated using (public.user_access_allowed('kpi','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.kpi_monthly_reviews for each row execute function public.guard_module_user_access('kpi');$statement$;
  else
    raise notice 'Skipping unavailable table public.kpi_monthly_reviews';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.custom_fields') is not null then
    execute $statement$drop policy if exists user_module_view on public.custom_fields;$statement$;
    execute $statement$drop policy if exists user_module_create on public.custom_fields;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.custom_fields;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.custom_fields;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.custom_fields;$statement$;
    execute $statement$alter table public.custom_fields enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.custom_fields as restrictive for select to authenticated using (public.user_access_allowed('settings.modules','view'));$statement$;
    execute $statement$create policy user_module_create on public.custom_fields as restrictive for insert to authenticated with check (public.user_access_allowed('settings.modules','create'));$statement$;
    execute $statement$create policy user_module_edit on public.custom_fields as restrictive for update to authenticated using (public.user_access_allowed('settings.modules','edit')) with check (public.user_access_allowed('settings.modules','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.custom_fields as restrictive for delete to authenticated using (public.user_access_allowed('settings.modules','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.custom_fields for each row execute function public.guard_module_user_access('settings.modules');$statement$;
  else
    raise notice 'Skipping unavailable table public.custom_fields';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.custom_field_values') is not null then
    execute $statement$drop policy if exists user_module_view on public.custom_field_values;$statement$;
    execute $statement$drop policy if exists user_module_create on public.custom_field_values;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.custom_field_values;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.custom_field_values;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.custom_field_values;$statement$;
    execute $statement$alter table public.custom_field_values enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.custom_field_values as restrictive for select to authenticated using (public.user_access_allowed('settings.modules','view'));$statement$;
    execute $statement$create policy user_module_create on public.custom_field_values as restrictive for insert to authenticated with check (public.user_access_allowed('settings.modules','create'));$statement$;
    execute $statement$create policy user_module_edit on public.custom_field_values as restrictive for update to authenticated using (public.user_access_allowed('settings.modules','edit')) with check (public.user_access_allowed('settings.modules','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.custom_field_values as restrictive for delete to authenticated using (public.user_access_allowed('settings.modules','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.custom_field_values for each row execute function public.guard_module_user_access('settings.modules');$statement$;
  else
    raise notice 'Skipping unavailable table public.custom_field_values';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.automation_rules') is not null then
    execute $statement$drop policy if exists user_module_view on public.automation_rules;$statement$;
    execute $statement$drop policy if exists user_module_create on public.automation_rules;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.automation_rules;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.automation_rules;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.automation_rules;$statement$;
    execute $statement$alter table public.automation_rules enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.automation_rules as restrictive for select to authenticated using (public.user_access_allowed('settings.workflows','view'));$statement$;
    execute $statement$create policy user_module_create on public.automation_rules as restrictive for insert to authenticated with check (public.user_access_allowed('settings.workflows','create'));$statement$;
    execute $statement$create policy user_module_edit on public.automation_rules as restrictive for update to authenticated using (public.user_access_allowed('settings.workflows','edit')) with check (public.user_access_allowed('settings.workflows','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.automation_rules as restrictive for delete to authenticated using (public.user_access_allowed('settings.workflows','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.automation_rules for each row execute function public.guard_module_user_access('settings.workflows');$statement$;
  else
    raise notice 'Skipping unavailable table public.automation_rules';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.workflow_policy_versions') is not null then
    execute $statement$drop policy if exists user_module_view on public.workflow_policy_versions;$statement$;
    execute $statement$drop policy if exists user_module_create on public.workflow_policy_versions;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.workflow_policy_versions;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.workflow_policy_versions;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.workflow_policy_versions;$statement$;
    execute $statement$alter table public.workflow_policy_versions enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.workflow_policy_versions as restrictive for select to authenticated using (public.user_access_allowed('settings.workflows','view'));$statement$;
    execute $statement$create policy user_module_create on public.workflow_policy_versions as restrictive for insert to authenticated with check (public.user_access_allowed('settings.workflows','create'));$statement$;
    execute $statement$create policy user_module_edit on public.workflow_policy_versions as restrictive for update to authenticated using (public.user_access_allowed('settings.workflows','edit')) with check (public.user_access_allowed('settings.workflows','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.workflow_policy_versions as restrictive for delete to authenticated using (public.user_access_allowed('settings.workflows','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.workflow_policy_versions for each row execute function public.guard_module_user_access('settings.workflows');$statement$;
  else
    raise notice 'Skipping unavailable table public.workflow_policy_versions';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.workflow_policy_events') is not null then
    execute $statement$drop policy if exists user_module_view on public.workflow_policy_events;$statement$;
    execute $statement$drop policy if exists user_module_create on public.workflow_policy_events;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.workflow_policy_events;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.workflow_policy_events;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.workflow_policy_events;$statement$;
    execute $statement$alter table public.workflow_policy_events enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.workflow_policy_events as restrictive for select to authenticated using (public.user_access_allowed('settings.workflows','view'));$statement$;
    execute $statement$create policy user_module_create on public.workflow_policy_events as restrictive for insert to authenticated with check (public.user_access_allowed('settings.workflows','create'));$statement$;
    execute $statement$create policy user_module_edit on public.workflow_policy_events as restrictive for update to authenticated using (public.user_access_allowed('settings.workflows','edit')) with check (public.user_access_allowed('settings.workflows','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.workflow_policy_events as restrictive for delete to authenticated using (public.user_access_allowed('settings.workflows','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.workflow_policy_events for each row execute function public.guard_module_user_access('settings.workflows');$statement$;
  else
    raise notice 'Skipping unavailable table public.workflow_policy_events';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.person_identity_backfill_review') is not null then
    execute $statement$drop policy if exists user_module_view on public.person_identity_backfill_review;$statement$;
    execute $statement$drop policy if exists user_module_create on public.person_identity_backfill_review;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.person_identity_backfill_review;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.person_identity_backfill_review;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.person_identity_backfill_review;$statement$;
    execute $statement$alter table public.person_identity_backfill_review enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.person_identity_backfill_review as restrictive for select to authenticated using (public.user_access_allowed('settings.data','view'));$statement$;
    execute $statement$create policy user_module_create on public.person_identity_backfill_review as restrictive for insert to authenticated with check (public.user_access_allowed('settings.data','create'));$statement$;
    execute $statement$create policy user_module_edit on public.person_identity_backfill_review as restrictive for update to authenticated using (public.user_access_allowed('settings.data','edit')) with check (public.user_access_allowed('settings.data','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.person_identity_backfill_review as restrictive for delete to authenticated using (public.user_access_allowed('settings.data','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.person_identity_backfill_review for each row execute function public.guard_module_user_access('settings.data');$statement$;
  else
    raise notice 'Skipping unavailable table public.person_identity_backfill_review';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.person_identity_decisions') is not null then
    execute $statement$drop policy if exists user_module_view on public.person_identity_decisions;$statement$;
    execute $statement$drop policy if exists user_module_create on public.person_identity_decisions;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.person_identity_decisions;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.person_identity_decisions;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.person_identity_decisions;$statement$;
    execute $statement$alter table public.person_identity_decisions enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.person_identity_decisions as restrictive for select to authenticated using (public.user_access_allowed('settings.data','view'));$statement$;
    execute $statement$create policy user_module_create on public.person_identity_decisions as restrictive for insert to authenticated with check (public.user_access_allowed('settings.data','create'));$statement$;
    execute $statement$create policy user_module_edit on public.person_identity_decisions as restrictive for update to authenticated using (public.user_access_allowed('settings.data','edit')) with check (public.user_access_allowed('settings.data','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.person_identity_decisions as restrictive for delete to authenticated using (public.user_access_allowed('settings.data','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.person_identity_decisions for each row execute function public.guard_module_user_access('settings.data');$statement$;
  else
    raise notice 'Skipping unavailable table public.person_identity_decisions';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.location_identity_backfill_review') is not null then
    execute $statement$drop policy if exists user_module_view on public.location_identity_backfill_review;$statement$;
    execute $statement$drop policy if exists user_module_create on public.location_identity_backfill_review;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.location_identity_backfill_review;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.location_identity_backfill_review;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.location_identity_backfill_review;$statement$;
    execute $statement$alter table public.location_identity_backfill_review enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.location_identity_backfill_review as restrictive for select to authenticated using (public.user_access_allowed('settings.data','view'));$statement$;
    execute $statement$create policy user_module_create on public.location_identity_backfill_review as restrictive for insert to authenticated with check (public.user_access_allowed('settings.data','create'));$statement$;
    execute $statement$create policy user_module_edit on public.location_identity_backfill_review as restrictive for update to authenticated using (public.user_access_allowed('settings.data','edit')) with check (public.user_access_allowed('settings.data','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.location_identity_backfill_review as restrictive for delete to authenticated using (public.user_access_allowed('settings.data','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.location_identity_backfill_review for each row execute function public.guard_module_user_access('settings.data');$statement$;
  else
    raise notice 'Skipping unavailable table public.location_identity_backfill_review';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.whatsapp_channel_settings') is not null then
    execute $statement$drop policy if exists user_module_view on public.whatsapp_channel_settings;$statement$;
    execute $statement$drop policy if exists user_module_create on public.whatsapp_channel_settings;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.whatsapp_channel_settings;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.whatsapp_channel_settings;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.whatsapp_channel_settings;$statement$;
    execute $statement$alter table public.whatsapp_channel_settings enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.whatsapp_channel_settings as restrictive for select to authenticated using (public.user_access_allowed('settings.notifications','view'));$statement$;
    execute $statement$create policy user_module_create on public.whatsapp_channel_settings as restrictive for insert to authenticated with check (public.user_access_allowed('settings.notifications','create'));$statement$;
    execute $statement$create policy user_module_edit on public.whatsapp_channel_settings as restrictive for update to authenticated using (public.user_access_allowed('settings.notifications','edit')) with check (public.user_access_allowed('settings.notifications','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.whatsapp_channel_settings as restrictive for delete to authenticated using (public.user_access_allowed('settings.notifications','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.whatsapp_channel_settings for each row execute function public.guard_module_user_access('settings.notifications');$statement$;
  else
    raise notice 'Skipping unavailable table public.whatsapp_channel_settings';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.integrations') is not null then
    execute $statement$drop policy if exists user_module_view on public.integrations;$statement$;
    execute $statement$drop policy if exists user_module_create on public.integrations;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.integrations;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.integrations;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.integrations;$statement$;
    execute $statement$alter table public.integrations enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.integrations as restrictive for select to authenticated using (public.user_access_allowed('integrations','view'));$statement$;
    execute $statement$create policy user_module_create on public.integrations as restrictive for insert to authenticated with check (public.user_access_allowed('integrations','create'));$statement$;
    execute $statement$create policy user_module_edit on public.integrations as restrictive for update to authenticated using (public.user_access_allowed('integrations','edit')) with check (public.user_access_allowed('integrations','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.integrations as restrictive for delete to authenticated using (public.user_access_allowed('integrations','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.integrations for each row execute function public.guard_module_user_access('integrations');$statement$;
  else
    raise notice 'Skipping unavailable table public.integrations';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.integration_sync_log') is not null then
    execute $statement$drop policy if exists user_module_view on public.integration_sync_log;$statement$;
    execute $statement$drop policy if exists user_module_create on public.integration_sync_log;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.integration_sync_log;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.integration_sync_log;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.integration_sync_log;$statement$;
    execute $statement$alter table public.integration_sync_log enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.integration_sync_log as restrictive for select to authenticated using (public.user_access_allowed('integrations','view'));$statement$;
    execute $statement$create policy user_module_create on public.integration_sync_log as restrictive for insert to authenticated with check (public.user_access_allowed('integrations','create'));$statement$;
    execute $statement$create policy user_module_edit on public.integration_sync_log as restrictive for update to authenticated using (public.user_access_allowed('integrations','edit')) with check (public.user_access_allowed('integrations','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.integration_sync_log as restrictive for delete to authenticated using (public.user_access_allowed('integrations','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.integration_sync_log for each row execute function public.guard_module_user_access('integrations');$statement$;
  else
    raise notice 'Skipping unavailable table public.integration_sync_log';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.elearning_courses') is not null then
    execute $statement$drop policy if exists user_module_view on public.elearning_courses;$statement$;
    execute $statement$drop policy if exists user_module_create on public.elearning_courses;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.elearning_courses;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.elearning_courses;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.elearning_courses;$statement$;
    execute $statement$alter table public.elearning_courses enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.elearning_courses as restrictive for select to authenticated using (public.user_access_allowed('training','view'));$statement$;
    execute $statement$create policy user_module_create on public.elearning_courses as restrictive for insert to authenticated with check (public.user_access_allowed('training','create'));$statement$;
    execute $statement$create policy user_module_edit on public.elearning_courses as restrictive for update to authenticated using (public.user_access_allowed('training','edit')) with check (public.user_access_allowed('training','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.elearning_courses as restrictive for delete to authenticated using (public.user_access_allowed('training','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.elearning_courses for each row execute function public.guard_module_user_access('training');$statement$;
  else
    raise notice 'Skipping unavailable table public.elearning_courses';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.elearning_enrolments') is not null then
    execute $statement$drop policy if exists user_module_view on public.elearning_enrolments;$statement$;
    execute $statement$drop policy if exists user_module_create on public.elearning_enrolments;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.elearning_enrolments;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.elearning_enrolments;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.elearning_enrolments;$statement$;
    execute $statement$alter table public.elearning_enrolments enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.elearning_enrolments as restrictive for select to authenticated using (public.user_access_allowed('training','view'));$statement$;
    execute $statement$create policy user_module_create on public.elearning_enrolments as restrictive for insert to authenticated with check (public.user_access_allowed('training','create'));$statement$;
    execute $statement$create policy user_module_edit on public.elearning_enrolments as restrictive for update to authenticated using (public.user_access_allowed('training','edit')) with check (public.user_access_allowed('training','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.elearning_enrolments as restrictive for delete to authenticated using (public.user_access_allowed('training','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.elearning_enrolments for each row execute function public.guard_module_user_access('training');$statement$;
  else
    raise notice 'Skipping unavailable table public.elearning_enrolments';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.elearning_quiz_attempts') is not null then
    execute $statement$drop policy if exists user_module_view on public.elearning_quiz_attempts;$statement$;
    execute $statement$drop policy if exists user_module_create on public.elearning_quiz_attempts;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.elearning_quiz_attempts;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.elearning_quiz_attempts;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.elearning_quiz_attempts;$statement$;
    execute $statement$alter table public.elearning_quiz_attempts enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.elearning_quiz_attempts as restrictive for select to authenticated using (public.user_access_allowed('training','view'));$statement$;
    execute $statement$create policy user_module_create on public.elearning_quiz_attempts as restrictive for insert to authenticated with check (public.user_access_allowed('training','create'));$statement$;
    execute $statement$create policy user_module_edit on public.elearning_quiz_attempts as restrictive for update to authenticated using (public.user_access_allowed('training','edit')) with check (public.user_access_allowed('training','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.elearning_quiz_attempts as restrictive for delete to authenticated using (public.user_access_allowed('training','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.elearning_quiz_attempts for each row execute function public.guard_module_user_access('training');$statement$;
  else
    raise notice 'Skipping unavailable table public.elearning_quiz_attempts';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.learning_course_governance') is not null then
    execute $statement$drop policy if exists user_module_view on public.learning_course_governance;$statement$;
    execute $statement$drop policy if exists user_module_create on public.learning_course_governance;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.learning_course_governance;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.learning_course_governance;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.learning_course_governance;$statement$;
    execute $statement$alter table public.learning_course_governance enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.learning_course_governance as restrictive for select to authenticated using (public.user_access_allowed('training','view'));$statement$;
    execute $statement$create policy user_module_create on public.learning_course_governance as restrictive for insert to authenticated with check (public.user_access_allowed('training','create'));$statement$;
    execute $statement$create policy user_module_edit on public.learning_course_governance as restrictive for update to authenticated using (public.user_access_allowed('training','edit')) with check (public.user_access_allowed('training','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.learning_course_governance as restrictive for delete to authenticated using (public.user_access_allowed('training','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.learning_course_governance for each row execute function public.guard_module_user_access('training');$statement$;
  else
    raise notice 'Skipping unavailable table public.learning_course_governance';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.learning_practical_assessments') is not null then
    execute $statement$drop policy if exists user_module_view on public.learning_practical_assessments;$statement$;
    execute $statement$drop policy if exists user_module_create on public.learning_practical_assessments;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.learning_practical_assessments;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.learning_practical_assessments;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.learning_practical_assessments;$statement$;
    execute $statement$alter table public.learning_practical_assessments enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.learning_practical_assessments as restrictive for select to authenticated using (public.user_access_allowed('training','view'));$statement$;
    execute $statement$create policy user_module_create on public.learning_practical_assessments as restrictive for insert to authenticated with check (public.user_access_allowed('training','create'));$statement$;
    execute $statement$create policy user_module_edit on public.learning_practical_assessments as restrictive for update to authenticated using (public.user_access_allowed('training','edit')) with check (public.user_access_allowed('training','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.learning_practical_assessments as restrictive for delete to authenticated using (public.user_access_allowed('training','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.learning_practical_assessments for each row execute function public.guard_module_user_access('training');$statement$;
  else
    raise notice 'Skipping unavailable table public.learning_practical_assessments';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.training_sessions') is not null then
    execute $statement$drop policy if exists user_module_view on public.training_sessions;$statement$;
    execute $statement$drop policy if exists user_module_create on public.training_sessions;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.training_sessions;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.training_sessions;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.training_sessions;$statement$;
    execute $statement$alter table public.training_sessions enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.training_sessions as restrictive for select to authenticated using (public.user_access_allowed('training','view'));$statement$;
    execute $statement$create policy user_module_create on public.training_sessions as restrictive for insert to authenticated with check (public.user_access_allowed('training','create'));$statement$;
    execute $statement$create policy user_module_edit on public.training_sessions as restrictive for update to authenticated using (public.user_access_allowed('training','edit')) with check (public.user_access_allowed('training','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.training_sessions as restrictive for delete to authenticated using (public.user_access_allowed('training','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.training_sessions for each row execute function public.guard_module_user_access('training');$statement$;
  else
    raise notice 'Skipping unavailable table public.training_sessions';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.training_requirements') is not null then
    execute $statement$drop policy if exists user_module_view on public.training_requirements;$statement$;
    execute $statement$drop policy if exists user_module_create on public.training_requirements;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.training_requirements;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.training_requirements;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.training_requirements;$statement$;
    execute $statement$alter table public.training_requirements enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.training_requirements as restrictive for select to authenticated using (public.user_access_allowed('training','view'));$statement$;
    execute $statement$create policy user_module_create on public.training_requirements as restrictive for insert to authenticated with check (public.user_access_allowed('training','create'));$statement$;
    execute $statement$create policy user_module_edit on public.training_requirements as restrictive for update to authenticated using (public.user_access_allowed('training','edit')) with check (public.user_access_allowed('training','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.training_requirements as restrictive for delete to authenticated using (public.user_access_allowed('training','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.training_requirements for each row execute function public.guard_module_user_access('training');$statement$;
  else
    raise notice 'Skipping unavailable table public.training_requirements';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.training_followup') is not null then
    execute $statement$drop policy if exists user_module_view on public.training_followup;$statement$;
    execute $statement$drop policy if exists user_module_create on public.training_followup;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.training_followup;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.training_followup;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.training_followup;$statement$;
    execute $statement$alter table public.training_followup enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.training_followup as restrictive for select to authenticated using (public.user_access_allowed('training','view'));$statement$;
    execute $statement$create policy user_module_create on public.training_followup as restrictive for insert to authenticated with check (public.user_access_allowed('training','create'));$statement$;
    execute $statement$create policy user_module_edit on public.training_followup as restrictive for update to authenticated using (public.user_access_allowed('training','edit')) with check (public.user_access_allowed('training','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.training_followup as restrictive for delete to authenticated using (public.user_access_allowed('training','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.training_followup for each row execute function public.guard_module_user_access('training');$statement$;
  else
    raise notice 'Skipping unavailable table public.training_followup';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.safety_observations') is not null then
    execute $statement$drop policy if exists user_module_view on public.safety_observations;$statement$;
    execute $statement$drop policy if exists user_module_create on public.safety_observations;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.safety_observations;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.safety_observations;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.safety_observations;$statement$;
    execute $statement$alter table public.safety_observations enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.safety_observations as restrictive for select to authenticated using (public.user_access_allowed('observation','view'));$statement$;
    execute $statement$create policy user_module_create on public.safety_observations as restrictive for insert to authenticated with check (public.user_access_allowed('observation','create'));$statement$;
    execute $statement$create policy user_module_edit on public.safety_observations as restrictive for update to authenticated using (public.user_access_allowed('observation','edit')) with check (public.user_access_allowed('observation','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.safety_observations as restrictive for delete to authenticated using (public.user_access_allowed('observation','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.safety_observations for each row execute function public.guard_module_user_access('observation');$statement$;
  else
    raise notice 'Skipping unavailable table public.safety_observations';
  end if;
end $access$;

do $access$ begin
  if to_regclass('public.tool_checklist_templates') is not null then
    execute $statement$drop policy if exists user_module_view on public.tool_checklist_templates;$statement$;
    execute $statement$drop policy if exists user_module_create on public.tool_checklist_templates;$statement$;
    execute $statement$drop policy if exists user_module_edit on public.tool_checklist_templates;$statement$;
    execute $statement$drop policy if exists user_module_delete on public.tool_checklist_templates;$statement$;
    execute $statement$drop trigger if exists module_user_access_guard on public.tool_checklist_templates;$statement$;
    execute $statement$alter table public.tool_checklist_templates enable row level security;$statement$;
    execute $statement$create policy user_module_view on public.tool_checklist_templates as restrictive for select to authenticated using (public.user_access_allowed('tools','view'));$statement$;
    execute $statement$create policy user_module_create on public.tool_checklist_templates as restrictive for insert to authenticated with check (public.user_access_allowed('tools','create'));$statement$;
    execute $statement$create policy user_module_edit on public.tool_checklist_templates as restrictive for update to authenticated using (public.user_access_allowed('tools','edit')) with check (public.user_access_allowed('tools','edit'));$statement$;
    execute $statement$create policy user_module_delete on public.tool_checklist_templates as restrictive for delete to authenticated using (public.user_access_allowed('tools','delete'));$statement$;
    execute $statement$create trigger module_user_access_guard before insert or update or delete on public.tool_checklist_templates for each row execute function public.guard_module_user_access('tools');$statement$;
  else
    raise notice 'Skipping unavailable table public.tool_checklist_templates';
  end if;
end $access$;

-- Pre-request protects read-only SECURITY DEFINER RPCs and their called routines.
create or replace function public.user_access_preflight() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare request_path text; rpc_name text; routine_source text; entry record; denied_tables jsonb; actor public.profiles;
begin
  if auth.uid() is null then return; end if;
  select * into actor from public.profiles where id=auth.uid();
  if actor.role='sephs_admin' or actor.permissions->'access_v1' is null then return; end if;
  request_path:=current_setting('request.path',true);
  if request_path not like '/rpc/%' then return; end if;
  rpc_name:=split_part(substring(request_path from 6),'?',1);
  denied_tables:='{"people":"people","people_certifications":"people","events":"events","inspections":"inspection","toolbox_talks":"meetings","hse_meetings":"meetings","meeting_actions":"meetings","work_schedule":"workschedule","work_schedule_links":"workschedule","permits":"permit","risk_assessments":"risk","risk_assessment_items":"risk","risk_assessment_operational_records":"risk","risk_assessment_relationships":"risk","tools_register":"tools","tool_inspections":"tools","ppe_catalogue":"ppe","ppe_inspections":"ppe","ppe_issuance":"ppe","ppe_replacements":"ppe","documents":"documents","training_needs":"training","kpis":"kpi","kpis_v2":"kpi","kpi_indicators":"kpi","kpi_monthly_data":"kpi","company_settings":"settings.company","approval_workflows":"settings.workflows","approval_workflow_steps":"settings.workflows","notification_settings":"settings.notifications","notification_escalation_settings":"settings.notifications","notification_acknowledgement_settings":"settings.notifications","investigations":"events","incident_evidence":"events","incident_mgmt_records":"events","incident_mgmt_config_records":"events","bbs_observation_details":"observation","bbs_observation_responses":"observation","bbs_observation_barriers":"observation","bbs_programmes":"observation","bbs_feedback":"observation","bbs_quality_reviews":"observation","bbs_recognitions":"observation","bbs_themes":"observation","inspection_items":"inspection","inspection_actions":"inspection","prestart_inspections":"inspection","checklist_templates":"inspection","action_tracker":"actions","jsa_records":"risk","equipment_assurance_records":"tools","equipment_assurance_profiles":"tools","equipment_defects":"tools","equipment_movements":"tools","equipment_maintenance_events":"tools","fuel_consumption":"fleet","atex_areas":"atex","fire_certificates":"fire","fire_equipment":"fire","fire_inspections":"fire","fire_inspection_findings":"fire","fire_layouts":"fire","fire_layout_symbols":"fire","chemical_register":"chemical","chemical_sds_versions":"chemical","chemical_inventory_events":"chemical","chemical_use_approvals":"chemical","emergency_equipment":"emergency","emergency_drills":"emergency","emergency_plans":"emergency","emergency_activations":"emergency","ert_members":"emergency","muster_points":"emergency","bcp_records":"emergency","contractors":"contractor","contractor_documents":"contractor","contractor_authorisations":"contractor","contractor_evaluations":"contractor","contractor_incidents":"contractor","contractor_preassessments":"contractor","contractor_assurance_profiles":"contractor","contractor_mobilisation_gates":"contractor","contractor_work_packages":"contractor","document_control_records":"documents","document_control_revisions":"documents","document_control_files":"documents","document_control_config":"documents","doc_revisions":"documents","doc_controlled_copies":"documents","doc_acknowledgements":"documents","induction_records":"training","competencies":"training","competency_matrix":"training","training_plan":"training","noise_measurements":"noise","noise_surveys":"noise","noise_mgmt_assessment_profiles":"noise","noise_mgmt_control_plans":"noise","noise_mgmt_exposure_assessments":"noise","noise_mgmt_field_surveys":"noise","noise_mgmt_health_statuses":"noise","noise_mgmt_hearing_protectors":"noise","noise_mgmt_instruments":"noise","noise_mgmt_maps":"noise","noise_mgmt_measurement_plans":"noise","noise_mgmt_measurements":"noise","noise_mgmt_programmes":"noise","noise_mgmt_reports":"noise","noise_mgmt_segs":"noise","noise_mgmt_sources":"noise","noise_mgmt_tasks":"noise","master_data_records":"master-data","master_data_revisions":"master-data","master_data_dependencies":"master-data","master_data_import_batches":"master-data","master_data_import_rows":"master-data","medical_surveillance":"ohealth","occupational_diseases":"ohealth","audiometry_records":"ohealth","exposure_monitoring":"ohealth","esg_targets":"esg","environmental_inspections":"esg","hazardous_waste":"esg","waste_records":"esg","water_usage":"esg","legal_register":"legal","legal_requirements":"legal","legal_changes":"legal","legislative_changes":"legal","legal_compliance_records":"legal","legal_compliance_relationships":"legal","compliance_assessments":"legal","compliance_audits":"legal","compliance_calendar":"legal","compliance_gaps":"legal","sop_documents":"sop","sop_video_evidence":"sop","sop_video_projects":"sop","sop_video_relationships":"sop","swms_configuration_versions":"swms","swms_operational_records":"swms","swms_relationships":"swms","moc_change_requests":"moc","objectives":"kpi","kpi_config_versions":"kpi","kpi_config_audit":"kpi","kpi_monthly_reviews":"kpi","custom_fields":"settings.modules","custom_field_values":"settings.modules","automation_rules":"settings.workflows","workflow_policy_versions":"settings.workflows","workflow_policy_events":"settings.workflows","person_identity_backfill_review":"settings.data","person_identity_decisions":"settings.data","location_identity_backfill_review":"settings.data","whatsapp_channel_settings":"settings.notifications","integrations":"integrations","integration_sync_log":"integrations","elearning_courses":"training","elearning_enrolments":"training","elearning_quiz_attempts":"training","learning_course_governance":"training","learning_practical_assessments":"training","training_sessions":"training","training_requirements":"training","training_followup":"training","safety_observations":"observation","tool_checklist_templates":"tools"}'::jsonb;
  for entry in
    with recursive called(oid,src,visited) as (
      select p.oid,p.prosrc,array[p.oid] from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=rpc_name
      union all
      select p.oid,p.prosrc,c.visited||p.oid from called c join pg_proc p on c.src ~ ('\m'||p.proname||'\M[[:space:]]*\(') join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and not p.oid=any(c.visited) and cardinality(c.visited)<12
    ) select distinct src from called
  loop
    for routine_source,rpc_name in select key,value from jsonb_each_text(denied_tables) loop
      if entry.src ~ ('\m'||routine_source||'\M') and not public.user_access_allowed(rpc_name,'view') then
        raise exception 'This RPC accesses a module unavailable to your account' using errcode='42501';
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.user_access_preflight() from public;
grant execute on function public.user_access_preflight() to authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname='authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request = ''public.user_access_preflight''';
  end if;
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

commit;
