-- AURIS360 Modular Foundation Phase 19: governed tenant automation.
begin;

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check(char_length(name) between 1 and 100),
  module_key text not null check(module_key='actions'),
  trigger_type text not null check(trigger_type='action_due'),
  trigger_config jsonb not null default '{}'::jsonb,
  action_type text not null check(action_type in ('reminder','escalation')),
  action_config jsonb not null default '{}'::jsonb,
  interval_minutes integer not null default 1440 check(interval_minutes between 5 and 10080),
  status text not null default 'draft' check(status in ('draft','active','paused')),
  next_run_at timestamptz,
  revision integer not null default 1 check(revision>0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);

create index if not exists automation_rules_due_idx on public.automation_rules(status,next_run_at) where status='active';
create index if not exists automation_rules_company_idx on public.automation_rules(company_id,updated_at desc);

create table if not exists public.automation_executions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  source_module text not null check(source_module='actions'),
  source_table text not null check(source_table='action_tracker'),
  source_record_id uuid not null,
  source_ref text,
  event_key text not null,
  recipient_key text not null,
  status text not null check(status in ('queued','skipped','failed')),
  notification_id uuid references public.notification_queue(id) on delete set null,
  failure_code text,
  scheduled_for timestamptz not null,
  created_at timestamptz not null default now(),
  unique(rule_id,source_record_id,event_key,recipient_key)
);

create index if not exists automation_executions_company_time_idx on public.automation_executions(company_id,created_at desc);
alter table public.automation_rules enable row level security;
alter table public.automation_executions enable row level security;

drop policy if exists automation_rules_company_admin on public.automation_rules;
create policy automation_rules_company_admin on public.automation_rules for select using (
  exists(select 1 from public.profiles actor where actor.id=auth.uid() and (actor.role='sephs_admin' or (actor.company_id=automation_rules.company_id and actor.role in ('admin','hse_manager'))))
);
drop policy if exists automation_executions_company_admin on public.automation_executions;
create policy automation_executions_company_admin on public.automation_executions for select using (
  exists(select 1 from public.profiles actor where actor.id=auth.uid() and (actor.role='sephs_admin' or (actor.company_id=automation_executions.company_id and actor.role in ('admin','hse_manager'))))
);

revoke all on public.automation_rules,public.automation_executions from public,anon;
grant select on public.automation_rules,public.automation_executions to authenticated;

create or replace function public.automation_require_admin(p_company_id uuid)
returns public.profiles language plpgsql security definer set search_path=public as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles where id=auth.uid();
  if actor.id is null or not(actor.role='sephs_admin' or (actor.company_id=p_company_id and actor.role in ('admin','hse_manager'))) then raise exception 'Automation administration is not permitted for this company'; end if;
  return actor;
end;
$$;

create or replace function public.save_automation_rule(
  p_rule_id uuid,p_company_id uuid,p_name text,p_module_key text,p_trigger_type text,
  p_trigger_config jsonb,p_action_type text,p_action_config jsonb,p_interval_minutes integer,p_expected_revision integer
) returns setof public.automation_rules language plpgsql security definer set search_path=public as $$
declare actor public.profiles; saved public.automation_rules; unsupported text;
begin
  actor:=public.automation_require_admin(p_company_id);
  if p_module_key<>'actions' or p_trigger_type<>'action_due' or p_action_type not in ('reminder','escalation') then raise exception 'Unsupported automation contract'; end if;
  if char_length(trim(coalesce(p_name,''))) not between 1 and 100 or p_interval_minutes not between 5 and 10080 then raise exception 'Invalid automation name or interval'; end if;
  select key into unsupported from jsonb_object_keys(coalesce(p_trigger_config,'{}')) key where key not in ('lead_days','overdue_days') limit 1;
  if unsupported is not null then raise exception 'Unsupported trigger field: %',unsupported; end if;
  select key into unsupported from jsonb_object_keys(coalesce(p_action_config,'{}')) key where key not in ('escalation_level') limit 1;
  if unsupported is not null then raise exception 'Unsupported action field: %',unsupported; end if;
  if coalesce((p_trigger_config->>'lead_days')::integer,7) not between 0 and 90 or coalesce((p_trigger_config->>'overdue_days')::integer,0) not between 0 and 365 then raise exception 'Invalid due-date thresholds'; end if;
  if p_action_type='escalation' and coalesce((p_action_config->>'escalation_level')::integer,0) not between 1 and 3 then raise exception 'Invalid escalation level'; end if;
  if p_rule_id is null then
    insert into public.automation_rules(company_id,name,module_key,trigger_type,trigger_config,action_type,action_config,interval_minutes,status,created_by,updated_by)
    values(p_company_id,trim(p_name),p_module_key,p_trigger_type,p_trigger_config,p_action_type,p_action_config,p_interval_minutes,'draft',actor.id,actor.id) returning * into saved;
  else
    update public.automation_rules set name=trim(p_name),trigger_config=p_trigger_config,action_type=p_action_type,action_config=p_action_config,interval_minutes=p_interval_minutes,revision=revision+1,updated_by=actor.id,updated_at=now()
    where id=p_rule_id and company_id=p_company_id and revision=p_expected_revision returning * into saved;
    if saved.id is null then raise exception 'Automation rule changed or belongs to another company'; end if;
  end if;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code)
  values(p_company_id,actor.id,actor.full_name,actor.role,'automation_rule_saved','administration','automation_rules',saved.id,'Automation rule draft saved',jsonb_build_object('revision',saved.revision,'status',saved.status),'automation.rule_saved');
  return next saved;
end;
$$;

create or replace function public.set_automation_rule_status(p_rule_id uuid,p_company_id uuid,p_status text,p_expected_revision integer)
returns setof public.automation_rules language plpgsql security definer set search_path=public as $$
declare actor public.profiles; saved public.automation_rules;
begin
  actor:=public.automation_require_admin(p_company_id);
  if p_status not in ('active','paused') then raise exception 'Automation status must be active or paused'; end if;
  update public.automation_rules set status=p_status,next_run_at=case when p_status='active' then now() else null end,revision=revision+1,updated_by=actor.id,updated_at=now()
  where id=p_rule_id and company_id=p_company_id and revision=p_expected_revision returning * into saved;
  if saved.id is null then raise exception 'Automation rule changed or belongs to another company'; end if;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code)
  values(p_company_id,actor.id,actor.full_name,actor.role,'automation_rule_'||p_status,'administration','automation_rules',saved.id,'Automation rule status changed to '||p_status,jsonb_build_object('revision',saved.revision),'automation.rule_'||p_status);
  return next saved;
end;
$$;

create or replace function public.process_due_automation_rules(p_now timestamptz default now(),p_limit integer default 200)
returns jsonb language plpgsql security definer set search_path=public as $$
declare rule_row public.automation_rules; action_row record; recipient_row record; notification_uuid uuid; event_value text; inserted_count integer; queued_count integer:=0; skipped_count integer:=0; rule_count integer:=0; url_value text; subject_value text;
begin
  for rule_row in select * from public.automation_rules where status='active' and next_run_at<=p_now order by next_run_at for update skip locked limit greatest(1,least(coalesce(p_limit,200),500)) loop
    rule_count:=rule_count+1;
    for action_row in select a.* from public.action_tracker a where a.company_id=rule_row.company_id and a.target_date is not null and lower(coalesce(a.status,'open')) not in ('closed','cancelled','canceled','completed','complete','void') and a.target_date<=p_now::date+coalesce((rule_row.trigger_config->>'lead_days')::integer,7) and (coalesce((rule_row.trigger_config->>'overdue_days')::integer,0)=0 or a.target_date<=p_now::date-coalesce((rule_row.trigger_config->>'overdue_days')::integer,0)) order by a.target_date limit 500 loop
      for recipient_row in
        with assignee as (
          select p.id profile_id,p.full_name recipient_name,coalesce(nullif(trim(p.real_email),''),nullif(trim(p.email),'')) recipient_email from public.profiles p where p.company_id=rule_row.company_id and p.id=action_row.assigned_to_id
          union all select p.id,p.full_name,coalesce(nullif(trim(p.real_email),''),nullif(trim(p.email),'')) from public.people person join public.profiles p on p.company_id=person.company_id and lower(p.email)=lower(person.email) where person.company_id=rule_row.company_id and person.id=action_row.assigned_to_id
        ), escalation as (
          select p.id profile_id,coalesce(er.display_name,p.full_name) recipient_name,coalesce(nullif(trim(er.email_override),''),nullif(trim(p.real_email),''),nullif(trim(p.email),'')) recipient_email from public.notification_escalation_recipients er left join public.profiles p on p.id=er.profile_id and p.company_id=er.company_id where er.company_id=rule_row.company_id and er.active and er.escalation_level=coalesce((rule_row.action_config->>'escalation_level')::integer,1)
          union all select p.id,p.full_name,coalesce(nullif(trim(p.real_email),''),nullif(trim(p.email),'')) from public.profiles p where p.company_id=rule_row.company_id and p.role in ('admin','hse_manager') and not exists(select 1 from public.notification_escalation_recipients er where er.company_id=rule_row.company_id and er.active and er.escalation_level=coalesce((rule_row.action_config->>'escalation_level')::integer,1))
        ) select distinct on(recipient_email) * from (select * from assignee where rule_row.action_type='reminder' union all select * from escalation where rule_row.action_type='escalation') recipients where recipient_email is not null order by recipient_email
      loop
        event_value:=rule_row.id::text||'/'||action_row.target_date::text||'/'||p_now::date::text||'/'||rule_row.action_type;
        insert into public.automation_executions(company_id,rule_id,source_module,source_table,source_record_id,source_ref,event_key,recipient_key,status,scheduled_for)
        values(rule_row.company_id,rule_row.id,'actions','action_tracker',action_row.id,coalesce(action_row.action_ref,action_row.source_ref,action_row.id::text),event_value,md5(lower(recipient_row.recipient_email)),'queued',p_now)
        on conflict(rule_id,source_record_id,event_key,recipient_key) do nothing;
        get diagnostics inserted_count=row_count;
        if inserted_count=0 then continue; end if;
        url_value:='https://auris360.app/?goto=actions&record='||action_row.id::text||'&table=action_tracker&company='||rule_row.company_id::text;
        subject_value:='[AURIS360] '||case when rule_row.action_type='escalation' then 'Escalation' else 'Reminder' end||': '||coalesce(action_row.action_ref,action_row.source_ref,'Action due');
        insert into public.notification_queue(company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,status,channel,priority,related_id,related_table,related_module,related_ref,record_url,metadata,idempotency_key,next_attempt_at)
        values(rule_row.company_id,recipient_row.profile_id,'automation_'||rule_row.action_type,subject_value,'<p>'||replace(replace(replace(coalesce(action_row.title,action_row.description,'Action requires attention'),'&','&amp;'),'<','&lt;'),'>','&gt;')||'</p><p><a href="'||url_value||'">Open exact action</a></p>',recipient_row.recipient_email,recipient_row.recipient_name,'pending','email',case when rule_row.action_type='escalation' then 'high' else 'normal' end,action_row.id,'action_tracker','actions',coalesce(action_row.action_ref,action_row.source_ref,action_row.id::text),url_value,jsonb_build_object('automation_rule_id',rule_row.id,'relationship',jsonb_build_object('module','actions','table','action_tracker','id',action_row.id,'company_id',rule_row.company_id,'url',url_value)),'automation/'||event_value||'/'||md5(lower(recipient_row.recipient_email)),now())
        on conflict(company_id,idempotency_key) where idempotency_key is not null do update set idempotency_key=excluded.idempotency_key returning id into notification_uuid;
        update public.automation_executions set notification_id=notification_uuid where rule_id=rule_row.id and source_record_id=action_row.id and event_key=event_value and recipient_key=md5(lower(recipient_row.recipient_email));
        queued_count:=queued_count+1;
      end loop;
      if not found then
        insert into public.automation_executions(company_id,rule_id,source_module,source_table,source_record_id,source_ref,event_key,recipient_key,status,failure_code,scheduled_for)
        values(rule_row.company_id,rule_row.id,'actions','action_tracker',action_row.id,coalesce(action_row.action_ref,action_row.source_ref,action_row.id::text),rule_row.id::text||'/'||action_row.target_date::text||'/'||p_now::date::text||'/'||rule_row.action_type,'no-recipient','skipped','recipient_unavailable',p_now) on conflict do nothing;
        skipped_count:=skipped_count+1;
      end if;
    end loop;
    update public.automation_rules set next_run_at=p_now+make_interval(mins=>rule_row.interval_minutes),updated_at=now() where id=rule_row.id and status='active';
  end loop;
  return jsonb_build_object('rules',rule_count,'queued',queued_count,'skipped',skipped_count,'processed_at',p_now);
end;
$$;

revoke all on function public.automation_require_admin(uuid) from public,anon,authenticated;
revoke all on function public.save_automation_rule(uuid,uuid,text,text,text,jsonb,text,jsonb,integer,integer) from public,anon;
revoke all on function public.set_automation_rule_status(uuid,uuid,text,integer) from public,anon;
revoke all on function public.process_due_automation_rules(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.save_automation_rule(uuid,uuid,text,text,text,jsonb,text,jsonb,integer,integer) to authenticated;
grant execute on function public.set_automation_rule_status(uuid,uuid,text,integer) to authenticated;
grant execute on function public.process_due_automation_rules(timestamptz,integer) to service_role;

commit;
