-- AURIS360 AP-062 controlled tenant rollout.
-- Safe to rerun. Existing companies.module_access remains the compatibility layer.

begin;

create table if not exists public.company_rollout_cohorts (
  company_id uuid not null references public.companies(id) on delete cascade,
  cohort_key text not null check (cohort_key in ('core_control','controlled_content','people_health','specialist_operations')),
  status text not null default 'disabled' check (status in ('disabled','pilot','enabled','paused')),
  module_keys text[] not null default '{}',
  compatibility_reads boolean not null default true,
  gate_results jsonb not null default '{}'::jsonb,
  notes text,
  enabled_at timestamptz,
  enabled_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, cohort_key)
);

create table if not exists public.rollout_health_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  cohort_key text check (cohort_key in ('core_control','controlled_content','people_health','specialist_operations')),
  module_key text,
  event_type text not null check (event_type in ('module_error','orphan_relationship','failed_deep_link','approval_discrepancy')),
  severity text not null default 'warning' check (severity in ('info','warning','error','critical')),
  record_table text,
  record_id text,
  record_ref text,
  fingerprint text,
  detail jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz not null default now()
);

-- Rollback is a controlled status transition, never deletion. This ledger
-- preserves who changed a cohort and the gate evidence at that moment.
create table if not exists public.rollout_cohort_transitions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  cohort_key text not null check (cohort_key in ('core_control','controlled_content','people_health','specialist_operations')),
  previous_status text check (previous_status is null or previous_status in ('disabled','pilot','enabled','paused')),
  new_status text not null check (new_status in ('disabled','pilot','enabled','paused')),
  gate_results jsonb not null default '{}'::jsonb,
  compatibility_reads boolean not null default true,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index if not exists rollout_cohort_transitions_company_time
  on public.rollout_cohort_transitions(company_id, cohort_key, changed_at desc);

create or replace function public.audit_rollout_cohort_transition()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='INSERT' or old.status is distinct from new.status then
    insert into public.rollout_cohort_transitions(
      company_id,cohort_key,previous_status,new_status,gate_results,
      compatibility_reads,changed_by
    ) values (
      new.company_id,new.cohort_key,
      case when tg_op='INSERT' then null else old.status end,
      new.status,new.gate_results,new.compatibility_reads,auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists company_rollout_cohort_transition_audit on public.company_rollout_cohorts;
create trigger company_rollout_cohort_transition_audit
after insert or update of status on public.company_rollout_cohorts
for each row execute function public.audit_rollout_cohort_transition();

create index if not exists rollout_health_events_company_time
  on public.rollout_health_events(company_id, created_at desc);
create index if not exists rollout_health_events_open
  on public.rollout_health_events(company_id, event_type, severity)
  where resolved_at is null;
create unique index if not exists rollout_health_events_open_fingerprint
  on public.rollout_health_events(company_id, event_type, fingerprint)
  where fingerprint is not null and resolved_at is null;

create or replace view public.rollout_cohort_health_summary
with (security_invoker=true)
as
select c.company_id,c.cohort_key,c.status,c.module_keys,c.compatibility_reads,c.gate_results,c.updated_at,
       count(e.id) filter (where e.resolved_at is null)::integer as open_findings,
       count(e.id) filter (where e.resolved_at is null and e.event_type='module_error')::integer as module_errors,
       count(e.id) filter (where e.resolved_at is null and e.event_type='orphan_relationship')::integer as orphan_relationships,
       count(e.id) filter (where e.resolved_at is null and e.event_type='failed_deep_link')::integer as failed_deep_links,
       count(e.id) filter (where e.resolved_at is null and e.event_type='approval_discrepancy')::integer as approval_discrepancies,
       max(e.created_at) as last_finding_at
from public.company_rollout_cohorts c
left join public.rollout_health_events e
  on e.company_id=c.company_id and (e.cohort_key=c.cohort_key or e.cohort_key is null)
group by c.company_id,c.cohort_key,c.status,c.module_keys,c.compatibility_reads,c.gate_results,c.updated_at;

alter table public.company_rollout_cohorts enable row level security;
alter table public.rollout_health_events enable row level security;
alter table public.rollout_cohort_transitions enable row level security;

drop policy if exists "rollout_cohorts_tenant_read" on public.company_rollout_cohorts;
create policy "rollout_cohorts_tenant_read" on public.company_rollout_cohorts
for select using (exists (
  select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=company_rollout_cohorts.company_id and p.role in ('admin','hse_manager','hse_officer')))
));
drop policy if exists "rollout_cohorts_platform_write" on public.company_rollout_cohorts;
create policy "rollout_cohorts_platform_write" on public.company_rollout_cohorts
for all using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='sephs_admin'))
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='sephs_admin'));

drop policy if exists "rollout_health_tenant_read" on public.rollout_health_events;
create policy "rollout_health_tenant_read" on public.rollout_health_events
for select using (exists (
  select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=rollout_health_events.company_id and p.role in ('admin','hse_manager','hse_officer')))
));
drop policy if exists "rollout_health_authenticated_insert" on public.rollout_health_events;
create policy "rollout_health_authenticated_insert" on public.rollout_health_events
for insert with check (exists (
  select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or p.company_id=rollout_health_events.company_id)
));
drop policy if exists "rollout_health_platform_update" on public.rollout_health_events;
create policy "rollout_health_platform_update" on public.rollout_health_events
for update using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='sephs_admin'))
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='sephs_admin'));

drop policy if exists "rollout_transitions_tenant_read" on public.rollout_cohort_transitions;
create policy "rollout_transitions_tenant_read" on public.rollout_cohort_transitions
for select using (exists (
  select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=rollout_cohort_transitions.company_id and p.role in ('admin','hse_manager','hse_officer')))
));

grant select on public.company_rollout_cohorts,public.rollout_cohort_health_summary to authenticated;
grant insert,update on public.company_rollout_cohorts to authenticated;
grant select,insert,update on public.rollout_health_events to authenticated;
grant select on public.rollout_cohort_transitions to authenticated;
revoke delete on public.company_rollout_cohorts from authenticated;
revoke insert,update,delete on public.rollout_cohort_transitions from authenticated;
revoke all on public.company_rollout_cohorts,public.rollout_health_events,public.rollout_cohort_transitions from anon;

commit;
