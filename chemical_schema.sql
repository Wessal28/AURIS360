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
alter table public.chemical_register add column if not exists sds_file_name text;
alter table public.chemical_register add column if not exists hazard_identification text;
alter table public.chemical_register add column if not exists hazard_statements text[];
alter table public.chemical_register add column if not exists hazard_pictograms text[];
alter table public.chemical_register add column if not exists exposure_routes text[];
alter table public.chemical_register add column if not exists exposure_consequences text;
alter table public.chemical_register add column if not exists persons_exposed integer default 0;
alter table public.chemical_register add column if not exists exposure_frequency text default 'occasional';
alter table public.chemical_register add column if not exists exposure_duration text default 'short';
alter table public.chemical_register add column if not exists task_type text default 'closed_handling';
alter table public.chemical_register add column if not exists risk_score integer default 0;
alter table public.chemical_register add column if not exists risk_level text default 'medium';

create index if not exists idx_chemical_register_company on public.chemical_register(company_id);
create index if not exists idx_chemical_register_risk on public.chemical_register(company_id, risk_level);
create index if not exists idx_chemical_register_product on public.chemical_register(company_id, product_name);
