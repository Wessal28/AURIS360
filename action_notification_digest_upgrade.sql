-- AURIS360 daily overdue-action digest and notification stop rules.
-- Apply after action_notification_escalation_upgrade.sql and the in-app/push/
-- WhatsApp notification migrations. Safe and rerunnable.

begin;

create table if not exists public.action_digest_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  run_date date not null,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  notification_id uuid references public.notification_queue(id) on delete set null,
  action_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique(company_id,run_date,recipient_profile_id)
);

alter table public.action_digest_runs enable row level security;
drop policy if exists action_digest_runs_company_read on public.action_digest_runs;
create policy action_digest_runs_company_read on public.action_digest_runs
for select to authenticated using (
  recipient_profile_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=action_digest_runs.company_id and p.role in ('admin','hse_manager','hse_officer'))))
);
revoke all on public.action_digest_runs from anon;
grant select on public.action_digest_runs to authenticated;

create or replace function public.process_action_overdue_digests(
  p_run_date date default current_date,
  p_company_id uuid default null,
  p_limit integer default 1000
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare recipient_row record; notification_uuid uuid; digest_count integer:=0; action_total integer:=0;
  body_value text; first_action_id uuid; first_action_ref text;
begin
  for recipient_row in
    with eligible as (
      select distinct p.company_id,p.id as profile_id,p.full_name,
        public.notification_best_email(array[p.real_email,p.email]) as recipient_email
      from public.profiles p
      join public.notification_settings ns on ns.company_id=p.company_id
      where (p_company_id is null or p.company_id=p_company_id)
        and coalesce(ns.email_enabled,true) and coalesce(ns.notify_on_overdue,true)
        and public.notification_best_email(array[p.real_email,p.email]) is not null
    )
    select e.*,
      count(a.id)::integer as action_count,
      min(a.id::text)::uuid as first_id,
      min(coalesce(a.action_ref,a.source_ref,a.id::text)) as first_ref,
      string_agg(
        '<tr><td style="padding:9px;border-bottom:1px solid #e5e7eb"><a href="https://auris360.app/?goto=actions&amp;record='||a.id::text||'&amp;table=action_tracker&amp;company='||a.company_id::text||'">'||
        public.notification_html_escape(coalesce(a.action_ref,a.source_ref,a.id::text))||'</a></td><td style="padding:9px;border-bottom:1px solid #e5e7eb">'||
        public.notification_html_escape(coalesce(a.title,a.description,'Action'))||'</td><td style="padding:9px;border-bottom:1px solid #e5e7eb">'||
        a.target_date::text||'</td><td style="padding:9px;border-bottom:1px solid #e5e7eb;color:#b91c1c;font-weight:700">'||
        (p_run_date-a.target_date)::text||' day(s)</td></tr>', '' order by a.target_date,a.created_at
      ) as action_rows
    from eligible e
    join public.action_tracker a on a.company_id=e.company_id
      and a.target_date<p_run_date
      and lower(coalesce(a.status,'open')) not in ('closed','cancelled','canceled','completed','complete','void')
      and (
        a.assigned_to_id=e.profile_id
        or regexp_replace(lower(coalesce(a.assigned_to_name,a.responsible,'')),'[^a-z0-9]+','','g')=
           regexp_replace(lower(coalesce(e.full_name,'')),'[^a-z0-9]+','','g')
        or exists(select 1 from public.people person where person.id=a.assigned_to_id and person.company_id=a.company_id
          and lower(coalesce(person.email,''))=lower(e.recipient_email))
      )
    where not exists(select 1 from public.action_digest_runs r where r.company_id=e.company_id
      and r.run_date=p_run_date and r.recipient_profile_id=e.profile_id)
    group by e.company_id,e.profile_id,e.full_name,e.recipient_email
    order by e.company_id,e.full_name
    limit greatest(1,least(coalesce(p_limit,1000),5000))
  loop
    first_action_id:=recipient_row.first_id; first_action_ref:=coalesce(recipient_row.first_ref,first_action_id::text);
    body_value:='<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f4f6f8;padding:20px"><div style="max-width:760px;margin:auto;background:#fff;border-radius:12px;overflow:hidden">'
      ||'<div style="background:#0b7f61;color:#fff;padding:18px 22px"><strong>AURIS360</strong><br>Daily overdue action digest</div><div style="padding:22px">'
      ||'<h2 style="margin-top:0">'||recipient_row.action_count||' overdue action(s)</h2><p>This summary is recalculated from currently open actions. Closed or cancelled actions are excluded.</p>'
      ||'<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f8fafc"><th style="padding:9px;text-align:left">Reference</th><th style="padding:9px;text-align:left">Action</th><th style="padding:9px;text-align:left">Due</th><th style="padding:9px;text-align:left">Overdue</th></tr></thead><tbody>'
      ||recipient_row.action_rows||'</tbody></table><p style="text-align:center;margin-top:22px"><a href="https://auris360.app/?goto=actions" style="background:#0b7f61;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none">Open Master Action Plan</a></p>'
      ||'</div></div></body></html>';

    insert into public.notification_queue(company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,status,
      channel,priority,related_id,related_table,related_module,related_ref,record_url,metadata,idempotency_key,next_attempt_at)
    values(recipient_row.company_id,recipient_row.profile_id,'overdue_digest','[AURIS360] Daily overdue action digest - '||recipient_row.action_count||' item(s)',
      body_value,recipient_row.recipient_email,recipient_row.full_name,'pending','email','normal',first_action_id,'action_tracker','actions',
      'DIGEST-'||p_run_date::text,'https://auris360.app/?goto=actions',
      jsonb_build_object('digest_date',p_run_date,'action_count',recipient_row.action_count,'recipient_profile_id',recipient_row.profile_id,
        'relationship',jsonb_build_object('module','actions','table','action_tracker','id',first_action_id,'ref',first_action_ref,'company_id',recipient_row.company_id,'url','https://auris360.app/?goto=actions')),
      'overdue-digest/'||recipient_row.company_id::text||'/'||p_run_date::text||'/'||recipient_row.profile_id::text,now())
    on conflict(company_id,idempotency_key) where idempotency_key is not null do update set idempotency_key=excluded.idempotency_key
    returning id into notification_uuid;
    insert into public.action_digest_runs(company_id,run_date,recipient_profile_id,notification_id,action_count)
    values(recipient_row.company_id,p_run_date,recipient_row.profile_id,notification_uuid,recipient_row.action_count)
    on conflict(company_id,run_date,recipient_profile_id) do nothing;
    digest_count:=digest_count+1; action_total:=action_total+recipient_row.action_count;
  end loop;
  return jsonb_build_object('run_date',p_run_date,'digests_queued',digest_count,'actions_included',action_total);
end;
$$;

revoke all on function public.process_action_overdue_digests(date,uuid,integer) from public,anon,authenticated;
grant execute on function public.process_action_overdue_digests(date,uuid,integer) to service_role;

create or replace function public.stop_action_notifications_on_terminal_state()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if lower(coalesce(new.status,'')) not in ('closed','cancelled','canceled','completed','complete','void')
    or lower(coalesce(new.status,''))=lower(coalesce(old.status,'')) then return new; end if;
  update public.notification_queue set status='skipped',error_msg='Source action is now '||new.status,
    locked_at=null,locked_by=null
  where company_id=new.company_id and related_table='action_tracker' and related_id=new.id and status='pending'
    and type in ('action','action_due_soon','action_overdue');
  update public.user_notifications u set dismissed_at=coalesce(u.dismissed_at,now()),updated_at=now()
  from public.notification_queue q where u.source_notification_id=q.id and q.company_id=new.company_id
    and q.related_table='action_tracker' and q.related_id=new.id and u.dismissed_at is null
    and q.type in ('action','action_due_soon','action_overdue');
  if to_regclass('public.push_delivery_jobs') is not null then
    execute $stop_push$update public.push_delivery_jobs j
      set status='skipped',error_msg='Source action reached a terminal state',locked_at=null,locked_by=null,updated_at=now()
      from public.user_notifications u,public.notification_queue q
      where j.user_notification_id=u.id and u.source_notification_id=q.id
        and q.company_id=$1 and q.related_table='action_tracker' and q.related_id=$2
        and q.type in ('action','action_due_soon','action_overdue') and j.status='pending'$stop_push$
      using new.company_id,new.id;
  end if;
  if to_regclass('public.whatsapp_delivery_jobs') is not null then
    execute $stop_whatsapp$update public.whatsapp_delivery_jobs j
      set status='skipped',error_msg='Source action reached a terminal state',locked_at=null,locked_by=null,updated_at=now()
      from public.user_notifications u,public.notification_queue q
      where j.user_notification_id=u.id and u.source_notification_id=q.id
        and q.company_id=$1 and q.related_table='action_tracker' and q.related_id=$2
        and q.type in ('action','action_due_soon','action_overdue') and j.status='pending'$stop_whatsapp$
      using new.company_id,new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stop_action_notifications on public.action_tracker;
create trigger trg_stop_action_notifications after update of status on public.action_tracker
for each row execute function public.stop_action_notifications_on_terminal_state();

comment on function public.process_action_overdue_digests(date,uuid,integer) is 'Service-only, one-per-recipient daily overdue digest built from live open actions.';
comment on function public.stop_action_notifications_on_terminal_state() is 'Stops still-pending individual action alerts and external jobs when the source reaches a terminal state.';

commit;
notify pgrst, 'reload schema';
