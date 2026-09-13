-- Complete the existing MAP lifecycle without rewriting or removing any records.
begin;

alter table public.action_tracker drop constraint if exists action_tracker_status_check;
alter table public.action_tracker add constraint action_tracker_status_check
  check (status in ('open','in_progress','overdue','pending_verification','pending_closure','closed','cancelled'));

-- Every writer advances the revision token, including older module code that
-- patches an action without sending updated_at. The editor compares this token
-- in the PATCH predicate, so a competing write returns no matching record.
create or replace function public.touch_action_tracker_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := greatest(clock_timestamp(), coalesce(old.updated_at, '-infinity'::timestamptz) + interval '1 microsecond');
  return new;
end;
$$;
drop trigger if exists action_tracker_updated_at on public.action_tracker;
create trigger action_tracker_updated_at before update on public.action_tracker
  for each row execute function public.touch_action_tracker_updated_at();

notify pgrst, 'reload schema';
commit;
