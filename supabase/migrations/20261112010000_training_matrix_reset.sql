begin;

-- A NULL roster retains the legacy all-members layout. An empty roster shows no members.
create table public.training_matrix_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  person_ids uuid[],
  competency_ids uuid[]
);

alter table public.training_matrix_settings enable row level security;
revoke all on public.training_matrix_settings from public, anon, authenticated;
grant select on public.training_matrix_settings to authenticated;

create policy training_matrix_settings_read on public.training_matrix_settings
for select to authenticated using (
  (company_id = public.auth_company_id() or public.is_sephs_admin())
  and public.user_access_allowed('training.competency', 'view')
);

create function public.assert_training_matrix_manager(p_company_id uuid, p_action text)
returns void language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if p_company_id is null or not exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid() and actor.status = 'active'
      and actor.role in ('manager', 'admin', 'sephs_admin')
      and (actor.company_id = p_company_id or actor.role = 'sephs_admin')
  ) or not public.user_access_allowed('training.competency', 'edit')
    or not public.user_access_allowed('training.competency', p_action) then
    raise exception 'You do not have permission to change this company''s training matrix.' using errcode = '42501';
  end if;
end;
$$;

create function public.set_training_matrix_members(p_company_id uuid, p_axis text, p_ids uuid[], p_add boolean default false)
returns public.training_matrix_settings language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  result public.training_matrix_settings;
begin
  perform public.assert_training_matrix_manager(p_company_id, 'edit');
  if p_axis is null or p_axis not in ('rows', 'columns') then
    raise exception 'Choose matrix rows or columns.' using errcode = '22023';
  end if;
  if p_add and p_ids is null then
    raise exception 'Choose the matrix members to add.' using errcode = '22023';
  end if;
  if array_ndims(p_ids) > 1 or cardinality(p_ids) <> (select count(distinct id) from unnest(p_ids) members(id)) then
    raise exception 'Matrix members must be a list of distinct records.' using errcode = '22023';
  end if;

  if p_axis = 'rows' then
    if exists (
      select 1 from unnest(p_ids) members(id)
      where not exists (
        select 1 from public.people person
        where person.id = members.id and person.company_id = p_company_id and person.status = 'active'
      )
    ) then
      raise exception 'Select active people from this company.' using errcode = '22023';
    end if;

    insert into public.training_matrix_settings as settings (company_id, person_ids)
    values (p_company_id, case when p_add then null else p_ids end)
    on conflict (company_id) do update set person_ids = case
      when not coalesce(p_add, false) then p_ids
      when settings.person_ids is null then null
      else array(select distinct id from unnest(settings.person_ids || p_ids) members(id) order by id)
    end
    returning * into result;
  else
    if exists (
      select 1 from unnest(p_ids) members(id)
      where not exists (
        select 1 from public.competencies competency
        where competency.id = members.id and competency.company_id = p_company_id
      )
    ) then
      raise exception 'Select competencies from this company.' using errcode = '22023';
    end if;

    insert into public.training_matrix_settings as settings (company_id, competency_ids)
    values (p_company_id, case when p_add then null else p_ids end)
    on conflict (company_id) do update set competency_ids = case
      when not coalesce(p_add, false) then p_ids
      when settings.competency_ids is null then null
      else array(select distinct id from unnest(settings.competency_ids || p_ids) members(id) order by id)
    end
    returning * into result;
  end if;
  return result;
end;
$$;

create function public.reset_training_matrix(p_company_id uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  layout public.training_matrix_settings;
  cleared_cells bigint;
  optional_assignments text;
  optional_fields text;
begin
  perform public.assert_training_matrix_manager(p_company_id, 'delete');
  if p_mode is null or p_mode not in ('cells', 'full') then
    raise exception 'Choose whether to clear the data or the entire matrix.' using errcode = '22023';
  end if;

  -- Hold the company layout row throughout the reset, including while clearing the cells.
  insert into public.training_matrix_settings (company_id) values (p_company_id)
  on conflict (company_id) do nothing;
  select * into layout from public.training_matrix_settings
  where company_id = p_company_id for update;

  -- Older installations may also have assessment fields from the flat competency register.
  select string_agg(format(', %I = null', attname), '' order by attname),
    string_agg(format(', cell.%I', attname), '' order by attname)
  into optional_assignments, optional_fields
  from pg_attribute
  where attrelid = 'public.competency_matrix'::regclass and attnum > 0 and not attisdropped
    and not attnotnull and attgenerated = ''
    and attname in ('supporting_training_id', 'assessed_date', 'expiry_date', 'assessor', 'evidence', 'evidence_ref', 'level');

  -- Retain cell IDs for existing links and leave the standalone competency register entries intact.
  execute format($sql$
    update public.competency_matrix cell
    set current_level = null, required_level = null, notes = null, updated_at = clock_timestamp()%s
    where cell.company_id = $1
      and exists (select 1 from public.people person where person.id = cell.person_id and person.company_id = $1)
      and exists (select 1 from public.competencies competency where competency.id = cell.competency_id and competency.company_id = $1)
      and num_nonnulls(cell.current_level, cell.required_level, cell.notes%s) > 0
  $sql$, optional_assignments, optional_fields) using p_company_id;
  get diagnostics cleared_cells = row_count;

  if p_mode = 'full' then
    update public.training_matrix_settings
    set person_ids = '{}'::uuid[], competency_ids = '{}'::uuid[]
    where company_id = p_company_id returning * into layout;
  end if;

  return jsonb_build_object('cleared_cells', cleared_cells,
    'person_ids', layout.person_ids, 'competency_ids', layout.competency_ids);
end;
$$;

revoke all on function public.assert_training_matrix_manager(uuid, text) from public, anon, authenticated;
revoke all on function public.set_training_matrix_members(uuid, text, uuid[], boolean) from public, anon, authenticated;
revoke all on function public.reset_training_matrix(uuid, text) from public, anon, authenticated;
grant execute on function public.set_training_matrix_members(uuid, text, uuid[], boolean),
  public.reset_training_matrix(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
