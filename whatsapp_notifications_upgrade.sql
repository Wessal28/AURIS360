-- AURIS360 governed WhatsApp Cloud API notification gate.
-- Apply after in_app_notification_centre_upgrade.sql.
-- WhatsApp is supplementary: in-app/email remain the governed fallback.

begin;

alter table public.profiles
  add column if not exists whatsapp_opted_in_at timestamptz,
  add column if not exists whatsapp_opted_out_at timestamptz,
  add column if not exists whatsapp_consent_source text,
  add column if not exists whatsapp_consent_version text;

create table if not exists public.whatsapp_channel_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  enabled boolean not null default false,
  provider text not null default 'meta_cloud' check (provider = 'meta_cloud'),
  phone_number_id text,
  alert_template_name text not null default 'auris360_alert',
  template_language text not null default 'en',
  minimum_escalation_level integer not null default 2 check (minimum_escalation_level between 0 and 3),
  allow_preferred_high_priority boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.whatsapp_consent_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('opted_in','opted_out','phone_changed')),
  phone_snapshot text,
  consent_version text not null default '2026-08',
  source text not null default 'user_profile',
  actor_id uuid not null references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null default now()
);

create index if not exists whatsapp_consent_events_profile_time
  on public.whatsapp_consent_events(profile_id, occurred_at desc);

create table if not exists public.whatsapp_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  user_notification_id uuid not null references public.user_notifications(id) on delete cascade,
  source_notification_id uuid not null references public.notification_queue(id) on delete cascade,
  phone_snapshot text not null,
  template_name text not null,
  template_language text not null default 'en',
  status text not null default 'pending'
    check (status in ('pending','processing','accepted','sent','delivered','read','failed','skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_attempt_at timestamptz,
  provider_message_id text,
  provider_status text,
  accepted_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  error_code text,
  error_msg text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_notification_id, recipient_profile_id)
);

create index if not exists whatsapp_delivery_jobs_due
  on public.whatsapp_delivery_jobs(status, next_attempt_at, created_at)
  where status = 'pending';
create index if not exists whatsapp_delivery_jobs_provider_message
  on public.whatsapp_delivery_jobs(provider_message_id)
  where provider_message_id is not null;

alter table public.whatsapp_channel_settings enable row level security;
alter table public.whatsapp_consent_events enable row level security;
alter table public.whatsapp_delivery_jobs enable row level security;

drop policy if exists whatsapp_settings_company_read on public.whatsapp_channel_settings;
create policy whatsapp_settings_company_read on public.whatsapp_channel_settings
for select to authenticated using (
  exists(select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or p.company_id=whatsapp_channel_settings.company_id))
);
drop policy if exists whatsapp_settings_admin_write on public.whatsapp_channel_settings;
create policy whatsapp_settings_admin_write on public.whatsapp_channel_settings
for all to authenticated using (
  exists(select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=whatsapp_channel_settings.company_id and p.role in ('admin','hse_manager'))))
) with check (
  exists(select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=whatsapp_channel_settings.company_id and p.role in ('admin','hse_manager'))))
);

drop policy if exists whatsapp_consent_own_read on public.whatsapp_consent_events;
create policy whatsapp_consent_own_read on public.whatsapp_consent_events
for select to authenticated using (
  profile_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=whatsapp_consent_events.company_id and p.role in ('admin','hse_manager'))))
);

drop policy if exists whatsapp_jobs_own_or_admin_read on public.whatsapp_delivery_jobs;
create policy whatsapp_jobs_own_or_admin_read on public.whatsapp_delivery_jobs
for select to authenticated using (
  recipient_profile_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=whatsapp_delivery_jobs.company_id and p.role in ('admin','hse_manager'))))
);

revoke all on public.whatsapp_channel_settings, public.whatsapp_consent_events, public.whatsapp_delivery_jobs from anon;
grant select on public.whatsapp_channel_settings, public.whatsapp_consent_events, public.whatsapp_delivery_jobs to authenticated;
grant insert,update on public.whatsapp_channel_settings to authenticated;

create or replace function public.set_my_whatsapp_consent(
  p_opted_in boolean,
  p_phone text default null,
  p_consent_version text default '2026-08'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  profile_row public.profiles%rowtype;
  normalised_phone text;
  previous_phone text;
  event_name text;
begin
  select * into profile_row from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Authenticated profile not found'; end if;
  previous_phone:=profile_row.whatsapp_phone;
  normalised_phone:=regexp_replace(coalesce(p_phone,profile_row.whatsapp_phone,''),'[^0-9+]','','g');
  if p_opted_in and normalised_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'WhatsApp number must use international format, for example +2305xxxxxxx';
  end if;

  update public.profiles set
    whatsapp_phone=case when p_opted_in then normalised_phone else whatsapp_phone end,
    preferred_notification_channel=case when p_opted_in then 'whatsapp'
      when preferred_notification_channel='whatsapp' then 'in_app' else preferred_notification_channel end,
    whatsapp_opted_in_at=case when p_opted_in then now() else whatsapp_opted_in_at end,
    whatsapp_opted_out_at=case when p_opted_in then null else now() end,
    whatsapp_consent_source='user_profile',
    whatsapp_consent_version=coalesce(nullif(trim(p_consent_version),''),'2026-08'),
    updated_at=now()
  where id=auth.uid();

  event_name:=case when not p_opted_in then 'opted_out'
    when previous_phone is distinct from normalised_phone and profile_row.whatsapp_opted_in_at is not null then 'phone_changed'
    else 'opted_in' end;
  insert into public.whatsapp_consent_events(company_id,profile_id,event_type,phone_snapshot,consent_version,source,actor_id)
  values(profile_row.company_id,profile_row.id,event_name,case when p_opted_in then normalised_phone else previous_phone end,
    coalesce(nullif(trim(p_consent_version),''),'2026-08'),'user_profile',auth.uid());

  if not p_opted_in then
    update public.whatsapp_delivery_jobs set status='skipped',error_msg='Recipient withdrew WhatsApp consent',updated_at=now()
    where recipient_profile_id=auth.uid() and status='pending';
  end if;
  return jsonb_build_object('opted_in',p_opted_in,'phone',case when p_opted_in then normalised_phone else null end,'event',event_name);
end;
$$;

revoke all on function public.set_my_whatsapp_consent(boolean,text,text) from public,anon;
grant execute on function public.set_my_whatsapp_consent(boolean,text,text) to authenticated;

create or replace function public.queue_whatsapp_delivery_job()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  profile_row record;
  setting_row record;
  source_row record;
  escalation_level integer;
begin
  select * into profile_row from public.profiles where id=new.recipient_profile_id and company_id=new.company_id;
  if not found or profile_row.whatsapp_opted_in_at is null or profile_row.whatsapp_opted_out_at is not null
    or coalesce(profile_row.whatsapp_phone,'')='' then return new; end if;
  select * into setting_row from public.whatsapp_channel_settings where company_id=new.company_id and enabled;
  if not found or coalesce(setting_row.phone_number_id,'')='' then return new; end if;
  select * into source_row from public.notification_queue where id=new.source_notification_id;
  escalation_level:=coalesce((source_row.metadata->>'escalation_level')::integer,0);
  if escalation_level < setting_row.minimum_escalation_level
    and not (setting_row.allow_preferred_high_priority and profile_row.preferred_notification_channel='whatsapp'
      and new.severity in ('high','urgent')) then return new; end if;

  insert into public.whatsapp_delivery_jobs(company_id,recipient_profile_id,user_notification_id,source_notification_id,
    phone_snapshot,template_name,template_language)
  values(new.company_id,new.recipient_profile_id,new.id,new.source_notification_id,profile_row.whatsapp_phone,
    setting_row.alert_template_name,setting_row.template_language)
  on conflict(user_notification_id,recipient_profile_id) do nothing;
  return new;
exception when invalid_text_representation then return new;
end;
$$;

drop trigger if exists trg_queue_whatsapp_delivery_job on public.user_notifications;
create trigger trg_queue_whatsapp_delivery_job after insert on public.user_notifications
for each row execute function public.queue_whatsapp_delivery_job();

create or replace function public.claim_whatsapp_delivery_jobs(p_limit integer default 50,p_worker_id text default null)
returns setof public.whatsapp_delivery_jobs language plpgsql security definer set search_path=public as $$
begin
  update public.whatsapp_delivery_jobs j set status='skipped',error_msg='Notification no longer requires WhatsApp delivery',updated_at=now()
  from public.user_notifications n where j.user_notification_id=n.id and j.status='pending'
    and (n.dismissed_at is not null or (n.read_at is not null and (not n.acknowledgement_required or n.acknowledged_at is not null)));
  update public.whatsapp_delivery_jobs j set status='skipped',error_msg='Recipient consent is no longer active',updated_at=now()
  from public.profiles p where j.recipient_profile_id=p.id and j.status='pending'
    and (p.whatsapp_opted_in_at is null or p.whatsapp_opted_out_at is not null);
  return query with due as (
    select j.id from public.whatsapp_delivery_jobs j
    where j.status='pending' and j.next_attempt_at<=now()
      and (j.locked_at is null or j.locked_at<now()-interval '10 minutes')
    order by j.next_attempt_at,j.created_at for update skip locked
    limit greatest(1,least(coalesce(p_limit,50),100))
  ) update public.whatsapp_delivery_jobs j set status='processing',locked_at=now(),
    locked_by=coalesce(nullif(trim(p_worker_id),''),'whatsapp-worker'),last_attempt_at=now(),
    attempt_count=j.attempt_count+1,updated_at=now() from due where j.id=due.id returning j.*;
end;
$$;

revoke all on function public.claim_whatsapp_delivery_jobs(integer,text) from public,anon,authenticated;
grant execute on function public.claim_whatsapp_delivery_jobs(integer,text) to service_role;

create or replace function public.audit_whatsapp_delivery_job()
returns trigger language plpgsql security definer set search_path=public as $$
declare event_name text;
begin
  if new.status is not distinct from old.status then return new; end if;
  event_name:=case new.status when 'accepted' then 'whatsapp_accepted' when 'sent' then 'whatsapp_sent'
    when 'delivered' then 'whatsapp_delivered' when 'read' then 'whatsapp_read'
    when 'failed' then 'whatsapp_failed' when 'skipped' then 'whatsapp_skipped' else null end;
  if event_name is not null then
    insert into public.notification_events(company_id,notification_id,event_type,actor_id,detail)
    values(new.company_id,new.source_notification_id,event_name,null,jsonb_build_object('channel','whatsapp','job_id',new.id,
      'attempt',new.attempt_count,'provider_message_id',new.provider_message_id,'provider_status',new.provider_status,
      'error_code',new.error_code,'error',new.error_msg));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_whatsapp_delivery_job on public.whatsapp_delivery_jobs;
create trigger trg_audit_whatsapp_delivery_job after update of status on public.whatsapp_delivery_jobs
for each row execute function public.audit_whatsapp_delivery_job();

comment on table public.whatsapp_consent_events is 'Append-only evidence of user-controlled WhatsApp consent changes.';
comment on table public.whatsapp_delivery_jobs is 'Tenant-safe, retryable Meta WhatsApp template delivery queue.';

commit;
notify pgrst, 'reload schema';
