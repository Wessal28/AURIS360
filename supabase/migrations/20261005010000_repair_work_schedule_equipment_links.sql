begin;

-- Repair deployments where the Work Schedule link migration was not applied
-- before the application began using equipment links. Existing rows are kept.
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

create index if not exists work_schedule_links_company_work_idx
  on public.work_schedule_links(company_id, work_order_id, link_type);
alter table public.work_schedule_links enable row level security;

drop policy if exists work_schedule_links_select_company on public.work_schedule_links;
create policy work_schedule_links_select_company on public.work_schedule_links
  for select to authenticated using (exists (
    select 1 from public.profiles p where p.id=auth.uid()
      and (p.role='sephs_admin' or p.company_id=work_schedule_links.company_id)
  ));
drop policy if exists work_schedule_links_insert_company on public.work_schedule_links;
create policy work_schedule_links_insert_company on public.work_schedule_links
  for insert to authenticated with check (exists (
    select 1 from public.profiles p where p.id=auth.uid()
      and (p.role='sephs_admin' or p.company_id=work_schedule_links.company_id)
  ));
drop policy if exists work_schedule_links_update_company on public.work_schedule_links;
create policy work_schedule_links_update_company on public.work_schedule_links
  for update to authenticated using (exists (
    select 1 from public.profiles p where p.id=auth.uid()
      and (p.role='sephs_admin' or p.company_id=work_schedule_links.company_id)
  )) with check (exists (
    select 1 from public.profiles p where p.id=auth.uid()
      and (p.role='sephs_admin' or p.company_id=work_schedule_links.company_id)
  ));
drop policy if exists work_schedule_links_delete_company on public.work_schedule_links;
create policy work_schedule_links_delete_company on public.work_schedule_links
  for delete to authenticated using (exists (
    select 1 from public.profiles p where p.id=auth.uid()
      and (p.role='sephs_admin' or p.company_id=work_schedule_links.company_id)
  ));

do $access$ begin
  if to_regprocedure('public.user_access_allowed(text,text)') is not null
     and to_regprocedure('public.guard_module_user_access()') is not null then
    drop policy if exists user_module_view on public.work_schedule_links;
    drop policy if exists user_module_create on public.work_schedule_links;
    drop policy if exists user_module_edit on public.work_schedule_links;
    drop policy if exists user_module_delete on public.work_schedule_links;
    drop trigger if exists module_user_access_guard on public.work_schedule_links;
    create policy user_module_view on public.work_schedule_links as restrictive
      for select to authenticated using (public.user_access_allowed('workschedule','view'));
    create policy user_module_create on public.work_schedule_links as restrictive
      for insert to authenticated with check (public.user_access_allowed('workschedule','create'));
    create policy user_module_edit on public.work_schedule_links as restrictive
      for update to authenticated using (public.user_access_allowed('workschedule','edit'))
      with check (public.user_access_allowed('workschedule','edit'));
    create policy user_module_delete on public.work_schedule_links as restrictive
      for delete to authenticated using (public.user_access_allowed('workschedule','delete'));
    create trigger module_user_access_guard before insert or update or delete
      on public.work_schedule_links for each row
      execute function public.guard_module_user_access('workschedule');
  end if;
end $access$;

grant select, insert, update, delete on public.work_schedule_links to authenticated;
notify pgrst, 'reload schema';
commit;
