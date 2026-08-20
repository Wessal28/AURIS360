-- CI-only compatibility objects for replaying the AURIS360 public schema on a
-- disposable vanilla PostgreSQL database. This file is never applied to a
-- Supabase project.

do $$
begin
  create role anon nologin;
exception when duplicate_object then null;
end
$$;

do $$
begin
  create role authenticated nologin;
exception when duplicate_object then null;
end
$$;

do $$
begin
  create role service_role nologin;
exception when duplicate_object then null;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select null::uuid
$$;
