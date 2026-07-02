-- AURIS360 security / infrastructure / SLA settings
-- Run this once in Supabase SQL Editor.

create table if not exists public.security_sla_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id)
);

alter table public.security_sla_settings enable row level security;

drop policy if exists "security_sla_select_company" on public.security_sla_settings;
create policy "security_sla_select_company"
on public.security_sla_settings
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or p.company_id = security_sla_settings.company_id
      )
  )
);

drop policy if exists "security_sla_insert_admin" on public.security_sla_settings;
create policy "security_sla_insert_admin"
on public.security_sla_settings
for insert
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = security_sla_settings.company_id
          and p.role in ('admin','company_admin','hse_manager')
        )
      )
  )
);

drop policy if exists "security_sla_update_admin" on public.security_sla_settings;
create policy "security_sla_update_admin"
on public.security_sla_settings
for update
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = security_sla_settings.company_id
          and p.role in ('admin','company_admin','hse_manager')
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
          p.company_id = security_sla_settings.company_id
          and p.role in ('admin','company_admin','hse_manager')
        )
      )
  )
);

create or replace function public.set_security_sla_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_security_sla_updated_at on public.security_sla_settings;
create trigger trg_security_sla_updated_at
before update on public.security_sla_settings
for each row execute function public.set_security_sla_updated_at();

notify pgrst, 'reload schema';
