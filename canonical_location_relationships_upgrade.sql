-- AURIS360 AP-052: canonical Site and Area relationships.
-- Rerunnable. Areas remain child rows in public.sites (parent_site_id is set).
-- Text fields are retained as immutable display snapshots; only unique exact
-- company-scoped matches are backfilled automatically.

begin;

create table if not exists public.location_identity_backfill_review (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_table text not null,
  source_id text not null,
  legacy_site text,
  legacy_area text,
  candidate_location_ids uuid[] not null default '{}',
  resolution_status text not null default 'unresolved'
    check (resolution_status in ('unresolved','resolved','ignored')),
  resolved_site_id uuid references public.sites(id),
  resolved_area_id uuid references public.sites(id),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_table,source_id)
);

-- The priority records consumed by Site Map and operational dashboards.
alter table if exists public.events add column if not exists site_id uuid references public.sites(id);
alter table if exists public.events add column if not exists area_id uuid references public.sites(id);
alter table if exists public.events add column if not exists site_name_snapshot text;
alter table if exists public.events add column if not exists area_name_snapshot text;

alter table if exists public.safety_observations add column if not exists site_id uuid references public.sites(id);
alter table if exists public.safety_observations add column if not exists area_id uuid references public.sites(id);
alter table if exists public.safety_observations add column if not exists site_name_snapshot text;
alter table if exists public.safety_observations add column if not exists area_name_snapshot text;

alter table if exists public.inspections add column if not exists site_id uuid references public.sites(id);
alter table if exists public.inspections add column if not exists area_id uuid references public.sites(id);
alter table if exists public.inspections add column if not exists site_name_snapshot text;
alter table if exists public.inspections add column if not exists area_name_snapshot text;

alter table if exists public.risk_assessments add column if not exists site_id uuid references public.sites(id);
alter table if exists public.risk_assessments add column if not exists area_id uuid references public.sites(id);
alter table if exists public.risk_assessments add column if not exists site_name_snapshot text;
alter table if exists public.risk_assessments add column if not exists area_name_snapshot text;

alter table if exists public.permits add column if not exists site_id uuid references public.sites(id);
alter table if exists public.permits add column if not exists area_id uuid references public.sites(id);
alter table if exists public.permits add column if not exists site_name_snapshot text;
alter table if exists public.permits add column if not exists area_name_snapshot text;

alter table if exists public.action_tracker add column if not exists site_id uuid references public.sites(id);
alter table if exists public.action_tracker add column if not exists area_id uuid references public.sites(id);
alter table if exists public.action_tracker add column if not exists site_name_snapshot text;
alter table if exists public.action_tracker add column if not exists area_name_snapshot text;

-- Compatibility tables used by older deployments are upgraded when present.
alter table if exists public.observations add column if not exists site_id uuid references public.sites(id);
alter table if exists public.observations add column if not exists area_id uuid references public.sites(id);
alter table if exists public.observations add column if not exists site_name_snapshot text;
alter table if exists public.observations add column if not exists area_name_snapshot text;
alter table if exists public.permit_to_work add column if not exists site_id uuid references public.sites(id);
alter table if exists public.permit_to_work add column if not exists area_id uuid references public.sites(id);
alter table if exists public.permit_to_work add column if not exists site_name_snapshot text;
alter table if exists public.permit_to_work add column if not exists area_name_snapshot text;

create index if not exists idx_location_identity_review_status
  on public.location_identity_backfill_review(company_id,resolution_status,source_table);

create or replace function public.normalise_location_identity_text(value text)
returns text language sql immutable as $$
  select regexp_replace(lower(trim(coalesce(value,''))),'[^a-z0-9]+','','g')
$$;

create or replace function public.resolve_location_identity(
  p_company_id uuid,
  p_site_text text,
  p_area_text text default null
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  matches uuid[];
  area_matches uuid[];
  matched public.sites%rowtype;
begin
  if nullif(trim(p_area_text),'') is null and nullif(trim(p_site_text),'') is null then
    return jsonb_build_object('site_id',null,'area_id',null,'candidate_ids','[]'::jsonb);
  end if;

  if nullif(trim(p_area_text),'') is not null then
    select array_agg(s.id order by s.id) into area_matches
    from public.sites s
    where s.company_id=p_company_id and s.parent_site_id is not null
      and coalesce(s.status,'active')<>'inactive'
      and (public.normalise_location_identity_text(s.name)=public.normalise_location_identity_text(p_area_text)
        or (nullif(trim(s.site_code),'') is not null and public.normalise_location_identity_text(s.site_code)=public.normalise_location_identity_text(p_area_text)));
    if coalesce(array_length(area_matches,1),0)=1 then
      select * into matched from public.sites where id=area_matches[1];
      return jsonb_build_object('site_id',matched.parent_site_id,'area_id',matched.id,'candidate_ids',to_jsonb(area_matches));
    end if;
  end if;

  if nullif(trim(p_site_text),'') is not null then
    select array_agg(s.id order by s.id) into matches
    from public.sites s
    where s.company_id=p_company_id and coalesce(s.status,'active')<>'inactive'
      and (public.normalise_location_identity_text(s.name)=public.normalise_location_identity_text(p_site_text)
        or (nullif(trim(s.site_code),'') is not null and public.normalise_location_identity_text(s.site_code)=public.normalise_location_identity_text(p_site_text)));
  else
    matches := area_matches;
  end if;

  if coalesce(array_length(matches,1),0)=1 then
    select * into matched from public.sites where id=matches[1];
    return jsonb_build_object(
      'site_id',coalesce(matched.parent_site_id,matched.id),
      'area_id',case when matched.parent_site_id is not null then matched.id else null end,
      'candidate_ids',to_jsonb(matches)
    );
  end if;
  return jsonb_build_object('site_id',null,'area_id',null,'candidate_ids',to_jsonb(coalesce(matches,'{}'::uuid[])));
end;
$$;

create or replace function public.backfill_location_identity(
  p_table text,
  p_site_column text,
  p_area_column text default null
) returns void
language plpgsql security definer set search_path=public as $$
declare
  area_expr text;
  sql_text text;
begin
  if to_regclass('public.'||p_table) is null then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name=p_site_column) then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name='site_id') then return; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name='company_id') then return; end if;
  area_expr := case when p_area_column is not null and exists(
    select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name=p_area_column
  ) then format('r.%I::text',p_area_column) else 'null::text' end;

  sql_text := format($q$
    update public.%I r set
      site_id=coalesce(r.site_id,(public.resolve_location_identity(r.company_id,r.%I::text,%s)->>'site_id')::uuid),
      area_id=coalesce(r.area_id,(public.resolve_location_identity(r.company_id,r.%I::text,%s)->>'area_id')::uuid),
      site_name_snapshot=coalesce(r.site_name_snapshot,nullif(trim(r.%I::text),'')),
      area_name_snapshot=coalesce(r.area_name_snapshot,nullif(trim(%s),''))
    where nullif(trim(r.%I::text),'') is not null
  $q$,p_table,p_site_column,area_expr,p_site_column,area_expr,p_site_column,area_expr,p_site_column);
  execute sql_text;

  sql_text := format($q$
    insert into public.location_identity_backfill_review(
      company_id,source_table,source_id,legacy_site,legacy_area,candidate_location_ids
    )
    select r.company_id,%L,r.id::text,r.%I::text,%s,
      coalesce(array(select jsonb_array_elements_text(public.resolve_location_identity(r.company_id,r.%I::text,%s)->'candidate_ids')::uuid),'{}'::uuid[])
    from public.%I r
    where r.site_id is null and nullif(trim(r.%I::text),'') is not null
    on conflict(source_table,source_id) do update set
      legacy_site=excluded.legacy_site,legacy_area=excluded.legacy_area,
      candidate_location_ids=excluded.candidate_location_ids,updated_at=now()
  $q$,p_table,p_site_column,area_expr,p_site_column,area_expr,p_table,p_site_column);
  execute sql_text;
end;
$$;

select public.backfill_location_identity('events','location',null);
select public.backfill_location_identity('safety_observations','location',null);
select public.backfill_location_identity('observations','location',null);
select public.backfill_location_identity('inspections','site',null);
select public.backfill_location_identity('risk_assessments','site_name','location');
select public.backfill_location_identity('permits','location',null);
select public.backfill_location_identity('permit_to_work','location',null);
select public.backfill_location_identity('action_tracker','location',null);

do $$
declare t text;
begin
  foreach t in array array['events','safety_observations','observations','inspections','risk_assessments','permits','permit_to_work','action_tracker'] loop
    if to_regclass('public.'||t) is not null and exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='company_id'
    ) then
      execute format('create index if not exists %I on public.%I(company_id,site_id,area_id)',
        'idx_'||t||'_location_identity',t);
    end if;
  end loop;
end;
$$;

alter table public.location_identity_backfill_review enable row level security;
drop policy if exists location_identity_review_admin_access on public.location_identity_backfill_review;
create policy location_identity_review_admin_access on public.location_identity_backfill_review
for all using (
  exists(select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=location_identity_backfill_review.company_id and p.role in ('admin','hse_manager'))))
) with check (
  exists(select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=location_identity_backfill_review.company_id and p.role in ('admin','hse_manager'))))
);

grant select,insert,update on public.location_identity_backfill_review to authenticated;

comment on table public.location_identity_backfill_review is
  'Ambiguous or unmatched legacy site/area text awaiting controlled reconciliation.';

commit;
