-- Exclusively run on the disposable replay database; every fixture rolls back.
begin;
do $$begin if current_database()<>'auris360_migration_replay' then raise exception 'Disposable replay database required';end if;end;$$;
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function pg_temp.monthly_audit_failure() returns trigger language plpgsql as $$begin
  if current_setting('test.monthly_audit_failure',true)='on' then raise exception 'Synthetic monthly audit failure';end if;return new;
end;$$;
create trigger test_monthly_audit_failure before insert on public.audit_events for each row execute function pg_temp.monthly_audit_failure();
create function pg_temp.monthly_snapshot(k uuid) returns jsonb language sql as $$select jsonb_build_object(
 'kpi',(select to_jsonb(t) from public.kpis_v2 t where id=k),
 'monthly',(select jsonb_agg(to_jsonb(t) order by month) from public.kpi_monthly_data t where kpi_id=k),
 'audit',(select jsonb_agg(to_jsonb(t) order by id) from public.audit_events t where details->>'kpi_id'=k::text))$$;
do $$
declare
 tenant uuid:=gen_random_uuid(); foreign_tenant uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid();
 k uuid; i uuid; o uuid; rev bigint; r jsonb; r2 jsonb; baseline jsonb; item public.kpi_monthly_data%rowtype;
 method text; expected numeric; invalid jsonb; count_before integer;
begin
 insert into auth.users(id) values(actor),(viewer);
 insert into public.companies(id,name) values(tenant,'Monthly replay'),(foreign_tenant,'Other monthly replay');
 insert into public.profiles(id,company_id,role,status) values(actor,tenant,'admin','active'),(viewer,tenant,'employee','active');
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into public.objectives(company_id,name,year) values(tenant,'Monthly replay',2025) returning id into o;
 insert into public.kpis_v2(company_id,objective_id,name,year,frequency) values(tenant,o,'Monthly replay',2025,'monthly') returning id into k;
 insert into public.kpi_indicators(company_id,kpi_id,name,target_value,target_operator) values(tenant,k,'Count',4,'gte') returning id into i;
 select definition_revision into rev from public.kpis_v2 where id=k;
 r:=public.mutate_kpi_monthly_result(tenant,k,i,2025,1,rev,null,null,'save','{"actual":4,"explanation":"Checked","root":"Cause","evidence":"Record A"}');
 if r#>>'{result,actual}'<>'4' or (r#>>'{result,ytd}')::numeric<>4 or r#>>'{result,entered_by}'<>actor::text
   or r#>>'{result,comment}'<>E'Checked\nRoot cause: Cause\nEvidence: Record A' or (r#>>'{kpi,definition_revision}')::bigint<>rev then raise exception 'Creation, calculation, attribution or definition revision failed';end if;
 r2:=public.mutate_kpi_monthly_result(tenant,k,i,2025,2,rev,null,null,'save','{"actual":8}');
 if (r2#>>'{result,ytd}')::numeric<>12 then raise exception 'Next month did not include earlier values';end if;
 -- A known row retains its identity, original author and evidence while totals for later months change.
 r:=public.mutate_kpi_monthly_result(tenant,k,i,2025,1,rev,(r#>>'{result,id}')::uuid,(r#>>'{result,result_revision}')::integer,'save','{"actual":6,"explanation":"Revised","root":"Cause","evidence":"Record B"}');
 if (select ytd from public.kpi_monthly_data where indicator_id=i and month=2)<>14 then raise exception 'Later YTD not recalculated';end if;
 baseline:=pg_temp.monthly_snapshot(k);
 begin perform public.mutate_kpi_monthly_result(tenant,k,i,2025,2,rev,(r2#>>'{result,id}')::uuid,(r2#>>'{result,result_revision}')::integer,'clear','{}');raise exception 'Stale clear accepted';
 exception when sqlstate 'PT409' then if sqlerrm<>'AURIS_KPI_MONTHLY_CONFLICT' then raise;end if;end;
 begin perform public.mutate_kpi_monthly_result(tenant,k,i,2025,1,rev,null,null,'save','{"actual":10}');raise exception 'Concurrent create accepted';exception when sqlstate 'PT409' then null;end;
 if baseline is distinct from pg_temp.monthly_snapshot(k) then raise exception 'Conflict altered state';end if;
 -- Fail at the final audit, after writes and totals, to prove transaction rollback.
 perform set_config('test.monthly_audit_failure','on',true);
 begin perform public.mutate_kpi_monthly_result(tenant,k,i,2025,1,rev,(r#>>'{result,id}')::uuid,(r#>>'{result,result_revision}')::integer,'clear','{}');raise exception 'Audit failure accepted';
 exception when raise_exception then if sqlerrm<>'Synthetic monthly audit failure' then raise;end if;end;
 perform set_config('test.monthly_audit_failure','off',true);
 if baseline is distinct from pg_temp.monthly_snapshot(k) then raise exception 'Clear partly committed on audit failure';end if;
 perform set_config('test.monthly_audit_failure','on',true);
 begin perform public.mutate_kpi_monthly_result(tenant,k,i,2025,3,rev,null,null,'save','{"actual":10}');raise exception 'Audit failure accepted';
 exception when raise_exception then if sqlerrm<>'Synthetic monthly audit failure' then raise;end if;end;
 perform set_config('test.monthly_audit_failure','off',true);
 if baseline is distinct from pg_temp.monthly_snapshot(k) then raise exception 'Save partly committed on audit failure';end if;
 -- Existing legacy REST writers also advance the server-owned result revision.
 update public.kpi_monthly_data set actual=7,result_revision=1 where id=(r#>>'{result,id}')::uuid returning * into item;
 if item.result_revision<=(r#>>'{result,result_revision}')::integer then raise exception 'Legacy update bypassed revision';end if;
 begin perform public.mutate_kpi_monthly_result(tenant,k,i,2025,1,rev,item.id,(r#>>'{result,result_revision}')::integer,'save','{"actual":10}');raise exception 'Stale legacy save accepted';exception when sqlstate 'PT409' then null;end;
 -- Clear removes only the chosen row, recalculates the next month and audits it.
 r:=public.mutate_kpi_monthly_result(tenant,k,i,2025,1,rev,item.id,item.result_revision,'clear','{}');
 if r->'result'<>'null' or (select ytd from public.kpi_monthly_data where indicator_id=i and month=2)<>8
   or exists(select 1 from public.kpi_monthly_data where indicator_id=i and month=1) then raise exception 'Clear did not recalculate remaining history';end if;
 -- Same month may be created afresh; its new identity must reject the earlier clear context.
 r:=public.mutate_kpi_monthly_result(tenant,k,i,2025,1,rev,null,null,'save','{"actual":4}');
 begin perform public.mutate_kpi_monthly_result(tenant,k,i,2025,1,rev,item.id,item.result_revision,'clear','{}');raise exception 'Deleted row context removed replacement';exception when sqlstate 'PT409' then null;end;
 for method,expected in select * from (values('sum',12::numeric),('average',6),('last',8),('min',4),('max',8)) q(m,v) loop
   update public.kpi_indicators set ytd_method=method where id=i;
   select definition_revision into rev from public.kpis_v2 where id=k;
   select * into item from public.kpi_monthly_data where indicator_id=i and month=2;
   r2:=public.mutate_kpi_monthly_result(tenant,k,i,2025,2,rev,item.id,item.result_revision,'save','{"actual":8}');
   if (r2#>>'{result,ytd}')::numeric<>expected then raise exception 'Wrong % total',method;end if;
 end loop;
 -- Definition changes conflict before saving. A locked definition may still receive results and derived status.
 begin perform public.mutate_kpi_monthly_result(tenant,k,i,2025,3,rev-1,null,null,'save','{"actual":4}');raise exception 'Stale definition accepted';exception when sqlstate 'PT409' then null;end;
 update public.kpis_v2 set approval_status='locked' where id=k;
 select definition_revision into rev from public.kpis_v2 where id=k;
 r:=public.mutate_kpi_monthly_result(tenant,k,i,2025,12,rev,null,null,'save','{"actual":4}');
 if r#>>'{kpi,status}'<>'on_track' or r#>>'{kpi,approval_status}'<>'locked' or (r#>>'{kpi,definition_revision}')::bigint<>rev then raise exception 'Locked monthly reporting changed the definition or failed status update';end if;
 begin update public.kpis_v2 set name='Bypass controlled definition' where id=k;raise exception 'Definition guard lost';exception when insufficient_privilege then null;end;
 -- Authorization is checked before any tenant data is read by the definer.
 baseline:=pg_temp.monthly_snapshot(k);
 perform set_config('request.jwt.claim.sub',viewer::text,true);
 begin perform public.mutate_kpi_monthly_result(tenant,k,i,2025,3,rev,null,null,'save','{"actual":4}');raise exception 'Employee accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin perform public.mutate_kpi_monthly_result(foreign_tenant,k,i,2025,3,rev,null,null,'save','{"actual":4}');raise exception 'Cross-tenant accepted';exception when insufficient_privilege then null;end;
 update public.profiles set status='inactive' where id=actor;
 begin perform public.mutate_kpi_monthly_result(tenant,k,i,2025,3,rev,null,null,'save','{"actual":4}');raise exception 'Inactive actor accepted';exception when insufficient_privilege then null;end;
 update public.profiles set status='active' where id=actor;
 if baseline is distinct from pg_temp.monthly_snapshot(k) then raise exception 'Denied writer altered data';end if;
 for invalid in select value from jsonb_array_elements('[{}, {"actual":null},{"actual":"NaN"},{"actual":"Infinity"},{"actual":4,"root":null}]') loop
   begin perform public.mutate_kpi_monthly_result(tenant,k,i,2025,3,rev,null,null,'save',invalid);raise exception 'Invalid input accepted';exception when invalid_parameter_value then null;end;
 end loop;
 begin perform public.mutate_kpi_monthly_result(tenant,k,i,2025,3,rev,null,null,'save','{"actual":0}');raise exception 'Unexplained adverse result accepted';exception when invalid_parameter_value then if sqlerrm<>'AURIS_KPI_EXPLANATION_REQUIRED' then raise;end if;end;
 r:=public.mutate_kpi_monthly_result(tenant,k,i,2025,3,rev,null,null,'save','{"actual":0,"explanation":"Zero measured","root":"Cause"}');
 if r#>>'{result,actual}'<>'0' then raise exception 'Zero was not preserved';end if;
 -- A separate annual KPI verifies cross-month uniqueness and durable late-entry audit.
 insert into public.kpis_v2(company_id,objective_id,name,year,frequency,planned_months) values(tenant,o,'Annual',2025,'annual',array[6]) returning id into k;
 insert into public.kpi_indicators(company_id,kpi_id,name,target_value,target_operator) values(tenant,k,'Annual count',1,'gte') returning id into i;
 select definition_revision into rev from public.kpis_v2 where id=k;
 begin perform public.mutate_kpi_monthly_result(tenant,k,i,2025,2,rev,null,null,'save','{"actual":1}');raise exception 'Unplanned month accepted';exception when invalid_parameter_value then null;end;
 r:=public.mutate_kpi_monthly_result(tenant,k,i,2025,6,rev,null,null,'save','{"actual":1}');
 if not exists(select 1 from public.audit_events where related_id=(r#>>'{result,id}')::uuid and event_code='kpi.monthly_late_entry' and details->>'reporting_month'='6') then raise exception 'Late annual audit missing';end if;
 update public.kpis_v2 set planned_months='{}' where id=k;
 select definition_revision into rev from public.kpis_v2 where id=k;
 begin perform public.mutate_kpi_monthly_result(tenant,k,i,2025,7,rev,null,null,'save','{"actual":1}');raise exception 'Second annual month accepted';exception when sqlstate 'PT409' then null;end;
 update public.kpi_indicators set source_mode='module' where id=i;
 select definition_revision into rev from public.kpis_v2 where id=k;
 begin perform public.mutate_kpi_monthly_result(tenant,k,i,2025,6,rev,(r#>>'{result,id}')::uuid,(r#>>'{result,result_revision}')::integer,'clear','{}');raise exception 'Automatic source cleared through manual path';exception when insufficient_privilege then null;end;
 raise notice 'Monthly transactions passed: revision conflicts, save/clear audit rollback, totals, locked definitions, tenant roles, annual periods and source separation';
end;$$;
rollback;
