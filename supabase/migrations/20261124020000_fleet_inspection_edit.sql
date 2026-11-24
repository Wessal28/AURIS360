-- Edit a saved monthly vehicle inspection without replacing its identity or
-- implicitly releasing the vehicle or reopening its independent repair records.
begin;
set local lock_timeout='5s';

do $preflight$
declare missing text[]:='{}'; required record; routine oid;
begin
  if to_regprocedure('auth.uid()') is null
    or to_regprocedure('public.user_access_allowed(text,text)') is null
    or to_regprocedure('public.auth_company_id()') is null
    or to_regprocedure('public.is_sephs_admin()') is null then
    raise exception 'Fleet inspection editing requires the existing authentication and user access helpers.';
  end if;
  for required in select spec.table_name,unnest(string_to_array(spec.columns,',')) as column_name from (values
    ('profiles','id,company_id,role,status'),
    ('tools_register','id,company_id,is_vehicle,status,updated_at,location'),
    ('tool_inspections','id,company_id,tool_id,inspection_type,inspection_date,inspected_by,inspected_by_name,overall_result,checklist_results,defects_found,actions_taken,next_inspection_date,signed_off,notes,created_by,created_at'),
    ('equipment_defects','id,company_id,equipment_id,reference,source,severity,description,reported_by,reported_date,status,quarantine_location,release_required,corrective_action_reference,created_by'),
    ('equipment_maintenance_events','id,company_id,equipment_id,reference,maintenance_type,status,problem_description,release_required,release_status,notes,created_by')
  ) spec(table_name,columns) loop
    if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||required.table_name)
      and attname=required.column_name and attnum>0 and not attisdropped) then
      missing:=array_append(missing,required.table_name||'.'||required.column_name);
    end if;
  end loop;
  if cardinality(missing)>0 then raise exception 'Fleet inspection edit prerequisites are incomplete'
    using detail=array_to_string(missing,', '),hint='Restore the listed core prerequisites first; retain all existing inspections.';end if;
  if exists(select 1 from pg_class where oid=any(array['public.tools_register'::regclass,'public.tool_inspections'::regclass,
    'public.equipment_defects'::regclass,'public.equipment_maintenance_events'::regclass]) and not relrowsecurity) then
    raise exception 'Fleet inspection tables must retain row-level security.';
  end if;
  if exists(select 1 from pg_attribute where attrelid='public.tool_inspections'::regclass and attname='fleet_edit_revision' and attnum>0 and not attisdropped)
    and not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid='public.tool_inspections'::regclass and a.attname='fleet_edit_revision' and a.attnum>0 and not a.attisdropped
        and a.atttypid='integer'::regtype and a.attnotnull and pg_get_expr(d.adbin,d.adrelid) in ('0','0::integer')) then
    raise exception 'The existing inspection edit revision differs from the reviewed integer/default setup. Review it before applying this upgrade.';
  end if;
  routine:=to_regprocedure('public.update_fleet_monthly_check(uuid,uuid,jsonb,date,text,jsonb,text,text)');
  if routine is not null and not exists(select 1 from pg_proc where oid=routine and not prosecdef
    and prorettype='uuid'::regtype and proargnames=array['p_company_id','p_id','p_expected','p_inspection_date','p_inspector_name','p_checklist','p_defects','p_actions']::text[]) then
    raise exception 'The existing Fleet inspection edit function differs in signature or execution security. Review it before applying this upgrade.';
  end if;
end;
$preflight$;

alter table public.tool_inspections add column if not exists fleet_edit_revision integer not null default 0;

create table if not exists public.fleet_inspection_edit_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  inspection_id uuid not null,
  changed_at timestamptz not null default clock_timestamp(),
  changed_by uuid,
  before_record jsonb not null,
  after_record jsonb not null
);
create index if not exists fleet_inspection_edit_audit_record_idx
  on public.fleet_inspection_edit_audit(company_id,inspection_id,changed_at desc);
alter table public.fleet_inspection_edit_audit enable row level security;
drop policy if exists fleet_inspection_edit_audit_read on public.fleet_inspection_edit_audit;
create policy fleet_inspection_edit_audit_read on public.fleet_inspection_edit_audit
  for select to authenticated using(company_id=public.auth_company_id() or public.is_sephs_admin());
revoke all on table public.fleet_inspection_edit_audit from public,anon,authenticated;
grant select on table public.fleet_inspection_edit_audit to authenticated;

-- An application caller can read its company's history but cannot forge or edit
-- it. The trigger records the original saving identity inside both snapshots.
create or replace function public.audit_fleet_inspection_edit()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare audit_id uuid;
begin
  if old.inspection_type='periodic' and old.notes='Fleet monthly check'
    and exists(select 1 from public.tools_register where id=old.tool_id and company_id=old.company_id and is_vehicle=true) then
    insert into public.fleet_inspection_edit_audit(company_id,inspection_id,changed_by,before_record,after_record)
    values(old.company_id,old.id,auth.uid(),to_jsonb(old),to_jsonb(new)) returning id into audit_id;
    if not found or audit_id is null then raise exception 'The inspection edit history could not be recorded. No changes were saved';end if;
  end if;
  return new;
end;
$$;
revoke all on function public.audit_fleet_inspection_edit() from public,anon,authenticated;
drop trigger if exists fleet_inspection_edit_audit_update on public.tool_inspections;
create trigger fleet_inspection_edit_audit_update after update on public.tool_inspections
  for each row execute function public.audit_fleet_inspection_edit();

create or replace function public.update_fleet_monthly_check(
  p_company_id uuid,p_id uuid,p_expected jsonb,p_inspection_date date,
  p_inspector_name text,p_checklist jsonb,p_defects text,p_actions text
) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  previous public.tool_inspections%rowtype;
  saved public.tool_inspections%rowtype;
  vehicle public.tools_register%rowtype;
  defect public.equipment_defects%rowtype;
  service public.equipment_maintenance_events%rowtype;
  expected jsonb;
  failed boolean;
  suffix text;
  defect_count integer;
  service_count integer;
  defect_ref text;
  service_ref text;
  saved_defect uuid;
  saved_service uuid;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles actor where actor.id=auth.uid()
    and actor.status='active' and actor.role in ('manager','admin','sephs_admin','hse_manager','hse_officer','site_manager','auditor','hr')
    and (actor.company_id=p_company_id or actor.role='sephs_admin'))
    or not coalesce(public.user_access_allowed('fleet','edit'),false) then
    raise exception 'Manager access to this company and Fleet inspection editing is required' using errcode='42501';
  end if;
  select * into previous from public.tool_inspections where id=p_id and company_id=p_company_id for update;
  if not found then raise exception 'This inspection is unavailable in the selected company' using errcode='42501';end if;
  if previous.inspection_type is distinct from 'periodic' or previous.notes is distinct from 'Fleet monthly check' then
    raise exception 'Only monthly Fleet inspections can be edited here';
  end if;
  if coalesce(previous.signed_off,false) then raise exception 'Signed-off inspections cannot be edited. Record a new inspection instead';end if;
  select * into vehicle from public.tools_register where id=previous.tool_id and company_id=p_company_id and is_vehicle=true for update;
  if not found then raise exception 'The inspection vehicle is unavailable in the selected company' using errcode='42501';end if;
  -- Accept an entire fresh API row, while avoiding timestamp text-format
  -- differences. A revision change rejects concurrent and repeated submissions.
  expected:=jsonb_build_object('id',previous.id,'company_id',previous.company_id,'tool_id',previous.tool_id,
    'inspection_type',previous.inspection_type,'inspection_date',previous.inspection_date,'inspected_by_name',previous.inspected_by_name,
    'overall_result',previous.overall_result,'checklist_results',previous.checklist_results,'defects_found',previous.defects_found,
    'actions_taken',previous.actions_taken,'next_inspection_date',previous.next_inspection_date,'signed_off',previous.signed_off,
    'notes',previous.notes,'fleet_edit_revision',previous.fleet_edit_revision);
  if jsonb_typeof(p_expected) is distinct from 'object' or exists(select 1 from jsonb_each(expected) item
    where not coalesce(p_expected ? item.key,false) or p_expected->item.key is distinct from item.value) then
    raise exception 'This inspection changed after it was opened. Reload it before saving' using errcode='40001';
  end if;
  if p_inspection_date is null or nullif(btrim(p_inspector_name),'') is null or jsonb_typeof(p_checklist) is distinct from 'array' then
    raise exception 'An inspection date, inspector and answered checklist are required';
  end if;
  if jsonb_array_length(p_checklist)=0 then raise exception 'An answered checklist is required';end if;
  if exists(select 1 from jsonb_array_elements(p_checklist) item where coalesce(item->>'result','') not in ('ok','fail','na')
    or nullif(btrim(item->>'item'),'') is null or (item->>'result' in ('fail','na') and nullif(btrim(item->>'note'),'') is null)) then
    raise exception 'Every checklist item needs a valid answer and failed or N/A items need a reason';
  end if;
  select exists(select 1 from jsonb_array_elements(p_checklist) item where item->>'result'='fail') into failed;
  if failed and (nullif(btrim(p_defects),'') is null or nullif(btrim(p_actions),'') is null) then
    raise exception 'Failed checks require defect details and corrective actions';
  end if;

  if failed or previous.overall_result='fail' then
    -- References created by the original save RPC include the inspection UUID.
    -- Match their suffix, not their date year: correcting a date keeps the same
    -- independent defect and service records, including closed/released history.
    suffix:=upper(left(replace(previous.id::text,'-',''),12));
    select count(*) into defect_count from public.equipment_defects where company_id=p_company_id and equipment_id=vehicle.id
      and source='inspection' and reference~'^DEF-[0-9]+-[0-9A-F]{12}$' and right(reference,13)='-'||suffix;
    select count(*) into service_count from public.equipment_maintenance_events where company_id=p_company_id and equipment_id=vehicle.id
      and reference~'^SVC-[0-9]+-[0-9A-F]{12}$' and right(reference,13)='-'||suffix;
    if defect_count>1 or service_count>1 or (defect_count=1)<>(service_count=1) then
      raise exception 'The linked defect and repair records require administrator review before editing this inspection';
    end if;
    if defect_count=1 then
      select * into defect from public.equipment_defects where company_id=p_company_id and equipment_id=vehicle.id
        and source='inspection' and reference~'^DEF-[0-9]+-[0-9A-F]{12}$' and right(reference,13)='-'||suffix for update;
      if not found then raise exception 'The linked defect is unavailable. No changes were saved';end if;
      select * into service from public.equipment_maintenance_events where company_id=p_company_id and equipment_id=vehicle.id
        and reference~'^SVC-[0-9]+-[0-9A-F]{12}$' and right(reference,13)='-'||suffix for update;
      if not found or defect.corrective_action_reference is distinct from service.reference then
        raise exception 'The linked repair is unavailable or inconsistent. No changes were saved';
      end if;
    elsif previous.overall_result='fail' then
      raise exception 'The failed inspection has no linked defect and repair records. Ask an administrator to reconcile it before editing';
    end if;
    if failed and previous.overall_result is distinct from 'fail' then
      if defect_count=1 and (defect.status in ('closed','disposed') or service.release_status='released' or service.status='cancelled') then
        raise exception 'This inspection has completed repair history. Create a new inspection to record a new failure';
      end if;
      update public.tools_register set status='out_of_service',updated_at=now() where id=vehicle.id and company_id=p_company_id;
      if not found then raise exception 'The failed vehicle could not be restricted. No changes were saved';end if;
      if defect_count=0 then
        defect_ref:='DEF-'||extract(year from p_inspection_date)::text||'-'||suffix;
        service_ref:='SVC-'||extract(year from p_inspection_date)::text||'-'||suffix;
        insert into public.equipment_defects(company_id,equipment_id,reference,source,severity,description,reported_by,reported_date,
          status,quarantine_location,release_required,corrective_action_reference,created_by)
        values(p_company_id,vehicle.id,defect_ref,'inspection','critical',btrim(p_defects),btrim(p_inspector_name),p_inspection_date,
          'quarantined',vehicle.location,true,service_ref,auth.uid()) returning id into saved_defect;
        if not found or saved_defect is null then raise exception 'The linked defect could not be created. No changes were saved';end if;
        insert into public.equipment_maintenance_events(company_id,equipment_id,reference,maintenance_type,status,problem_description,
          release_required,release_status,notes,created_by)
        values(p_company_id,vehicle.id,service_ref,'corrective','requested',btrim(p_defects),true,'pending','Raised from '||defect_ref,auth.uid())
          returning id into saved_service;
        if not found or saved_service is null then raise exception 'The linked repair task could not be created. No changes were saved';end if;
      end if;
    end if;
  end if;

  update public.tool_inspections set inspection_date=p_inspection_date,inspected_by_name=btrim(p_inspector_name),
    overall_result=case when failed then 'fail' else 'pass' end,checklist_results=p_checklist,
    defects_found=nullif(btrim(p_defects),''),actions_taken=nullif(btrim(p_actions),''),next_inspection_date=p_inspection_date+30,
    fleet_edit_revision=previous.fleet_edit_revision+1
  where id=previous.id and company_id=p_company_id and tool_id=previous.tool_id and fleet_edit_revision=previous.fleet_edit_revision
  returning * into saved;
  if not found then raise exception 'The inspection could not be updated. No changes were saved';end if;
  if saved.id is distinct from previous.id or saved.company_id is distinct from previous.company_id or saved.tool_id is distinct from previous.tool_id
    or saved.created_by is distinct from previous.created_by or saved.created_at is distinct from previous.created_at
    or saved.inspection_type is distinct from previous.inspection_type or saved.notes is distinct from previous.notes
    or saved.signed_off is distinct from previous.signed_off or saved.inspected_by is distinct from previous.inspected_by
    or saved.inspection_date is distinct from p_inspection_date or saved.inspected_by_name is distinct from btrim(p_inspector_name)
    or saved.overall_result is distinct from (case when failed then 'fail' else 'pass' end) or saved.checklist_results is distinct from p_checklist
    or saved.defects_found is distinct from nullif(btrim(p_defects),'') or saved.actions_taken is distinct from nullif(btrim(p_actions),'')
    or saved.next_inspection_date is distinct from p_inspection_date+30 or saved.fleet_edit_revision is distinct from previous.fleet_edit_revision+1 then
    raise exception 'The saved inspection did not match the requested edit. No changes were saved';
  end if;
  return saved.id;
end;
$$;
revoke all on function public.update_fleet_monthly_check(uuid,uuid,jsonb,date,text,jsonb,text,text) from public,anon;
grant execute on function public.update_fleet_monthly_check(uuid,uuid,jsonb,date,text,jsonb,text,text) to authenticated;
-- A failure newly recorded by editing an older inspection still requires a
-- later authorised service release. A descriptive edit of an already-failed
-- historical inspection does not reopen its completed repair history.
create or replace function public.guard_fleet_vehicle_reactivation()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.is_vehicle and old.status='out_of_service' and new.status='active' then
    if exists(select 1 from public.equipment_defects d where d.equipment_id=new.id
      and d.company_id=new.company_id and d.status not in ('closed','disposed')) then
      raise exception 'Unresolved vehicle defects block reactivation';
    end if;
    if exists(select 1 from public.tool_inspections i where i.tool_id=new.id
      and i.company_id=new.company_id and i.overall_result='fail'
      and greatest(i.created_at,coalesce((select max(a.changed_at)
        from public.fleet_inspection_edit_audit a where a.inspection_id=i.id and a.company_id=i.company_id
          and a.before_record->>'overall_result' is distinct from 'fail' and a.after_record->>'overall_result'='fail'),'-infinity'::timestamptz))
        >coalesce((select max(m.updated_at) from public.equipment_maintenance_events m
          where m.equipment_id=new.id and m.company_id=new.company_id and m.release_status='released'),'-infinity'::timestamptz)) then
      raise exception 'A failed vehicle check requires authorised service release';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_fleet_vehicle_reactivation() from public,anon,authenticated;
drop trigger if exists fleet_vehicle_reactivation_guard on public.tools_register;
create trigger fleet_vehicle_reactivation_guard before update of status on public.tools_register
  for each row execute function public.guard_fleet_vehicle_reactivation();

notify pgrst,'reload schema';
commit;
