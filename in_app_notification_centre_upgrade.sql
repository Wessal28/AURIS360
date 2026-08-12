-- AURIS360 personal in-app notification centre.
-- Rerunnable. Apply after notification_relationships_upgrade.sql and
-- notification_delivery_reliability_upgrade.sql.

begin;

alter table public.notification_queue
  add column if not exists recipient_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists channel text not null default 'email',
  add column if not exists priority text not null default 'normal',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.profiles
  add column if not exists real_email text;

create index if not exists notification_queue_recipient_profile
  on public.notification_queue(company_id, recipient_profile_id, created_at desc)
  where recipient_profile_id is not null;

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  source_notification_id uuid not null references public.notification_queue(id) on delete cascade,
  event_type text not null default 'system',
  severity text not null default 'normal'
    check (severity in ('low','normal','high','urgent')),
  title text not null,
  message text,
  related_module text,
  related_table text,
  related_id uuid,
  related_ref text,
  record_url text,
  acknowledgement_required boolean not null default false,
  read_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_notification_id, recipient_profile_id)
);

create index if not exists user_notifications_personal_inbox
  on public.user_notifications(recipient_profile_id, created_at desc);
create index if not exists user_notifications_unread
  on public.user_notifications(recipient_profile_id, created_at desc)
  where read_at is null and dismissed_at is null;
create index if not exists user_notifications_acknowledgement
  on public.user_notifications(recipient_profile_id, created_at desc)
  where acknowledgement_required and acknowledged_at is null and dismissed_at is null;

alter table public.user_notifications enable row level security;

drop policy if exists user_notifications_recipient_select on public.user_notifications;
create policy user_notifications_recipient_select on public.user_notifications
for select to authenticated
using (recipient_profile_id = auth.uid());

drop policy if exists user_notifications_recipient_update on public.user_notifications;
create policy user_notifications_recipient_update on public.user_notifications
for update to authenticated
using (recipient_profile_id = auth.uid())
with check (
  recipient_profile_id = auth.uid()
  and (acknowledged_by is null or acknowledged_by = auth.uid())
);

revoke all on public.user_notifications from anon;
revoke all on public.user_notifications from authenticated;
grant select on public.user_notifications to authenticated;
grant update(read_at, acknowledged_at, acknowledged_by, dismissed_at, updated_at)
  on public.user_notifications to authenticated;

create or replace function public.resolve_notification_recipient_profile(
  p_company_id uuid,
  p_recipient_profile_id uuid,
  p_to_email text,
  p_metadata jsonb
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resolved_id uuid;
  metadata_id text;
begin
  if p_recipient_profile_id is not null then
    select p.id into resolved_id
    from public.profiles p
    where p.id = p_recipient_profile_id and p.company_id = p_company_id
    limit 1;
    if resolved_id is not null then return resolved_id; end if;
  end if;

  metadata_id := coalesce(p_metadata->>'recipient_profile_id', p_metadata#>>'{recipient,id}');
  if metadata_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select p.id into resolved_id
    from public.profiles p
    where p.id = metadata_id::uuid and p.company_id = p_company_id
    limit 1;
    if resolved_id is not null then return resolved_id; end if;
  end if;

  select p.id into resolved_id
  from public.profiles p
  where p.company_id = p_company_id
    and nullif(trim(p_to_email), '') is not null
    and (
      lower(trim(coalesce(p.real_email, ''))) = lower(trim(p_to_email))
      or lower(trim(coalesce(p.email, ''))) = lower(trim(p_to_email))
    )
  order by case when lower(trim(coalesce(p.real_email, ''))) = lower(trim(p_to_email)) then 0 else 1 end, p.id
  limit 1;
  return resolved_id;
end;
$$;

create or replace function public.create_user_notification_from_queue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient_id uuid;
  requires_ack boolean;
  plain_message text;
begin
  recipient_id := public.resolve_notification_recipient_profile(
    new.company_id, new.recipient_profile_id, new.to_email, coalesce(new.metadata, '{}'::jsonb)
  );
  if recipient_id is null then return new; end if;

  requires_ack := coalesce((new.metadata->>'acknowledgement_required')::boolean, false)
    or coalesce(new.priority, 'normal') = 'urgent'
    or (
      new.type = 'action_overdue'
      and coalesce((new.metadata->>'escalation_level')::integer, 0) >= 2
    );
  plain_message := left(trim(regexp_replace(coalesce(new.body_html, ''), '<[^>]*>', ' ', 'g')), 500);

  insert into public.user_notifications(
    company_id, recipient_profile_id, source_notification_id, event_type, severity,
    title, message, related_module, related_table, related_id, related_ref,
    record_url, acknowledgement_required, created_at, updated_at
  ) values (
    new.company_id, recipient_id, new.id, coalesce(new.type, 'system'),
    case when coalesce(new.priority, 'normal') in ('low','normal','high','urgent')
      then coalesce(new.priority, 'normal') else 'normal' end,
    coalesce(nullif(trim(new.subject), ''), 'AURIS360 notification'),
    nullif(plain_message, ''), new.related_module, new.related_table, new.related_id,
    new.related_ref, new.record_url, requires_ack, coalesce(new.created_at, now()), now()
  ) on conflict(source_notification_id, recipient_profile_id) do nothing;

  update public.notification_queue
  set recipient_profile_id = recipient_id
  where id = new.id and recipient_profile_id is null;
  return new;
end;
$$;

drop trigger if exists trg_create_user_notification_from_queue on public.notification_queue;
create trigger trg_create_user_notification_from_queue
after insert on public.notification_queue
for each row execute function public.create_user_notification_from_queue();

create or replace function public.audit_user_notification_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.read_at is not null and old.read_at is null then
    insert into public.notification_events(
      company_id, notification_id, event_type, related_module, related_table,
      related_id, related_ref, actor_id, detail
    ) values (
      new.company_id, new.source_notification_id, 'opened', new.related_module,
      new.related_table, new.related_id, new.related_ref, auth.uid(),
      jsonb_build_object('surface', 'personal_inbox', 'user_notification_id', new.id)
    );
  end if;

  if new.acknowledged_at is not null and old.acknowledged_at is null then
    insert into public.notification_events(
      company_id, notification_id, event_type, related_module, related_table,
      related_id, related_ref, actor_id, detail
    ) values (
      new.company_id, new.source_notification_id, 'acknowledged', new.related_module,
      new.related_table, new.related_id, new.related_ref, auth.uid(),
      jsonb_build_object('surface', 'personal_inbox', 'user_notification_id', new.id)
    );
  end if;
  return new;
end;
$$;

create or replace function public.enforce_user_notification_state()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception 'A read notification cannot be returned to unread';
  end if;
  if old.acknowledged_at is not null and (
    new.acknowledged_at is distinct from old.acknowledged_at
    or new.acknowledged_by is distinct from old.acknowledged_by
  ) then
    raise exception 'A notification acknowledgement is immutable';
  end if;
  if new.acknowledged_at is not null and old.acknowledged_at is null then
    if not new.acknowledgement_required then
      raise exception 'This notification does not require acknowledgement';
    end if;
    new.acknowledged_by := auth.uid();
    new.read_at := coalesce(new.read_at, new.acknowledged_at);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_user_notification_state on public.user_notifications;
create trigger trg_enforce_user_notification_state
before update of read_at, acknowledged_at, acknowledged_by on public.user_notifications
for each row execute function public.enforce_user_notification_state();

drop trigger if exists trg_audit_user_notification_state on public.user_notifications;
create trigger trg_audit_user_notification_state
after update of read_at, acknowledged_at on public.user_notifications
for each row execute function public.audit_user_notification_state();

-- Backfill recent notifications once. Login-only .local addresses still resolve
-- to their profile, so users without a real email can receive in-app notices.
insert into public.user_notifications(
  company_id, recipient_profile_id, source_notification_id, event_type, severity,
  title, message, related_module, related_table, related_id, related_ref,
  record_url, acknowledgement_required, created_at, updated_at
)
select q.company_id, resolved.recipient_id, q.id, coalesce(q.type, 'system'),
  case when coalesce(q.priority, 'normal') in ('low','normal','high','urgent')
    then coalesce(q.priority, 'normal') else 'normal' end,
  coalesce(nullif(trim(q.subject), ''), 'AURIS360 notification'),
  nullif(left(trim(regexp_replace(coalesce(q.body_html, ''), '<[^>]*>', ' ', 'g')), 500), ''),
  q.related_module, q.related_table, q.related_id, q.related_ref, q.record_url,
  coalesce((q.metadata->>'acknowledgement_required')::boolean, false)
    or coalesce(q.priority, 'normal') = 'urgent',
  q.created_at, now()
from public.notification_queue q
cross join lateral (
  select public.resolve_notification_recipient_profile(
    q.company_id, q.recipient_profile_id, q.to_email, coalesce(q.metadata, '{}'::jsonb)
  ) as recipient_id
) resolved
where q.created_at >= now() - interval '90 days'
  and resolved.recipient_id is not null
on conflict(source_notification_id, recipient_profile_id) do nothing;

update public.notification_queue q
set recipient_profile_id = u.recipient_profile_id
from public.user_notifications u
where u.source_notification_id = q.id and q.recipient_profile_id is null;

comment on table public.user_notifications is
  'Recipient-private in-app inbox derived from governed notification queue records.';

commit;

notify pgrst, 'reload schema';
