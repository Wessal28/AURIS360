-- AURIS360 acknowledgement SLA, reminder and hierarchy-escalation control.
-- Apply after in_app_notification_centre_upgrade.sql,
-- action_notification_escalation_upgrade.sql and notification_escalation_admin_upgrade.sql.

begin;

create table if not exists public.notification_acknowledgement_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  enabled boolean not null default true,
  high_sla_minutes integer not null default 240 check(high_sla_minutes between 15 and 10080),
  urgent_sla_minutes integer not null default 30 check(urgent_sla_minutes between 5 and 1440),
  reminder_interval_minutes integer not null default 60 check(reminder_interval_minutes between 5 and 1440),
  max_reminders integer not null default 3 check(max_reminders between 1 and 10),
  escalate_after_reminders integer not null default 1 check(escalate_after_reminders between 1 and 10),
  updated_at timestamptz not null default now(),
  constraint acknowledgement_sla_order check(urgent_sla_minutes<high_sla_minutes and escalate_after_reminders<=max_reminders)
);

alter table public.user_notifications
  add column if not exists acknowledgement_due_at timestamptz,
  add column if not exists acknowledgement_overdue_at timestamptz,
  add column if not exists acknowledgement_reminder_count integer not null default 0,
  add column if not exists acknowledgement_last_reminded_at timestamptz;

create index if not exists user_notifications_ack_due on public.user_notifications(acknowledgement_due_at)
  where acknowledgement_required and acknowledged_at is null and dismissed_at is null;

alter table public.notification_acknowledgement_settings enable row level security;
drop policy if exists notification_ack_settings_company_read on public.notification_acknowledgement_settings;
create policy notification_ack_settings_company_read on public.notification_acknowledgement_settings for select to authenticated using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or p.company_id=notification_acknowledgement_settings.company_id))
);
revoke all on public.notification_acknowledgement_settings from anon;
grant select on public.notification_acknowledgement_settings to authenticated;

create or replace function public.set_notification_acknowledgement_settings(p_company_id uuid,p_enabled boolean,
  p_high_sla_minutes integer,p_urgent_sla_minutes integer,p_reminder_interval_minutes integer,p_max_reminders integer,p_escalate_after_reminders integer)
returns public.notification_acknowledgement_settings language plpgsql security definer set search_path=public as $$
declare actor public.profiles%rowtype; result public.notification_acknowledgement_settings%rowtype;
begin
  select * into actor from public.profiles where id=auth.uid();
  if not found or not(actor.role='sephs_admin' or (actor.company_id=p_company_id and actor.role in ('admin','hse_manager'))) then raise exception 'Only a company administrator or HSE manager can configure acknowledgement control'; end if;
  if p_high_sla_minutes not between 15 and 10080 or p_urgent_sla_minutes not between 5 and 1440 or p_urgent_sla_minutes>=p_high_sla_minutes
    or p_reminder_interval_minutes not between 5 and 1440 or p_max_reminders not between 1 and 10 or p_escalate_after_reminders not between 1 and p_max_reminders then raise exception 'Acknowledgement SLA settings are invalid'; end if;
  insert into public.notification_acknowledgement_settings(company_id,enabled,high_sla_minutes,urgent_sla_minutes,reminder_interval_minutes,max_reminders,escalate_after_reminders,updated_at)
  values(p_company_id,coalesce(p_enabled,true),p_high_sla_minutes,p_urgent_sla_minutes,p_reminder_interval_minutes,p_max_reminders,p_escalate_after_reminders,now())
  on conflict(company_id) do update set enabled=excluded.enabled,high_sla_minutes=excluded.high_sla_minutes,urgent_sla_minutes=excluded.urgent_sla_minutes,
    reminder_interval_minutes=excluded.reminder_interval_minutes,max_reminders=excluded.max_reminders,escalate_after_reminders=excluded.escalate_after_reminders,updated_at=now()
  returning * into result; return result;
end; $$;
revoke all on function public.set_notification_acknowledgement_settings(uuid,boolean,integer,integer,integer,integer,integer) from public,anon;
grant execute on function public.set_notification_acknowledgement_settings(uuid,boolean,integer,integer,integer,integer,integer) to authenticated;

create or replace function public.set_user_notification_ack_deadline()
returns trigger language plpgsql security definer set search_path=public as $$
declare cfg record; minutes_value integer;
begin
  if not new.acknowledgement_required or new.acknowledged_at is not null then return new; end if;
  select * into cfg from public.notification_acknowledgement_settings where company_id=new.company_id;
  if not found then
    minutes_value:=case when new.severity='urgent' then 30 else 240 end;
  elsif not cfg.enabled then return new;
  else minutes_value:=case when new.severity='urgent' then cfg.urgent_sla_minutes else cfg.high_sla_minutes end;
  end if;
  new.acknowledgement_due_at:=coalesce(new.acknowledgement_due_at,new.created_at,now())+make_interval(mins=>minutes_value);
  return new;
end; $$;
drop trigger if exists trg_set_user_notification_ack_deadline on public.user_notifications;
create trigger trg_set_user_notification_ack_deadline before insert on public.user_notifications for each row execute function public.set_user_notification_ack_deadline();

update public.user_notifications n set acknowledgement_due_at=coalesce(n.created_at,now())+make_interval(mins=>
  case when n.severity='urgent' then coalesce(s.urgent_sla_minutes,30) else coalesce(s.high_sla_minutes,240) end)
from public.notification_acknowledgement_settings s where s.company_id=n.company_id and s.enabled
  and n.acknowledgement_required and n.acknowledged_at is null and n.dismissed_at is null and n.acknowledgement_due_at is null;
update public.user_notifications n set acknowledgement_due_at=coalesce(n.created_at,now())+make_interval(mins=>case when n.severity='urgent' then 30 else 240 end)
where n.acknowledgement_required and n.acknowledged_at is null and n.dismissed_at is null and n.acknowledgement_due_at is null
  and not exists(select 1 from public.notification_acknowledgement_settings s where s.company_id=n.company_id);

create or replace function public.stop_acknowledgement_followups()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.acknowledged_at is null or old.acknowledged_at is not null then return new; end if;
  update public.notification_queue set status='skipped',error_msg='Alert was acknowledged before external delivery',locked_at=null,locked_by=null
    where id=new.source_notification_id and status='pending';
  update public.notification_queue set status='skipped',error_msg='Original alert was acknowledged',locked_at=null,locked_by=null
    where status='pending' and metadata->>'parent_user_notification_id'=new.id::text and type in ('acknowledgement_reminder','acknowledgement_escalation');
  update public.user_notifications u set dismissed_at=coalesce(u.dismissed_at,now()),updated_at=now()
    from public.notification_queue q where u.source_notification_id=q.id and q.metadata->>'parent_user_notification_id'=new.id::text and u.dismissed_at is null;
  return new;
end; $$;
drop trigger if exists trg_stop_acknowledgement_followups on public.user_notifications;
create trigger trg_stop_acknowledgement_followups after update of acknowledged_at on public.user_notifications for each row execute function public.stop_acknowledgement_followups();

create or replace function public.stop_action_acknowledgement_followups()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if lower(coalesce(new.status,'')) not in ('closed','cancelled','canceled','completed','complete','void') or lower(coalesce(new.status,''))=lower(coalesce(old.status,'')) then return new; end if;
  update public.notification_queue followup set status='skipped',error_msg='Source action is now '||new.status,locked_at=null,locked_by=null
    where followup.status='pending' and followup.type in ('acknowledgement_reminder','acknowledgement_escalation') and exists(
      select 1 from public.user_notifications original where original.id::text=followup.metadata->>'parent_user_notification_id'
        and original.company_id=new.company_id and original.related_table='action_tracker' and original.related_id=new.id);
  update public.user_notifications original set dismissed_at=coalesce(original.dismissed_at,now()),updated_at=now()
    where original.company_id=new.company_id and original.related_table='action_tracker' and original.related_id=new.id and original.dismissed_at is null;
  return new;
end; $$;
drop trigger if exists trg_stop_action_acknowledgement_followups on public.action_tracker;
create trigger trg_stop_action_acknowledgement_followups after update of status on public.action_tracker for each row execute function public.stop_action_acknowledgement_followups();

create or replace function public.process_notification_acknowledgement_slas(p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path=public as $$
declare original record; cfg public.notification_acknowledgement_settings%rowtype; recipient record; next_count integer; queued integer:=0; escalated integer:=0; queue_id uuid; event_level integer; email_value text;
begin
  for original in select n.* from public.user_notifications n
    where n.acknowledgement_required and n.acknowledged_at is null and n.dismissed_at is null and n.acknowledgement_due_at<=now()
      and (n.acknowledgement_last_reminded_at is null or n.acknowledgement_last_reminded_at<=now()-coalesce((select make_interval(mins=>s.reminder_interval_minutes) from public.notification_acknowledgement_settings s where s.company_id=n.company_id),interval '60 minutes'))
    order by n.acknowledgement_due_at limit greatest(1,least(coalesce(p_limit,500),2000))
  loop
    select * into cfg from public.notification_acknowledgement_settings where company_id=original.company_id;
    if found and not cfg.enabled then continue; end if;
    if original.related_table='action_tracker' and exists(select 1 from public.action_tracker a where a.id=original.related_id and lower(coalesce(a.status,'open')) in ('closed','cancelled','canceled','completed','complete','void')) then
      update public.user_notifications set dismissed_at=now(),updated_at=now() where id=original.id; continue;
    end if;
    next_count:=original.acknowledgement_reminder_count+1;
    if original.acknowledgement_overdue_at is null then
      insert into public.notification_events(company_id,notification_id,event_type,related_module,related_table,related_id,related_ref,actor_id,detail)
      values(original.company_id,original.source_notification_id,'acknowledgement_overdue',original.related_module,original.related_table,
        original.related_id,original.related_ref,null,jsonb_build_object('user_notification_id',original.id,'due_at',original.acknowledgement_due_at,'recipient_profile_id',original.recipient_profile_id));
    end if;
    if next_count<=coalesce(cfg.max_reminders,3) then
      select public.notification_best_email(array[p.real_email,p.email]) into email_value from public.profiles p where p.id=original.recipient_profile_id and p.company_id=original.company_id;
      insert into public.notification_queue(company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,status,channel,priority,related_id,related_table,related_module,related_ref,record_url,metadata,idempotency_key,next_attempt_at)
      select original.company_id,original.recipient_profile_id,'acknowledgement_reminder','[AURIS360] Response overdue: '||original.title,
        '<p>Your acknowledgement is overdue.</p><p><a href="'||coalesce(original.record_url,'https://auris360.app/')||'">Open the exact record and acknowledge</a></p>',email_value,p.full_name,'pending','email',original.severity,
        original.related_id,original.related_table,original.related_module,original.related_ref,original.record_url,
        jsonb_build_object('parent_user_notification_id',original.id,'reminder_number',next_count,'acknowledgement_required',false,'relationship',jsonb_build_object('module',original.related_module,'table',original.related_table,'id',original.related_id,'ref',original.related_ref,'company_id',original.company_id,'url',original.record_url)),
        'ack-reminder/'||original.id::text||'/'||next_count::text,now() from public.profiles p where p.id=original.recipient_profile_id
      on conflict(company_id,idempotency_key) where idempotency_key is not null do update set idempotency_key=excluded.idempotency_key returning id into queue_id;
      queued:=queued+1;
    end if;
    update public.user_notifications set acknowledgement_overdue_at=coalesce(acknowledgement_overdue_at,now()),acknowledgement_reminder_count=next_count,acknowledgement_last_reminded_at=now(),updated_at=now() where id=original.id and acknowledged_at is null;
    if next_count>=coalesce(cfg.escalate_after_reminders,1) and next_count<=coalesce(cfg.max_reminders,3) then
      event_level:=case when original.severity='urgent' then 3 else 2 end;
      for recipient in
        with explicit as (
          select er.profile_id,coalesce(er.display_name,p.full_name,er.email_override) name,public.notification_best_email(array[er.email_override,p.real_email,p.email]) email
          from public.notification_escalation_recipients er left join public.profiles p on p.id=er.profile_id and p.company_id=er.company_id
          where er.company_id=original.company_id and er.active and er.escalation_level=event_level
        ), fallback as (
          select p.id profile_id,p.full_name name,public.notification_best_email(array[p.real_email,p.email]) email from public.profiles p
          where p.company_id=original.company_id and not exists(select 1 from explicit where email is not null)
            and case when event_level=2 then p.role in ('manager','hse_manager') else p.role in ('executive','director','company_admin','admin','hse_manager') end
            and public.notification_best_email(array[p.real_email,p.email]) is not null order by p.full_name,p.id limit 1
        ) select * from explicit where email is not null union all select * from fallback
      loop
        insert into public.notification_queue(company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,status,channel,priority,related_id,related_table,related_module,related_ref,record_url,metadata,idempotency_key,next_attempt_at)
        values(original.company_id,recipient.profile_id,'acknowledgement_escalation','[AURIS360] Unacknowledged alert requires attention: '||original.title,
          '<p>A required acknowledgement remains overdue after '||next_count||' reminder(s).</p><p><a href="'||coalesce(original.record_url,'https://auris360.app/')||'">Open exact source record</a></p>',recipient.email,recipient.name,'pending','email',original.severity,
          original.related_id,original.related_table,original.related_module,original.related_ref,original.record_url,
          jsonb_build_object('parent_user_notification_id',original.id,'escalation_level',event_level,'reminder_number',next_count,'acknowledgement_required',false,'relationship',jsonb_build_object('module',original.related_module,'table',original.related_table,'id',original.related_id,'ref',original.related_ref,'company_id',original.company_id,'url',original.record_url)),
          'ack-escalation/'||original.id::text||'/'||next_count::text||'/'||coalesce(recipient.profile_id::text,lower(recipient.email)),now())
        on conflict(company_id,idempotency_key) where idempotency_key is not null do update set idempotency_key=excluded.idempotency_key;
        escalated:=escalated+1;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('reminders_queued',queued,'hierarchy_escalations_queued',escalated);
end; $$;
revoke all on function public.process_notification_acknowledgement_slas(integer) from public,anon,authenticated;
grant execute on function public.process_notification_acknowledgement_slas(integer) to service_role;

commit;
notify pgrst, 'reload schema';
