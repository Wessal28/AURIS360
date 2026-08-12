-- AURIS360 browser and mobile PWA push notifications.
-- Rerunnable. Apply after in_app_notification_centre_upgrade.sql.

begin;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_secret text not null,
  user_agent text,
  device_label text,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(endpoint)
);

create index if not exists push_subscriptions_recipient_active
  on public.push_subscriptions(recipient_profile_id, enabled, last_seen_at desc);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_own_select on public.push_subscriptions;
create policy push_subscriptions_own_select on public.push_subscriptions
for select to authenticated
using (recipient_profile_id = auth.uid());

drop policy if exists push_subscriptions_own_insert on public.push_subscriptions;
create policy push_subscriptions_own_insert on public.push_subscriptions
for insert to authenticated
with check (
  recipient_profile_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = push_subscriptions.company_id
  )
);

drop policy if exists push_subscriptions_own_update on public.push_subscriptions;
create policy push_subscriptions_own_update on public.push_subscriptions
for update to authenticated
using (recipient_profile_id = auth.uid())
with check (
  recipient_profile_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = push_subscriptions.company_id
  )
);

drop policy if exists push_subscriptions_own_delete on public.push_subscriptions;
create policy push_subscriptions_own_delete on public.push_subscriptions
for delete to authenticated
using (recipient_profile_id = auth.uid());

revoke all on public.push_subscriptions from anon;
revoke all on public.push_subscriptions from authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create table if not exists public.push_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_notification_id uuid not null references public.user_notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','processing','sent','failed','expired','skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  error_msg text,
  provider_status integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_notification_id, subscription_id)
);

create index if not exists push_delivery_jobs_due
  on public.push_delivery_jobs(status, next_attempt_at, created_at)
  where status = 'pending';

alter table public.push_delivery_jobs enable row level security;
drop policy if exists push_delivery_jobs_own_select on public.push_delivery_jobs;
create policy push_delivery_jobs_own_select on public.push_delivery_jobs
for select to authenticated
using (
  exists (
    select 1 from public.user_notifications n
    where n.id = push_delivery_jobs.user_notification_id
      and n.recipient_profile_id = auth.uid()
  )
);

revoke all on public.push_delivery_jobs from anon;
revoke all on public.push_delivery_jobs from authenticated;
grant select on public.push_delivery_jobs to authenticated;

create or replace function public.queue_push_delivery_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.dismissed_at is not null
    or not (new.severity in ('high','urgent') or new.acknowledgement_required) then
    return new;
  end if;

  insert into public.push_delivery_jobs(
    company_id, user_notification_id, subscription_id, status, next_attempt_at
  )
  select new.company_id, new.id, s.id, 'pending', now()
  from public.push_subscriptions s
  where s.company_id = new.company_id
    and s.recipient_profile_id = new.recipient_profile_id
    and s.enabled
  on conflict(user_notification_id, subscription_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_queue_push_delivery_jobs on public.user_notifications;
create trigger trg_queue_push_delivery_jobs
after insert on public.user_notifications
for each row execute function public.queue_push_delivery_jobs();

-- A newly enabled device receives only currently relevant unread alerts, not a
-- historical flood. This also covers devices subscribed after an alert arrived.
create or replace function public.queue_recent_push_jobs_for_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.enabled then return new; end if;
  insert into public.push_delivery_jobs(
    company_id, user_notification_id, subscription_id, status, next_attempt_at
  )
  select n.company_id, n.id, new.id, 'pending', now()
  from public.user_notifications n
  where n.company_id = new.company_id
    and n.recipient_profile_id = new.recipient_profile_id
    and n.read_at is null and n.dismissed_at is null
    and n.created_at >= now() - interval '7 days'
    and (n.severity in ('high','urgent') or n.acknowledgement_required)
  on conflict(user_notification_id, subscription_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_queue_recent_push_jobs on public.push_subscriptions;
create trigger trg_queue_recent_push_jobs
after insert or update of enabled on public.push_subscriptions
for each row execute function public.queue_recent_push_jobs_for_subscription();

create or replace function public.claim_push_delivery_jobs(
  p_limit integer default 50,
  p_worker_id text default null
)
returns setof public.push_delivery_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.push_delivery_jobs j
  set status = 'skipped', error_msg = 'Notification no longer requires push',
      locked_at = null, locked_by = null, updated_at = now()
  from public.user_notifications n
  where j.user_notification_id = n.id
    and j.status = 'pending'
    and (
      n.dismissed_at is not null
      or (n.read_at is not null and (not n.acknowledgement_required or n.acknowledged_at is not null))
    );

  update public.push_delivery_jobs j
  set status = 'skipped', error_msg = 'Browser push subscription is disabled',
      locked_at = null, locked_by = null, updated_at = now()
  from public.push_subscriptions s
  where j.subscription_id = s.id
    and j.status = 'pending'
    and not s.enabled;

  return query
  with due as (
    select j.id
    from public.push_delivery_jobs j
    join public.push_subscriptions s on s.id = j.subscription_id
    join public.user_notifications n on n.id = j.user_notification_id
    where j.status = 'pending'
      and j.next_attempt_at <= now()
      and (j.locked_at is null or j.locked_at < now() - interval '10 minutes')
      and s.enabled
      and n.dismissed_at is null
      and (n.read_at is null or n.acknowledgement_required and n.acknowledged_at is null)
    order by case n.severity when 'urgent' then 0 when 'high' then 1 else 2 end,
      j.next_attempt_at, j.created_at
    for update of j skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  update public.push_delivery_jobs j
  set status = 'processing', locked_at = now(),
      locked_by = coalesce(nullif(trim(p_worker_id), ''), 'push-worker'),
      last_attempt_at = now(), attempt_count = j.attempt_count + 1,
      updated_at = now()
  from due
  where j.id = due.id
  returning j.*;
end;
$$;

revoke all on function public.claim_push_delivery_jobs(integer,text) from public;
revoke all on function public.claim_push_delivery_jobs(integer,text) from anon;
revoke all on function public.claim_push_delivery_jobs(integer,text) from authenticated;
grant execute on function public.claim_push_delivery_jobs(integer,text) to service_role;

create or replace function public.audit_push_delivery_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  notification_row record;
  event_name text;
begin
  if new.status is not distinct from old.status then return new; end if;
  event_name := case new.status
    when 'sent' then 'push_sent'
    when 'failed' then 'push_failed'
    when 'expired' then 'push_subscription_expired'
    when 'skipped' then 'push_skipped'
    else null
  end;
  if event_name is null then return new; end if;

  select n.* into notification_row
  from public.user_notifications n
  where n.id = new.user_notification_id;
  if not found then return new; end if;

  insert into public.notification_events(
    company_id, notification_id, event_type, related_module, related_table,
    related_id, related_ref, actor_id, detail
  ) values (
    notification_row.company_id, notification_row.source_notification_id,
    event_name, notification_row.related_module, notification_row.related_table,
    notification_row.related_id, notification_row.related_ref, null,
    jsonb_build_object(
      'channel','push','job_id',new.id,'subscription_id',new.subscription_id,
      'attempt',new.attempt_count,'provider_status',new.provider_status,'error',new.error_msg
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_push_delivery_job on public.push_delivery_jobs;
create trigger trg_audit_push_delivery_job
after update of status on public.push_delivery_jobs
for each row execute function public.audit_push_delivery_job();

comment on table public.push_subscriptions is
  'User-consented browser/PWA push subscriptions. One user may register multiple devices.';
comment on table public.push_delivery_jobs is
  'Auditable, retryable delivery jobs for high/urgent personal notifications.';

commit;

notify pgrst, 'reload schema';
