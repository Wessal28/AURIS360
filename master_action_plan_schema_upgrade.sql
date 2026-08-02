-- AURIS360 Master Action Plan schema upgrade
-- Run once in the Supabase SQL editor, then refresh the application.

begin;

alter table public.action_tracker
  add column if not exists action_ref text,
  add column if not exists title text,
  add column if not exists action_type text default 'corrective',
  add column if not exists root_cause text,
  add column if not exists source_type text,
  add column if not exists source_module text,
  add column if not exists source_ref text,
  add column if not exists location text,
  add column if not exists start_date date,
  add column if not exists completed_date date,
  add column if not exists date_extended boolean not null default false,
  add column if not exists extension_reason text,
  add column if not exists estimated_cost numeric,
  add column if not exists actual_cost numeric,
  add column if not exists department text,
  add column if not exists assigned_to_id uuid,
  add column if not exists assigned_to_name text,
  add column if not exists assigned_by text,
  add column if not exists assigned_date date,
  add column if not exists instructions text,
  add column if not exists escalated boolean not null default false,
  add column if not exists escalated_to text,
  add column if not exists escalation_level integer not null default 0,
  add column if not exists escalation_reason text,
  add column if not exists escalated_at timestamptz,
  add column if not exists progress_pct integer not null default 0,
  add column if not exists progress_notes text,
  add column if not exists evidence text,
  add column if not exists comments text,
  add column if not exists requires_verification boolean not null default true,
  add column if not exists verified_by text,
  add column if not exists verified_date date,
  add column if not exists verification_method text,
  add column if not exists verification_notes text,
  add column if not exists verification_status text default 'not_required',
  add column if not exists requires_closure_approval boolean not null default false,
  add column if not exists closure_approved_by text,
  add column if not exists closure_approved_date date,
  add column if not exists closure_notes text,
  add column if not exists closure_rejected_reason text,
  add column if not exists effectiveness_rating integer,
  add column if not exists recurrence_prevented boolean,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_action_tracker_company_status
  on public.action_tracker(company_id, status);
create index if not exists idx_action_tracker_company_target
  on public.action_tracker(company_id, target_date);
create index if not exists idx_action_tracker_company_ref
  on public.action_tracker(company_id, action_ref)
  where action_ref is not null;

create table if not exists public.map_activity_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  action_id uuid not null references public.action_tracker(id) on delete cascade,
  activity_type text not null,
  performed_by text,
  old_value text,
  new_value text,
  notes text,
  performed_at timestamptz not null default now()
);

alter table public.map_activity_log
  add column if not exists company_id uuid,
  add column if not exists action_id uuid,
  add column if not exists activity_type text,
  add column if not exists performed_by text,
  add column if not exists old_value text,
  add column if not exists new_value text,
  add column if not exists notes text,
  add column if not exists performed_at timestamptz not null default now();

create index if not exists idx_map_activity_log_action_time
  on public.map_activity_log(action_id, performed_at desc);
create index if not exists idx_map_activity_log_company
  on public.map_activity_log(company_id);

alter table public.map_activity_log enable row level security;

drop policy if exists "map_activity_log_company_access" on public.map_activity_log;
create policy "map_activity_log_company_access"
  on public.map_activity_log
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'sephs_admin' or p.company_id = map_activity_log.company_id)
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'sephs_admin' or p.company_id = map_activity_log.company_id)
    )
  );

grant select, insert, update, delete on public.map_activity_log to authenticated;

commit;

notify pgrst, 'reload schema';
