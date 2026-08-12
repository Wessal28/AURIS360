-- AURIS360 recipient preferences, quiet hours and delivery-rate protection.
-- Apply after the in-app, browser push and WhatsApp notification migrations.
-- Safe and rerunnable.

begin;

create table if not exists public.notification_user_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  timezone text not null default 'Asia/Dubai',
  quiet_hours_enabled boolean not null default false,
  quiet_start time not null default '20:00',
  quiet_end time not null default '06:00',
  allow_urgent_override boolean not null default true,
  email_enabled boolean not null default true,
  push_enabled boolean not null default true,
  whatsapp_enabled boolean not null default true,
  max_external_alerts_per_hour integer not null default 10
    check (max_external_alerts_per_hour between 1 and 60),
  updated_at timestamptz not null default now(),
  unique(company_id,profile_id)
);

alter table public.notification_user_preferences enable row level security;
drop policy if exists notification_preferences_own_read on public.notification_user_preferences;
create policy notification_preferences_own_read on public.notification_user_preferences
for select to authenticated using (profile_id=auth.uid());
drop policy if exists notification_preferences_own_insert on public.notification_user_preferences;
create policy notification_preferences_own_insert on public.notification_user_preferences
for insert to authenticated with check (
  profile_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.company_id=notification_user_preferences.company_id)
);
drop policy if exists notification_preferences_own_update on public.notification_user_preferences;
create policy notification_preferences_own_update on public.notification_user_preferences
for update to authenticated using (profile_id=auth.uid()) with check (profile_id=auth.uid());
revoke all on public.notification_user_preferences from anon;
grant select,insert,update on public.notification_user_preferences to authenticated;

create or replace function public.set_my_notification_preferences(
  p_timezone text,
  p_quiet_enabled boolean,
  p_quiet_start time,
  p_quiet_end time,
  p_allow_urgent_override boolean,
  p_email_enabled boolean,
  p_push_enabled boolean,
  p_whatsapp_enabled boolean,
  p_max_external_alerts integer
)
returns public.notification_user_preferences
language plpgsql security definer set search_path=public as $$
declare profile_row public.profiles%rowtype; result public.notification_user_preferences%rowtype;
begin
  select * into profile_row from public.profiles where id=auth.uid();
  if not found then raise exception 'Authenticated profile not found'; end if;
  if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Unsupported timezone'; end if;
  insert into public.notification_user_preferences(profile_id,company_id,timezone,quiet_hours_enabled,quiet_start,quiet_end,
    allow_urgent_override,email_enabled,push_enabled,whatsapp_enabled,max_external_alerts_per_hour,updated_at)
  values(profile_row.id,profile_row.company_id,p_timezone,coalesce(p_quiet_enabled,false),coalesce(p_quiet_start,'20:00'),
    coalesce(p_quiet_end,'06:00'),coalesce(p_allow_urgent_override,true),coalesce(p_email_enabled,true),
    coalesce(p_push_enabled,true),coalesce(p_whatsapp_enabled,true),greatest(1,least(coalesce(p_max_external_alerts,10),60)),now())
  on conflict(profile_id) do update set timezone=excluded.timezone,quiet_hours_enabled=excluded.quiet_hours_enabled,
    quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,allow_urgent_override=excluded.allow_urgent_override,
    email_enabled=excluded.email_enabled,push_enabled=excluded.push_enabled,whatsapp_enabled=excluded.whatsapp_enabled,
    max_external_alerts_per_hour=excluded.max_external_alerts_per_hour,updated_at=now()
  returning * into result;
  return result;
end;
$$;
revoke all on function public.set_my_notification_preferences(text,boolean,time,time,boolean,boolean,boolean,boolean,integer) from public,anon;
grant execute on function public.set_my_notification_preferences(text,boolean,time,time,boolean,boolean,boolean,boolean,integer) to authenticated;

create or replace function public.evaluate_notification_delivery_policy(
  p_company_id uuid,p_profile_id uuid,p_channel text,p_severity text,p_ack_required boolean default false
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare pref record; local_now timestamp; quiet boolean:=false; urgent_override boolean:=false;
  deliver_after timestamptz:=now(); recent_count integer:=0; channel_enabled boolean:=true;
begin
  if p_profile_id is null then return jsonb_build_object('allowed',true,'deliver_after',now(),'reason','recipient_unresolved'); end if;
  select * into pref from public.notification_user_preferences where profile_id=p_profile_id and company_id=p_company_id;
  if not found then return jsonb_build_object('allowed',true,'deliver_after',now(),'reason','default_preferences'); end if;
  channel_enabled:=case lower(p_channel) when 'email' then pref.email_enabled when 'push' then pref.push_enabled
    when 'whatsapp' then pref.whatsapp_enabled else true end;
  if not channel_enabled then return jsonb_build_object('allowed',false,'deliver_after',null,'reason','channel_disabled'); end if;
  local_now:=now() at time zone pref.timezone;
  if pref.quiet_hours_enabled then
    quiet:=case when pref.quiet_start=pref.quiet_end then true
      when pref.quiet_start<pref.quiet_end then local_now::time>=pref.quiet_start and local_now::time<pref.quiet_end
      else local_now::time>=pref.quiet_start or local_now::time<pref.quiet_end end;
  end if;
  urgent_override:=quiet and lower(coalesce(p_severity,''))='urgent' and coalesce(p_ack_required,false) and pref.allow_urgent_override;
  if quiet and not urgent_override then
    deliver_after:=case when local_now::time<pref.quiet_end
      then ((local_now::date+pref.quiet_end) at time zone pref.timezone)
      else (((local_now::date+1)+pref.quiet_end) at time zone pref.timezone) end;
    return jsonb_build_object('allowed',true,'deliver_after',deliver_after,'reason','quiet_hours_deferred','override',false);
  end if;
  if lower(coalesce(p_severity,'')) not in ('urgent') then
    select count(*) into recent_count from public.notification_events e
    where e.company_id=p_company_id and e.occurred_at>=now()-interval '1 hour'
      and e.detail->>'recipient_profile_id'=p_profile_id::text and e.detail->>'channel'=lower(p_channel)
      and e.event_type in ('sent','delivered','push_sent','whatsapp_accepted','whatsapp_sent','whatsapp_delivered');
    if recent_count>=pref.max_external_alerts_per_hour then
      return jsonb_build_object('allowed',true,'deliver_after',now()+interval '1 hour','reason','rate_limit_deferred','override',false);
    end if;
  end if;
  return jsonb_build_object('allowed',true,'deliver_after',now(),'reason',case when urgent_override then 'urgent_quiet_hours_override' else 'allowed' end,'override',urgent_override);
end;
$$;
revoke all on function public.evaluate_notification_delivery_policy(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.evaluate_notification_delivery_policy(uuid,uuid,text,text,boolean) to service_role;

-- Add recipient identity to future lifecycle evidence so rate protection is
-- calculated per person, company and channel without exposing contact details.
create or replace function public.capture_notification_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_event text;
begin
  if tg_op='INSERT' then v_event:=case when new.status='failed' then 'delivery_failed' else 'queued' end;
  elsif new.status is distinct from old.status then v_event:=case new.status when 'sent' then 'sent' when 'delivered' then 'delivered'
    when 'failed' then 'delivery_failed' when 'bounced' then 'bounced' when 'skipped' then 'skipped'
    else 'status_'||coalesce(new.status,'unknown') end;
  else return new; end if;
  insert into public.notification_events(company_id,notification_id,event_type,related_module,related_table,related_id,related_ref,actor_id,detail)
  values(new.company_id,new.id,v_event,new.related_module,new.related_table,new.related_id,new.related_ref,auth.uid(),
    jsonb_build_object('status',new.status,'channel',coalesce(new.channel,'email'),'error',new.error_msg,
      'recipient_profile_id',new.recipient_profile_id));
  return new;
end;
$$;

create or replace function public.audit_push_delivery_job()
returns trigger language plpgsql security definer set search_path=public as $$
declare notification_row record; event_name text;
begin
  if new.status is not distinct from old.status then return new; end if;
  event_name:=case new.status when 'sent' then 'push_sent' when 'failed' then 'push_failed'
    when 'expired' then 'push_subscription_expired' when 'skipped' then 'push_skipped' else null end;
  if event_name is null then return new; end if;
  select n.* into notification_row from public.user_notifications n where n.id=new.user_notification_id;
  if not found then return new; end if;
  insert into public.notification_events(company_id,notification_id,event_type,related_module,related_table,related_id,related_ref,actor_id,detail)
  values(notification_row.company_id,notification_row.source_notification_id,event_name,notification_row.related_module,
    notification_row.related_table,notification_row.related_id,notification_row.related_ref,null,
    jsonb_build_object('channel','push','job_id',new.id,'subscription_id',new.subscription_id,'attempt',new.attempt_count,
      'provider_status',new.provider_status,'error',new.error_msg,'recipient_profile_id',notification_row.recipient_profile_id));
  return new;
end;
$$;

create or replace function public.audit_whatsapp_delivery_job()
returns trigger language plpgsql security definer set search_path=public as $$
declare event_name text;
begin
  if new.status is not distinct from old.status then return new; end if;
  event_name:=case new.status when 'accepted' then 'whatsapp_accepted' when 'sent' then 'whatsapp_sent'
    when 'delivered' then 'whatsapp_delivered' when 'read' then 'whatsapp_read'
    when 'failed' then 'whatsapp_failed' when 'skipped' then 'whatsapp_skipped' else null end;
  if event_name is not null then insert into public.notification_events(company_id,notification_id,event_type,actor_id,detail)
    values(new.company_id,new.source_notification_id,event_name,null,jsonb_build_object('channel','whatsapp','job_id',new.id,
      'attempt',new.attempt_count,'provider_message_id',new.provider_message_id,'provider_status',new.provider_status,
      'error_code',new.error_code,'error',new.error_msg,'recipient_profile_id',new.recipient_profile_id)); end if;
  return new;
end;
$$;

comment on table public.notification_user_preferences is 'Recipient-owned external notification channel, quiet-hour and rate-protection preferences.';
comment on function public.evaluate_notification_delivery_policy(uuid,uuid,text,text,boolean) is 'Service-only central policy; urgent acknowledgement-required alerts may audibly override quiet hours.';

commit;
notify pgrst, 'reload schema';
