-- AURIS360 AP-051: controlled legacy People reconciliation.
-- Apply after canonical_person_identity_upgrade.sql. Safe to rerun.

begin;

create table if not exists public.person_identity_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  review_id uuid references public.person_identity_backfill_review(id) on delete set null,
  source_table text not null,
  source_id uuid not null,
  decision text not null check(decision in ('linked','ignored','reopened')),
  selected_person_id uuid references public.people(id),
  legacy_name text,
  decision_note text,
  decided_by uuid,
  decided_at timestamptz not null default now()
);

create index if not exists idx_person_identity_decisions_source
  on public.person_identity_decisions(company_id,source_table,source_id,decided_at desc);

-- Duplicate signals are advisory. They never merge or deactivate People records.
create or replace view public.person_duplicate_candidates
with (security_invoker=true) as
with identity_keys as (
  select p.company_id,p.id,'email'::text as match_type,lower(trim(p.email)) as match_key
  from public.people p where nullif(trim(p.email),'') is not null
  union all
  select p.company_id,p.id,'employee_number',public.normalise_person_identity_text(coalesce(p.employee_number,p.id_number))
  from public.people p where nullif(trim(coalesce(p.employee_number,p.id_number)),'') is not null
  union all
  select p.company_id,p.id,'normalised_name',public.normalise_person_identity_text(concat_ws(' ',p.first_name,p.last_name))
  from public.people p where nullif(trim(concat_ws(' ',p.first_name,p.last_name)),'') is not null
)
select k.company_id,k.match_type,k.match_key,
       array_agg(k.id order by k.id) as person_ids,
       array_agg(concat_ws(' ',p.first_name,p.last_name) order by p.last_name,p.first_name,p.id) as person_names,
       count(*)::integer as candidate_count
from identity_keys k join public.people p on p.id=k.id
group by k.company_id,k.match_type,k.match_key
having count(*)>1;

create or replace view public.person_identity_reconciliation_summary
with (security_invoker=true) as
select c.id as company_id,
  count(r.id) filter(where r.resolution_status='unresolved')::integer as unresolved_count,
  count(r.id) filter(where r.resolution_status='resolved')::integer as resolved_count,
  count(r.id) filter(where r.resolution_status='ignored')::integer as ignored_count,
  coalesce((select count(*) from public.person_duplicate_candidates d where d.company_id=c.id),0)::integer as duplicate_cluster_count,
  max(r.updated_at) as last_review_at
from public.companies c
left join public.person_identity_backfill_review r on r.company_id=c.id
group by c.id;

create or replace function public.refresh_person_identity_reconciliation(p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  caller_role text;
  result jsonb;
  table_name text;
begin
  select p.role into caller_role from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or p.company_id=p_company_id);
  if caller_role is null or caller_role not in ('sephs_admin','admin','hse_manager') then
    raise exception 'Identity reconciliation permission denied';
  end if;

  perform public.backfill_person_identity('training_followup','person_name',null);
  perform public.backfill_person_identity('competency_matrix','person_name',null);
  perform public.backfill_person_identity('induction_records','person_name','employee_id');
  perform public.backfill_person_identity('elearning_enrolments','person_name',null);
  perform public.backfill_person_identity('ppe_issuance','employee_name','employee_id');
  perform public.backfill_person_identity('medical_surveillance','employee_name','employee_id');
  perform public.backfill_person_identity('audiometry_records','employee_name',null);
  perform public.backfill_person_identity('spirometry_records','employee_name',null);
  perform public.backfill_person_identity('vaccination_records','employee_name',null);
  perform public.backfill_person_identity('occupational_diseases','employee_name','employee_id');
  perform public.backfill_person_identity('doc_acknowledgements','employee_name',null);

  -- Account for queue items that became uniquely resolvable after People data
  -- was corrected or added since the previous scan.
  foreach table_name in array array[
    'training_followup','competency_matrix','induction_records','elearning_enrolments',
    'ppe_issuance','medical_surveillance','audiometry_records','spirometry_records',
    'vaccination_records','occupational_diseases','doc_acknowledgements'
  ] loop
    if to_regclass('public.'||table_name) is not null then
      execute format($q$
        insert into public.person_identity_decisions(
          company_id,review_id,source_table,source_id,decision,selected_person_id,
          legacy_name,decision_note,decided_by
        )
        select q.company_id,q.id,q.source_table,q.source_id,'linked',r.person_id,
               q.legacy_name,'Automatically linked after a unique-match rescan',auth.uid()
        from public.person_identity_backfill_review q
        join public.%I r on r.id=q.source_id and r.company_id=q.company_id
        where q.company_id=$1 and q.source_table=%L
          and q.resolution_status='unresolved' and r.person_id is not null
      $q$,table_name,table_name) using p_company_id;
      execute format($q$
        update public.person_identity_backfill_review q
        set resolution_status='resolved',resolved_person_id=r.person_id,
            resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
        from public.%I r
        where q.company_id=$1 and q.source_table=%L
          and q.resolution_status='unresolved'
          and r.id=q.source_id and r.company_id=q.company_id and r.person_id is not null
      $q$,table_name,table_name) using p_company_id;
    end if;
  end loop;

  select to_jsonb(s) into result from public.person_identity_reconciliation_summary s where s.company_id=p_company_id;
  return coalesce(result,'{}'::jsonb);
end;
$$;

create or replace function public.resolve_person_identity_review(
  p_review_id uuid,
  p_person_id uuid,
  p_decision text,
  p_note text default null
) returns public.person_identity_backfill_review
language plpgsql security definer set search_path=public as $$
declare
  item public.person_identity_backfill_review%rowtype;
  person_row public.people%rowtype;
  caller_role text;
  set_parts text[]:=array['person_id=$1'];
  update_sql text;
begin
  select * into item from public.person_identity_backfill_review where id=p_review_id for update;
  if item.id is null then raise exception 'Identity review item not found'; end if;
  select p.role into caller_role from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or p.company_id=item.company_id);
  if caller_role is null or caller_role not in ('sephs_admin','admin','hse_manager') then
    raise exception 'Identity reconciliation permission denied';
  end if;
  if p_decision not in ('linked','ignored') then raise exception 'Unsupported reconciliation decision'; end if;

  if p_decision='linked' then
    if p_person_id is null then raise exception 'Select a person before linking'; end if;
    select * into person_row from public.people where id=p_person_id and company_id=item.company_id;
    if person_row.id is null then raise exception 'Selected person is outside this company or unavailable'; end if;
    if item.source_table not in (
      'training_followup','competency_matrix','induction_records','elearning_enrolments',
      'ppe_issuance','medical_surveillance','audiometry_records','spirometry_records',
      'vaccination_records','occupational_diseases','doc_acknowledgements'
    ) then raise exception 'Source table is not approved for identity reconciliation'; end if;
    if to_regclass('public.'||item.source_table) is null then raise exception 'Source table is unavailable'; end if;

    if exists(select 1 from information_schema.columns where table_schema='public' and table_name=item.source_table and column_name='person_name_snapshot') then
      set_parts:=set_parts||'person_name_snapshot=coalesce(person_name_snapshot,$2)';
    end if;
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name=item.source_table and column_name='organization_snapshot') then
      set_parts:=set_parts||'organization_snapshot=coalesce(organization_snapshot,$3)';
    end if;
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name=item.source_table and column_name='role_snapshot') then
      set_parts:=set_parts||'role_snapshot=coalesce(role_snapshot,$4)';
    end if;
    update_sql:=format('update public.%I set %s where id=$5 and company_id=$6',item.source_table,array_to_string(set_parts,','));
    execute update_sql using person_row.id,concat_ws(' ',person_row.first_name,person_row.last_name),coalesce(person_row.company_name,person_row.department),person_row.job_title,item.source_id,item.company_id;
    if not found then raise exception 'Source record no longer exists or belongs to another company'; end if;
  end if;

  update public.person_identity_backfill_review
  set resolution_status=case when p_decision='linked' then 'resolved' else 'ignored' end,
      resolved_person_id=case when p_decision='linked' then p_person_id else null end,
      resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
  where id=p_review_id returning * into item;

  insert into public.person_identity_decisions(
    company_id,review_id,source_table,source_id,decision,selected_person_id,
    legacy_name,decision_note,decided_by
  ) values (
    item.company_id,item.id,item.source_table,item.source_id,p_decision,p_person_id,
    item.legacy_name,nullif(trim(p_note),''),auth.uid()
  );

  if to_regclass('public.audit_events') is not null then
    insert into public.audit_events(
      company_id,actor_user_id,action,module_name,related_table,related_id,
      summary,details
    ) values (
      item.company_id,auth.uid(),'update','people',item.source_table,item.source_id,
      'Legacy person identity '||p_decision,
      jsonb_build_object('review_id',item.id,'legacy_name',item.legacy_name,'selected_person_id',p_person_id,'note',p_note,'event_code','people.identity_'||p_decision,'sensitivity','restricted')
    );
  end if;
  return item;
end;
$$;

alter table public.person_identity_decisions enable row level security;
drop policy if exists person_identity_decisions_admin_access on public.person_identity_decisions;
create policy person_identity_decisions_admin_access on public.person_identity_decisions
for select using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=person_identity_decisions.company_id and p.role in ('admin','hse_manager'))))
);

grant select on public.person_duplicate_candidates,public.person_identity_reconciliation_summary to authenticated;
grant select on public.person_identity_decisions to authenticated;
grant execute on function public.refresh_person_identity_reconciliation(uuid) to authenticated;
grant execute on function public.resolve_person_identity_review(uuid,uuid,text,text) to authenticated;

comment on view public.person_duplicate_candidates is
  'Advisory duplicate signals only; candidate People records are never merged automatically.';

commit;
