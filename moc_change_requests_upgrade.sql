-- AURIS360 AP-044: separate Management of Change from corrective actions.
-- Rerunnable. Existing action_tracker MOC rows are retained and linked to the
-- new change request; no action history is deleted.

begin;

create table if not exists public.moc_change_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  moc_ref text not null,
  title text not null,
  change_type text not null default 'process',
  reason text,
  current_situation text,
  proposed_change text,
  impacted_areas text[] not null default '{}',
  risk_review text,
  pre_implementation_actions text,
  post_change_verification text,
  priority text not null default 'medium',
  lifecycle_status text not null default 'draft',
  owner_id uuid,
  owner_name text,
  location text,
  target_date date,
  submitted_at timestamptz,
  approved_at timestamptz,
  implemented_at timestamptz,
  verified_at timestamptz,
  closed_at timestamptz,
  approver_id uuid,
  approver_name text,
  verifier_id uuid,
  verifier_name text,
  legacy_action_id uuid unique,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint moc_change_requests_company_ref_key unique(company_id, moc_ref),
  constraint moc_change_requests_priority_check
    check(priority in ('low','medium','high','critical')),
  constraint moc_change_requests_lifecycle_check
    check(lifecycle_status in (
      'draft','screening','impact_assessment','pending_approval','approved',
      'implementation','verification','closed','rejected','cancelled'
    ))
);

create index if not exists idx_moc_change_requests_company_status
  on public.moc_change_requests(company_id, lifecycle_status, updated_at desc);
create index if not exists idx_moc_change_requests_owner
  on public.moc_change_requests(company_id, owner_id, target_date);

create or replace function public.moc_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists trg_moc_touch_updated_at on public.moc_change_requests;
create trigger trg_moc_touch_updated_at
before update on public.moc_change_requests
for each row execute function public.moc_touch_updated_at();

-- Promote legacy MOC-shaped action rows into dedicated change request headers.
-- The original action row remains available as the first linked implementation
-- action and keeps its activity/history records.
with legacy as (
  select a.*,
         coalesce(nullif(a.source_ref,''),nullif(a.action_ref,''),'MOC-LEGACY-' || left(a.id::text,8)) as base_ref,
         count(*) over (
           partition by a.company_id,
             coalesce(nullif(a.source_ref,''),nullif(a.action_ref,''),'MOC-LEGACY-' || left(a.id::text,8))
         ) as ref_count
  from public.action_tracker a
  where lower(coalesce(a.source_module,a.source_type,'')) in ('moc','management_of_change')
), prepared as (
  select l.*,
         case when l.ref_count > 1 then l.base_ref || '-' || left(l.id::text,8) else l.base_ref end as migrated_ref
  from legacy l
)
insert into public.moc_change_requests(
  company_id,moc_ref,title,change_type,reason,current_situation,proposed_change,
  impacted_areas,risk_review,pre_implementation_actions,post_change_verification,
  priority,lifecycle_status,owner_id,owner_name,location,target_date,
  legacy_action_id,created_by,created_at,updated_at
)
select
  p.company_id,p.migrated_ref,coalesce(nullif(p.title,''),'Legacy change request'),
  case
    when lower(coalesce(substring(p.description from '(?im)^Change type:\s*(.*)$'),'')) like 'equipment%' then 'equipment'
    when lower(coalesce(substring(p.description from '(?im)^Change type:\s*(.*)$'),'')) like 'chemical%' then 'chemical'
    when lower(coalesce(substring(p.description from '(?im)^Change type:\s*(.*)$'),'')) like 'layout%' then 'layout'
    when lower(coalesce(substring(p.description from '(?im)^Change type:\s*(.*)$'),'')) like 'organisation%' then 'people'
    when lower(coalesce(substring(p.description from '(?im)^Change type:\s*(.*)$'),'')) like 'supplier%' then 'supplier'
    when lower(coalesce(substring(p.description from '(?im)^Change type:\s*(.*)$'),'')) like 'legal%' then 'legal'
    when lower(coalesce(substring(p.description from '(?im)^Change type:\s*(.*)$'),'')) like 'temporary%' then 'temporary'
    when lower(coalesce(substring(p.description from '(?im)^Change type:\s*(.*)$'),'')) like 'emergency%' then 'emergency'
    when lower(coalesce(substring(p.description from '(?im)^Change type:\s*(.*)$'),'')) like 'process%' then 'process'
    else 'other'
  end,
  nullif(substring(p.description from '(?im)^Reason:\s*(.*)$'),''),
  nullif(substring(p.description from '(?im)^Current situation:\s*(.*)$'),''),
  nullif(substring(p.description from '(?im)^Proposed change:\s*(.*)$'),''),
  case
    when nullif(substring(p.description from '(?im)^Impacted areas:\s*(.*)$'),'') is null then '{}'
    when lower(substring(p.description from '(?im)^Impacted areas:\s*(.*)$'))='none selected' then '{}'
    else string_to_array(substring(p.description from '(?im)^Impacted areas:\s*(.*)$'),', ')
  end,
  nullif(substring(p.description from '(?im)^Risk review:\s*(.*)$'),''),
  nullif(substring(p.description from '(?im)^Pre-implementation actions:\s*(.*)$'),''),
  nullif(substring(p.description from '(?im)^Post-change verification:\s*(.*)$'),''),
  case when p.priority in ('low','medium','high','critical') then p.priority else 'medium' end,
  case p.status
    when 'open' then 'screening'
    when 'in_progress' then 'implementation'
    when 'pending_verification' then 'verification'
    when 'closed' then 'closed'
    when 'cancelled' then 'cancelled'
    else 'draft'
  end,
  p.assigned_to_id,coalesce(p.assigned_to_name,p.responsible),p.location,p.target_date,
  p.id,p.created_by,p.created_at,coalesce(p.updated_at,p.created_at,now())
from prepared p
on conflict(legacy_action_id) do update set
  title=excluded.title,
  owner_id=coalesce(public.moc_change_requests.owner_id,excluded.owner_id),
  owner_name=coalesce(public.moc_change_requests.owner_name,excluded.owner_name),
  updated_at=greatest(public.moc_change_requests.updated_at,excluded.updated_at);

-- Point retained actions at their new source record. source_table was added by
-- the relationship remediation; guard it for installations upgrading directly.
update public.action_tracker a
set source_id=m.id,
    source_ref=m.moc_ref,
    source_module='moc',
    source_type='moc'
from public.moc_change_requests m
where m.legacy_action_id=a.id;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='action_tracker' and column_name='source_table'
  ) then
    execute $sql$
      update public.action_tracker a
      set source_table='moc_change_requests'
      from public.moc_change_requests m
      where m.legacy_action_id=a.id
    $sql$;
  end if;
end;
$$;

-- Register the dedicated endpoint and retire the old MOC-as-action endpoint.
-- Guard this block for installations that have not applied AP-030 yet.
do $$
begin
  if to_regclass('public.relationship_module_registry') is not null then
    insert into public.relationship_module_registry(
      module_key,table_name,id_column,ref_column,display_label,enabled
    ) values ('moc','moc_change_requests','id','moc_ref','Management of Change',true)
    on conflict(module_key,table_name) do update set
      id_column=excluded.id_column,ref_column=excluded.ref_column,
      display_label=excluded.display_label,enabled=true,updated_at=now();

    update public.relationship_module_registry
    set enabled=false,updated_at=now()
    where module_key='moc' and table_name='action_tracker';
  end if;
end;
$$;

-- Create reciprocal MOC -> action relationships where the shared platform is
-- installed. This is intentionally conditional so the migration stays portable.
do $$
begin
  if to_regclass('public.record_relationships') is not null then
    insert into public.record_relationships(
      company_id,source_module,source_table,source_id,source_ref,
      target_module,target_table,target_id,target_ref,relationship_type,
      status,source_valid,target_valid,last_validated_at,created_by
    )
    select m.company_id,'moc','moc_change_requests',m.id::text,m.moc_ref,
           'action','action_tracker',a.id::text,coalesce(a.action_ref,a.source_ref),
           'generated_action','active',true,true,now(),coalesce(m.created_by,a.created_by)
    from public.moc_change_requests m
    join public.action_tracker a on a.id=m.legacy_action_id
    where not exists (
      select 1 from public.record_relationships r
      where r.status<>'archived'
        and r.source_table='moc_change_requests' and r.source_id=m.id::text
        and r.target_table='action_tracker' and r.target_id=a.id::text
    );
  end if;
end;
$$;

alter table public.moc_change_requests enable row level security;
drop policy if exists moc_change_requests_company_access on public.moc_change_requests;
create policy moc_change_requests_company_access on public.moc_change_requests
for all using (
  exists (
    select 1 from public.profiles p
    where p.id=auth.uid()
      and (p.role='sephs_admin' or p.company_id=moc_change_requests.company_id)
  )
) with check (
  exists (
    select 1 from public.profiles p
    where p.id=auth.uid()
      and (p.role='sephs_admin' or p.company_id=moc_change_requests.company_id)
  )
);

grant select,insert,update,delete on public.moc_change_requests to authenticated;

comment on table public.moc_change_requests is
  'Controlled Management of Change headers. Resulting corrective actions remain separate action_tracker records linked through record_relationships.';

commit;
