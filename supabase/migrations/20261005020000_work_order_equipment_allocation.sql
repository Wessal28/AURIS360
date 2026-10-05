begin;

-- A work-order equipment link is an allocation from store while the work is
-- open. Completed and cancelled orders retain their links as history, but no
-- longer reserve the equipment. Lock the equipment row so concurrent users
-- cannot allocate the same item to two jobs.
create or replace function public.guard_work_equipment_allocation()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  work_row public.work_schedule%rowtype;
  equipment_row public.tools_register%rowtype;
begin
  if new.link_type <> 'equipment' then return new; end if;
  if new.record_id is null then
    raise exception 'Select equipment from the register' using errcode = '23514';
  end if;

  select * into work_row from public.work_schedule
    where id = new.work_order_id for key share;
  if not found or work_row.company_id is distinct from new.company_id then
    raise exception 'Work order is unavailable for this company' using errcode = '23514';
  end if;
  select * into equipment_row from public.tools_register
    where id = new.record_id for update;
  if not found or equipment_row.company_id is distinct from new.company_id then
    raise exception 'Equipment is unavailable in this company register' using errcode = '23514';
  end if;
  -- Historical equipment can be recorded on a closed job without checking it
  -- out of store or blocking a later active job.
  if work_row.status in ('completed', 'cancelled') then return new; end if;
  if equipment_row.status is distinct from 'active' or equipment_row.assigned_to is not null then
    raise exception 'Equipment is not available in store' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.work_schedule_links link
    join public.work_schedule other_work on other_work.id = link.work_order_id
    where link.link_type = 'equipment' and link.record_id = new.record_id
      and link.work_order_id <> new.work_order_id
      and other_work.status not in ('completed', 'cancelled')
  ) then
    raise exception 'Equipment is already allocated to another active work order' using errcode = '23505';
  end if;
  return new;
end $$;

drop trigger if exists guard_work_equipment_allocation on public.work_schedule_links;
create trigger guard_work_equipment_allocation
before insert or update of company_id, work_order_id, link_type, record_id
on public.work_schedule_links for each row
execute function public.guard_work_equipment_allocation();

-- Reopening a completed job must not silently reserve equipment that was
-- subsequently allocated to another job.
create or replace function public.guard_work_equipment_reopen()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $$
declare equipment_id uuid;
begin
  if old.status in ('completed', 'cancelled')
     and new.status not in ('completed', 'cancelled') then
    for equipment_id in
      select record_id from public.work_schedule_links
      where work_order_id = new.id and link_type = 'equipment'
        and record_id is not null order by record_id
    loop
      perform 1 from public.tools_register
        where id = equipment_id and status = 'active' and assigned_to is null
        for update;
      if not found then
        raise exception 'Return or replace equipment no longer available in store before reopening this job' using errcode = '23514';
      end if;
      if exists (
        select 1 from public.work_schedule_links link
        join public.work_schedule other_work on other_work.id = link.work_order_id
        where link.link_type = 'equipment' and link.record_id = equipment_id
          and link.work_order_id <> new.id
          and other_work.status not in ('completed', 'cancelled')
      ) then
        raise exception 'Return or remove equipment already allocated to another work order before reopening this job' using errcode = '23505';
      end if;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists guard_work_equipment_reopen on public.work_schedule;
create trigger guard_work_equipment_reopen before update of status
on public.work_schedule for each row
execute function public.guard_work_equipment_reopen();

-- Personal custody cannot be granted while an active job holds the same item.
create or replace function public.guard_work_equipment_person_assignment()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $$
begin
  if new.assigned_to is not null and new.assigned_to is distinct from old.assigned_to
     and exists (
       select 1 from public.work_schedule_links link
       join public.work_schedule work on work.id = link.work_order_id
       where link.link_type = 'equipment' and link.record_id = new.id
         and work.status not in ('completed', 'cancelled')
     ) then
    raise exception 'Return equipment from its active work order before assigning it to a person' using errcode = '23505';
  end if;
  return new;
end $$;

drop trigger if exists guard_work_equipment_person_assignment on public.tools_register;
create trigger guard_work_equipment_person_assignment before update of assigned_to
on public.tools_register for each row
execute function public.guard_work_equipment_person_assignment();

revoke all on function public.guard_work_equipment_allocation() from public, anon, authenticated;
revoke all on function public.guard_work_equipment_reopen() from public, anon, authenticated;
revoke all on function public.guard_work_equipment_person_assignment() from public, anon, authenticated;
commit;
