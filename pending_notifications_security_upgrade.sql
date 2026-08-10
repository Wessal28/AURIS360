-- AURIS360 release-gate correction for the pending notification view.
-- Safe to rerun. The view reads with the caller's permissions so the
-- tenant-scoped notification_queue RLS policy remains authoritative.

begin;

do $$
begin
  if to_regclass('public.pending_notifications') is null then
    raise notice 'public.pending_notifications does not exist; no view change applied';
  else
    execute 'alter view public.pending_notifications set (security_invoker=true)';
    execute 'revoke all on public.pending_notifications from anon';
    execute 'grant select on public.pending_notifications to authenticated';
  end if;
end
$$;

commit;
