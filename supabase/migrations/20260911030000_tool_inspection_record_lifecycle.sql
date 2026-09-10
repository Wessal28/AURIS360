-- Govern equipment inspection record removal through archive-first lifecycle.
alter table public.tool_inspections
  add column if not exists status text not null default 'active',
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid,
  add column if not exists archived_by_name text,
  add column if not exists archive_reason text,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.tool_inspections'::regclass
      and conname='tool_inspections_status_check'
  ) then
    alter table public.tool_inspections
      add constraint tool_inspections_status_check check (status in ('active','archived'));
  end if;
end $$;

create index if not exists tool_inspections_company_status_date_idx
  on public.tool_inspections(company_id,status,inspection_date desc);

drop policy if exists tenant_all on public.tool_inspections;
drop policy if exists tool_inspections_tenant_read on public.tool_inspections;
drop policy if exists tool_inspections_operational_insert on public.tool_inspections;
drop policy if exists tool_inspections_operational_update on public.tool_inspections;
drop policy if exists tool_inspections_admin_delete_archived on public.tool_inspections;

create policy tool_inspections_tenant_read on public.tool_inspections
for select to authenticated
using (company_id=public.auth_company_id() or public.is_sephs_admin());

create policy tool_inspections_operational_insert on public.tool_inspections
for insert to authenticated
with check (
  exists (
    select 1 from public.profiles actor
    where actor.id=auth.uid()
      and (actor.role='sephs_admin' or (
        actor.company_id=tool_inspections.company_id
        and actor.role in ('admin','company_admin','hse_manager','hse_officer','manager','site_manager','supervisor','inspector','auditor')
      ))
  )
);

create policy tool_inspections_operational_update on public.tool_inspections
for update to authenticated
using (
  exists (
    select 1 from public.profiles actor
    where actor.id=auth.uid()
      and (actor.role='sephs_admin' or (
        actor.company_id=tool_inspections.company_id
        and actor.role in ('admin','company_admin','hse_manager','hse_officer','manager','site_manager','supervisor','inspector','auditor')
      ))
  )
)
with check (
  exists (
    select 1 from public.profiles actor
    where actor.id=auth.uid()
      and (actor.role='sephs_admin' or (
        actor.company_id=tool_inspections.company_id
        and actor.role in ('admin','company_admin','hse_manager','hse_officer','manager','site_manager','supervisor','inspector','auditor')
      ))
  )
);

create policy tool_inspections_admin_delete_archived on public.tool_inspections
for delete to authenticated
using (
  status='archived'
  and exists (
    select 1 from public.profiles actor
    where actor.id=auth.uid()
      and (actor.role='sephs_admin' or (
        actor.company_id=tool_inspections.company_id
        and actor.role in ('admin','company_admin')
      ))
  )
);

comment on column public.tool_inspections.status is
  'Record lifecycle: active records are operational; archived records are retained for audit and may only be permanently deleted by administrators.';
