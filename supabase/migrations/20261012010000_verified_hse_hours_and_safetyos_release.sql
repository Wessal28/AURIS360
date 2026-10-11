begin;

-- Actual exposure hours are entered by period and backed by a source reference.
-- No headcount-derived hours are stored or treated as verified.
create table if not exists public.hse_exposure_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  reporting_year integer not null check (reporting_year between 2020 and 2100),
  reporting_month integer not null check (reporting_month between 1 and 12),
  exposure_hours numeric(14,2) not null check (exposure_hours >= 0),
  source_reference text not null check (length(btrim(source_reference)) between 3 and 500),
  verified_by uuid not null references public.profiles(id),
  verified_at timestamptz not null default now(),
  unique (company_id, reporting_year, reporting_month)
);

create table if not exists public.hse_rate_targets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  reporting_year integer not null check (reporting_year between 2020 and 2100),
  ltifr_target numeric(12,3) check (ltifr_target >= 0),
  trir_target numeric(12,3) check (trir_target >= 0),
  approval_reference text not null check (length(btrim(approval_reference)) between 3 and 500),
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  unique (company_id, reporting_year),
  check (ltifr_target is not null or trir_target is not null)
);

-- Each supervisor action is an immutable decision against a specific advisory.
create table if not exists public.safetyos_supervisor_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  task text not null check (length(btrim(task)) between 3 and 500),
  planned_date date not null,
  location text,
  work_type text,
  worker_id uuid,
  equipment_id uuid,
  risk_assessment_id uuid,
  permit_id uuid,
  advisory_decision text not null check (advisory_decision in ('GO','CONDITIONAL_GO','NO_GO')),
  advisory_snapshot jsonb not null check (jsonb_typeof(advisory_snapshot) = 'object'),
  supervisor_decision text not null check (supervisor_decision in ('released','held')),
  supervisor_note text not null check (length(btrim(supervisor_note)) between 10 and 2000),
  decided_by uuid not null references public.profiles(id),
  decided_at timestamptz not null default now(),
  check (coalesce(advisory_snapshot->>'decision', '') = advisory_decision),
  check (supervisor_decision = 'held' or coalesce(jsonb_array_length(advisory_snapshot->'blocking_items'), 0) = 0)
);

create index if not exists safetyos_supervisor_decisions_scope_idx
  on public.safetyos_supervisor_decisions(company_id, planned_date desc, decided_at desc);

alter table public.hse_exposure_periods enable row level security;
alter table public.hse_rate_targets enable row level security;
alter table public.safetyos_supervisor_decisions enable row level security;

create policy hse_exposure_read on public.hse_exposure_periods for select to authenticated
  using (company_id = public.auth_company_id() or public.is_sephs_admin());
create policy hse_exposure_write on public.hse_exposure_periods for insert to authenticated
  with check ((company_id = public.auth_company_id() or public.is_sephs_admin())
    and verified_by = auth.uid()
    and (public.is_sephs_admin() or public.current_user_role() in ('admin','company_admin','hse_manager')));
create policy hse_exposure_update on public.hse_exposure_periods for update to authenticated
  using ((company_id = public.auth_company_id() or public.is_sephs_admin())
    and (public.is_sephs_admin() or public.current_user_role() in ('admin','company_admin','hse_manager')))
  with check ((company_id = public.auth_company_id() or public.is_sephs_admin())
    and verified_by = auth.uid()
    and (public.is_sephs_admin() or public.current_user_role() in ('admin','company_admin','hse_manager')));

create policy hse_targets_read on public.hse_rate_targets for select to authenticated
  using (company_id = public.auth_company_id() or public.is_sephs_admin());
create policy hse_targets_write on public.hse_rate_targets for insert to authenticated
  with check ((company_id = public.auth_company_id() or public.is_sephs_admin())
    and approved_by = auth.uid()
    and (public.is_sephs_admin() or public.current_user_role() in ('admin','company_admin','hse_manager')));
create policy hse_targets_update on public.hse_rate_targets for update to authenticated
  using ((company_id = public.auth_company_id() or public.is_sephs_admin())
    and (public.is_sephs_admin() or public.current_user_role() in ('admin','company_admin','hse_manager')))
  with check ((company_id = public.auth_company_id() or public.is_sephs_admin())
    and approved_by = auth.uid()
    and (public.is_sephs_admin() or public.current_user_role() in ('admin','company_admin','hse_manager')));

create policy safetyos_decision_read on public.safetyos_supervisor_decisions for select to authenticated
  using (company_id = public.auth_company_id() or public.is_sephs_admin());
create policy safetyos_decision_insert on public.safetyos_supervisor_decisions for insert to authenticated
  with check ((company_id = public.auth_company_id() or public.is_sephs_admin())
    and decided_by = auth.uid()
    and (public.is_sephs_admin() or public.current_user_role() in ('admin','company_admin','hse_manager','manager','site_manager'))
    and (supervisor_decision = 'held' or advisory_decision <> 'NO_GO'));

grant select, insert, update on public.hse_exposure_periods, public.hse_rate_targets to authenticated;
grant select, insert on public.safetyos_supervisor_decisions to authenticated;
notify pgrst, 'reload schema';
commit;
