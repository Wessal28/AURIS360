-- AURIS360 targeted Supabase API exposure remediation
-- Evidence basis: live read-only audit on 14 August 2026.
-- This migration preserves authenticated application access and intentional
-- public storage reads while removing anonymous mutation and internal RPC use.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Anonymous users do not have an AURIS360 application workflow. RLS remains
-- the primary tenant boundary, while these revokes remove unnecessary mutation
-- capability before a policy is even evaluated.
do $block$
declare target regclass;
begin
  for target in
    select c.oid::regclass
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on table %s from anon',
      target
    );
  end loop;
end
$block$;

do $block$
declare target regclass;
begin
  for target in
    select c.oid::regclass
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='S'
  loop
    execute format('revoke all privileges on sequence %s from anon',target);
  end loop;
end
$block$;

-- Internal maintenance and notification functions are service-only. Each
-- function is optional so the migration remains safe across staged schemas.
do $block$
declare
  signature text;
  target regprocedure;
begin
  foreach signature in array array[
    'public.backfill_location_identity(text,text,text)',
    'public.backfill_person_identity(text,text,text)',
    'public.backfill_verified_reference(text,text,text,text,text)',
    'public.mark_notification_sent(uuid)',
    'public.queue_notification(uuid,text,text,text,text,text,uuid,text)',
    'public.resolve_location_identity(uuid,text,text)',
    'public.resolve_notification_recipient_profile(uuid,uuid,text,jsonb)',
    'public.resolve_unique_person_id(uuid,text,text)'
  ]
  loop
    target:=to_regprocedure(signature);
    if target is not null then
      execute format('alter function %s set search_path = pg_catalog, public, extensions',target);
      execute format('revoke all privileges on function %s from public, anon, authenticated',target);
      execute format('grant execute on function %s to service_role',target);
    end if;
  end loop;
end
$block$;

-- These caller-aware helpers are required by signed-in workflows. Remove
-- pre-authentication access and retain explicit authenticated/service access.
do $block$
declare
  signature text;
  target regprocedure;
begin
  foreach signature in array array[
    'public.auth_company_id()',
    'public.is_sephs_admin()',
    'public.current_user_company()',
    'public.current_user_role()',
    'public.refresh_person_identity_reconciliation(uuid)',
    'public.resolve_person_identity_review(uuid,uuid,text,text)'
  ]
  loop
    target:=to_regprocedure(signature);
    if target is not null then
      execute format('alter function %s set search_path = pg_catalog, public, extensions',target);
      execute format('revoke all privileges on function %s from public, anon',target);
      execute format('grant execute on function %s to authenticated, service_role',target);
    end if;
  end loop;
end
$block$;

-- Trigger functions never need direct browser execution. Revoking EXECUTE does
-- not stop already-created triggers from firing.
do $block$
declare target regprocedure;
begin
  for target in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef and p.prorettype='trigger'::regtype
  loop
    execute format('alter function %s set search_path = pg_catalog, public, extensions',target);
    execute format('revoke all privileges on function %s from public, anon, authenticated',target);
  end loop;
end
$block$;

-- Secure defaults for future public-schema objects. Authenticated and service
-- roles keep the Supabase application defaults; anonymous future mutation and
-- implicit function execution must be granted deliberately if ever required.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;

commit;

-- Verification: expected result is zero in every numeric column.
select
  count(*) filter (
    where c.relkind in ('r','p') and (
      has_table_privilege('anon',c.oid,'INSERT') or
      has_table_privilege('anon',c.oid,'UPDATE') or
      has_table_privilege('anon',c.oid,'DELETE')
    )
  ) as anon_mutation_tables,
  count(*) filter (
    where c.relkind='S' and exists (
      select 1
      from aclexplode(coalesce(c.relacl,acldefault('S',c.relowner))) x
      join pg_roles r on r.oid=x.grantee
      where r.rolname='anon'
        and x.privilege_type in ('USAGE','UPDATE')
    )
  ) as anon_sequences
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public';

select count(*) as exposed_security_definer_functions
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef
  and (
    has_function_privilege('anon',p.oid,'EXECUTE') or
    exists (
      select 1
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
      where x.grantee=0 and x.privilege_type='EXECUTE'
    )
  );
