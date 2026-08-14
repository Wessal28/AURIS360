-- AURIS360 remaining Supabase exposure review
-- READ ONLY: inventories non-privileged RPCs, anonymous reads and defaults
-- after the targeted privileged-function and mutation-grant remediation.

begin;
set transaction read only;

with public_functions as (
  select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
         l.lanname as language,p.provolatile,
         has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
         exists (
           select 1
           from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
           where x.grantee=0 and x.privilege_type='EXECUTE'
         ) as public_execute
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  join pg_language l on l.oid=p.prolang
  where n.nspname='public' and p.prokind='f' and not p.prosecdef
), anon_read_tables as (
  select c.oid,c.relname,c.relrowsecurity,
         count(pol.policyname)::int as policies,
         count(pol.policyname) filter (
           where pol.roles&&array['anon','public']::name[]
             and pol.cmd in ('SELECT','ALL')
         )::int as anon_policies
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  left join pg_policies pol on pol.schemaname=n.nspname and pol.tablename=c.relname
  where n.nspname='public' and c.relkind in ('r','p')
    and has_table_privilege('anon',c.oid,'SELECT')
  group by c.oid,c.relname,c.relrowsecurity
), weak_anon_policies as (
  select schemaname,tablename,policyname,cmd,
         coalesce(qual,'') as using_expression,
         coalesce(with_check,'') as check_expression
  from pg_policies
  where schemaname in ('public','storage')
    and roles&&array['anon','public']::name[]
    and lower(coalesce(qual,'')||' '||coalesce(with_check,'')) !~
        '(auth\\.uid|auth\\.role|company_id|tenant|current_user|bucket_id)'
), default_grants as (
  select owner.rolname as owner_role,coalesce(n.nspname,'all schemas') as schema_name,
         case d.defaclobjtype when 'r' then 'table' when 'S' then 'sequence'
              when 'f' then 'function' else d.defaclobjtype::text end as object_type,
         coalesce(grantee.rolname,'PUBLIC') as grantee,
         string_agg(distinct x.privilege_type,',' order by x.privilege_type) as privileges
  from pg_default_acl d
  join pg_roles owner on owner.oid=d.defaclrole
  left join pg_namespace n on n.oid=d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) x
  left join pg_roles grantee on grantee.oid=x.grantee
  where coalesce(grantee.rolname,'PUBLIC') in ('anon','PUBLIC')
  group by owner.rolname,n.nspname,d.defaclobjtype,grantee.rolname
), findings as (
  select 10 as sort_order,'RPC'::text as review_area,
         proname||'('||arguments||')' as object_name,
         concat_ws('; ',
           'language='||language,
           'volatility='||case provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end,
           'anon='||anon_execute,
           'PUBLIC='||public_execute
         ) as detail
  from public_functions
  where anon_execute or public_execute

  union all
  select 20,'Anonymous read',relname,
         'RLS='||relrowsecurity||'; policies='||policies||'; anon policies='||anon_policies
  from anon_read_tables
  where not relrowsecurity or anon_policies=0

  union all
  select 30,'Policy expression',schemaname||'.'||tablename||' / '||policyname,
         'command='||cmd||'; using='||using_expression||'; check='||check_expression
  from weak_anon_policies

  union all
  select 40,'Default grant',owner_role||' / '||schema_name||' '||object_type,
         'grantee='||grantee||'; privileges='||privileges
  from default_grants
)
select review_area,object_name,detail
from findings
order by sort_order,object_name;

rollback;
