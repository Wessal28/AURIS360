-- Real SQL behavior, exclusively inside the disposable migration replay.
begin;
do $$begin
  if current_database()<>'auris360_migration_replay' then raise exception 'Disposable replay database required';end if;
end;$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create function pg_temp.objective_snapshot(o uuid) returns jsonb language sql as $$
  select jsonb_build_object('objective',(select to_jsonb(t) from public.objectives t where id=o),
    'audit',(select jsonb_agg(to_jsonb(t) order by id) from public.audit_events t where related_id=o))
$$;
create function pg_temp.objective_audit_failure() returns trigger language plpgsql as $$
begin
  if current_setting('test.objective_audit_failure',true)='on' then raise exception 'Synthetic audit failure';end if;
  return new;
end;$$;
create trigger test_objective_audit_failure before insert on public.audit_events
for each row execute function pg_temp.objective_audit_failure();
do $$
declare
  tenant uuid:=gen_random_uuid(); foreign_tenant uuid:=gen_random_uuid();
  actor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid();
  o uuid; k uuid; rev bigint; definition jsonb; saved jsonb; before_state jsonb; before_kpi jsonb;
  invalid jsonb; permitted_role text;
begin
  insert into auth.users(id) values(actor),(viewer);
  insert into public.companies(id,name) values(tenant,'Objective replay'),(foreign_tenant,'Foreign objective replay');
  insert into public.profiles(id,company_id,role,status) values(actor,tenant,'admin','active'),(viewer,tenant,'employee','active');
  perform set_config('request.jwt.claim.sub',actor::text,true);
  insert into public.objectives(company_id,name,year,code) values
    (tenant,'Code prefix',2026,'3.1'),(tenant,'Other year',2027,'80'),(foreign_tenant,'Other company',2026,'90');
  definition:=jsonb_build_object('company_id',tenant,'name','Original objective','code','','year',2026,'color','#abcdef',
    'created_by',viewer,'definition_revision',999,'sort_order',100,'id',viewer);
  saved:=public.save_objective_definition(tenant,null,null,definition);o:=(saved->>'id')::uuid;
  if saved->>'code'<>'4' or saved->>'created_by'<>actor::text or saved->>'definition_revision'<>'1'
      or saved->>'sort_order'<>'0' or o=viewer or (select count(*) from public.audit_events where related_id=o)<>1 then
    raise exception 'Auto-code, attribution, revision or atomic audit failed';end if;
  definition:=saved||'{"name":"Updated objective","color":"#185FA5"}';
  saved:=public.save_objective_definition(tenant,o,1,definition);
  if saved->>'definition_revision'<>'2' or saved->>'color'<>'#185FA5' or saved->>'created_by'<>actor::text then
    raise exception 'Edit did not preserve identity and advance revision';end if;
  before_state:=pg_temp.objective_snapshot(o);
  begin
    perform public.save_objective_definition(tenant,o,1,definition||'{"name":"Stale"}');
    raise exception 'Accepted stale edit';
  exception when sqlstate 'PT409' then if sqlerrm<>'AURIS_OBJECTIVE_EDIT_CONFLICT' then raise;end if;end;
  if before_state is distinct from pg_temp.objective_snapshot(o) then raise exception 'Conflict altered state';end if;
  -- An audit failure occurs after the objective update and must undo both.
  perform set_config('test.objective_audit_failure','on',true);
  begin
    perform public.save_objective_definition(tenant,o,2,definition||'{"name":"Must roll back"}');
    raise exception 'Accepted audit failure';
  exception when raise_exception then if sqlerrm<>'Synthetic audit failure' then raise;end if;end;
  perform set_config('test.objective_audit_failure','off',true);
  if before_state is distinct from pg_temp.objective_snapshot(o) then raise exception 'Partial objective save';end if;
  for invalid in select value from jsonb_array_elements('[{"name":" "},{"name":"[Archived] bypass"},{"year":1899},{"year":10000},{"year":null},{"color":"red"},{"color":null}]') loop
    begin
      perform public.save_objective_definition(tenant,o,2,definition||invalid);
      raise exception 'Accepted invalid definition';
    exception when invalid_parameter_value then null;end;
  end loop;
  if before_state is distinct from pg_temp.objective_snapshot(o) then raise exception 'Validation altered state';end if;
  -- A legacy REST update cannot forge the revision or silently permit stale forms.
  update public.objectives set name='Legacy edit',definition_revision=1 where id=o;
  select definition_revision into rev from public.objectives where id=o;
  if rev<>3 then raise exception 'Legacy writer bypassed revision';end if;
  begin
    perform public.save_objective_definition(tenant,o,2,definition);
    raise exception 'Accepted stale legacy baseline';
  exception when sqlstate 'PT409' then null;end;
  insert into public.kpis_v2(company_id,objective_id,name,year,frequency,created_by)
    values(tenant,o,'Keep linked KPI',2026,'monthly',actor) returning id into k;
  select to_jsonb(t) into before_kpi from public.kpis_v2 t where id=k;
  before_state:=pg_temp.objective_snapshot(o);
  begin
    perform public.save_objective_definition(tenant,o,3,definition||'{"year":2027}');
    raise exception 'Moved objective away from linked KPI';
  exception when check_violation then if sqlerrm<>'AURIS_OBJECTIVE_YEAR_HAS_KPIS' then raise;end if;end;
  if before_state is distinct from pg_temp.objective_snapshot(o)
      or before_kpi is distinct from (select to_jsonb(t) from public.kpis_v2 t where id=k) then raise exception 'Year guard changed parent or child';end if;
  -- New objectives and unlinked objectives may use a different reporting year.
  saved:=public.save_objective_definition(tenant,null,null,definition||'{"code":"manual","year":2028}');
  saved:=public.save_objective_definition(tenant,(saved->>'id')::uuid,1,saved||'{"year":2029}');
  if saved->>'year'<>'2029' or saved->>'code'<>'manual' then raise exception 'Unlinked year/manual code failed';end if;
  update public.objectives set name='[Archived] Keep archived' where id=o;
  select definition_revision into rev from public.objectives where id=o;
  begin
    perform public.save_objective_definition(tenant,o,rev,definition);
    raise exception 'Revived archived objective';
  exception when insufficient_privilege then if sqlerrm<>'AURIS_OBJECTIVE_ARCHIVED' then raise;end if;end;
  -- Tenant, role and inactive-account denials, including actual execution grants.
  if has_function_privilege('anon','public.save_objective_definition(uuid,uuid,bigint,jsonb)','EXECUTE') then raise exception 'Anonymous execute granted';end if;
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  begin
    perform public.save_objective_definition(tenant,null,null,definition);
    raise exception 'Employee save allowed';
  exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  begin
    perform public.save_objective_definition(foreign_tenant,null,null,definition||jsonb_build_object('company_id',foreign_tenant));
    raise exception 'Foreign tenant save allowed';
  exception when insufficient_privilege then null;end;
  update public.profiles set status='inactive' where id=actor;
  begin
    perform public.save_objective_definition(tenant,null,null,definition);
    raise exception 'Inactive save allowed';
  exception when insufficient_privilege then null;end;
  update public.profiles set status='active' where id=actor;
  foreach permitted_role in array array['manager','admin','sephs_admin'] loop
    update public.profiles set role=permitted_role where id=actor;
    perform public.save_objective_definition(tenant,null,null,definition||jsonb_build_object('name',permitted_role));
  end loop;
  begin
    perform public.save_objective_definition(foreign_tenant,o,rev,definition||jsonb_build_object('company_id',foreign_tenant));
    raise exception 'Foreign objective ID accepted';
  exception when no_data_found then null;end;
  raise notice 'Objective behavior passed: conflict, audit rollback, legacy revision, year/history guard, fields and authorization.';
end;$$;
rollback;
