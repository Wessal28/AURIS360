-- AURIS360 - No-code custom fields
-- Run once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  module_key text not null,
  field_label text not null,
  field_key text not null,
  field_type text not null check (field_type in ('text','number','date','textarea','select','checkbox')),
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, module_key, field_key)
);

create table if not exists public.custom_field_values (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  record_table text not null,
  record_id uuid not null,
  field_id uuid not null references public.custom_fields(id) on delete cascade,
  field_key text not null,
  value jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(record_table, record_id, field_id)
);

create index if not exists idx_custom_fields_company_module
  on public.custom_fields(company_id, module_key, active, sort_order);

create index if not exists idx_custom_field_values_record
  on public.custom_field_values(record_table, record_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_custom_fields_updated_at on public.custom_fields;
create trigger trg_custom_fields_updated_at
before update on public.custom_fields
for each row execute function public.touch_updated_at();

drop trigger if exists trg_custom_field_values_updated_at on public.custom_field_values;
create trigger trg_custom_field_values_updated_at
before update on public.custom_field_values
for each row execute function public.touch_updated_at();

alter table public.custom_fields enable row level security;
alter table public.custom_field_values enable row level security;

drop policy if exists custom_fields_select_company on public.custom_fields;
create policy custom_fields_select_company on public.custom_fields
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = custom_fields.company_id)
  )
);

drop policy if exists custom_fields_manage_company_admin on public.custom_fields;
create policy custom_fields_manage_company_admin on public.custom_fields
for all using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (p.company_id = custom_fields.company_id and p.role in ('admin','company_admin','hse_manager'))
      )
  )
) with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (p.company_id = custom_fields.company_id and p.role in ('admin','company_admin','hse_manager'))
      )
  )
);

drop policy if exists custom_field_values_select_company on public.custom_field_values;
create policy custom_field_values_select_company on public.custom_field_values
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = custom_field_values.company_id)
  )
);

drop policy if exists custom_field_values_write_company on public.custom_field_values;
create policy custom_field_values_write_company on public.custom_field_values
for all using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = custom_field_values.company_id)
  )
) with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = custom_field_values.company_id)
  )
);

notify pgrst, 'reload schema';
