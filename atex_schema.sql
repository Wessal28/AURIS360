-- AURIS360 ATEX / Hazardous Area Management
-- Run this in Supabase SQL Editor before using the ATEX module.

create table if not exists public.atex_areas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  area_ref text,
  area_name text not null,
  location text,
  plant_area text,
  zone_type text not null default 'zone_2',
  material_type text default 'gas_vapour',
  substance text,
  source_of_release text,
  ventilation_controls text,
  ignition_controls text,
  detection_controls text,
  linked_equipment text,
  linked_ra_ref text,
  linked_permit_type text,
  last_inspection_date date,
  next_inspection_date date,
  status text not null default 'controlled',
  responsible_person text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_atex_areas_company on public.atex_areas(company_id);
create index if not exists idx_atex_areas_zone on public.atex_areas(zone_type);
create index if not exists idx_atex_areas_next_inspection on public.atex_areas(next_inspection_date);

alter table public.atex_areas enable row level security;

drop policy if exists "atex_areas_select_company" on public.atex_areas;
create policy "atex_areas_select_company"
on public.atex_areas for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or p.company_id = atex_areas.company_id
      )
  )
);

drop policy if exists "atex_areas_insert_company" on public.atex_areas;
create policy "atex_areas_insert_company"
on public.atex_areas for insert
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = atex_areas.company_id
          and p.role in ('company_admin','admin','hse_manager','site_manager','supervisor')
        )
      )
  )
);

drop policy if exists "atex_areas_update_company" on public.atex_areas;
create policy "atex_areas_update_company"
on public.atex_areas for update
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = atex_areas.company_id
          and p.role in ('company_admin','admin','hse_manager','site_manager','supervisor')
        )
      )
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = atex_areas.company_id
          and p.role in ('company_admin','admin','hse_manager','site_manager','supervisor')
        )
      )
  )
);

drop policy if exists "atex_areas_delete_company" on public.atex_areas;
create policy "atex_areas_delete_company"
on public.atex_areas for delete
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = atex_areas.company_id
          and p.role in ('company_admin','admin','hse_manager')
        )
      )
  )
);
