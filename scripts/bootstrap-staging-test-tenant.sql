-- AURIS360 staging-only tenant bootstrap.
--
-- Prerequisite: create and auto-confirm one dedicated test user in the staging
-- Supabase project. Replace the email below only in the SQL Editor copy.
-- This script never creates or modifies auth.users and refuses to run against
-- a database that looks populated.

begin;

do $bootstrap$
declare
  v_admin_email constant text := 'REPLACE_WITH_STAGING_TEST_EMAIL';
  v_company_name constant text := 'AURIS360 Staging Test';
  v_user_id uuid;
  v_company_id uuid;
  v_auth_user_count bigint;
  v_company_count bigint;
  v_updated_count integer;
begin
  if v_admin_email = 'REPLACE_WITH_STAGING_TEST_EMAIL'
     or v_admin_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Replace REPLACE_WITH_STAGING_TEST_EMAIL with the dedicated staging user email.';
  end if;

  select count(*) into v_auth_user_count from auth.users;
  select count(*) into v_company_count from public.companies;

  if v_auth_user_count < 1 then
    raise exception 'Create and auto-confirm the staging test user before running this bootstrap.';
  end if;

  if v_auth_user_count > 5 then
    raise exception 'Safety stop: % Auth users make this database look populated.', v_auth_user_count;
  end if;

  if v_company_count > 1
     or exists (
       select 1 from public.companies
       where name is distinct from v_company_name
     ) then
    raise exception 'Safety stop: this database contains a non-staging company.';
  end if;

  select id
  into v_user_id
  from auth.users
  where lower(email) = lower(v_admin_email)
  limit 1;

  if v_user_id is null then
    raise exception 'No Auth user exists for the supplied staging email.';
  end if;

  select id
  into v_company_id
  from public.companies
  where name = v_company_name
  order by created_at
  limit 1;

  if v_company_id is null then
    insert into public.companies (name, industry, active)
    values (v_company_name, 'Software verification', true)
    returning id into v_company_id;
  end if;

  -- A schema-only staging copy contains no Auth users and may not include the
  -- production auth.users trigger. Create only the application profile that
  -- corresponds to the already-created staging Auth identity.
  if not exists (select 1 from public.profiles where id = v_user_id) then
    insert into public.profiles (id, email, full_name, role, company_id)
    values (v_user_id, v_admin_email, 'Staging Administrator', 'admin', v_company_id);
  end if;

  update public.profiles
  set email = v_admin_email,
      full_name = coalesce(nullif(trim(full_name), ''), 'Staging Administrator'),
      role = 'admin',
      company_id = v_company_id,
      status = 'active',
      updated_at = now()
  where id = v_user_id;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'Expected to update one staging profile, updated %.', v_updated_count;
  end if;

  if not exists (
    select 1 from public.sites
    where company_id = v_company_id and name = 'Staging Office'
  ) then
    insert into public.sites (company_id, name, site_type, address, active)
    values (v_company_id, 'Staging Office', 'office', 'Non-production test site', true);
  end if;
end
$bootstrap$;

commit;

select
  c.id as company_id,
  c.name as company_name,
  p.id as profile_id,
  p.full_name,
  p.role,
  p.status,
  s.name as site_name
from public.companies c
join public.profiles p on p.company_id = c.id
left join public.sites s on s.company_id = c.id
where c.name = 'AURIS360 Staging Test'
order by p.full_name, s.name;
