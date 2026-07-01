-- AURIS360 professional platform foundations
-- Run this once in Supabase SQL Editor.
-- It is safe to re-run: tables/columns/policies are created with IF NOT EXISTS where possible.

create extension if not exists pgcrypto;

-- 1) Global chronological audit trail
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  actor_user_id uuid null,
  actor_name text,
  actor_role text,
  action text not null,
  module_name text,
  related_table text,
  related_id uuid null,
  summary text,
  details jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_company_created
  on public.audit_events(company_id, created_at desc);

create index if not exists idx_audit_events_related
  on public.audit_events(related_table, related_id);

alter table public.audit_events enable row level security;

drop policy if exists "audit_events_select_company_admins" on public.audit_events;
create policy "audit_events_select_company_admins"
on public.audit_events for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (p.company_id = audit_events.company_id and p.role in ('admin','hse_manager','hse_officer'))
      )
  )
);

drop policy if exists "audit_events_insert_authenticated" on public.audit_events;
create policy "audit_events_insert_authenticated"
on public.audit_events for insert
with check (auth.uid() is not null);

-- 2) Generic approval workflow engine
create table if not exists public.approval_workflows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  module_name text not null,
  workflow_name text not null,
  applies_to text,
  is_active boolean not null default true,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.approval_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.approval_workflows(id) on delete cascade,
  step_no int not null,
  approver_role text,
  approver_person_id uuid null,
  approver_name text,
  approver_email text,
  required boolean not null default true,
  notify_channels text[] not null default array['email','in_app']::text[],
  created_at timestamptz not null default now(),
  unique(workflow_id, step_no)
);

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  module_name text not null,
  related_table text not null,
  related_id uuid not null,
  workflow_id uuid null references public.approval_workflows(id) on delete set null,
  current_step_no int not null default 1,
  status text not null default 'pending',
  submitted_by uuid null,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz null,
  released_by uuid null,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.approval_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  step_no int not null,
  decision text not null,
  decided_by uuid null,
  decided_by_name text,
  comments text,
  decided_at timestamptz not null default now()
);

create index if not exists idx_approval_requests_company_status
  on public.approval_requests(company_id, status, created_at desc);

alter table public.approval_workflows enable row level security;
alter table public.approval_workflow_steps enable row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_decisions enable row level security;

drop policy if exists "approval_workflows_company_read" on public.approval_workflows;
create policy "approval_workflows_company_read" on public.approval_workflows for select
using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role='sephs_admin' or p.company_id = approval_workflows.company_id)));

drop policy if exists "approval_workflows_company_manage" on public.approval_workflows;
create policy "approval_workflows_company_manage" on public.approval_workflows for all
using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role='sephs_admin' or (p.company_id = approval_workflows.company_id and p.role in ('admin','hse_manager')))))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role='sephs_admin' or (p.company_id = approval_workflows.company_id and p.role in ('admin','hse_manager')))));

drop policy if exists "approval_steps_company_read" on public.approval_workflow_steps;
create policy "approval_steps_company_read" on public.approval_workflow_steps for select
using (exists (select 1 from public.approval_workflows w join public.profiles p on p.id = auth.uid() where w.id = approval_workflow_steps.workflow_id and (p.role='sephs_admin' or p.company_id = w.company_id)));

drop policy if exists "approval_steps_company_manage" on public.approval_workflow_steps;
create policy "approval_steps_company_manage" on public.approval_workflow_steps for all
using (exists (select 1 from public.approval_workflows w join public.profiles p on p.id = auth.uid() where w.id = approval_workflow_steps.workflow_id and (p.role='sephs_admin' or (p.company_id = w.company_id and p.role in ('admin','hse_manager')))))
with check (exists (select 1 from public.approval_workflows w join public.profiles p on p.id = auth.uid() where w.id = approval_workflow_steps.workflow_id and (p.role='sephs_admin' or (p.company_id = w.company_id and p.role in ('admin','hse_manager')))));

drop policy if exists "approval_requests_company_access" on public.approval_requests;
create policy "approval_requests_company_access" on public.approval_requests for all
using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role='sephs_admin' or p.company_id = approval_requests.company_id)))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role='sephs_admin' or p.company_id = approval_requests.company_id)));

drop policy if exists "approval_decisions_company_access" on public.approval_decisions;
create policy "approval_decisions_company_access" on public.approval_decisions for all
using (exists (select 1 from public.approval_requests r join public.profiles p on p.id = auth.uid() where r.id = approval_decisions.request_id and (p.role='sephs_admin' or p.company_id = r.company_id)))
with check (exists (select 1 from public.approval_requests r join public.profiles p on p.id = auth.uid() where r.id = approval_decisions.request_id and (p.role='sephs_admin' or p.company_id = r.company_id)));

-- 3) Notification channel support
alter table public.notification_queue
  add column if not exists channel text not null default 'email',
  add column if not exists to_phone text,
  add column if not exists in_app_seen_at timestamptz,
  add column if not exists priority text not null default 'normal',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.notification_queue
  drop constraint if exists notification_queue_channel_check;

alter table public.notification_queue
  add constraint notification_queue_channel_check
  check (channel in ('email','in_app','whatsapp','sms'));

alter table public.notification_queue
  drop constraint if exists notification_queue_priority_check;

alter table public.notification_queue
  add constraint notification_queue_priority_check
  check (priority in ('low','normal','high','urgent'));

alter table public.profiles
  add column if not exists real_email text,
  add column if not exists mobile_phone text,
  add column if not exists whatsapp_phone text,
  add column if not exists preferred_notification_channel text default 'in_app',
  add column if not exists notification_notes text;

alter table public.profiles
  drop constraint if exists profiles_preferred_notification_channel_check;

alter table public.profiles
  add constraint profiles_preferred_notification_channel_check
  check (preferred_notification_channel in ('in_app', 'email', 'whatsapp', 'sms'));

-- 4) Training matrix / competency requirements
create table if not exists public.training_requirements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  role_name text,
  job_title text,
  department text,
  training_title text not null,
  training_code text,
  mandatory boolean not null default true,
  validity_months int,
  refresher_months int,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_training_requirements_company
  on public.training_requirements(company_id, role_name, job_title);

alter table public.training_requirements enable row level security;

drop policy if exists "training_requirements_company_access" on public.training_requirements;
create policy "training_requirements_company_access" on public.training_requirements for all
using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role='sephs_admin' or p.company_id = training_requirements.company_id)))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role='sephs_admin' or p.company_id = training_requirements.company_id)));

-- 5) QR code registry for equipment, chemicals, permits, documents and training
create table if not exists public.qr_registry (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  module_name text not null,
  related_table text,
  related_id uuid,
  qr_code text not null unique,
  label text,
  public_url text,
  is_active boolean not null default true,
  created_by uuid null,
  created_at timestamptz not null default now()
);

create index if not exists idx_qr_registry_company_module
  on public.qr_registry(company_id, module_name);

alter table public.qr_registry enable row level security;

drop policy if exists "qr_registry_company_access" on public.qr_registry;
create policy "qr_registry_company_access" on public.qr_registry for all
using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role='sephs_admin' or p.company_id = qr_registry.company_id)))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role='sephs_admin' or p.company_id = qr_registry.company_id)));

-- 6) Tenant settings for future subdomains, module defaults and client controls
create table if not exists public.company_settings (
  company_id uuid primary key,
  subdomain_slug text unique,
  notification_defaults jsonb not null default '{}'::jsonb,
  workflow_defaults jsonb not null default '{}'::jsonb,
  mobile_defaults jsonb not null default '{}'::jsonb,
  ai_enabled boolean not null default true,
  audit_retention_months int not null default 84,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.company_settings enable row level security;

drop policy if exists "company_settings_company_access" on public.company_settings;
create policy "company_settings_company_access" on public.company_settings for all
using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role='sephs_admin' or p.company_id = company_settings.company_id)))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role='sephs_admin' or p.company_id = company_settings.company_id)));

notify pgrst, 'reload schema';
