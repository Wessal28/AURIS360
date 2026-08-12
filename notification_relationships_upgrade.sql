-- AURIS360 AP-042: canonical notification relationships and lifecycle events.
-- Rerunnable. Apply after the base notification_queue table exists.

begin;

alter table public.notification_queue
  add column if not exists related_module text,
  add column if not exists related_ref text,
  add column if not exists record_url text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Remove the NOT VALID relationship guard while legacy rows are repaired.
-- PostgreSQL still enforces NOT VALID constraints on every updated row, which
-- otherwise prevents later migrations from adding recipient_profile_id.
alter table public.notification_queue
  drop constraint if exists notification_queue_workflow_relationship_check;

update public.notification_queue
set related_module = coalesce(
  nullif(trim(metadata#>>'{relationship,module}'), ''),
  case
  when related_table in ('events','investigations') then 'events'
  when related_table = 'safety_observations' then 'observation'
  when related_table = 'risk_assessments' then 'risk'
  when related_table = 'permits' then 'permit'
  when related_table = 'documents' then 'documents'
  when related_table = 'action_tracker' then 'actions'
  when related_table like 'training_%' or related_table like 'elearning_%' then 'training'
  when related_table = 'companies' then 'admin'
  else related_module
  end)
where related_module is null and related_table is not null;

-- Keep the original reference when present. Older queue rows commonly stored
-- only related_id; its UUID is a stable, honest fallback reference.
update public.notification_queue
set related_ref = coalesce(
  nullif(trim(metadata#>>'{relationship,ref}'), ''),
  related_id::text
)
where nullif(trim(related_ref), '') is null
  and related_id is not null;

update public.notification_queue
set record_url = 'https://auris-360.vercel.app/?goto=' ||
    replace(related_module, ' ', '%20') || '&record=' || related_id::text ||
    '&table=' || replace(related_table, ' ', '%20') ||
    '&company=' || company_id::text
where nullif(trim(record_url), '') is null
  and nullif(trim(related_module), '') is not null
  and nullif(trim(related_table), '') is not null
  and related_id is not null;

alter table public.notification_queue
  add constraint notification_queue_workflow_relationship_check
  check (
    type in ('test_email','system')
    or (
      nullif(trim(related_module),'') is not null
      and nullif(trim(related_table),'') is not null
      and related_id is not null
      and nullif(trim(related_ref),'') is not null
    )
  ) not valid;

create index if not exists idx_notification_queue_relationship
  on public.notification_queue(company_id, related_table, related_id);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  notification_id uuid not null references public.notification_queue(id) on delete cascade,
  event_type text not null,
  related_module text,
  related_table text,
  related_id uuid,
  related_ref text,
  actor_id uuid,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_notification_events_notification
  on public.notification_events(notification_id, occurred_at desc);
create index if not exists idx_notification_events_relationship
  on public.notification_events(company_id, related_table, related_id, occurred_at desc);

alter table public.notification_events enable row level security;
drop policy if exists notification_events_company_access on public.notification_events;
create policy notification_events_company_access on public.notification_events
for all using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = notification_events.company_id)
  )
) with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = notification_events.company_id)
  )
);

create or replace function public.capture_notification_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := case when new.status = 'failed' then 'delivery_failed' else 'queued' end;
  elsif new.status is distinct from old.status then
    v_event := case new.status
      when 'sent' then 'sent'
      when 'delivered' then 'delivered'
      when 'failed' then 'delivery_failed'
      when 'bounced' then 'bounced'
      when 'skipped' then 'skipped'
      else 'status_' || coalesce(new.status,'unknown')
    end;
  else
    return new;
  end if;

  insert into public.notification_events(
    company_id, notification_id, event_type,
    related_module, related_table, related_id, related_ref, actor_id, detail
  ) values (
    new.company_id, new.id, v_event,
    new.related_module, new.related_table, new.related_id, new.related_ref, auth.uid(),
    jsonb_build_object('status',new.status,'channel',coalesce(new.channel,'email'),'error',new.error_msg)
  );
  return new;
end;
$$;

drop trigger if exists trg_capture_notification_event on public.notification_queue;
create trigger trg_capture_notification_event
after insert or update of status on public.notification_queue
for each row execute function public.capture_notification_event();

grant select, insert on public.notification_events to authenticated;

comment on table public.notification_events is
  'Append-only notification lifecycle events, including delivery, open and failed-target outcomes.';

commit;

notify pgrst, 'reload schema';
