-- AURIS360 controlled legacy Master Action Plan source backfill
-- Safe to rerun. Existing source_id values are never overwritten.
-- Exact, company-scoped, single-candidate matches are linked automatically.
-- Ambiguous and unresolved records are retained in map_source_backfill_review.
-- MIGRATION VERSION: V3-STAGING-FREE

select 'AURIS360_ACTION_SOURCE_BACKFILL_V3_STAGING_FREE' as migration_version;

begin;

alter table public.action_tracker
  add column if not exists source_id uuid;

create index if not exists idx_action_tracker_source_record
  on public.action_tracker(company_id, source_module, source_id)
  where source_id is not null;

create table if not exists public.map_source_backfill_review (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  action_id uuid not null references public.action_tracker(id) on delete cascade,
  source_module text,
  source_ref text,
  candidate_count integer not null default 0,
  candidate_records jsonb not null default '[]'::jsonb,
  resolution_status text not null default 'unresolved',
  resolved_source_table text,
  resolved_source_id uuid,
  review_notes text,
  first_scanned_at timestamptz not null default now(),
  last_scanned_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  unique(action_id)
);

create index if not exists idx_map_source_backfill_review_company_status
  on public.map_source_backfill_review(company_id, resolution_status);

-- Correct known legacy aliases before matching. This does not alter genuinely
-- manual actions because both the source prefix and missing source ID are required.
update public.action_tracker
set source_module = 'observation',
    source_type = case when source_type is null or lower(source_type) = 'manual' then 'observation' else source_type end,
    updated_at = now()
where source_id is null
  and lower(coalesce(source_module, 'manual')) = 'manual'
  and source_ref ilike 'BBS observation - %';

update public.action_tracker
set source_module = 'chemical',
    source_type = case when source_type is null or lower(source_type) = 'manual' then 'chemical' else source_type end,
    updated_at = now()
where source_id is null
  and lower(coalesce(source_module, 'manual')) = 'manual'
  and source_ref ilike 'Chemical - %';

update public.action_tracker
set source_module = 'atex',
    source_type = case when source_type is null or lower(source_type) = 'manual' then 'atex' else source_type end,
    updated_at = now()
where source_id is null
  and lower(coalesce(source_module, 'manual')) = 'manual'
  and source_ref ilike 'ATEX - %';

-- Each mapping is activated only when both the table and reference column exist.
-- Every mapping is processed in one self-contained CTE statement: no temporary,
-- unlogged or cross-statement work relation is required by the SQL runner.
do $backfill$
declare
  mapping record;
begin
  for mapping in
    select * from (values
      ('event',         'events',                    'event_ref'),
      ('investigation', 'investigations',            'investigation_ref'),
      ('observation',   'safety_observations',       'obs_ref'),
      ('inspection',    'inspections',               'reference_no'),
      ('risk',          'risk_assessments',          'ra_ref'),
      ('meeting',       'toolbox_talks',             'tbt_ref'),
      ('legal',         'compliance_gaps',            'gap_ref'),
      ('chemical',      'chemical_register',         'chemical_ref'),
      ('atex',          'atex_areas',                'area_ref'),
      ('contractor',    'contractor_incidents',      'ref_number'),
      ('esg',           'spill_reports',             'ref_number'),
      ('emergency',     'emergency_drills',          'drill_ref'),
      ('emergency',     'emergency_activations',     'activation_ref'),
      ('emergency',     'emergency_equipment',       'identifier'),
      ('ohealth',       'exposure_monitoring',       'monitoring_ref'),
      ('ohealth',       'occupational_diseases',     'disease_ref'),
      ('documents',     'documents',                 'doc_ref'),
      ('documents',     'documents',                 'reference_no')
    ) as x(module_key, table_name, ref_column)
  loop
    if to_regclass('public.' || mapping.table_name) is not null
       and exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = mapping.table_name
           and column_name = mapping.ref_column
       )
       and exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = mapping.table_name
           and column_name = 'company_id'
       ) then
      execute format(
        'with matches as (
           select
             a.id as action_id,
             a.company_id,
             lower(coalesce(a.source_module, '''')) as source_module,
             a.source_ref,
             count(s.id)::integer as candidate_count,
             min(s.id::text)::uuid as resolved_id,
             jsonb_agg(
               jsonb_build_object(
                 ''source_table'', %L,
                 ''source_id'', s.id,
                 ''matched_reference'', s.%I::text
               ) order by s.id
             ) as candidate_records
           from public.action_tracker a
           join public.%I s on s.company_id = a.company_id
           where a.source_id is null
             and lower(coalesce(a.source_module, '''')) = %L
             and nullif(btrim(a.source_ref), '''') is not null
            and nullif(btrim(s.%I::text), '''') is not null
             and position(lower(s.%I::text) in lower(a.source_ref)) > 0
           group by a.id, a.company_id, a.source_module, a.source_ref
         ), logged as (
           insert into public.map_source_backfill_review (
             company_id, action_id, source_module, source_ref, candidate_count,
             candidate_records, resolution_status, resolved_source_table,
             resolved_source_id, last_scanned_at
           )
           select
             company_id,
             action_id,
             source_module,
             source_ref,
             candidate_count,
             candidate_records,
             case when candidate_count = 1 then ''auto_linked'' else ''needs_review'' end,
             case when candidate_count = 1 then %L else null end,
             case when candidate_count = 1 then resolved_id else null end,
             now()
           from matches
           on conflict (action_id) do update
           set source_module = excluded.source_module,
               source_ref = excluded.source_ref,
               candidate_count = excluded.candidate_count,
               candidate_records = excluded.candidate_records,
               resolution_status = excluded.resolution_status,
               resolved_source_table = excluded.resolved_source_table,
               resolved_source_id = excluded.resolved_source_id,
               last_scanned_at = now()
           where map_source_backfill_review.resolution_status not in (''manually_linked'', ''dismissed'')
           returning action_id
         )
         update public.action_tracker a
         set source_id = m.resolved_id,
             updated_at = now()
         from matches m
         join logged l on l.action_id = m.action_id
         where a.id = m.action_id
           and a.source_id is null
           and m.candidate_count = 1',
        mapping.table_name,
        mapping.ref_column,
        mapping.table_name,
        mapping.module_key,
        mapping.ref_column,
        mapping.ref_column,
        mapping.table_name
      );
    end if;
  end loop;
end
$backfill$;

-- A Management of Change item is itself the governed action_tracker row.
with moc_matches as (
  select id as action_id, company_id, lower(source_module) as source_module, source_ref
  from public.action_tracker
  where source_id is null
    and lower(coalesce(source_module, '')) = 'moc'
    and source_ref ~* '^MOC-[0-9]{4}-[0-9]+'
), logged as (
  insert into public.map_source_backfill_review (
    company_id, action_id, source_module, source_ref, candidate_count,
    candidate_records, resolution_status, resolved_source_table,
    resolved_source_id, last_scanned_at
  )
  select
    company_id,
    action_id,
    source_module,
    source_ref,
    1,
    jsonb_build_array(jsonb_build_object('source_table', 'action_tracker', 'source_id', action_id, 'matched_reference', source_ref)),
    'auto_linked',
    'action_tracker',
    action_id,
    now()
  from moc_matches
  on conflict (action_id) do update
  set candidate_count = 1,
      candidate_records = excluded.candidate_records,
      resolution_status = 'auto_linked',
      resolved_source_table = 'action_tracker',
      resolved_source_id = excluded.resolved_source_id,
      last_scanned_at = now()
  where map_source_backfill_review.resolution_status not in ('manually_linked', 'dismissed')
  returning action_id
)
update public.action_tracker a
set source_id = a.id,
    updated_at = now()
from logged l
where a.id = l.action_id
  and a.source_id is null;

-- Anything still unlinked is explicitly queued without guessing.
insert into public.map_source_backfill_review (
  company_id, action_id, source_module, source_ref, candidate_count,
  candidate_records, resolution_status, last_scanned_at
)
select
  company_id,
  id,
  lower(source_module),
  source_ref,
  0,
  '[]'::jsonb,
  'unresolved',
  now()
from public.action_tracker
where source_id is null
  and nullif(btrim(source_ref), '') is not null
  and lower(coalesce(source_module, '')) not in ('', 'manual', 'ai')
on conflict (action_id) do update
set last_scanned_at = now()
where map_source_backfill_review.resolution_status = 'unresolved';

alter table public.map_source_backfill_review enable row level security;

drop policy if exists "map_source_backfill_review_company_access" on public.map_source_backfill_review;
create policy "map_source_backfill_review_company_access"
  on public.map_source_backfill_review
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'sephs_admin' or p.company_id = map_source_backfill_review.company_id)
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'sephs_admin' or p.company_id = map_source_backfill_review.company_id)
    )
  );

grant select, insert, update, delete on public.map_source_backfill_review to authenticated;

commit;

notify pgrst, 'reload schema';

-- Post-run reconciliation summary:
select resolution_status, count(*) as actions
from public.map_source_backfill_review
group by resolution_status
order by resolution_status;
