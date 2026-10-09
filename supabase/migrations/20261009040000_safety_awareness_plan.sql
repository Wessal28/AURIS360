begin;

create table if not exists public.safety_awareness_topics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  plan_year integer not null check (plan_year between 2020 and 2100),
  planned_month integer not null check (planned_month between 1 and 12),
  theme text not null check (length(btrim(theme)) between 1 and 200),
  discussion_points text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_awareness_points_required check (cardinality(discussion_points) > 0)
);

create index if not exists safety_awareness_company_year_month_idx
  on public.safety_awareness_topics(company_id, plan_year, planned_month);

alter table public.safety_awareness_topics enable row level security;

create policy safety_awareness_read on public.safety_awareness_topics
  for select to authenticated
  using ((company_id = public.auth_company_id() or public.is_sephs_admin())
    and public.user_access_allowed('meetings.awareness','view'));

create policy safety_awareness_insert on public.safety_awareness_topics
  for insert to authenticated
  with check ((company_id = public.auth_company_id() or public.is_sephs_admin())
    and public.user_access_allowed('meetings.awareness','create')
    and (public.is_sephs_admin() or public.current_user_role() in ('admin','company_admin','hse_manager','hse_officer','manager','site_manager')));

create policy safety_awareness_update on public.safety_awareness_topics
  for update to authenticated
  using ((company_id = public.auth_company_id() or public.is_sephs_admin())
    and public.user_access_allowed('meetings.awareness','edit')
    and (public.is_sephs_admin() or public.current_user_role() in ('admin','company_admin','hse_manager','hse_officer','manager','site_manager')))
  with check ((company_id = public.auth_company_id() or public.is_sephs_admin())
    and public.user_access_allowed('meetings.awareness','edit'));

create policy safety_awareness_delete on public.safety_awareness_topics
  for delete to authenticated
  using ((company_id = public.auth_company_id() or public.is_sephs_admin())
    and public.user_access_allowed('meetings.awareness','delete')
    and (public.is_sephs_admin() or public.current_user_role() in ('admin','company_admin','hse_manager','hse_officer','manager','site_manager')));

grant select, insert, update, delete on public.safety_awareness_topics to authenticated;
notify pgrst, 'reload schema';
commit;
