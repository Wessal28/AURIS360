-- AURIS360 canonical-domain migration
-- Run once in the Supabase SQL editor after auris360.app is connected to Vercel.
-- Rerunnable: rewrites only active notification links and function definitions
-- that still reference a retired public origin. Sent notification evidence is
-- intentionally left unchanged as an audit record.

begin;

do $$
declare
  fn record;
  definition text;
begin
  for fn in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and (
        pg_get_functiondef(p.oid) like '%https://auris-360.vercel.app%'
        or pg_get_functiondef(p.oid) like '%https://app.auris360.com%'
      )
  loop
    definition := pg_get_functiondef(fn.oid);
    definition := replace(definition, 'https://auris-360.vercel.app', 'https://auris360.app');
    definition := replace(definition, 'https://app.auris360.com', 'https://auris360.app');
    execute definition;
  end loop;
end $$;

do $$
begin
  if to_regclass('public.notification_queue') is not null then
    update public.notification_queue
    set record_url = replace(
          replace(record_url, 'https://auris-360.vercel.app', 'https://auris360.app'),
          'https://app.auris360.com', 'https://auris360.app'
        ),
        body_html = replace(
          replace(body_html, 'https://auris-360.vercel.app', 'https://auris360.app'),
          'https://app.auris360.com', 'https://auris360.app'
        ),
        metadata = replace(
          replace(metadata::text, 'https://auris-360.vercel.app', 'https://auris360.app'),
          'https://app.auris360.com', 'https://auris360.app'
        )::jsonb
    where status in ('pending', 'processing', 'failed')
      and (
        coalesce(record_url, '') like '%auris-360.vercel.app%'
        or coalesce(record_url, '') like '%app.auris360.com%'
        or coalesce(body_html, '') like '%auris-360.vercel.app%'
        or coalesce(body_html, '') like '%app.auris360.com%'
        or metadata::text like '%auris-360.vercel.app%'
        or metadata::text like '%app.auris360.com%'
      );
  end if;

  if to_regclass('public.user_notifications') is not null then
    update public.user_notifications
    set record_url = replace(
          replace(record_url, 'https://auris-360.vercel.app', 'https://auris360.app'),
          'https://app.auris360.com', 'https://auris360.app'
        ),
        updated_at = now()
    where dismissed_at is null
      and (
        coalesce(record_url, '') like '%auris-360.vercel.app%'
        or coalesce(record_url, '') like '%app.auris360.com%'
      );
  end if;
end $$;

commit;

-- Verification: both result values must be zero. The temporary result makes
-- this verification safe even during a partially applied notification rollout.
create temporary table if not exists auris360_domain_migration_result (
  check_name text primary key,
  remaining integer not null
) on commit preserve rows;
truncate auris360_domain_migration_result;

do $$
begin
  if to_regclass('public.notification_queue') is not null then
    execute $query$
      insert into auris360_domain_migration_result
      select 'active_queue_links_on_old_domains', count(*)::integer
      from public.notification_queue
      where status in ('pending', 'processing', 'failed')
        and concat_ws(' ', record_url, body_html, metadata::text)
            ~ 'auris-360\\.vercel\\.app|app\\.auris360\\.com'
    $query$;
  else
    insert into auris360_domain_migration_result values ('active_queue_links_on_old_domains', 0);
  end if;

  if to_regclass('public.user_notifications') is not null then
    execute $query$
      insert into auris360_domain_migration_result
      select 'active_in_app_links_on_old_domains', count(*)::integer
      from public.user_notifications
      where dismissed_at is null
        and coalesce(record_url, '') ~ 'auris-360\\.vercel\\.app|app\\.auris360\\.com'
    $query$;
  else
    insert into auris360_domain_migration_result values ('active_in_app_links_on_old_domains', 0);
  end if;
end $$;

select check_name, remaining
from auris360_domain_migration_result
order by check_name;
