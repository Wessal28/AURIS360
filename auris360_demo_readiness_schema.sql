-- AURIS360 demo / sales readiness schema bundle
-- Run this once in Supabase SQL Editor before client demonstrations.
-- Safe to re-run: tables, columns, indexes and policies are created idempotently where possible.

create extension if not exists pgcrypto;

-- ============================================================
-- 1) Professional platform foundations
--    Audit trail, approval workflow, notification channels,
--    training requirements, QR registry and tenant settings.
-- ============================================================

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
        or (p.company_id = audit_events.company_id and p.role in ('admin','company_admin','hse_manager','hse_officer'))
      )
  )
);

drop policy if exists "audit_events_insert_authenticated" on public.audit_events;
create policy "audit_events_insert_authenticated"
on public.audit_events for insert
with check (auth.uid() is not null);

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
using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role='sephs_admin' or (p.company_id = approval_workflows.company_id and p.role in ('admin','company_admin','hse_manager')))))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role='sephs_admin' or (p.company_id = approval_workflows.company_id and p.role in ('admin','company_admin','hse_manager')))));

drop policy if exists "approval_steps_company_read" on public.approval_workflow_steps;
create policy "approval_steps_company_read" on public.approval_workflow_steps for select
using (exists (select 1 from public.approval_workflows w join public.profiles p on p.id = auth.uid() where w.id = approval_workflow_steps.workflow_id and (p.role='sephs_admin' or p.company_id = w.company_id)));

drop policy if exists "approval_steps_company_manage" on public.approval_workflow_steps;
create policy "approval_steps_company_manage" on public.approval_workflow_steps for all
using (exists (select 1 from public.approval_workflows w join public.profiles p on p.id = auth.uid() where w.id = approval_workflow_steps.workflow_id and (p.role='sephs_admin' or (p.company_id = w.company_id and p.role in ('admin','company_admin','hse_manager')))))
with check (exists (select 1 from public.approval_workflows w join public.profiles p on p.id = auth.uid() where w.id = approval_workflow_steps.workflow_id and (p.role='sephs_admin' or (p.company_id = w.company_id and p.role in ('admin','company_admin','hse_manager')))));

drop policy if exists "approval_requests_company_access" on public.approval_requests;
create policy "approval_requests_company_access" on public.approval_requests for all
using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role='sephs_admin' or p.company_id = approval_requests.company_id)))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role='sephs_admin' or p.company_id = approval_requests.company_id)));

drop policy if exists "approval_decisions_company_access" on public.approval_decisions;
create policy "approval_decisions_company_access" on public.approval_decisions for all
using (exists (select 1 from public.approval_requests r join public.profiles p on p.id = auth.uid() where r.id = approval_decisions.request_id and (p.role='sephs_admin' or p.company_id = r.company_id)))
with check (exists (select 1 from public.approval_requests r join public.profiles p on p.id = auth.uid() where r.id = approval_decisions.request_id and (p.role='sephs_admin' or p.company_id = r.company_id)));

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

-- ============================================================
-- 2) Fire layout plans and map symbols
-- ============================================================

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
  updated_at timestamptz not null default now()
);

alter table public.fire_layouts
  drop constraint if exists fire_layouts_company_id_layout_type_key;

create index if not exists idx_fire_layouts_company_type
  on public.fire_layouts(company_id, layout_type);

create index if not exists idx_fire_layouts_company_type_title
  on public.fire_layouts(company_id, layout_type, title);

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
        or (p.company_id = fire_layouts.company_id and p.role in ('admin','company_admin','hse_manager','hse_officer','site_manager'))
      )
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (p.company_id = fire_layouts.company_id and p.role in ('admin','company_admin','hse_manager','hse_officer','site_manager'))
      )
  )
);

create table if not exists public.fire_layout_symbols (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  item_type text not null,
  label text not null,
  symbol text not null default 'EQ',
  image_data text,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, item_type)
);

create index if not exists idx_fire_layout_symbols_company_label
  on public.fire_layout_symbols(company_id, label);

alter table public.fire_layout_symbols enable row level security;

drop policy if exists "fire_layout_symbols_company_read" on public.fire_layout_symbols;
create policy "fire_layout_symbols_company_read"
on public.fire_layout_symbols for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = fire_layout_symbols.company_id)
  )
);

drop policy if exists "fire_layout_symbols_company_manage" on public.fire_layout_symbols;
create policy "fire_layout_symbols_company_manage"
on public.fire_layout_symbols for all
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (p.company_id = fire_layout_symbols.company_id and p.role in ('admin','company_admin','hse_manager','hse_officer','site_manager'))
      )
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (p.company_id = fire_layout_symbols.company_id and p.role in ('admin','company_admin','hse_manager','hse_officer','site_manager'))
      )
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('layouts', 'layouts', true, 5242880, array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "layouts_read" on storage.objects;
create policy "layouts_read"
on storage.objects for select
using (bucket_id = 'layouts');

drop policy if exists "layouts_company_upload" on storage.objects;
create policy "layouts_company_upload"
on storage.objects for insert
with check (
  bucket_id = 'layouts'
  and auth.role() = 'authenticated'
);

drop policy if exists "layouts_company_update" on storage.objects;
create policy "layouts_company_update"
on storage.objects for update
using (
  bucket_id = 'layouts'
  and auth.role() = 'authenticated'
)
with check (
  bucket_id = 'layouts'
  and auth.role() = 'authenticated'
);

drop policy if exists "layouts_company_delete" on storage.objects;
create policy "layouts_company_delete"
on storage.objects for delete
using (
  bucket_id = 'layouts'
  and auth.role() = 'authenticated'
);

-- ============================================================
-- 3) No-code custom fields
-- ============================================================

create table if not exists public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  module_key text not null,
  field_label text not null,
  field_key text not null,
  field_type text not null check (field_type in ('text','number','date','textarea','select','checkbox')),
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, module_key, field_key)
);

create table if not exists public.custom_field_values (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  record_table text not null,
  record_id uuid not null,
  field_id uuid not null references public.custom_fields(id) on delete cascade,
  field_key text not null,
  value jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(record_table, record_id, field_id)
);

create index if not exists idx_custom_fields_company_module
  on public.custom_fields(company_id, module_key, active, sort_order);

create index if not exists idx_custom_field_values_record
  on public.custom_field_values(record_table, record_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_custom_fields_updated_at on public.custom_fields;
create trigger trg_custom_fields_updated_at
before update on public.custom_fields
for each row execute function public.touch_updated_at();

drop trigger if exists trg_custom_field_values_updated_at on public.custom_field_values;
create trigger trg_custom_field_values_updated_at
before update on public.custom_field_values
for each row execute function public.touch_updated_at();

alter table public.custom_fields enable row level security;
alter table public.custom_field_values enable row level security;

drop policy if exists custom_fields_select_company on public.custom_fields;
create policy custom_fields_select_company on public.custom_fields
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = custom_fields.company_id)
  )
);

drop policy if exists custom_fields_manage_company_admin on public.custom_fields;
create policy custom_fields_manage_company_admin on public.custom_fields
for all using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (p.company_id = custom_fields.company_id and p.role in ('admin','company_admin','hse_manager'))
      )
  )
) with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (p.company_id = custom_fields.company_id and p.role in ('admin','company_admin','hse_manager'))
      )
  )
);

drop policy if exists custom_field_values_select_company on public.custom_field_values;
create policy custom_field_values_select_company on public.custom_field_values
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = custom_field_values.company_id)
  )
);

drop policy if exists custom_field_values_write_company on public.custom_field_values;
create policy custom_field_values_write_company on public.custom_field_values
for all using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = custom_field_values.company_id)
  )
) with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = custom_field_values.company_id)
  )
);

-- ============================================================
-- 4) Security / infrastructure / SLA settings
-- ============================================================

create table if not exists public.security_sla_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id)
);

alter table public.security_sla_settings enable row level security;

drop policy if exists "security_sla_select_company" on public.security_sla_settings;
create policy "security_sla_select_company"
on public.security_sla_settings
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or p.company_id = security_sla_settings.company_id
      )
  )
);

drop policy if exists "security_sla_insert_admin" on public.security_sla_settings;
create policy "security_sla_insert_admin"
on public.security_sla_settings
for insert
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = security_sla_settings.company_id
          and p.role in ('admin','company_admin','hse_manager')
        )
      )
  )
);

drop policy if exists "security_sla_update_admin" on public.security_sla_settings;
create policy "security_sla_update_admin"
on public.security_sla_settings
for update
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = security_sla_settings.company_id
          and p.role in ('admin','company_admin','hse_manager')
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = security_sla_settings.company_id
          and p.role in ('admin','company_admin','hse_manager')
        )
      )
  )
);

create or replace function public.set_security_sla_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_security_sla_updated_at on public.security_sla_settings;
create trigger trg_security_sla_updated_at
before update on public.security_sla_settings
for each row execute function public.set_security_sla_updated_at();

-- ============================================================
-- 5) Optional feature column upgrades
-- ============================================================

alter table public.noise_surveys
  add column if not exists layout_title text,
  add column if not exists layout_url text,
  add column if not exists layout_image text,
  add column if not exists measurements jsonb default '[]'::jsonb,
  add column if not exists hpe_assessment jsonb default '[]'::jsonb,
  add column if not exists updated_at timestamptz default now();

alter table public.elearning_courses
  add column if not exists category text,
  add column if not exists duration_minutes integer,
  add column if not exists passing_score integer,
  add column if not exists validity_months integer,
  add column if not exists target_roles text,
  add column if not exists mandatory boolean default false;

alter table public.elearning_enrolments
  add column if not exists target_date date,
  add column if not exists score integer,
  add column if not exists expiry_date date,
  add column if not exists attempts integer,
  add column if not exists time_spent_minutes integer;

alter table public.safety_bulletins
  add column if not exists checked_by jsonb default '[]'::jsonb,
  add column if not exists acknowledged_by jsonb default '[]'::jsonb,
  add column if not exists file_url text,
  add column if not exists file_name text,
  add column if not exists last_checked_at timestamptz,
  add column if not exists updated_at timestamptz default now();

notify pgrst, 'reload schema';
