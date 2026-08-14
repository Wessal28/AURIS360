-- AURIS360 targeted remaining Supabase exposure remediation
-- Removes unnecessary anonymous RPC, maintenance and deny-by-RLS read grants
-- while retaining every authenticated application workflow.

begin;

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature,
           p.prorettype='trigger'::regtype as trigger_only
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.proname in (
      'enforce_user_notification_state','generate_tool_ref','kpi_publish_config',
      'moc_touch_updated_at','my_company_id','normalise_location_identity_text',
      'normalise_operational_reference','normalise_person_identity_text',
      'notification_best_email','notification_deliverable_email',
      'notification_html_escape','refresh_learning_source_impacts',
      'set_security_sla_updated_at','set_updated_at','touch_updated_at'
    )
  loop
    execute format(
      'revoke all privileges on function %s from public, anon, authenticated',
      fn.signature
    );
    if fn.trigger_only then
      execute format('grant execute on function %s to service_role',fn.signature);
    else
      execute format('grant execute on function %s to authenticated, service_role',fn.signature);
    end if;
  end loop;
end $$;

-- Anonymous SELECT without an applicable SELECT/ALL policy is already denied by
-- RLS. Remove the redundant grant so a future policy cannot expose a table by
-- accident without an explicit grant decision.
do $$
declare
  rel record;
begin
  for rel in
    select c.oid::regclass as relation_name
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
      and has_table_privilege('anon',c.oid,'SELECT')
      and not exists (
        select 1
        from pg_policies pol
        where pol.schemaname='public' and pol.tablename=c.relname
          and pol.roles&&array['anon','public']::name[]
          and pol.cmd in ('SELECT','ALL')
      )
  loop
    execute format('revoke select on table %s from anon',rel.relation_name);
  end loop;
end $$;

-- The browser API role never needs database maintenance privileges.
do $$
declare
  rel record;
begin
  for rel in
    select c.oid::regclass as relation_name
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
      and has_table_privilege('anon',c.oid,'MAINTAIN')
  loop
    execute format('revoke maintain on table %s from anon',rel.relation_name);
  end loop;
end $$;

-- Supabase's platform-owned schemas and supabase_admin defaults are managed by
-- the platform and cannot be changed by the project SQL role. Only project-owned
-- postgres defaults are narrowed here; current objects are secured above.
alter default privileges for role postgres in schema public
  revoke maintain on tables from anon;

commit;

-- Verification: all five counts must be zero. The final booleans must be true.
select
  (select count(*)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prokind='f' and not p.prosecdef
     and (has_function_privilege('anon',p.oid,'EXECUTE') or exists (
       select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
       where x.grantee=0 and x.privilege_type='EXECUTE'
     ))) as exposed_non_privileged_rpcs,
  (select count(*)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p')
     and has_table_privilege('anon',c.oid,'SELECT') and not exists (
       select 1 from pg_policies pol
       where pol.schemaname='public' and pol.tablename=c.relname
         and pol.roles&&array['anon','public']::name[]
         and pol.cmd in ('SELECT','ALL')
     )) as anon_reads_without_policy,
  (select count(*)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p')
     and has_table_privilege('anon',c.oid,'MAINTAIN')) as anon_maintenance_tables,
  (select count(*)
   from pg_default_acl d join pg_roles owner on owner.oid=d.defaclrole
   join pg_namespace n on n.oid=d.defaclnamespace
   cross join lateral aclexplode(d.defaclacl) x
   left join pg_roles grantee on grantee.oid=x.grantee
   where owner.rolname='postgres' and n.nspname='public'
     and coalesce(grantee.rolname,'PUBLIC') in ('anon','PUBLIC')
     and not (d.defaclobjtype='r' and x.privilege_type='SELECT')) as risky_public_defaults,
  has_function_privilege('authenticated','public.kpi_publish_config(uuid,text,date)','EXECUTE') as kpi_publish_ready,
  has_function_privilege('authenticated','public.refresh_learning_source_impacts(uuid)','EXECUTE') as learning_refresh_ready;
