-- Keep completed-service schedule changes reviewable.
alter table public.equipment_maintenance_events
  add column if not exists service_schedule_override_reason text;

create table if not exists public.fleet_service_schedule_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  maintenance_event_id uuid not null references public.equipment_maintenance_events(id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  reason text not null,
  previous_schedule jsonb not null,
  new_schedule jsonb not null
);
create index if not exists fleet_service_schedule_audit_event_idx
  on public.fleet_service_schedule_audit(maintenance_event_id, changed_at desc);
alter table public.fleet_service_schedule_audit enable row level security;
create policy fleet_service_schedule_audit_read on public.fleet_service_schedule_audit
  for select to authenticated
  using (company_id = public.auth_company_id() or public.is_sephs_admin());
grant select on public.fleet_service_schedule_audit to authenticated;

create or replace function public.audit_fleet_service_schedule()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  v_old := jsonb_build_object('service_interval_days',old.service_interval_days,
    'service_interval_km',old.service_interval_km,'service_interval_hours',old.service_interval_hours,
    'completed_meter',old.completed_meter,'next_due_date',old.next_due_date,
    'next_due_meter',old.next_due_meter);
  v_new := jsonb_build_object('service_interval_days',new.service_interval_days,
    'service_interval_km',new.service_interval_km,'service_interval_hours',new.service_interval_hours,
    'completed_meter',new.completed_meter,'next_due_date',new.next_due_date,
    'next_due_meter',new.next_due_meter);
  if old.status = 'completed' and v_old is distinct from v_new then
    if nullif(btrim(new.service_schedule_override_reason),'') is null
       or new.service_schedule_override_reason is not distinct from old.service_schedule_override_reason then
      raise exception 'Explain the completed-service schedule change before saving';
    end if;
    insert into public.fleet_service_schedule_audit
      (company_id,maintenance_event_id,changed_by,reason,previous_schedule,new_schedule)
    values (new.company_id,new.id,auth.uid(),new.service_schedule_override_reason,v_old,v_new);
  end if;
  return new;
end;
$$;
drop trigger if exists fleet_service_schedule_audit_update on public.equipment_maintenance_events;
create trigger fleet_service_schedule_audit_update
  before update on public.equipment_maintenance_events
  for each row execute function public.audit_fleet_service_schedule();

-- A form or direct API write cannot release a failed vehicle with unresolved defects.
create or replace function public.guard_fleet_service_release()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.release_status = 'released' and old.release_status is distinct from 'released'
     and exists (select 1 from public.tools_register t where t.id=new.equipment_id
       and t.company_id=new.company_id and t.is_vehicle=true) then
    if new.status <> 'completed' or new.completed_date is null
       or nullif(btrim(new.work_performed),'') is null
       or nullif(btrim(new.post_work_test_reference),'') is null
       or nullif(btrim(new.release_authority),'') is null then
      raise exception 'Vehicle release requires completed work, test evidence and an authority';
    end if;
    if exists (select 1 from public.equipment_defects d where d.equipment_id=new.equipment_id
      and d.company_id=new.company_id and d.status not in ('closed','disposed')) then
      raise exception 'Unresolved vehicle defects block release';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists fleet_service_release_guard on public.equipment_maintenance_events;
create trigger fleet_service_release_guard
  before update on public.equipment_maintenance_events
  for each row execute function public.guard_fleet_service_release();

create or replace function public.guard_fleet_vehicle_reactivation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_vehicle and old.status='out_of_service' and new.status='active' then
    if exists (select 1 from public.equipment_defects d where d.equipment_id=new.id
      and d.company_id=new.company_id and d.status not in ('closed','disposed')) then
      raise exception 'Unresolved vehicle defects block reactivation';
    end if;
    if exists (select 1 from public.tool_inspections i where i.tool_id=new.id
      and i.company_id=new.company_id and i.overall_result='fail'
      and i.created_at > coalesce((select max(m.updated_at)
        from public.equipment_maintenance_events m where m.equipment_id=new.id
          and m.company_id=new.company_id and m.release_status='released'),'-infinity'::timestamptz)) then
      raise exception 'A failed vehicle check requires authorised service release';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists fleet_vehicle_reactivation_guard on public.tools_register;
create trigger fleet_vehicle_reactivation_guard
  before update of status on public.tools_register
  for each row execute function public.guard_fleet_vehicle_reactivation();

-- A linked road incident creates a review task; an inspection still requires a person to perform it.
create or replace function public.flag_fleet_incident_review()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_vehicle public.tools_register%rowtype;
begin
  if new.company_id is null or nullif(btrim(new.vehicle_reg),'') is null then return new; end if;
  select * into v_vehicle from public.tools_register
    where company_id = new.company_id and is_vehicle = true
      and lower(regexp_replace(coalesce(registration_number,''),'[^a-zA-Z0-9]','','g')) =
          lower(regexp_replace(new.vehicle_reg,'[^a-zA-Z0-9]','','g'))
    limit 1;
  if not found then return new; end if;
  if not exists (select 1 from public.action_tracker where company_id = new.company_id
      and source_module = 'fleet_incident_review' and source_id = new.id) then
    insert into public.action_tracker
      (company_id,source_module,source_id,source_ref,title,description,responsible,
       target_date,priority,status,created_by)
    values (new.company_id,'fleet_incident_review',new.id,new.event_ref,
      'Review vehicle after incident: ' || coalesce(v_vehicle.registration_number,v_vehicle.name),
      'Review the linked vehicle incident and determine whether a new inspection or risk assessment is required. Vehicle: '
        || coalesce(v_vehicle.registration_number,v_vehicle.name),
      v_vehicle.assigned_to_name,current_date + 7,'high','open',new.created_by);
  end if;
  return new;
end;
$$;
drop trigger if exists fleet_incident_review_task on public.events;
create trigger fleet_incident_review_task
  after insert or update of vehicle_reg on public.events
  for each row execute function public.flag_fleet_incident_review();
