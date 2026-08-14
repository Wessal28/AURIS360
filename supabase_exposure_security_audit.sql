-- AURIS360 Supabase exposure security audit
-- READ ONLY: this script does not create, alter, grant, revoke or change data.
-- Run in the Supabase SQL Editor. Review every CRITICAL and REVIEW row before
-- applying a targeted corrective migration. An all-clear run returns one PASS row.

begin;
set transaction read only;

with public_schema_access as (
  select has_schema_privilege('anon',n.oid,'CREATE') as anon_create,
         has_schema_privilege('authenticated',n.oid,'CREATE') as auth_create,
         exists (
           select 1 from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x
           where x.grantee=0 and x.privilege_type='CREATE'
         ) as public_create
  from pg_namespace n where n.nspname='public'
), public_relations as (
  select c.oid,n.nspname as schema_name,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
         coalesce((select option_value::boolean from pg_options_to_table(c.reloptions) where option_name='security_invoker'),false) as security_invoker,
         has_table_privilege('anon',c.oid,'SELECT') as anon_select,
         has_table_privilege('anon',c.oid,'INSERT') as anon_insert,
         has_table_privilege('anon',c.oid,'UPDATE') as anon_update,
         has_table_privilege('anon',c.oid,'DELETE') as anon_delete,
         has_table_privilege('anon',c.oid,'MAINTAIN') as anon_maintain,
         has_table_privilege('authenticated',c.oid,'SELECT') as auth_select,
         has_table_privilege('authenticated',c.oid,'INSERT') as auth_insert,
         has_table_privilege('authenticated',c.oid,'UPDATE') as auth_update,
         has_table_privilege('authenticated',c.oid,'DELETE') as auth_delete
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p','v','m','f')
), policy_counts as (
  select schemaname,tablename,count(*)::int as policies,
         count(*) filter (where roles&&array['anon','public']::name[])::int as anon_policies,
         count(*) filter (where roles&&array['authenticated','public']::name[])::int as auth_policies
  from pg_policies where schemaname='public' group by schemaname,tablename
), public_functions as (
  select p.oid,n.nspname as schema_name,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
         p.prosecdef as security_definer,
         coalesce(array_to_string(p.proconfig,','),'') as function_config,
         has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
         has_function_privilege('authenticated',p.oid,'EXECUTE') as auth_execute,
         exists (
           select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
           where x.grantee=0 and x.privilege_type='EXECUTE'
         ) as public_execute
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
), column_grants as (
  select table_schema,table_name,grantee,string_agg(distinct privilege_type,',' order by privilege_type) as privileges,
         count(distinct column_name)::int as columns
  from information_schema.column_privileges
  where table_schema='public' and grantee in ('anon','authenticated','PUBLIC')
  group by table_schema,table_name,grantee
), default_grants as (
  select coalesce(n.nspname,'all schemas') as schema_name,
         case d.defaclobjtype when 'r' then 'table' when 'S' then 'sequence' when 'f' then 'function' when 'T' then 'type' when 'n' then 'schema' else d.defaclobjtype::text end as object_type,
         coalesce(grantee.rolname,'PUBLIC') as grantee,
         string_agg(distinct x.privilege_type,',' order by x.privilege_type) as privileges
  from pg_default_acl d
  left join pg_namespace n on n.oid=d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) x
  left join pg_roles grantee on grantee.oid=x.grantee
  where coalesce(grantee.rolname,'PUBLIC') in ('anon','authenticated','PUBLIC')
  group by n.nspname,d.defaclobjtype,grantee.rolname
), findings as (
  select 10 as sort_order,'CRITICAL'::text as severity,'Schema'::text as category,'public'::text as object_name,
         'The anon/authenticated/PUBLIC role can CREATE objects in the public schema.'::text as finding,
         'Revoke CREATE on schema public from the affected role; retain USAGE only where required.'::text as recommendation
  from public_schema_access
  where anon_create or auth_create or public_create

  union all
  select 20,'CRITICAL','Table RLS',schema_name||'.'||relname,
         'RLS is disabled while anon or authenticated has table privileges.',
         'Enable RLS and add explicit least-privilege policies before keeping the grant.'
  from public_relations
  where relkind in ('r','p') and not relrowsecurity
    and (anon_select or anon_insert or anon_update or anon_delete or auth_select or auth_insert or auth_update or auth_delete)

  union all
  select 30,'REVIEW','Table policy',r.schema_name||'.'||r.relname,
         'RLS is enabled and authenticated has privileges, but no policy is defined.',
         'Confirm deny-by-default is intentional or add a tenant/user policy for the required operation.'
  from public_relations r left join policy_counts p on p.schemaname=r.schema_name and p.tablename=r.relname
  where r.relkind in ('r','p') and r.relrowsecurity and coalesce(p.policies,0)=0
    and (r.auth_select or r.auth_insert or r.auth_update or r.auth_delete)

  union all
  select 40,'CRITICAL','Anonymous mutation',schema_name||'.'||relname,
         'The anon role has INSERT, UPDATE or DELETE table privilege.',
         'Revoke anonymous mutation grants unless a documented public workflow and restrictive RLS policy require them.'
  from public_relations where relkind in ('r','p') and (anon_insert or anon_update or anon_delete)

  union all
  select 45,'CRITICAL','Anonymous maintenance',schema_name||'.'||relname,
         'The anon role has MAINTAIN table privilege.',
         'Revoke MAINTAIN from anonymous API roles; database maintenance belongs to controlled operator roles.'
  from public_relations where relkind in ('r','p') and anon_maintain

  union all
  select 50,'CRITICAL','View exposure',schema_name||'.'||relname,
         'A view is accessible to anon/authenticated without security_invoker=true and may bypass underlying RLS.',
         'Recreate the view with security_invoker=true or revoke API access and expose a governed RPC.'
  from public_relations where relkind in ('v','m') and not security_invoker and (anon_select or auth_select)

  union all
  select 60,'CRITICAL','Security definer RPC',schema_name||'.'||proname||'('||arguments||')',
         'A SECURITY DEFINER function is executable by anon or PUBLIC.',
         'Revoke EXECUTE from anon/PUBLIC and grant only to the intended role after verifying in-function authorization.'
  from public_functions where security_definer and (anon_execute or public_execute)

  union all
  select 70,'CRITICAL','Security definer search path',schema_name||'.'||proname||'('||arguments||')',
         'A SECURITY DEFINER function has no fixed search_path.',
         'Set a safe search_path (normally public plus required extensions) and schema-qualify referenced objects.'
  from public_functions where security_definer and function_config not ilike '%search_path=%'

  union all
  select 80,'REVIEW','RPC exposure',schema_name||'.'||proname||'('||arguments||')',
         'A public-schema function is executable by anon or PUBLIC.',
         'Confirm public execution is required; otherwise revoke it and grant EXECUTE only to authenticated or service roles.'
  from public_functions where not security_definer and (anon_execute or public_execute)

  union all
  select 90,case when grantee in ('anon','PUBLIC') then 'CRITICAL' else 'REVIEW' end,'Default privileges',schema_name||' '||object_type,
         'Default privileges grant '||privileges||' to '||grantee||' for future objects.',
         'Replace broad default privileges with explicit least-privilege grants so new objects are not exposed automatically.'
  from default_grants

  union all
  select 100,case when grantee in ('anon','PUBLIC') then 'CRITICAL' else 'REVIEW' end,'Column privileges',table_schema||'.'||table_name,
         grantee||' has direct column grants ('||privileges||') across '||columns||' column(s).',
         'Confirm these column grants are intentional and still protected by the expected RLS policy.'
  from column_grants

  union all
  select 110,'CRITICAL','Storage policy','storage.objects',
         'Storage objects does not have RLS enabled.',
         'Enable RLS on storage.objects and use bucket/company/user policies for every operation.'
  where exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='storage' and c.relname='objects' and c.relkind in ('r','p') and not c.relrowsecurity
  )
), final_rows as (
  select sort_order,severity,category,object_name,finding,recommendation from findings
  union all
  select 999,'PASS','Summary','public API exposure','No catalog-level exposure findings were detected by this audit.',
         'Retain evidence, review Supabase Security Advisor and repeat after every schema migration.'
  where not exists (select 1 from findings)
)
select severity,category,object_name,finding,recommendation
from final_rows
order by sort_order,object_name;

rollback;
