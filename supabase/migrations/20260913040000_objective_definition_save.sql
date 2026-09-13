-- Save objective definitions and their audit event with a captured revision.
begin;
alter table public.objectives add column if not exists definition_revision bigint not null default 1;

create or replace function public.advance_objective_definition_revision()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  new.definition_revision := old.definition_revision + 1;
  return new;
end;$$;
drop trigger if exists trg_zz_objective_definition_revision on public.objectives;
create trigger trg_zz_objective_definition_revision before update on public.objectives
for each row execute function public.advance_objective_definition_revision();

create or replace function public.save_objective_definition(
  p_company_id uuid, p_objective_id uuid, p_expected_revision bigint, p_definition jsonb
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor_role text;
  item public.objectives%rowtype;
  desired public.objectives%rowtype;
begin
  select role into actor_role from public.profiles
    where id=auth.uid() and status='active' and (company_id=p_company_id or role='sephs_admin');
  if auth.uid() is null or p_company_id is null or actor_role is null
      or actor_role not in ('manager','admin','sephs_admin')
      or not public.auris_can_access_company(p_company_id) then
    raise exception 'AURIS_OBJECTIVE_SAVE_DENIED' using errcode='42501';
  end if;
  if jsonb_typeof(p_definition) is distinct from 'object' then
    raise exception 'AURIS_OBJECTIVE_INVALID_DEFINITION' using errcode='22023';
  end if;
  desired := jsonb_populate_record(null::public.objectives,p_definition);
  desired.name := btrim(desired.name);
  desired.code := nullif(btrim(desired.code),'');
  if desired.company_id is distinct from p_company_id or nullif(desired.name,'') is null
      or desired.name ~* '^\[Archived' or desired.year is null or desired.year not between 1900 and 9999
      or desired.color is null or desired.color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'AURIS_OBJECTIVE_INVALID_DEFINITION' using errcode='22023';
  end if;
  if p_objective_id is not null then
    select * into item from public.objectives where id=p_objective_id and company_id=p_company_id for update;
    if not found then raise exception 'AURIS_OBJECTIVE_NOT_FOUND' using errcode='P0002';end if;
    if item.definition_revision is distinct from p_expected_revision then
      raise exception 'AURIS_OBJECTIVE_EDIT_CONFLICT' using errcode='PT409';
    end if;
    if item.name ~* '^\[Archived' then
      raise exception 'AURIS_OBJECTIVE_ARCHIVED' using errcode='42501';
    end if;
    -- The KPI definition RPC takes FOR SHARE on this same objective. Either
    -- creation/reparenting commits first and this check sees it, or it waits
    -- and rejects the mismatched year. No child records are moved implicitly.
    if item.year is distinct from desired.year and exists(
      select 1 from public.kpis_v2 where objective_id=item.id
    ) then
      raise exception 'AURIS_OBJECTIVE_YEAR_HAS_KPIS' using errcode='23514';
    end if;
  elsif p_expected_revision is not null then
    raise exception 'AURIS_OBJECTIVE_INVALID_BASELINE' using errcode='22023';
  end if;
  -- All RPC saves for this tenant/year share the allocator lock, including
  -- explicit codes. Existing manual/legacy codes retain their semantics.
  perform pg_advisory_xact_lock(hashtextextended('objective-code:'||p_company_id::text||':'||desired.year::text,0));
  if desired.code is null then
    select (coalesce(max(((regexp_match(btrim(code),'^([+]?[0-9]+)'))[1])::numeric),0)+1)::text
      into desired.code from public.objectives where company_id=p_company_id and year=desired.year;
  end if;
  if p_objective_id is null then
    insert into public.objectives(company_id,name,code,year,color,created_by)
      values(p_company_id,desired.name,desired.code,desired.year,desired.color,auth.uid()) returning * into item;
  else
    update public.objectives set name=desired.name,code=desired.code,year=desired.year,color=desired.color
      where id=item.id returning * into item;
  end if;
  insert into public.audit_events(company_id,actor_user_id,actor_role,action,module_name,related_table,related_id,related_ref,summary,details,event_code)
    values(p_company_id,auth.uid(),actor_role,case when p_objective_id is null then 'create' else 'update' end,
      'kpi','objectives',item.id,item.code,'Objective definition saved',
      jsonb_build_object('definition_revision',item.definition_revision,'year',item.year),'objective.definition_saved');
  return to_jsonb(item);
end;$$;
revoke all on function public.advance_objective_definition_revision() from public,anon,authenticated;
revoke all on function public.save_objective_definition(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.save_objective_definition(uuid,uuid,bigint,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
