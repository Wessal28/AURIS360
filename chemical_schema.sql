-- AURIS360 Chemical Control / COSHH schema
-- Run this once in Supabase SQL Editor before using the Chemical Control module.

create table if not exists public.chemical_register (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  chemical_ref text,
  product_name text not null,
  supplier text,
  manufacturer text,
  sds_file_name text,
  sds_revision_date date,
  signal_word text,
  hazard_identification text,
  hazard_statements text[],
  hazard_pictograms text[],
  exposure_routes text[],
  exposure_consequences text,
  first_aid text,
  handling_storage text,
  ppe_required text,
  location text,
  department text,
  process_use text,
  quantity_stored text,
  persons_exposed integer default 0,
  exposure_frequency text default 'occasional',
  exposure_duration text default 'short',
  task_type text default 'closed_handling',
  existing_controls text,
  risk_score integer default 0,
  risk_level text default 'medium',
  recommendations text,
  status text default 'active',
  review_date date,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.chemical_register add column if not exists chemical_ref text;
alter table public.chemical_register add column if not exists supplier text;
alter table public.chemical_register add column if not exists manufacturer text;
alter table public.chemical_register add column if not exists sds_file_name text;
alter table public.chemical_register add column if not exists sds_revision_date date;
alter table public.chemical_register add column if not exists signal_word text;
alter table public.chemical_register add column if not exists hazard_identification text;
alter table public.chemical_register add column if not exists hazard_statements text[];
alter table public.chemical_register add column if not exists hazard_pictograms text[];
alter table public.chemical_register add column if not exists exposure_routes text[];
alter table public.chemical_register add column if not exists exposure_consequences text;
alter table public.chemical_register add column if not exists first_aid text;
alter table public.chemical_register add column if not exists handling_storage text;
alter table public.chemical_register add column if not exists ppe_required text;
alter table public.chemical_register add column if not exists location text;
alter table public.chemical_register add column if not exists department text;
alter table public.chemical_register add column if not exists process_use text;
alter table public.chemical_register add column if not exists quantity_stored text;
alter table public.chemical_register add column if not exists persons_exposed integer default 0;
alter table public.chemical_register add column if not exists exposure_frequency text default 'occasional';
alter table public.chemical_register add column if not exists exposure_duration text default 'short';
alter table public.chemical_register add column if not exists task_type text default 'closed_handling';
alter table public.chemical_register add column if not exists existing_controls text;
alter table public.chemical_register add column if not exists risk_score integer default 0;
alter table public.chemical_register add column if not exists risk_level text default 'medium';
alter table public.chemical_register add column if not exists recommendations text;
alter table public.chemical_register add column if not exists status text default 'active';
alter table public.chemical_register add column if not exists review_date date;
alter table public.chemical_register add column if not exists created_by uuid;
alter table public.chemical_register add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_chemical_register_company on public.chemical_register(company_id);
create index if not exists idx_chemical_register_risk on public.chemical_register(company_id, risk_level);
create index if not exists idx_chemical_register_product on public.chemical_register(company_id, product_name);

alter table public.chemical_register enable row level security;

drop policy if exists "chemical_register_select_company" on public.chemical_register;
create policy "chemical_register_select_company"
on public.chemical_register
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or p.company_id = chemical_register.company_id
      )
  )
);

drop policy if exists "chemical_register_insert_company" on public.chemical_register;
create policy "chemical_register_insert_company"
on public.chemical_register
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = chemical_register.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
);

drop policy if exists "chemical_register_update_company" on public.chemical_register;
create policy "chemical_register_update_company"
on public.chemical_register
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = chemical_register.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = chemical_register.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
);

drop policy if exists "chemical_register_delete_company" on public.chemical_register;
create policy "chemical_register_delete_company"
on public.chemical_register
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = chemical_register.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
);

notify pgrst, 'reload schema';
