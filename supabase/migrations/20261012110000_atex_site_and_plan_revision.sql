-- auris360: allow-data-migration
-- Bind ATEX areas to the same tenant-scoped site identities used by the map.
create unique index if not exists sites_company_id_id_unique_idx
  on public.sites(company_id, id);

alter table public.atex_areas
  add column if not exists site_id uuid,
  add column if not exists last_inspection_result text,
  add column if not exists last_inspection_notes text;

alter table public.atex_areas
  add constraint atex_last_inspection_result_check
  check (last_inspection_result is null or last_inspection_result in ('pass', 'fail'));

alter table public.atex_areas
  add constraint atex_areas_company_site_fkey
  foreign key (company_id, site_id) references public.sites(company_id, id);

create index if not exists idx_atex_areas_company_site
  on public.atex_areas(company_id, site_id);

-- Only an unambiguous exact name or site-code match is safe to reconcile.
with matches as (
  select a.id as area_id, (array_agg(s.id order by s.id))[1] as site_id
  from public.atex_areas a
  join public.sites s on s.company_id = a.company_id
   and (
     lower(trim(a.location)) = lower(trim(s.name))
     or lower(trim(a.location)) = lower(trim(s.site_code))
   )
  where a.site_id is null and nullif(trim(a.location), '') is not null
  group by a.id
  having count(distinct s.id) = 1
)
update public.atex_areas a set site_id = matches.site_id
from matches where a.id = matches.area_id;

-- Changing the underlying plan requires an explicit marker-position review.
alter table public.fire_layouts
  add column if not exists plan_revision integer not null default 1,
  add column if not exists markers_review_required boolean not null default false,
  add column if not exists markers_reviewed_at timestamptz;

alter table public.fire_layouts
  add constraint fire_layouts_plan_revision_check check (plan_revision >= 1);

-- Queue one in-app reminder per area, due date, run date and manager.
create function public.process_atex_inspection_reminders(p_run_date date default current_date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  insert into public.notification_queue
    (company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,
     status,channel,priority,related_id,related_table,related_module,related_ref,
     idempotency_key,metadata)
  select a.company_id,p.id,'atex_inspection_due',
    'ATEX area inspection due: ' || coalesce(a.area_ref,a.area_name),
    '<p>An ATEX area inspection is due. Open the area record and verify its classification and controls.</p>',
    coalesce(nullif(p.real_email,''),p.email),p.full_name,'pending','in_app',
    case when a.next_inspection_date < p_run_date then 'high' else 'normal' end,
    a.id,'atex_areas','atex',coalesce(a.area_ref,a.area_name),
    'atex-inspection/' || a.id::text || '/' || a.next_inspection_date::text || '/' || p_run_date::text || '/' || p.id::text,
    jsonb_build_object('due_date',a.next_inspection_date,'interval_months',a.inspection_interval_months)
  from public.atex_areas a
  join public.profiles p on p.company_id=a.company_id and p.status='active'
    and p.role in ('sephs_admin','admin','manager','hse_manager','site_manager')
  where a.status <> 'archived' and a.next_inspection_date is not null
    and a.next_inspection_date <= p_run_date + 14
    and coalesce(nullif(p.real_email,''),p.email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and coalesce(nullif(p.real_email,''),p.email) !~* '\.local$'
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return jsonb_build_object('run_date',p_run_date,'notifications_queued',v_count);
end;
$$;
revoke all on function public.process_atex_inspection_reminders(date) from public, anon, authenticated;
grant execute on function public.process_atex_inspection_reminders(date) to service_role;
