-- AURIS360 AP-053: replace operational reference-only links with stable IDs.
-- Rerunnable. Existing reference fields remain as historical display snapshots.

begin;

create table if not exists public.reference_identity_backfill_review (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_table text not null,
  source_id text not null,
  source_field text not null,
  legacy_reference text not null,
  target_table text not null,
  candidate_target_ids uuid[] not null default '{}',
  resolution_status text not null default 'unresolved'
    check (resolution_status in ('unresolved','resolved','ignored')),
  resolved_target_id uuid,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_table,source_id,source_field)
);

alter table if exists public.atex_areas add column if not exists linked_ra_id uuid references public.risk_assessments(id);
alter table if exists public.atex_areas add column if not exists linked_permit_id uuid references public.permits(id);
alter table if exists public.atex_areas add column if not exists linked_permit_ref text;

alter table if exists public.ppe_issuance add column if not exists work_order_id uuid references public.work_schedule(id);
alter table if exists public.ppe_issuance add column if not exists risk_assessment_id uuid references public.risk_assessments(id);

alter table if exists public.compliance_calendar add column if not exists legal_requirement_id uuid references public.legal_requirements(id);
alter table if exists public.compliance_calendar add column if not exists linked_action_id uuid references public.action_tracker(id);

alter table if exists public.work_schedule add column if not exists risk_assessment_id uuid references public.risk_assessments(id);
alter table if exists public.work_schedule add column if not exists permit_id uuid references public.permits(id);

alter table if exists public.permits add column if not exists risk_assessment_id uuid references public.risk_assessments(id);
alter table if exists public.permits add column if not exists method_statement_id uuid references public.documents(id);
alter table if exists public.permits add column if not exists work_order_id uuid references public.work_schedule(id);

alter table if exists public.documents add column if not exists linked_risk_assessment_id uuid references public.risk_assessments(id);
alter table if exists public.documents add column if not exists linked_permit_id uuid references public.permits(id);
alter table if exists public.documents add column if not exists linked_ra_ref text;
alter table if exists public.documents add column if not exists linked_permit_ref text;

create index if not exists idx_reference_identity_review_status
  on public.reference_identity_backfill_review(company_id,resolution_status,source_table);

create or replace function public.normalise_operational_reference(value text)
returns text language sql immutable as $$
  select regexp_replace(lower(trim(coalesce(value,''))),'[^a-z0-9]+','','g')
$$;

create or replace function public.backfill_verified_reference(
  p_source_table text,
  p_target_id_column text,
  p_legacy_ref_column text,
  p_target_table text,
  p_target_ref_column text
) returns void
language plpgsql security definer set search_path=public as $$
declare sql_text text;
begin
  if p_source_table not in ('atex_areas','ppe_issuance','compliance_calendar','work_schedule','permits','documents')
     or p_target_table not in ('risk_assessments','permits','work_schedule','documents','legal_requirements','action_tracker') then
    raise exception 'Reference backfill table is not allowlisted';
  end if;
  if to_regclass('public.'||p_source_table) is null or to_regclass('public.'||p_target_table) is null then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_source_table and column_name='company_id') then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_source_table and column_name=p_target_id_column) then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_source_table and column_name=p_legacy_ref_column) then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_target_table and column_name=p_target_ref_column) then return; end if;

  sql_text:=format($q$
    update public.%I s set %I=m.target_id
    from (
      select src.id as source_id,(array_agg(t.id order by t.id))[1] as target_id
      from public.%I src join public.%I t on t.company_id=src.company_id
       and (t.id::text=trim(src.%I::text) or public.normalise_operational_reference(t.%I::text)=public.normalise_operational_reference(src.%I::text))
      where src.%I is null and nullif(trim(src.%I::text),'') is not null
      group by src.id having count(*)=1
    ) m where s.id=m.source_id
  $q$,p_source_table,p_target_id_column,p_source_table,p_target_table,p_legacy_ref_column,p_target_ref_column,p_legacy_ref_column,p_target_id_column,p_legacy_ref_column);
  execute sql_text;

  sql_text:=format($q$
    insert into public.reference_identity_backfill_review(
      company_id,source_table,source_id,source_field,legacy_reference,target_table,candidate_target_ids
    )
    select s.company_id,%L,s.id::text,%L,s.%I::text,%L,
      coalesce((select array_agg(t.id order by t.id) from public.%I t where t.company_id=s.company_id
        and (t.id::text=trim(s.%I::text) or public.normalise_operational_reference(t.%I::text)=public.normalise_operational_reference(s.%I::text))),'{}'::uuid[])
    from public.%I s where s.%I is null and nullif(trim(s.%I::text),'') is not null
    on conflict(source_table,source_id,source_field) do update set
      legacy_reference=excluded.legacy_reference,target_table=excluded.target_table,
      candidate_target_ids=excluded.candidate_target_ids,updated_at=now()
  $q$,p_source_table,p_target_id_column,p_legacy_ref_column,p_target_table,p_target_table,p_legacy_ref_column,p_target_ref_column,p_legacy_ref_column,p_source_table,p_target_id_column,p_legacy_ref_column);
  execute sql_text;
end;
$$;

select public.backfill_verified_reference('atex_areas','linked_ra_id','linked_ra_ref','risk_assessments','ra_ref');
select public.backfill_verified_reference('atex_areas','linked_permit_id','linked_permit_ref','permits','permit_number');
select public.backfill_verified_reference('ppe_issuance','work_order_id','work_order_ref','work_schedule','ref_number');
select public.backfill_verified_reference('ppe_issuance','risk_assessment_id','ra_ref','risk_assessments','ra_ref');
select public.backfill_verified_reference('compliance_calendar','legal_requirement_id','obligation_ref','legal_requirements','req_ref');
select public.backfill_verified_reference('compliance_calendar','linked_action_id','linked_action_ref','action_tracker','action_ref');
select public.backfill_verified_reference('work_schedule','risk_assessment_id','ra_ref','risk_assessments','ra_ref');
select public.backfill_verified_reference('work_schedule','permit_id','permit_ref','permits','permit_number');
select public.backfill_verified_reference('permits','risk_assessment_id','ra_ref','risk_assessments','ra_ref');
select public.backfill_verified_reference('permits','method_statement_id','method_statement_ref','documents','doc_ref');
select public.backfill_verified_reference('permits','work_order_id','work_order_ref','work_schedule','ref_number');
select public.backfill_verified_reference('documents','linked_risk_assessment_id','linked_ra_ref','risk_assessments','ra_ref');
select public.backfill_verified_reference('documents','linked_permit_id','linked_permit_ref','permits','permit_number');

do $$
declare spec text[]; t text; cols text;
begin
  foreach spec slice 1 in array array[
    ['atex_areas','linked_ra_id,linked_permit_id'],['ppe_issuance','work_order_id,risk_assessment_id'],
    ['compliance_calendar','legal_requirement_id,linked_action_id'],['work_schedule','risk_assessment_id,permit_id'],
    ['permits','risk_assessment_id,method_statement_id,work_order_id'],['documents','linked_risk_assessment_id,linked_permit_id']
  ] loop
    t:=spec[1];cols:=spec[2];
    if to_regclass('public.'||t) is not null and exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='company_id') then
      execute format('create index if not exists %I on public.%I(company_id,%s)','idx_'||t||'_verified_refs',t,cols);
    end if;
  end loop;
end;
$$;

alter table public.reference_identity_backfill_review enable row level security;
drop policy if exists reference_identity_review_admin_access on public.reference_identity_backfill_review;
create policy reference_identity_review_admin_access on public.reference_identity_backfill_review
for all using (exists(select 1 from public.profiles p where p.id=auth.uid()
  and (p.role='sephs_admin' or (p.company_id=reference_identity_backfill_review.company_id and p.role in ('admin','hse_manager')))))
with check (exists(select 1 from public.profiles p where p.id=auth.uid()
  and (p.role='sephs_admin' or (p.company_id=reference_identity_backfill_review.company_id and p.role in ('admin','hse_manager')))));

grant select,insert,update on public.reference_identity_backfill_review to authenticated;
comment on table public.reference_identity_backfill_review is 'Ambiguous or missing legacy operational references requiring controlled resolution.';

commit;
