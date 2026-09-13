-- Executed only by the guarded disposable PostgreSQL replay; everything rolls back.
begin;
do $$begin
  if current_database()<>'auris360_migration_replay' then raise exception 'Disposable replay database required';end if;
end;$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create function pg_temp.kpi_snapshot(k uuid) returns jsonb language sql as $$
  select jsonb_build_object('parent',(select to_jsonb(p) from public.kpis_v2 p where id=k),
    'indicators',(select jsonb_agg(to_jsonb(i) order by id) from public.kpi_indicators i where kpi_id=k),
    'monthly',(select jsonb_agg(to_jsonb(m) order by m.id) from public.kpi_monthly_data m join public.kpi_indicators i on i.id=m.indicator_id where i.kpi_id=k),
    'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a where related_id=k))
$$;
create function pg_temp.kpi_baseline(k uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(to_jsonb(i)-'created_at' order by id),'[]') from public.kpi_indicators i where kpi_id=k
$$;

do $$
declare
  tenant uuid:=gen_random_uuid(); foreign_tenant uuid:=gen_random_uuid();
  actor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); obj uuid:=gen_random_uuid(); foreign_obj uuid:=gen_random_uuid();
  k uuid; ind uuid; rev bigint; baseline jsonb; definition jsonb; desired jsonb; result jsonb;
  before_state jsonb; before_actual jsonb; after_actual jsonb; invalid jsonb;
  method text; expected numeric; attempted boolean; prior_revision bigint;
begin
  insert into auth.users(id) values(actor),(viewer);
  insert into public.companies(id,name) values(tenant,'Atomic KPI replay'),(foreign_tenant,'Other tenant replay');
  insert into public.profiles(id,company_id,role,status) values(actor,tenant,'admin','active'),(viewer,tenant,'employee','active');
  insert into public.objectives(id,company_id,name,year) values(obj,tenant,'Replay objective',2026),(foreign_obj,foreign_tenant,'Foreign objective',2026);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  definition:=jsonb_build_object('company_id',tenant,'objective_id',obj,'name','Atomic KPI','code','1.1','year',2026,'frequency','monthly','planned_months','[]'::jsonb,
    'created_by',viewer,'approval_status','locked','status','archived');
  desired:='[{"name":"Original measure","target_value":4,"target_operator":"gte","ytd_method":"sum","unit":null}]';
  result:=public.save_kpi_definition(tenant,null,null,'[]',definition,desired);
  k:=(result->'kpi'->>'id')::uuid; ind:=(result->'indicators'->0->>'id')::uuid;
  if result->'kpi'->>'created_by'<>actor::text or result->'kpi'->>'approval_status'<>'draft'
      or result->'kpi'->>'status'<>'not_started' then raise exception 'Client smuggled creator/workflow state';end if;
  if jsonb_array_length(result->'indicators')<>1 or (select count(*) from public.audit_events where related_id=k)<>1 then raise exception 'Create was incomplete';end if;
  insert into public.kpi_monthly_data(company_id,kpi_id,indicator_id,year,month,actual,ytd,comment,entered_by)
    values(tenant,k,ind,2026,1,2,2,'Keep evidence and authorship',actor),
      (tenant,k,ind,2026,8,4,6,'August evidence',actor),(tenant,k,ind,2025,12,9,9,'Previous year',actor);
  select jsonb_agg(to_jsonb(m)-'ytd' order by id) into before_actual from public.kpi_monthly_data m where indicator_id=ind;
  baseline:=pg_temp.kpi_baseline(k);select definition_revision,to_jsonb(p) into rev,definition from public.kpis_v2 p where id=k;
  desired:=jsonb_build_array((baseline->0)||'{"name":"Renamed measure","ytd_method":"average"}');
  result:=public.save_kpi_definition(tenant,k,rev,baseline,definition||'{"name":"Changed KPI"}',desired);
  if result->'indicators'->0->>'id'<>ind::text or result->'indicators'->0->>'name'<>'Renamed measure'
    or (select ytd from public.kpi_monthly_data where indicator_id=ind and year=2026 and month=8)<>3 then raise exception 'Rename/YTD failed';end if;
  select jsonb_agg(to_jsonb(m)-'ytd' order by id) into after_actual from public.kpi_monthly_data m where indicator_id=ind;
  if before_actual is distinct from after_actual then raise exception 'Definition save altered actual/history/authorship';end if;
  before_state:=pg_temp.kpi_snapshot(k);
  begin
    perform public.save_kpi_definition(tenant,k,rev,baseline,definition,desired);
    raise exception 'Stale revision accepted';
  exception when sqlstate 'PT409' then if sqlerrm<>'AURIS_KPI_EDIT_CONFLICT' then raise;end if;end;
  if before_state is distinct from pg_temp.kpi_snapshot(k) then raise exception 'Conflict changed records';end if;

  baseline:=pg_temp.kpi_baseline(k);select definition_revision,to_jsonb(p) into rev,definition from public.kpis_v2 p where id=k;
  -- Bad second indicator fails after parent and first indicator writes. Both must roll back.
  invalid:=desired||'[{"name":"Invalid last row","target_value":1,"target_operator":"invalid","ytd_method":"sum"}]';
  begin
    perform public.save_kpi_definition(tenant,k,rev,baseline,definition||'{"name":"Must roll back"}',invalid);
    raise exception 'Invalid last row accepted';
  exception when check_violation then null;end;
  if before_state is distinct from pg_temp.kpi_snapshot(k) then raise exception 'Failed multi-row save left partial changes';end if;
  begin
    perform public.save_kpi_definition(tenant,k,rev,baseline,definition,'[{"name":"Replacement","target_value":1,"target_operator":"gte","ytd_method":"sum"}]');
    raise exception 'Historical indicator deletion accepted';
  exception when foreign_key_violation then if sqlerrm<>'AURIS_KPI_INDICATOR_HAS_HISTORY' then raise;end if;end;
  begin
    perform public.save_kpi_definition(tenant,k,rev,baseline,definition,desired||desired);
    raise exception 'Duplicate indicator accepted';
  exception when foreign_key_violation then if sqlerrm<>'AURIS_KPI_INDICATOR_MISMATCH' then raise;end if;end;
  begin
    perform public.save_kpi_definition(tenant,k,rev,baseline,definition||jsonb_build_object('objective_id',foreign_obj),desired);
    raise exception 'Foreign objective accepted';
  exception when foreign_key_violation then if sqlerrm<>'AURIS_KPI_OBJECTIVE_REQUIRED' then raise;end if;end;
  begin
    perform public.save_kpi_definition(foreign_tenant,k,rev,baseline,definition,desired);
    raise exception 'Foreign company accepted';
  exception when insufficient_privilege then if sqlerrm<>'AURIS_KPI_SAVE_DENIED' then raise;end if;end;
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  begin
    perform public.save_kpi_definition(tenant,k,rev,baseline,definition,desired);
    raise exception 'Employee definition write accepted';
  exception when insufficient_privilege then if sqlerrm<>'AURIS_KPI_SAVE_DENIED' then raise;end if;end;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.save_kpi_definition(tenant,k,rev,baseline,definition,desired);
    raise exception 'Anonymous definition write accepted';
  exception when insufficient_privilege then if sqlerrm<>'AURIS_KPI_SAVE_DENIED' then raise;end if;end;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  update public.profiles set status='inactive' where id=actor;
  begin
    perform public.save_kpi_definition(tenant,k,rev,baseline,definition,desired);
    raise exception 'Inactive administrator accepted';
  exception when insufficient_privilege then if sqlerrm<>'AURIS_KPI_SAVE_DENIED' then raise;end if;end;
  update public.profiles set status='active' where id=actor;
  if before_state is distinct from pg_temp.kpi_snapshot(k) then raise exception 'Rejected save changed records';end if;

  -- The revision catches old REST writers; the child baseline also catches mixed cache reads.
  update public.kpi_indicators set name='Legacy writer' where id=ind;
  select definition_revision into prior_revision from public.kpis_v2 where id=k;
  if prior_revision<=rev then raise exception 'Legacy child did not advance revision';end if;
  begin
    perform public.save_kpi_definition(tenant,k,prior_revision,baseline,definition,desired);
    raise exception 'Mixed parent/child baseline accepted';
  exception when sqlstate 'PT409' then if sqlerrm<>'AURIS_KPI_EDIT_CONFLICT' then raise;end if;end;

  foreach method in array array['sum','average','last','max','min'] loop
    baseline:=pg_temp.kpi_baseline(k);select definition_revision,to_jsonb(p) into rev,definition from public.kpis_v2 p where id=k;
    result:=public.save_kpi_definition(tenant,k,rev,baseline,definition,jsonb_build_array((baseline->0)||jsonb_build_object('ytd_method',method)));
    expected:=case method when 'sum' then 6 when 'average' then 3 when 'last' then 4 when 'max' then 4 when 'min' then 2 end;
    if (select ytd from public.kpi_monthly_data where indicator_id=ind and year=2026 and month=8)<>expected then raise exception 'YTD method % failed',method;end if;
    if (select ytd from public.kpi_monthly_data where indicator_id=ind and year=2025)<>9 then raise exception 'Historical year changed';end if;
  end loop;
  update public.kpi_monthly_data set actual=-1.005 where indicator_id=ind and year=2025;
  baseline:=pg_temp.kpi_baseline(k);select definition_revision,to_jsonb(p) into rev,definition from public.kpis_v2 p where id=k;
  result:=public.save_kpi_definition(tenant,k,rev,baseline,definition,jsonb_build_array((baseline->0)||'{"ytd_method":"sum"}'));
  if (select ytd from public.kpi_monthly_data where indicator_id=ind and year=2025)<>-1 then raise exception 'Negative YTD rounding failed';end if;
  update public.kpis_v2 set approval_status='approved' where id=k;
  baseline:=pg_temp.kpi_baseline(k);select definition_revision,to_jsonb(p) into rev,definition from public.kpis_v2 p where id=k;
  begin
    perform public.save_kpi_definition(tenant,k,rev,baseline,definition,desired);
    raise exception 'Approved definition accepted';
  exception when insufficient_privilege then if sqlerrm<>'AURIS_KPI_DEFINITION_FROZEN' then raise;end if;end;
  -- Existing approved/locked monthly reporting must remain available.
  update public.kpi_monthly_data set comment='Approved monthly update' where indicator_id=ind and year=2026 and month=8;
  update public.kpis_v2 set approval_status='locked' where id=k;
  update public.kpi_monthly_data set comment='Locked monthly update' where indicator_id=ind and year=2026 and month=8;
  if has_function_privilege('anon','public.save_kpi_definition(uuid,uuid,bigint,jsonb,jsonb,jsonb)','execute')
      or not has_function_privilege('authenticated','public.save_kpi_definition(uuid,uuid,bigint,jsonb,jsonb,jsonb)','execute') then raise exception 'Incorrect RPC grants';end if;
  raise notice 'Atomic KPI SQL behavior passed: create, rollback, conflicts, identity, history, authorization, five YTD methods and locked reporting';
end;$$;
rollback;
