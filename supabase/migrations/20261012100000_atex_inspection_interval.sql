alter table public.atex_areas
  add column if not exists inspection_interval_months integer not null default 12;

alter table public.atex_areas
  add column if not exists linked_equipment_id uuid references public.tools_register(id) on delete set null;

alter table public.atex_areas
  add constraint atex_inspection_interval_months_check
  check (inspection_interval_months between 1 and 60);

create or replace function public.atex_validate_equipment_company()
returns trigger language plpgsql as $$
begin
  if new.linked_equipment_id is not null and not exists (
    select 1 from public.tools_register equipment
    where equipment.id = new.linked_equipment_id
      and equipment.company_id = new.company_id
  ) then
    raise exception 'Linked equipment must belong to the ATEX area company';
  end if;
  return new;
end;
$$;

create trigger atex_validate_equipment_company
before insert or update of company_id, linked_equipment_id on public.atex_areas
for each row execute function public.atex_validate_equipment_company();
