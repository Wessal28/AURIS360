-- Preserve the factor actually used and prevent incompatible new fuel readings.
alter table public.fuel_consumption add column if not exists factor_value numeric;
alter table public.fuel_consumption add column if not exists factor_unit text;
alter table public.fuel_consumption add column if not exists factor_source text;
alter table public.fuel_consumption add column if not exists factor_version text;
alter table public.fuel_consumption add constraint fuel_consumption_type_unit_check
  check (fuel_type='other' or
    (fuel_type in ('diesel','petrol','lpg','heavy_fuel_oil') and unit='litres') or
    (fuel_type='natural_gas' and unit='m3') or
    (fuel_type='electricity' and unit='kwh')) not valid;

-- A new inspection has no outcome until an inspector explicitly records one.
alter table public.environmental_inspections alter column overall_rating drop default;

alter table public.hazardous_waste add column if not exists chemical_id uuid references public.chemical_register(id);
alter table public.spill_reports add column if not exists chemical_id uuid references public.chemical_register(id);
alter table public.spill_reports add column if not exists waste_record_id uuid references public.waste_records(id);
alter table public.spill_reports add column if not exists action_id uuid references public.action_tracker(id);

create function public.esg_link_company_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.chemical_id is not null and not exists
    (select 1 from public.chemical_register c where c.id=new.chemical_id and c.company_id=new.company_id) then
    raise exception 'Linked chemical must belong to the selected company'; end if;
  if tg_table_name='spill_reports' then
    if new.waste_record_id is not null and not exists
      (select 1 from public.waste_records w where w.id=new.waste_record_id and w.company_id=new.company_id) then
      raise exception 'Linked waste record must belong to the selected company'; end if;
    if new.action_id is not null and not exists
      (select 1 from public.action_tracker a where a.id=new.action_id and a.company_id=new.company_id) then
      raise exception 'Linked corrective action must belong to the selected company'; end if;
  end if;
  return new;
end $$;
create trigger hazardous_waste_link_company_guard before insert or update of company_id,chemical_id
on public.hazardous_waste for each row execute function public.esg_link_company_guard();
create trigger spill_report_link_company_guard before insert or update of company_id,chemical_id,waste_record_id,action_id
on public.spill_reports for each row execute function public.esg_link_company_guard();
