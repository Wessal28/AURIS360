-- AURIS360 notification delivery reliability gate.
-- Rerunnable. Apply after notification_relationships_upgrade.sql.

alter table public.notification_queue
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists provider text,
  add column if not exists provider_message_id text,
  add column if not exists delivered_at timestamptz,
  add column if not exists bounced_at timestamptz,
  add column if not exists idempotency_key text;

update public.notification_queue
set provider = coalesce(provider, 'resend'),
    provider_message_id = coalesce(provider_message_id, resend_id)
where resend_id is not null
  and provider_message_id is null;

alter table public.notification_queue
  drop constraint if exists notification_queue_attempt_count_check;
alter table public.notification_queue
  add constraint notification_queue_attempt_count_check
  check (attempt_count >= 0);

create index if not exists notification_queue_delivery_due
  on public.notification_queue(status, next_attempt_at, created_at)
  where status = 'pending';

create index if not exists notification_queue_provider_message
  on public.notification_queue(provider, provider_message_id)
  where provider_message_id is not null;

create unique index if not exists notification_queue_idempotency
  on public.notification_queue(company_id, idempotency_key)
  where idempotency_key is not null;

-- Atomically leases due rows. A crashed worker's lease becomes available after
-- ten minutes, while concurrent workers cannot claim the same notification.
create or replace function public.claim_notification_queue(
  p_limit integer default 50,
  p_worker_id text default null
)
returns setof public.notification_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select q.id
    from public.notification_queue q
    where q.status = 'pending'
      and coalesce(q.next_attempt_at, q.created_at, now()) <= now()
      and (q.locked_at is null or q.locked_at < now() - interval '10 minutes')
    order by coalesce(q.next_attempt_at, q.created_at), q.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  update public.notification_queue q
  set locked_at = now(),
      locked_by = coalesce(nullif(trim(p_worker_id), ''), 'notification-worker'),
      last_attempt_at = now(),
      attempt_count = coalesce(q.attempt_count, 0) + 1
  from due
  where q.id = due.id
  returning q.*;
end;
$$;

revoke all on function public.claim_notification_queue(integer, text) from public;
revoke all on function public.claim_notification_queue(integer, text) from anon;
revoke all on function public.claim_notification_queue(integer, text) from authenticated;
grant execute on function public.claim_notification_queue(integer, text) to service_role;

create or replace function public.capture_notification_attempt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.attempt_count is not distinct from old.attempt_count then
    return new;
  end if;

  insert into public.notification_events(
    company_id, notification_id, event_type,
    related_module, related_table, related_id, related_ref, actor_id, detail
  ) values (
    new.company_id, new.id,
    case when new.status = 'pending' and new.next_attempt_at > now()
      then 'retry_scheduled' else 'delivery_attempt' end,
    new.related_module, new.related_table, new.related_id, new.related_ref, null,
    jsonb_build_object(
      'attempt', new.attempt_count,
      'next_attempt_at', new.next_attempt_at,
      'worker', new.locked_by,
      'provider', new.provider,
      'error', new.error_msg
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_capture_notification_attempt on public.notification_queue;
create trigger trg_capture_notification_attempt
after update of attempt_count on public.notification_queue
for each row execute function public.capture_notification_attempt();

comment on function public.claim_notification_queue(integer, text) is
  'Service-role-only atomic lease for due notification delivery jobs.';

comment on column public.notification_queue.idempotency_key is
  'Optional producer-supplied key preventing duplicate notification creation within a company.';
