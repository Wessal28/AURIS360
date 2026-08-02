-- AURIS360 Objectives & KPI configuration workspace
-- Run once in the Supabase SQL editor. Existing KPI records are not changed.

begin;

create table if not exists public.kpi_config_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  version_no integer not null,
  status text not null default 'draft' check (status in ('draft','validated','published','archived')),
  scope_type text not null default 'company',
  scope_id uuid,
  effective_from date,
  reason text,
  configuration jsonb not null default '{}'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  impact_summary jsonb not null default '{}'::jsonb,
  supersedes_id uuid references public.kpi_config_versions(id),
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  validated_by uuid,
  validated_by_name text,
  validated_at timestamptz,
  published_by uuid,
  published_by_name text,
  published_at timestamptz,
  unique(company_id, version_no)
);

create unique index if not exists idx_kpi_config_one_published
  on public.kpi_config_versions(company_id) where status='published';
create index if not exists idx_kpi_config_company_version
  on public.kpi_config_versions(company_id, version_no desc);

create table if not exists public.kpi_config_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  config_version_id uuid references public.kpi_config_versions(id),
  event_type text not null,
  section_key text,
  before_json jsonb,
  after_json jsonb,
  reason text,
  actor_id uuid,
  actor_name text,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_kpi_config_audit_company_time
  on public.kpi_config_audit(company_id, created_at desc);

-- Seed every existing company with the current behaviour as immutable version 1.
-- This preserves existing KPI results while making the defaults explicit and auditable.
insert into public.kpi_config_versions(company_id,version_no,status,effective_from,reason,configuration,created_by_name,published_by_name,published_at)
select c.id,1,'published',current_date,'Initial configuration preserving existing KPI behaviour',
  '{"general":{"calendar_basis":"calendar","start_month":1,"default_frequency":"monthly","decimal_precision":2,"code_pattern":"OBJ.KPI.IND","show_archived":false},"objectives":{"weighting_method":"equal","allow_local_categories":true,"require_owner":true,"require_description":true},"templates":{"name":"Standard HSE KPI","classification":"leading_or_lagging","default_unit":"count","ytd_method":"sum","evidence_required":false,"owner_required":true},"targets":{"on_track_percent":95,"at_risk_percent":85,"zero_tolerance_override":true,"critical_override":true,"require_action_off_track":true,"require_explanation_at_risk":true,"data_missing_excluded":true},"cycles":{"entry_deadline_working_day":5,"verification_deadline_working_day":7,"approval_deadline_working_day":10,"lock_after_approval":true,"current_period_excluded":true,"reopen_policy":"request"},"calculations":{"aggregation":"average","ytd_method":"sum","rounding":2,"zero_denominator":"data_error","formula":"actual / target * 100","block_circular":true},"sources":{"default_source":"manual","refresh_frequency":"real_time","reconciliation":"source_wins","allow_manual_override":false,"lock_imported_values":true},"workflow":{"name":"Standard KPI Approval","self_approval":false,"stage1":"KPI Owner","stage2":"HSE Manager","stage3":"Company Admin","escalation_days":3,"allow_delegation":true},"notifications":{"enabled":true,"channels":"in_app,email","missing_reminder_days":2,"at_risk_recipient":"KPI Owner","off_track_recipient":"HSE Manager","approval_reminders":true},"permissions":{"edit_roles":"sephs_admin,admin,hse_manager","entry_roles":"manager,inspector","publish_roles":"sephs_admin,admin,hse_manager","restrict_company":true},"reports":{"default_report":"management_summary","status_scheme":"icon_text_colour","trend_months":6,"show_data_quality":true,"default_columns":"target,actual,variance,trend,owner,status"},"audit":{"retention_years":7,"published_immutable":true,"approved_values_locked":true,"reason_required":true,"record_exports":true}}'::jsonb,
  'System migration','System migration',now()
from public.companies c
where not exists(select 1 from public.kpi_config_versions v where v.company_id=c.id);

alter table public.kpi_config_versions enable row level security;
alter table public.kpi_config_audit enable row level security;

drop policy if exists "kpi_config_read" on public.kpi_config_versions;
create policy "kpi_config_read" on public.kpi_config_versions for select using (
  exists (select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or p.company_id=kpi_config_versions.company_id))
);
drop policy if exists "kpi_config_manage" on public.kpi_config_versions;
create policy "kpi_config_manage" on public.kpi_config_versions for all using (
  exists (select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=kpi_config_versions.company_id and p.role in ('admin','hse_manager'))))
) with check (
  exists (select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=kpi_config_versions.company_id and p.role in ('admin','hse_manager'))))
);
drop policy if exists "kpi_config_audit_read" on public.kpi_config_audit;
create policy "kpi_config_audit_read" on public.kpi_config_audit for select using (
  exists (select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or p.company_id=kpi_config_audit.company_id))
);
drop policy if exists "kpi_config_audit_insert" on public.kpi_config_audit;
create policy "kpi_config_audit_insert" on public.kpi_config_audit for insert with check (
  exists (select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=kpi_config_audit.company_id and p.role in ('admin','hse_manager'))))
);

create or replace function public.kpi_publish_config(p_config_id uuid, p_reason text, p_effective_from date default current_date)
returns public.kpi_config_versions language plpgsql security invoker as $$
declare v public.kpi_config_versions; old_row public.kpi_config_versions;
begin
  select * into v from public.kpi_config_versions where id=p_config_id for update;
  if v.id is null then raise exception 'Configuration version not found'; end if;
  if v.status <> 'validated' then raise exception 'Only a validated configuration can be published'; end if;
  if coalesce((v.validation->>'valid')::boolean,false) is not true then raise exception 'Validation must pass before publication'; end if;
  select * into old_row from public.kpi_config_versions where company_id=v.company_id and status='published' for update;
  update public.kpi_config_versions set status='archived',updated_at=now() where company_id=v.company_id and status='published';
  update public.kpi_config_versions set status='published',reason=p_reason,effective_from=p_effective_from,
    published_by=auth.uid(),published_by_name=coalesce((select full_name from public.profiles where id=auth.uid()),'User'),
    published_at=now(),updated_at=now() where id=p_config_id returning * into v;
  insert into public.kpi_config_audit(company_id,config_version_id,event_type,before_json,after_json,reason,actor_id,actor_name)
    values(v.company_id,v.id,'published',to_jsonb(old_row),to_jsonb(v),p_reason,auth.uid(),v.published_by_name);
  return v;
end $$;

grant select,insert,update on public.kpi_config_versions to authenticated;
grant select,insert on public.kpi_config_audit to authenticated;
grant execute on function public.kpi_publish_config(uuid,text,date) to authenticated;

commit;
notify pgrst, 'reload schema';
