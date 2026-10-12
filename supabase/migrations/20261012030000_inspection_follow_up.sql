-- Keep recurring inspections and corrective-action verification linked to their source.
-- auris360: allow-data-migration
-- Historical finding links are backfilled by exact inspection ID and numbered finding key;
-- only open findings whose linked action is already closed enter verification.
alter table public.inspections add column if not exists recurrence_interval text not null default 'none';
alter table public.inspections add column if not exists reminder_days integer not null default 7;
alter table public.inspections add column if not exists recurrence_origin_id uuid;
alter table public.inspections add column if not exists next_due_date date;
alter table public.inspections add constraint inspections_recurrence_interval_check
  check (recurrence_interval in ('none','weekly','monthly','quarterly','annual'));
alter table public.inspections add constraint inspections_reminder_days_check
  check (reminder_days between 0 and 90);
create unique index if not exists inspections_recurrence_origin_idx
  on public.inspections(recurrence_origin_id) where recurrence_origin_id is not null;

alter table public.audit_findings add column if not exists linked_action_id uuid;
create index if not exists audit_findings_linked_action_idx on public.audit_findings(linked_action_id)
  where linked_action_id is not null;
update public.audit_findings as finding
   set linked_action_id = (
     select action.id from public.action_tracker as action
      where action.company_id is not distinct from finding.company_id
        and action.source_module='inspection' and action.source_id=finding.inspection_id
        and action.action_no='finding:' || substring(finding.finding_ref from '[0-9]+$')::integer::text
      order by action.created_at desc nulls last limit 1)
 where finding.linked_action_id is null and finding.finding_ref ~ '^F[0-9]+$';
update public.audit_findings as finding set status='awaiting_verification',updated_at=now()
 where finding.status in ('open','in_progress') and finding.linked_action_id is not null
   and exists (select 1 from public.action_tracker as action where action.id=finding.linked_action_id
     and action.company_id is not distinct from finding.company_id
     and action.status in ('pending_verification','pending_closure','closed'));

create or replace function public.prepare_next_recurring_inspection()
returns trigger language plpgsql as $$
declare due_on date;
begin
  if new.status not in ('completed','closed') or new.recurrence_interval = 'none' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.status in ('completed','closed') then return new; end if;
  end if;
  due_on := coalesce(new.inspection_date,current_date) +
    case new.recurrence_interval
      when 'weekly' then interval '7 days'
      when 'monthly' then interval '1 month'
      when 'quarterly' then interval '3 months'
      else interval '1 year'
    end;
  update public.inspections set next_due_date = due_on where id = new.id;
  insert into public.inspections
    (company_id,inspection_type,site,if_site,department,inspection_date,if_date,
     planned_date,inspector,if_by,audit_standard,audit_scope,lead_auditor,audit_team,
     auditee,priority,status,items,created_by,equipment_asset_id,recurrence_interval,
     reminder_days,recurrence_origin_id)
  values
    (new.company_id,new.inspection_type,new.site,new.if_site,new.department,due_on,due_on,
     due_on,new.inspector,new.if_by,new.audit_standard,new.audit_scope,new.lead_auditor,
     new.audit_team,new.auditee,new.priority,'open',
     (select coalesce(jsonb_agg(checklist_item.value - 'result' - 'observation'), '[]'::jsonb)
        from jsonb_array_elements(coalesce(new.items,'[]'::jsonb)) as checklist_item(value)),
     new.created_by,new.equipment_asset_id,new.recurrence_interval,new.reminder_days,new.id)
  on conflict (recurrence_origin_id) where recurrence_origin_id is not null do nothing;
  return new;
end $$;
drop trigger if exists trg_prepare_next_recurring_inspection on public.inspections;
create trigger trg_prepare_next_recurring_inspection after insert or update of status on public.inspections
for each row execute function public.prepare_next_recurring_inspection();

create or replace function public.inspection_action_awaiting_verification()
returns trigger language plpgsql as $$
begin
  if new.source_module = 'inspection' and new.status in ('pending_verification','pending_closure','closed')
     and old.status is distinct from new.status then
    update public.audit_findings
       set status='awaiting_verification',updated_at=now()
     where company_id=new.company_id and linked_action_id=new.id
       and status in ('open','in_progress');
  end if;
  return new;
end $$;
drop trigger if exists trg_inspection_action_awaiting_verification on public.action_tracker;
create trigger trg_inspection_action_awaiting_verification after update of status on public.action_tracker
for each row execute function public.inspection_action_awaiting_verification();

-- Queue at most one due and one overdue email per inspection and inspector.
create or replace function public.process_inspection_due_reminders(
  p_run_date date default current_date, p_limit integer default 1000)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare queued_count integer;
begin
  insert into public.notification_queue
    (company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,status,
     channel,priority,related_id,related_table,related_module,related_ref,record_url,
     metadata,idempotency_key,next_attempt_at)
  select i.company_id,p.id,
    case when i.planned_date<p_run_date then 'inspection_overdue' else 'inspection_due_soon' end,
    '[AURIS360] Inspection ' || case when i.planned_date<p_run_date then 'overdue: ' else 'due: ' end || coalesce(i.reference_no,i.id::text),
    '<p>Your inspection <strong>' || public.notification_html_escape(coalesce(i.reference_no,i.id::text)) ||
    '</strong> at ' || public.notification_html_escape(coalesce(i.site,'the assigned site')) ||
    ' is ' || case when i.planned_date<p_run_date then 'overdue' else 'due soon' end ||
    ' (' || i.planned_date::text || ').</p><p><a href="https://auris360.app/?goto=inspection&amp;record=' ||
    i.id::text || '&amp;table=inspections&amp;company=' || i.company_id::text || '">Open inspection</a></p>',
    public.notification_best_email(array[p.real_email,p.email]),p.full_name,'pending','email',
    case when i.planned_date<p_run_date then 'high' else 'normal' end,
    i.id,'inspections','inspection',coalesce(i.reference_no,i.id::text),
    'https://auris360.app/?goto=inspection&record=' || i.id::text || '&table=inspections&company=' || i.company_id::text,
    jsonb_build_object('due_date',i.planned_date,'inspector_profile_id',p.id),
    'inspection-' || case when i.planned_date<p_run_date then 'overdue' else 'due' end ||
      '/' || i.id::text || '/' || i.planned_date::text || '/' || p.id::text,now()
  from public.inspections i
  join public.profiles p on p.company_id=i.company_id
    and regexp_replace(lower(coalesce(p.full_name,'')),'[^a-z0-9]+','','g')=
        regexp_replace(lower(coalesce(i.inspector,i.performed_by,i.if_by,'')),'[^a-z0-9]+','','g')
  join public.notification_settings ns on ns.company_id=i.company_id
  where i.status in ('open','in_progress') and i.planned_date is not null
    and nullif(trim(coalesce(i.inspector,i.performed_by,i.if_by,'')),'') is not null
    and i.planned_date<=p_run_date+least(90,greatest(0,coalesce(i.reminder_days,7)))
    and coalesce(ns.email_enabled,true) and coalesce(ns.notify_on_audit,true)
    and public.notification_best_email(array[p.real_email,p.email]) is not null
  order by i.planned_date,i.id,p.id
  limit greatest(1,least(coalesce(p_limit,1000),5000))
  on conflict(company_id,idempotency_key) where idempotency_key is not null do nothing;
  get diagnostics queued_count=row_count;
  return jsonb_build_object('run_date',p_run_date,'reminders_queued',queued_count);
end $$;
revoke all on function public.process_inspection_due_reminders(date,integer) from public,anon,authenticated;
grant execute on function public.process_inspection_due_reminders(date,integer) to service_role;
