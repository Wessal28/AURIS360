-- AURIS360 controlled legacy Master Action Plan source backfill
-- Safe to rerun. Existing source_id values are never overwritten.
-- Exact, company-scoped, single-candidate matches are linked automatically.
-- Ambiguous and unresolved records are retained in map_source_backfill_review.

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

-- Supabase SQL runners may execute statements across transaction boundaries,
-- which makes temporary tables disappear before the DO block can use them.
-- Explicitly scoped unlogged work tables survive those boundaries and are
-- removed at the end of the migration.
drop table if exists public.map_source_backfill_candidates_work;
drop table if exists public.map_source_backfill_targets_work;

create unlogged table public.map_source_backfill_targets_work as
select id as action_id, company_id, lower(coalesce(source_module, '')) as source_module, source_ref
from public.action_tracker
where source_id is null
  and nullif(btrim(source_ref), '') is not null
  and lower(coalesce(source_module, '')) not in ('', 'manual', 'ai');

create unlogged table public.map_source_backfill_candidates_work (
  action_id uuid not null,
  source_table text not null,
  source_id uuid not null,
  matched_reference text,
  primary key(action_id, source_table, source_id)
);

-- Each mapping is activated only when both the table and reference column exist.
-- Matching is case-insensitive, company-scoped and reference-token based.
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
        'insert into public.map_source_backfill_candidates_work(action_id, source_table, source_id, matched_reference)
         select t.action_id, %L, s.id, s.%I::text
         from public.map_source_backfill_targets_work t
         join public.%I s on s.company_id = t.company_id
         where t.source_module = %L
           and nullif(btrim(s.%I::text), '''') is not null
           and position(lower(s.%I::text) in lower(t.source_ref)) > 0
         on conflict do nothing',
        mapping.table_name,
        mapping.ref_column,
        mapping.table_name,
        mapping.module_key,
        mapping.ref_column,
        mapping.ref_column
      );
    end if;
  end loop;
end
$backfill$;

-- A Management of Change item is itself the governed action_tracker row.
insert into public.map_source_backfill_candidates_work(action_id, source_table, source_id, matched_reference)
select t.action_id, 'action_tracker', t.action_id, t.source_ref
from public.map_source_backfill_targets_work t
where t.source_module = 'moc'
  and t.source_ref ~* '^MOC-[0-9]{4}-[0-9]+'
on conflict do nothing;

-- Only exactly one candidate may be auto-linked.
with unique_candidates as (
  select action_id, max(source_id::text)::uuid as source_id
  from public.map_source_backfill_candidates_work
  group by action_id
  having count(*) = 1
)
update public.action_tracker a
set source_id = u.source_id,
    updated_at = now()
from unique_candidates u
where a.id = u.action_id
  and a.source_id is null;

-- Preserve a complete reconciliation result for every scanned action.
with candidate_summary as (
  select
    t.action_id,
    t.company_id,
    t.source_module,
    t.source_ref,
    count(c.source_id)::integer as candidate_count,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'source_table', c.source_table,
          'source_id', c.source_id,
          'matched_reference', c.matched_reference
        ) order by c.source_table, c.source_id
      ) filter (where c.source_id is not null),
      '[]'::jsonb
    ) as candidates,
    max(c.source_table) filter (where c.source_id is not null) as resolved_table,
    (max(c.source_id::text) filter (where c.source_id is not null))::uuid as resolved_id
  from public.map_source_backfill_targets_work t
  left join public.map_source_backfill_candidates_work c on c.action_id = t.action_id
  group by t.action_id, t.company_id, t.source_module, t.source_ref
)
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
  candidates,
  case
    when candidate_count = 1 then 'auto_linked'
    when candidate_count > 1 then 'needs_review'
    else 'unresolved'
  end,
  case when candidate_count = 1 then resolved_table else null end,
  case when candidate_count = 1 then resolved_id else null end,
  now()
from candidate_summary
on conflict (action_id) do update
set source_module = excluded.source_module,
    source_ref = excluded.source_ref,
    candidate_count = excluded.candidate_count,
    candidate_records = excluded.candidate_records,
    resolution_status = excluded.resolution_status,
    resolved_source_table = excluded.resolved_source_table,
    resolved_source_id = excluded.resolved_source_id,
    last_scanned_at = now();

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

drop table if exists public.map_source_backfill_candidates_work;
drop table if exists public.map_source_backfill_targets_work;

commit;

notify pgrst, 'reload schema';

-- Post-run reconciliation summary:
select resolution_status, count(*) as actions
from public.map_source_backfill_review
group by resolution_status
order by resolution_status;
