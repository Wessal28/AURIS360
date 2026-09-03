-- Phase 27: reliable KPI editing and persisted ownership/governance metadata.

alter table public.kpis_v2
  add column if not exists description text,
  add column if not exists data_provider text,
  add column if not exists data_source text,
  add column if not exists reviewer text,
  add column if not exists approver text,
  add column if not exists approval_status text not null default 'draft';

alter table public.kpis_v2 drop constraint if exists kpis_v2_status_check;
alter table public.kpis_v2
  add constraint kpis_v2_status_check
  check (status = any (array['on_track'::text, 'at_risk'::text, 'off_track'::text, 'not_started'::text, 'archived'::text]));

alter table public.kpis_v2 drop constraint if exists kpis_v2_approval_status_check;
alter table public.kpis_v2
  add constraint kpis_v2_approval_status_check
  check (approval_status = any (array['draft'::text, 'submitted'::text, 'verified'::text, 'approved'::text, 'locked'::text, 'rejected'::text, 'revision_requested'::text]));

alter table public.kpis_v2 drop constraint if exists kpis_v2_description_length_check;
alter table public.kpis_v2
  add constraint kpis_v2_description_length_check check (char_length(description) <= 4000);

alter table public.kpis_v2 drop constraint if exists kpis_v2_governance_metadata_length_check;
alter table public.kpis_v2
  add constraint kpis_v2_governance_metadata_length_check check (
    char_length(data_provider) <= 200 and
    char_length(data_source) <= 200 and
    char_length(reviewer) <= 200 and
    char_length(approver) <= 200
  );

comment on column public.kpis_v2.description is 'Purpose, scope and expected outcome of the KPI.';
comment on column public.kpis_v2.data_provider is 'Tenant-scoped person responsible for supplying the KPI data.';
comment on column public.kpis_v2.data_source is 'Manual, module or evidence source used for the KPI result.';
comment on column public.kpis_v2.reviewer is 'Tenant-scoped person nominated to review KPI submissions.';
comment on column public.kpis_v2.approver is 'Tenant-scoped person nominated to approve KPI submissions.';
comment on column public.kpis_v2.approval_status is 'Governed KPI lifecycle state; transitions are introduced by the subsequent workflow phase.';
