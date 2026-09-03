-- AURIS360 Modular Foundation Phase 26: non-destructive operational master-data adoption.
begin;

create table if not exists public.master_data_source_bindings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_module text not null check(source_module in ('incident','risk','permit','audit','action','document')),
  source_table text not null check(source_table in ('events','risk_assessments','permits','inspections','action_tracker','documents')),
  source_record_id uuid not null,
  source_field text not null check(source_field ~ '^[a-z][a-z0-9_]{1,79}$'),
  source_ref text not null check(char_length(trim(source_ref)) between 1 and 160),
  domain text not null check(domain in ('location','department','organisation','risk_classification','action_classification','document_category')),
  master_record_id uuid not null references public.master_data_records(id) on delete restrict,
  legacy_snapshot text not null check(char_length(trim(legacy_snapshot)) between 1 and 500),
  status text not null default 'confirmed' check(status in ('confirmed','retired')),
  revision integer not null default 1 check(revision>0),
  confirmed_by uuid not null references public.profiles(id),
  confirmed_at timestamptz not null default now(),
  retired_by uuid references public.profiles(id),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,source_table,source_record_id,source_field),
  check((status='retired')=(retired_at is not null))
);
create index if not exists master_data_source_bindings_master_idx on public.master_data_source_bindings(company_id,master_record_id,status);
create index if not exists master_data_source_bindings_source_idx on public.master_data_source_bindings(company_id,source_module,source_record_id);

alter table public.master_data_source_bindings enable row level security;
create policy master_data_source_bindings_company_read on public.master_data_source_bindings for select using (
  exists(select 1 from public.profiles actor where actor.id=auth.uid() and (actor.role='sephs_admin' or actor.company_id=master_data_source_bindings.company_id))
);
revoke all on public.master_data_source_bindings from public,anon;
grant select on public.master_data_source_bindings to authenticated;

create or replace function public.set_master_data_source_binding(
  p_company_id uuid,p_source_module text,p_source_table text,p_source_record_id uuid,p_source_field text,p_source_ref text,
  p_domain text,p_master_record_id uuid,p_legacy_snapshot text,p_active boolean,p_expected_revision integer
)
returns setof public.master_data_source_bindings language plpgsql security definer set search_path=public as $$
declare actor public.profiles; current_row public.master_data_source_bindings; canonical public.master_data_records; saved public.master_data_source_bindings; source_exists boolean:=false; approved boolean:=false;
begin
  actor:=public.integration_require_admin(p_company_id);
  approved:=
    (p_source_module='incident' and p_source_table='events' and ((p_source_field='location' and p_domain='location') or (p_source_field='department' and p_domain='department'))) or
    (p_source_module='risk' and p_source_table='risk_assessments' and ((p_source_field='location' and p_domain='location') or (p_source_field='department' and p_domain='department') or (p_source_field='overall_risk_level' and p_domain='risk_classification'))) or
    (p_source_module='permit' and p_source_table='permits' and ((p_source_field='location' and p_domain='location') or (p_source_field='department' and p_domain='department') or (p_source_field='contractor_name' and p_domain='organisation'))) or
    (p_source_module='audit' and p_source_table='inspections' and ((p_source_field='site' and p_domain='location') or (p_source_field='department' and p_domain='department'))) or
    (p_source_module='action' and p_source_table='action_tracker' and ((p_source_field='location' and p_domain='location') or (p_source_field='department' and p_domain='department') or (p_source_field in ('action_type','priority') and p_domain='action_classification'))) or
    (p_source_module='document' and p_source_table='documents' and ((p_source_field in ('category','document_type') and p_domain='document_category') or (p_source_field='department' and p_domain='department') or (p_source_field='location' and p_domain='location')));
  if not approved or char_length(trim(coalesce(p_source_ref,''))) not between 1 and 160 or char_length(trim(coalesce(p_legacy_snapshot,''))) not between 1 and 500 then raise exception 'The operational master-data binding is not approved'; end if;
  execute format('select exists(select 1 from public.%I where id=$1 and company_id=$2)',p_source_table) into source_exists using p_source_record_id,p_company_id;
  if not source_exists then raise exception 'The exact source record does not exist in the selected company'; end if;
  select * into current_row from public.master_data_source_bindings where company_id=p_company_id and source_table=p_source_table and source_record_id=p_source_record_id and source_field=p_source_field for update;
  if current_row.id is null and coalesce(p_expected_revision,0)<>0 then raise exception 'The operational binding changed before it could be saved'; end if;
  if current_row.id is not null and current_row.revision<>p_expected_revision then raise exception 'The operational binding changed before it could be saved'; end if;
  if p_active then
    select * into canonical from public.master_data_records where id=p_master_record_id and company_id=p_company_id and domain=p_domain and status='active';
    if canonical.id is null then raise exception 'Only an active same-company canonical value in the approved domain can be bound'; end if;
    if current_row.id is not null and current_row.master_record_id<>canonical.id then update public.master_data_dependencies set active=false,registered_by=actor.id,updated_at=now() where company_id=p_company_id and master_record_id=current_row.master_record_id and source_table=p_source_table and source_record_id=p_source_record_id and source_field=p_source_field; end if;
    insert into public.master_data_source_bindings(company_id,source_module,source_table,source_record_id,source_field,source_ref,domain,master_record_id,legacy_snapshot,status,confirmed_by)
    values(p_company_id,p_source_module,p_source_table,p_source_record_id,p_source_field,trim(p_source_ref),p_domain,canonical.id,trim(p_legacy_snapshot),'confirmed',actor.id)
    on conflict(company_id,source_table,source_record_id,source_field) do update set source_module=excluded.source_module,source_ref=excluded.source_ref,domain=excluded.domain,master_record_id=excluded.master_record_id,legacy_snapshot=public.master_data_source_bindings.legacy_snapshot,status='confirmed',revision=public.master_data_source_bindings.revision+1,confirmed_by=actor.id,confirmed_at=now(),retired_by=null,retired_at=null,updated_at=now() returning * into saved;
    insert into public.master_data_dependencies(company_id,master_record_id,source_table,source_record_id,source_field,source_ref,active,registered_by)
    values(p_company_id,canonical.id,p_source_table,p_source_record_id,p_source_field,trim(p_source_ref),true,actor.id)
    on conflict(company_id,master_record_id,source_table,source_record_id,source_field) do update set source_ref=excluded.source_ref,active=true,registered_by=actor.id,updated_at=now();
  else
    if current_row.id is null or current_row.status<>'confirmed' or current_row.master_record_id<>p_master_record_id then raise exception 'Only the exact confirmed operational binding can be released'; end if;
    update public.master_data_source_bindings set status='retired',revision=revision+1,retired_by=actor.id,retired_at=now(),updated_at=now() where id=current_row.id returning * into saved;
    update public.master_data_dependencies set active=false,registered_by=actor.id,updated_at=now() where company_id=p_company_id and master_record_id=current_row.master_record_id and source_table=p_source_table and source_record_id=p_source_record_id and source_field=p_source_field;
  end if;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,related_ref,summary,details,event_code)
  values(p_company_id,actor.id,actor.full_name,actor.role,case when p_active then 'master_data_binding_confirmed' else 'master_data_binding_released' end,'master-data',p_source_table,p_source_record_id,trim(p_source_ref),case when p_active then 'Operational record linked to canonical master data' else 'Operational canonical link released with history retained' end,jsonb_build_object('source_module',p_source_module,'source_field',p_source_field,'domain',p_domain,'master_record_id',p_master_record_id,'binding_revision',saved.revision),'master_data.binding_changed');
  return next saved;
end;
$$;

create or replace view public.master_data_adoption_coverage with (security_invoker='true') as
select company_id,source_module,domain,count(*) filter(where status='confirmed') confirmed_count,count(*) filter(where status='retired') retired_count,count(*) total_bindings,max(updated_at) last_reviewed_at
from public.master_data_source_bindings group by company_id,source_module,domain;
grant select on public.master_data_adoption_coverage to authenticated;

revoke all on function public.set_master_data_source_binding(uuid,text,text,uuid,text,text,text,uuid,text,boolean,integer) from public,anon;
grant execute on function public.set_master_data_source_binding(uuid,text,text,uuid,text,text,text,uuid,text,boolean,integer) to authenticated;

commit;
