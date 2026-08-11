-- AURIS360 automatic Master Action Plan notification escalation.
-- Rerunnable. Apply after master_action_plan_schema_upgrade.sql,
-- notification_relationships_upgrade.sql and notification_delivery_reliability_upgrade.sql.

begin;

-- Keep the migration self-contained for installations that used the older
-- notification queue bundle but have not yet applied professional_foundations.
alter table public.notification_queue
  add column if not exists channel text not null default 'email',
  add column if not exists priority text not null default 'normal',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.profiles
  add column if not exists real_email text;

create table if not exists public.notification_escalation_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  enabled boolean not null default true,
  due_soon_days integer not null default 7,
  level_1_overdue_days integer not null default 7,
  level_2_overdue_days integer not null default 21,
  level_3_overdue_days integer not null default 45,
  updated_at timestamptz not null default now(),
  constraint notification_escalation_threshold_order check (
    due_soon_days between 0 and 90
    and level_1_overdue_days >= 1
    and level_2_overdue_days > level_1_overdue_days
    and level_3_overdue_days > level_2_overdue_days
  )
);

-- Explicit recipients take precedence over role-based fallbacks. This allows a
-- company to configure its real reporting hierarchy without notifying every
-- user who happens to share a role.
create table if not exists public.notification_escalation_recipients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  escalation_level integer not null check (escalation_level between 1 and 3),
  profile_id uuid references public.profiles(id) on delete cascade,
  display_name text,
  email_override text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_escalation_recipient_target check (
    profile_id is not null or nullif(trim(email_override), '') is not null
  )
);

create unique index if not exists notification_escalation_recipient_profile_uq
  on public.notification_escalation_recipients(company_id, escalation_level, profile_id)
  where profile_id is not null;

create table if not exists public.action_notification_escalation_state (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  action_id uuid not null references public.action_tracker(id) on delete cascade,
  event_key text not null,
  escalation_level integer not null check (escalation_level between 0 and 3),
  recipient_email text not null,
  notification_id uuid references public.notification_queue(id) on delete set null,
  processed_at timestamptz not null default now(),
  unique(action_id, event_key, recipient_email)
);

create index if not exists action_notification_escalation_company_time
  on public.action_notification_escalation_state(company_id, processed_at desc);

alter table public.notification_escalation_settings enable row level security;
alter table public.notification_escalation_recipients enable row level security;
alter table public.action_notification_escalation_state enable row level security;

drop policy if exists notification_escalation_settings_admin on public.notification_escalation_settings;
create policy notification_escalation_settings_admin on public.notification_escalation_settings
for all using (
  exists(select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=notification_escalation_settings.company_id and p.role in ('admin','hse_manager'))))
) with check (
  exists(select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=notification_escalation_settings.company_id and p.role in ('admin','hse_manager'))))
);

drop policy if exists notification_escalation_recipients_admin on public.notification_escalation_recipients;
create policy notification_escalation_recipients_admin on public.notification_escalation_recipients
for all using (
  exists(select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=notification_escalation_recipients.company_id and p.role in ('admin','hse_manager'))))
) with check (
  exists(select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=notification_escalation_recipients.company_id and p.role in ('admin','hse_manager'))))
);

drop policy if exists action_notification_escalation_state_company on public.action_notification_escalation_state;
create policy action_notification_escalation_state_company on public.action_notification_escalation_state
for select using (
  exists(select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or p.company_id=action_notification_escalation_state.company_id))
);

grant select,insert,update,delete on public.notification_escalation_settings to authenticated;
grant select,insert,update,delete on public.notification_escalation_recipients to authenticated;
grant select on public.action_notification_escalation_state to authenticated;

create or replace function public.notification_deliverable_email(value text)
returns boolean language sql immutable as $$
  select coalesce(trim(value),'') ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and lower(trim(value)) not like '%.local'
$$;

create or replace function public.notification_best_email(values_to_check text[])
returns text language sql immutable as $$
  select lower(trim(candidate))
  from unnest(coalesce(values_to_check,'{}'::text[])) with ordinality as item(candidate, position)
  where public.notification_deliverable_email(candidate)
  order by position
  limit 1
$$;

create or replace function public.notification_html_escape(value text)
returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(value,''),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;')
$$;

create or replace function public.process_action_notification_escalations(
  p_run_date date default current_date,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  action_row record;
  recipient_row record;
  notification_uuid uuid;
  event_name text;
  event_key_value text;
  event_label text;
  priority_value text;
  escalation_level_value integer;
  overdue_days integer;
  action_count integer:=0;
  notification_count integer:=0;
  skipped_recipient_count integer:=0;
  recipient_names text[];
  inserted_state integer;
  record_url_value text;
  body_value text;
begin
  for action_row in
    select a.*,
      coalesce(s.due_soon_days,7) as cfg_due_soon,
      coalesce(s.level_1_overdue_days,7) as cfg_level_1,
      coalesce(s.level_2_overdue_days,21) as cfg_level_2,
      coalesce(s.level_3_overdue_days,45) as cfg_level_3
    from public.action_tracker a
    left join public.notification_escalation_settings s on s.company_id=a.company_id
    where a.target_date is not null
      and lower(coalesce(a.status,'open')) not in ('closed','cancelled','canceled','completed','complete','void')
      and coalesce(s.enabled,true)
      and a.target_date <= p_run_date + coalesce(s.due_soon_days,7)
    order by a.target_date,a.created_at
    limit greatest(1,least(coalesce(p_limit,500),2000))
  loop
    overdue_days:=p_run_date-action_row.target_date;
    if overdue_days >= action_row.cfg_level_3 then
      event_name:='overdue_level_3'; escalation_level_value:=3; priority_value:='urgent';
      event_label:='Level 3 executive escalation - '||overdue_days||' days overdue';
    elsif overdue_days >= action_row.cfg_level_2 then
      event_name:='overdue_level_2'; escalation_level_value:=2; priority_value:='urgent';
      event_label:='Level 2 management escalation - '||overdue_days||' days overdue';
    elsif overdue_days >= action_row.cfg_level_1 then
      event_name:='overdue_level_1'; escalation_level_value:=1; priority_value:='high';
      event_label:='Level 1 supervisor escalation - '||overdue_days||' days overdue';
    elsif overdue_days >= 1 then
      event_name:='overdue_initial'; escalation_level_value:=0; priority_value:='high';
      event_label:='Action overdue by '||overdue_days||case when overdue_days=1 then ' day' else ' days' end;
    elsif action_row.target_date >= p_run_date then
      event_name:='due_soon'; escalation_level_value:=0; priority_value:='normal';
      event_label:='Action due in '||(action_row.target_date-p_run_date)||case when action_row.target_date-p_run_date=1 then ' day' else ' days' end;
    else
      continue;
    end if;

    event_key_value:=event_name||':'||action_row.target_date::text;
    record_url_value:='https://auris-360.vercel.app/?goto=actions&record='||action_row.id::text||'&table=action_tracker&company='||action_row.company_id::text;
    recipient_names:=array[]::text[];
    action_count:=action_count+1;

    for recipient_row in
      with assignee_person as (
        select p.* from public.people p where p.id=action_row.assigned_to_id and p.company_id=action_row.company_id limit 1
      ),
      assignee_profile as (
        select pr.* from public.profiles pr
        left join assignee_person ap on true
        where pr.company_id=action_row.company_id and (
          pr.id=action_row.assigned_to_id
          or (nullif(trim(ap.email),'') is not null and lower(pr.email)=lower(ap.email))
          or regexp_replace(lower(coalesce(pr.full_name,'')),'[^a-z0-9]+','','g')=
             regexp_replace(lower(coalesce(action_row.assigned_to_name,action_row.responsible,'')),'[^a-z0-9]+','','g')
        )
        order by case when pr.id=action_row.assigned_to_id then 0 else 1 end
        limit 1
      ),
      explicit_recipients as (
        select er.escalation_level,
          coalesce(nullif(trim(er.display_name),''),pr.full_name,er.email_override) as recipient_name,
          public.notification_best_email(array[er.email_override,pr.real_email,pr.email]) as recipient_email
        from public.notification_escalation_recipients er
        left join public.profiles pr on pr.id=er.profile_id and pr.company_id=er.company_id
        where er.company_id=action_row.company_id and er.active
          and er.escalation_level between 1 and escalation_level_value
      ),
      fallback_recipients as (
        select level_value as escalation_level,pr.full_name as recipient_name,
          public.notification_best_email(array[pr.real_email,pr.email]) as recipient_email
        from generate_series(1,escalation_level_value) level_value
        join lateral (
          select p.* from public.profiles p
          where p.company_id=action_row.company_id
            and case level_value
              when 1 then p.role in ('supervisor','site_manager')
              when 2 then p.role in ('manager','hse_manager')
              when 3 then p.role in ('executive','director','company_admin','admin','hse_manager')
              else false end
            and public.notification_best_email(array[p.real_email,p.email]) is not null
          order by case p.role
            when 'supervisor' then 1 when 'manager' then 1
            when 'executive' then 1 when 'director' then 1 when 'company_admin' then 1 when 'admin' then 1
            else 2 end,p.full_name,p.id
          limit 1
        ) pr on true
        where not exists(
          select 1 from public.notification_escalation_recipients configured
          left join public.profiles configured_profile
            on configured_profile.id=configured.profile_id and configured_profile.company_id=configured.company_id
          where configured.company_id=action_row.company_id and configured.active
            and configured.escalation_level=level_value
            and public.notification_best_email(array[configured.email_override,configured_profile.real_email,configured_profile.email]) is not null
        )
      ),
      candidates as (
        select 0 as escalation_level,
          coalesce(apf.full_name,concat_ws(' ',ap.first_name,ap.last_name),action_row.assigned_to_name,action_row.responsible,'Assigned person') as recipient_name,
          public.notification_best_email(array[apf.real_email,apf.email,ap.email]) as recipient_email
        from (select 1) seed
        left join assignee_person ap on true
        left join assignee_profile apf on true
        union all select * from explicit_recipients
        union all select * from fallback_recipients
      )
      select distinct on (recipient_email) escalation_level,recipient_name,recipient_email
      from candidates
      where recipient_email is not null
      order by recipient_email,escalation_level desc
    loop
      if exists(
        select 1 from public.action_notification_escalation_state st
        where st.action_id=action_row.id and st.event_key=event_key_value
          and lower(st.recipient_email)=lower(recipient_row.recipient_email)
      ) then
        continue;
      end if;

      body_value:='<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f4f6f8;padding:20px">'
        ||'<div style="max-width:640px;margin:auto;background:#fff;border-radius:12px;overflow:hidden">'
        ||'<div style="background:#0b7f61;color:#fff;padding:18px 22px"><strong>AURIS360</strong><br>Master Action Plan notification</div>'
        ||'<div style="padding:22px"><h2 style="margin-top:0">'||public.notification_html_escape(event_label)||'</h2>'
        ||'<p><strong>Reference:</strong> '||public.notification_html_escape(coalesce(action_row.action_ref,action_row.source_ref,action_row.id::text))||'</p>'
        ||'<p><strong>Action:</strong> '||public.notification_html_escape(coalesce(action_row.title,action_row.description,'Action'))||'</p>'
        ||'<p><strong>Due date:</strong> '||action_row.target_date::text||'</p>'
        ||'<p><strong>Current status:</strong> '||public.notification_html_escape(coalesce(action_row.status,'open'))||'</p>'
        ||'<p style="text-align:center;margin-top:22px"><a href="'||record_url_value||'" style="background:#0b7f61;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none">Open exact action</a></p>'
        ||'</div></div></body></html>';

      insert into public.notification_queue(
        company_id,type,subject,body_html,to_email,to_name,status,channel,priority,
        related_id,related_table,related_module,related_ref,record_url,metadata,
        idempotency_key,next_attempt_at
      ) values (
        action_row.company_id,
        case when event_name='due_soon' then 'action_due_soon' else 'action_overdue' end,
        '[AURIS360] '||event_label||': '||coalesce(action_row.action_ref,action_row.source_ref,'Action'),
        body_value,recipient_row.recipient_email,recipient_row.recipient_name,'pending','email',priority_value,
        action_row.id,'action_tracker','actions',coalesce(action_row.action_ref,action_row.source_ref,action_row.id::text),
        record_url_value,
        jsonb_build_object('event',event_name,'escalation_level',escalation_level_value,'target_date',action_row.target_date,'relationship',jsonb_build_object('module','actions','table','action_tracker','id',action_row.id,'ref',coalesce(action_row.action_ref,action_row.source_ref,action_row.id::text),'company_id',action_row.company_id,'url',record_url_value)),
        'action-escalation/'||action_row.id::text||'/'||event_key_value||'/'||lower(recipient_row.recipient_email),now()
      )
      on conflict (company_id,idempotency_key) where idempotency_key is not null
      do update set idempotency_key=excluded.idempotency_key
      returning id into notification_uuid;

      insert into public.action_notification_escalation_state(
        company_id,action_id,event_key,escalation_level,recipient_email,notification_id
      ) values (
        action_row.company_id,action_row.id,event_key_value,escalation_level_value,
        recipient_row.recipient_email,notification_uuid
      ) on conflict(action_id,event_key,recipient_email) do nothing;
      get diagnostics inserted_state=row_count;
      if inserted_state>0 then
        notification_count:=notification_count+1;
        recipient_names:=array_append(recipient_names,recipient_row.recipient_name);
      end if;
    end loop;

    if coalesce(array_length(recipient_names,1),0)=0 then
      skipped_recipient_count:=skipped_recipient_count+1;
    end if;

    if escalation_level_value>0 and escalation_level_value>coalesce(action_row.escalation_level,0) then
      update public.action_tracker set
        escalated=true,
        escalation_level=escalation_level_value,
        escalated_to=coalesce(array_to_string(recipient_names,', '),escalated_to),
        escalation_reason='Automatic '||event_label,
        escalated_at=now(),updated_at=now()
      where id=action_row.id and company_id=action_row.company_id
        and lower(coalesce(status,'open')) not in ('closed','cancelled','canceled','completed','complete','void');

      if to_regclass('public.map_activity_log') is not null then
        execute 'insert into public.map_activity_log(company_id,action_id,activity_type,performed_by,old_value,new_value,notes) values ($1,$2,$3,$4,$5,$6,$7)'
        using action_row.company_id,action_row.id,'Automatic escalation to Level '||escalation_level_value,
          'AURIS360 notification engine',coalesce(action_row.escalation_level,0)::text,escalation_level_value::text,event_label;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'run_date',p_run_date,'actions_evaluated',action_count,
    'notifications_queued',notification_count,'actions_without_deliverable_recipient',skipped_recipient_count
  );
end;
$$;

revoke all on function public.process_action_notification_escalations(date,integer) from public;
revoke all on function public.process_action_notification_escalations(date,integer) from anon;
revoke all on function public.process_action_notification_escalations(date,integer) from authenticated;
grant execute on function public.process_action_notification_escalations(date,integer) to service_role;

comment on function public.process_action_notification_escalations(date,integer) is
  'Service-role-only idempotent due-soon and 7/21/45-day Master Action Plan escalation processor.';

commit;

notify pgrst, 'reload schema';
