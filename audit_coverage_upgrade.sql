-- AURIS360 AP-043: shared audit event contract.
-- Rerunnable. Apply after professional_foundations.sql.

alter table public.audit_events
  add column if not exists event_code text,
  add column if not exists related_ref text,
  add column if not exists relationship_id uuid,
  add column if not exists correlation_id uuid,
  add column if not exists outcome text not null default 'success',
  add column if not exists sensitivity text not null default 'standard';

update public.audit_events
set event_code = lower(coalesce(nullif(module_name,''),'system')) || '.' || lower(action)
where event_code is null;

update public.audit_events
set relationship_id = related_id
where relationship_id is null
  and related_table = 'record_relationships'
  and action in ('link','unlink');

alter table public.audit_events drop constraint if exists audit_events_outcome_check;
alter table public.audit_events add constraint audit_events_outcome_check
  check (outcome in ('success','failed','denied','partial'));

alter table public.audit_events drop constraint if exists audit_events_sensitivity_check;
alter table public.audit_events add constraint audit_events_sensitivity_check
  check (sensitivity in ('standard','confidential','restricted','clinical'));

create index if not exists idx_audit_events_contract
  on public.audit_events(company_id, event_code, created_at desc);
create index if not exists idx_audit_events_relationship
  on public.audit_events(relationship_id, created_at desc)
  where relationship_id is not null;
create index if not exists idx_audit_events_correlation
  on public.audit_events(correlation_id)
  where correlation_id is not null;

comment on column public.audit_events.event_code is
  'Stable module.action code used by cross-module audit contract tests.';
comment on column public.audit_events.relationship_id is
  'Canonical record_relationships.id for link and unlink lifecycle events.';
