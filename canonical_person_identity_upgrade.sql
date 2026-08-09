-- AURIS360 AP-050: canonical People identity links.
-- Rerunnable. Names, organisation and roles remain as historical snapshots.
-- Only unique legacy matches are backfilled; ambiguous rows enter the review queue.

begin;

create table if not exists public.person_identity_backfill_review (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_table text not null,
  source_id uuid not null,
  legacy_name text,
  legacy_employee_number text,
  candidate_person_ids uuid[] not null default '{}',
  resolution_status text not null default 'unresolved'
    check(resolution_status in ('unresolved','resolved','ignored')),
  resolved_person_id uuid references public.people(id),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_table,source_id)
);

-- Canonical ID plus immutable display snapshots on person-facing records.
alter table if exists public.training_followup add column if not exists person_id uuid references public.people(id);
alter table if exists public.training_followup add column if not exists person_name_snapshot text;
alter table if exists public.training_followup add column if not exists organization_snapshot text;
alter table if exists public.training_followup add column if not exists role_snapshot text;

alter table if exists public.competency_matrix add column if not exists person_id uuid references public.people(id);
alter table if exists public.competency_matrix add column if not exists person_name_snapshot text;
alter table if exists public.competency_matrix add column if not exists organization_snapshot text;
alter table if exists public.competency_matrix add column if not exists role_snapshot text;

alter table if exists public.induction_records add column if not exists person_id uuid references public.people(id);
alter table if exists public.induction_records add column if not exists inducted_by_person_id uuid references public.people(id);
alter table if exists public.induction_records add column if not exists person_name_snapshot text;
alter table if exists public.induction_records add column if not exists organization_snapshot text;
alter table if exists public.induction_records add column if not exists role_snapshot text;

alter table if exists public.elearning_enrolments add column if not exists person_id uuid references public.people(id);
alter table if exists public.elearning_enrolments add column if not exists person_name_snapshot text;
alter table if exists public.elearning_enrolments add column if not exists organization_snapshot text;
alter table if exists public.elearning_enrolments add column if not exists role_snapshot text;

alter table if exists public.ppe_issuance add column if not exists person_id uuid references public.people(id);
alter table if exists public.ppe_issuance add column if not exists issued_by_person_id uuid references public.people(id);
alter table if exists public.ppe_issuance add column if not exists person_name_snapshot text;
alter table if exists public.ppe_issuance add column if not exists organization_snapshot text;
alter table if exists public.ppe_issuance add column if not exists role_snapshot text;

alter table if exists public.medical_surveillance add column if not exists person_id uuid references public.people(id);
alter table if exists public.audiometry_records add column if not exists person_id uuid references public.people(id);
alter table if exists public.spirometry_records add column if not exists person_id uuid references public.people(id);
alter table if exists public.vaccination_records add column if not exists person_id uuid references public.people(id);
alter table if exists public.occupational_diseases add column if not exists person_id uuid references public.people(id);

alter table if exists public.doc_acknowledgements add column if not exists person_id uuid references public.people(id);
alter table if exists public.doc_acknowledgements add column if not exists person_name_snapshot text;
alter table if exists public.doc_acknowledgements add column if not exists organization_snapshot text;
alter table if exists public.doc_acknowledgements add column if not exists role_snapshot text;

alter table if exists public.hse_meetings add column if not exists chair_person_id uuid references public.people(id);
alter table if exists public.hse_meetings add column if not exists attendee_person_ids uuid[] not null default '{}';
alter table if exists public.toolbox_talks add column if not exists presenter_person_id uuid references public.people(id);
alter table if exists public.toolbox_talks add column if not exists attendee_person_ids uuid[] not null default '{}';

alter table if exists public.action_tracker add column if not exists assigned_to_id uuid references public.people(id);
alter table if exists public.action_tracker add column if not exists assigned_to_name text;
alter table if exists public.action_tracker add column if not exists assignee_organization_snapshot text;
alter table if exists public.action_tracker add column if not exists assignee_role_snapshot text;

create index if not exists idx_person_identity_review_status
  on public.person_identity_backfill_review(company_id,resolution_status,source_table);

create or replace function public.normalise_person_identity_text(value text)
returns text language sql immutable as $$
  select regexp_replace(lower(trim(coalesce(value,''))),'[^a-z0-9]+','','g')
$$;

create or replace function public.resolve_unique_person_id(
  p_company_id uuid,
  p_name text,
  p_employee_number text default null
) returns uuid
language plpgsql stable security definer set search_path=public as $$
declare
  matches uuid[];
begin
  select array_agg(p.id order by p.id) into matches
  from public.people p
  where p.company_id=p_company_id
    and (
      (nullif(trim(p_employee_number),'') is not null and
       public.normalise_person_identity_text(coalesce(p.employee_number,p.id_number))=public.normalise_person_identity_text(p_employee_number))
      or
      (nullif(trim(p_name),'') is not null and
       public.normalise_person_identity_text(concat_ws(' ',p.first_name,p.last_name))=public.normalise_person_identity_text(p_name))
      or
      (nullif(trim(p_name),'') is not null and
       public.normalise_person_identity_text(concat_ws(', ',p.last_name,p.first_name))=public.normalise_person_identity_text(p_name))
      or lower(coalesce(p.email,''))=lower(trim(coalesce(p_name,'')))
    );
  if coalesce(array_length(matches,1),0)=1 then return matches[1]; end if;
  return null;
end;
$$;

-- Populate one table at a time only when its legacy columns exist. The helper
-- also records ambiguous/unresolved values for controlled review.
create or replace function public.backfill_person_identity(
  p_table text,
  p_name_column text,
  p_employee_column text default null
) returns void
language plpgsql security definer set search_path=public as $$
declare
  employee_expr text;
  sql_text text;
begin
  if to_regclass('public.'||p_table) is null then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name='person_id') then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name=p_name_column) then return; end if;
  employee_expr := case when p_employee_column is not null and exists(
    select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name=p_employee_column
  ) then format('%I::text',p_employee_column) else 'null::text' end;

  sql_text := format(
    'update public.%I r set person_id=public.resolve_unique_person_id(r.company_id,r.%I::text,%s) where r.person_id is null and nullif(trim(r.%I::text),'''') is not null',
    p_table,p_name_column,employee_expr,p_name_column
  );
  execute sql_text;

  sql_text := format($q$
    insert into public.person_identity_backfill_review(
      company_id,source_table,source_id,legacy_name,legacy_employee_number,candidate_person_ids
    )
    select r.company_id,%L,r.id,r.%I::text,%s,
      coalesce((select array_agg(p.id order by p.id) from public.people p
        where p.company_id=r.company_id and (
          public.normalise_person_identity_text(concat_ws(' ',p.first_name,p.last_name))=public.normalise_person_identity_text(r.%I::text)
          or public.normalise_person_identity_text(concat_ws(', ',p.last_name,p.first_name))=public.normalise_person_identity_text(r.%I::text)
          or lower(coalesce(p.email,''))=lower(trim(r.%I::text))
        )), '{}'::uuid[])
    from public.%I r
    where r.person_id is null and nullif(trim(r.%I::text),'') is not null
    on conflict(source_table,source_id) do update set
      legacy_name=excluded.legacy_name,legacy_employee_number=excluded.legacy_employee_number,
      candidate_person_ids=excluded.candidate_person_ids,updated_at=now()
  $q$,p_table,p_name_column,employee_expr,p_name_column,p_name_column,p_name_column,p_table,p_name_column);
  execute sql_text;
end;
$$;

select public.backfill_person_identity('training_followup','person_name',null);
select public.backfill_person_identity('competency_matrix','person_name',null);
select public.backfill_person_identity('induction_records','person_name','employee_id');
select public.backfill_person_identity('elearning_enrolments','person_name',null);
select public.backfill_person_identity('ppe_issuance','employee_name','employee_id');
select public.backfill_person_identity('medical_surveillance','employee_name','employee_id');
select public.backfill_person_identity('audiometry_records','employee_name',null);
select public.backfill_person_identity('spirometry_records','employee_name',null);
select public.backfill_person_identity('vaccination_records','employee_name',null);
select public.backfill_person_identity('occupational_diseases','employee_name','employee_id');
select public.backfill_person_identity('doc_acknowledgements','employee_name',null);

-- Freeze current People attributes into empty snapshots without overwriting
-- historical values already recorded by the application.
do $$
declare t text;
begin
  foreach t in array array['training_followup','competency_matrix','induction_records','elearning_enrolments','ppe_issuance','doc_acknowledgements'] loop
    if to_regclass('public.'||t) is not null then
      execute format($q$
        update public.%I r set
          person_name_snapshot=coalesce(r.person_name_snapshot,concat_ws(' ',p.first_name,p.last_name)),
          organization_snapshot=coalesce(r.organization_snapshot,p.company_name,p.department),
          role_snapshot=coalesce(r.role_snapshot,p.job_title)
        from public.people p where p.id=r.person_id
      $q$,t);
    end if;
  end loop;
end;
$$;

alter table public.person_identity_backfill_review enable row level security;
drop policy if exists person_identity_review_admin_access on public.person_identity_backfill_review;
create policy person_identity_review_admin_access on public.person_identity_backfill_review
for all using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=person_identity_backfill_review.company_id and p.role in ('admin','hse_manager'))))
) with check (
  exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=person_identity_backfill_review.company_id and p.role in ('admin','hse_manager'))))
);

grant select,insert,update on public.person_identity_backfill_review to authenticated;

comment on table public.person_identity_backfill_review is
  'Ambiguous or unmatched legacy person references awaiting controlled identity resolution.';

commit;
