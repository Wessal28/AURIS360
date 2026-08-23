begin;

create table if not exists public.work_schedule_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  work_order_id uuid not null references public.work_schedule(id) on delete cascade,
  link_type text not null check (link_type in ('tbt','prestart','site','ra','ptw','event','equipment')),
  record_id uuid,
  record_ref text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (work_order_id, link_type, record_id),
  check (record_id is not null or nullif(btrim(record_ref),'') is not null)
);

create index if not exists work_schedule_links_company_work_idx on public.work_schedule_links(company_id,work_order_id,link_type);
alter table public.work_schedule_links enable row level security;

drop policy if exists work_schedule_links_select_company on public.work_schedule_links;
create policy work_schedule_links_select_company on public.work_schedule_links for select using (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=work_schedule_links.company_id)));
drop policy if exists work_schedule_links_insert_company on public.work_schedule_links;
create policy work_schedule_links_insert_company on public.work_schedule_links for insert with check (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=work_schedule_links.company_id)));
drop policy if exists work_schedule_links_update_company on public.work_schedule_links;
create policy work_schedule_links_update_company on public.work_schedule_links for update using (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=work_schedule_links.company_id))) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=work_schedule_links.company_id)));
drop policy if exists work_schedule_links_delete_company on public.work_schedule_links;
create policy work_schedule_links_delete_company on public.work_schedule_links for delete using (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=work_schedule_links.company_id)));

grant select,insert,update,delete on public.work_schedule_links to authenticated;

commit;
