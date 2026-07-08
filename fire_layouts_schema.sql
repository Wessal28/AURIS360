-- AURIS360 Fire Site Layouts
-- Run once in Supabase SQL Editor.
-- Creates shared fire layout plans and marker positions per company.

create extension if not exists pgcrypto;

create table if not exists public.fire_layouts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  layout_type text not null default 'fire',
  title text not null default 'Fire equipment layout',
  image_url text,
  image_path text,
  markers jsonb not null default '[]'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, layout_type)
);

create index if not exists idx_fire_layouts_company_type
  on public.fire_layouts(company_id, layout_type);

alter table public.fire_layouts enable row level security;

drop policy if exists "fire_layouts_company_read" on public.fire_layouts;
create policy "fire_layouts_company_read"
on public.fire_layouts for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = fire_layouts.company_id)
  )
);

drop policy if exists "fire_layouts_company_manage" on public.fire_layouts;
create policy "fire_layouts_company_manage"
on public.fire_layouts for all
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (p.company_id = fire_layouts.company_id and p.role in ('admin','hse_manager','hse_officer','site_manager'))
      )
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (p.company_id = fire_layouts.company_id and p.role in ('admin','hse_manager','hse_officer','site_manager'))
      )
  )
);

-- Storage bucket for layout images. Public read keeps plan rendering simple in the app.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('layouts', 'layouts', true, 5242880, array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Company folder rule: object path begins with the user's company_id, e.g. <company_id>/fire-layout.png
-- SEPHS admin may manage all layout files.
drop policy if exists "layouts_read" on storage.objects;
create policy "layouts_read"
on storage.objects for select
using (bucket_id = 'layouts');

drop policy if exists "layouts_company_upload" on storage.objects;
create policy "layouts_company_upload"
on storage.objects for insert
with check (
  bucket_id = 'layouts'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or split_part(storage.objects.name, '/', 1) = p.company_id::text
      )
  )
);

drop policy if exists "layouts_company_update" on storage.objects;
create policy "layouts_company_update"
on storage.objects for update
using (
  bucket_id = 'layouts'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or split_part(storage.objects.name, '/', 1) = p.company_id::text
      )
  )
)
with check (
  bucket_id = 'layouts'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or split_part(storage.objects.name, '/', 1) = p.company_id::text
      )
  )
);

drop policy if exists "layouts_company_delete" on storage.objects;
create policy "layouts_company_delete"
on storage.objects for delete
using (
  bucket_id = 'layouts'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or split_part(storage.objects.name, '/', 1) = p.company_id::text
      )
  )
);

notify pgrst, 'reload schema';