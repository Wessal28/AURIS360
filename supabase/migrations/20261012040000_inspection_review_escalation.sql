-- Separate inspection submission from an authenticated reviewer decision.
alter table public.inspections add column if not exists review_status text not null default 'draft';
alter table public.inspections add column if not exists reviewer_profile_id uuid;
alter table public.inspections add column if not exists reviewed_by_profile_id uuid;
alter table public.inspections add column if not exists submitted_at timestamptz;
alter table public.inspections add column if not exists reviewed_at timestamptz;
alter table public.inspections add column if not exists review_notes text;
alter table public.inspections add constraint inspections_review_status_check
  check (review_status in ('draft','pending_review','changes_requested','approved'));

-- Inspection approval is an explicit company grant, independent of a person's
-- general job title or ability to edit inspections.
create table public.inspection_reviewer_grants (
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  granted_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(company_id,profile_id)
);
alter table public.inspection_reviewer_grants enable row level security;

create or replace function public.guard_inspection_review()
returns trigger language plpgsql as $$
declare reviewer public.profiles%rowtype;
begin
  -- Pre-start GO/HOLD/STOP has its own supervisor sign-off and must remain usable.
  if tg_op='UPDATE' and (old.inspection_type='prestart') is distinct from
     (new.inspection_type='prestart') then
    raise exception 'Pre-start and reviewed inspection workflows cannot be interchanged';
  end if;
  if new.inspection_type='prestart' then return new; end if;
  if tg_op='UPDATE' then
    if old.review_status in ('pending_review','approved')
       and coalesce(current_setting('auris.inspection_review_decision',true),'') <> 'allowed' then
      raise exception 'Submitted or approved inspections cannot be edited; request changes through the review workflow';
    end if;
    if (new.review_status,new.reviewed_by_profile_id,new.reviewed_at,new.review_notes,new.submitted_at,
        new.sign_reviewer,new.sign_reviewer_date,new.reviewed_by,new.reviewed_date)
       is distinct from
       (old.review_status,old.reviewed_by_profile_id,old.reviewed_at,old.review_notes,old.submitted_at,
        old.sign_reviewer,old.sign_reviewer_date,old.reviewed_by,old.reviewed_date)
       and coalesce(current_setting('auris.inspection_review_decision',true),'') <> 'allowed' then
      raise exception 'Use the inspection review workflow to change review fields';
    end if;
    if new.status in ('completed','closed') and old.status is distinct from new.status
       and coalesce(current_setting('auris.inspection_review_decision',true),'') <> 'allowed' then
      raise exception 'Submit and approve the inspection through the review workflow';
    end if;
  elsif new.review_status <> 'draft' or new.reviewed_by_profile_id is not null or new.reviewed_at is not null
    or new.sign_reviewer is not null or new.sign_reviewer_date is not null
    or new.reviewed_by is not null or new.reviewed_date is not null then
    raise exception 'A new inspection must start as a draft';
  end if;
  if tg_op='INSERT' and new.status in ('completed','closed') then
    raise exception 'A new inspection must be submitted for review before completion';
  end if;
  if new.reviewer_profile_id is not null and new.review_status='pending_review' then
    select * into reviewer from public.profiles where id=new.reviewer_profile_id;
    if not found or reviewer.status<>'active' or reviewer.company_id is distinct from new.company_id
       or not exists(select 1 from public.inspection_reviewer_grants grant_row
          where grant_row.company_id=new.company_id and grant_row.profile_id=reviewer.id
            and grant_row.enabled) then
      raise exception 'Choose a designated reviewer in the inspection company';
    end if;
    if new.reviewer_profile_id=new.created_by then
      raise exception 'An inspector cannot review their own inspection';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_inspection_review on public.inspections;
create trigger trg_guard_inspection_review before insert or update on public.inspections
for each row execute function public.guard_inspection_review();

create or replace function public.list_inspection_reviewers(p_company_id uuid)
returns table(id uuid,full_name text,role text,enabled boolean)
language plpgsql security definer set search_path to 'public' as $$
declare actor public.profiles%rowtype;
begin
  select * into actor from public.profiles where profiles.id=auth.uid();
  if not found or (actor.role<>'sephs_admin' and actor.company_id is distinct from p_company_id)
     or not public.user_access_allowed('inspection','view') then
    raise exception 'Inspection access is required to list reviewers';
  end if;
  return query select p.id,p.full_name,p.role,coalesce(grant_row.enabled,false)
    from public.profiles p
    left join public.inspection_reviewer_grants grant_row
      on grant_row.company_id=p.company_id and grant_row.profile_id=p.id
    where p.company_id=p_company_id
      and p.status='active'
    order by p.full_name,p.id;
end $$;

create or replace function public.set_inspection_reviewer_grant(p_profile_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare actor public.profiles%rowtype; reviewer public.profiles%rowtype;
begin
  select * into actor from public.profiles where id=auth.uid();
  select * into reviewer from public.profiles where id=p_profile_id;
  if actor.id is null or reviewer.id is null or reviewer.status<>'active'
     or actor.role not in ('sephs_admin','admin','hse_manager')
     or (actor.role<>'sephs_admin' and actor.company_id is distinct from reviewer.company_id)
     or not public.user_access_allowed('inspection','edit') then
    raise exception 'Only an inspection administrator may designate reviewers in their company';
  end if;
  if not p_enabled and exists(select 1 from public.inspections i
    where i.company_id=reviewer.company_id and i.reviewer_profile_id=reviewer.id
      and i.review_status='pending_review') then
    raise exception 'Resolve or reassign pending inspection reviews before removing this reviewer';
  end if;
  insert into public.inspection_reviewer_grants(company_id,profile_id,enabled,granted_by,updated_at)
    values(reviewer.company_id,reviewer.id,p_enabled,actor.id,now())
    on conflict(company_id,profile_id) do update
      set enabled=excluded.enabled,granted_by=excluded.granted_by,updated_at=excluded.updated_at;
  return true;
end $$;

create or replace function public.reassign_inspection_reviewer(p_inspection_id uuid,p_reviewer_profile_id uuid)
returns public.inspections language plpgsql security definer set search_path to 'public' as $$
declare item public.inspections%rowtype; actor public.profiles%rowtype; reviewer public.profiles%rowtype;
begin
  select * into actor from public.profiles where id=auth.uid();
  select * into item from public.inspections where id=p_inspection_id for update;
  select * into reviewer from public.profiles where id=p_reviewer_profile_id;
  if item.id is null or actor.id is null or reviewer.id is null
     or actor.role not in ('sephs_admin','admin','hse_manager')
     or (actor.role<>'sephs_admin' and actor.company_id is distinct from item.company_id)
     or item.review_status<>'pending_review' or reviewer.company_id is distinct from item.company_id
     or reviewer.id=item.created_by or reviewer.status<>'active'
     or not public.user_access_allowed('inspection','edit')
     or not exists(select 1 from public.inspection_reviewer_grants grant_row
       where grant_row.company_id=item.company_id and grant_row.profile_id=reviewer.id and grant_row.enabled) then
    raise exception 'Only an inspection administrator may reassign pending review to another designated reviewer';
  end if;
  perform set_config('auris.inspection_review_decision','allowed',true);
  update public.inspections set reviewer_profile_id=reviewer.id,updated_at=now()
    where id=item.id returning * into item;
  return item;
end $$;

create or replace function public.submit_inspection_for_review(p_inspection_id uuid,p_reviewer_profile_id uuid)
returns public.inspections language plpgsql security definer set search_path to 'public' as $$
declare item public.inspections%rowtype; actor public.profiles%rowtype; reviewer public.profiles%rowtype;
begin
  select * into actor from public.profiles where id=auth.uid();
  select * into item from public.inspections where id=p_inspection_id for update;
  if not found or actor.id is null or (actor.role<>'sephs_admin' and actor.company_id is distinct from item.company_id)
     or not public.user_access_allowed('inspection','edit') then raise exception 'Inspection edit access is required'; end if;
  if item.review_status not in ('draft','changes_requested') then raise exception 'This inspection is already submitted or approved'; end if;
  if item.inspection_type='prestart' then raise exception 'Pre-start decisions use supervisor sign-off, not audit review'; end if;
  select * into reviewer from public.profiles where id=p_reviewer_profile_id and company_id=item.company_id;
  if not found or reviewer.status<>'active' or not exists(select 1 from public.inspection_reviewer_grants grant_row
      where grant_row.company_id=item.company_id and grant_row.profile_id=reviewer.id and grant_row.enabled)
     or reviewer.id=actor.id then raise exception 'Choose another authorised reviewer in this company'; end if;
  if item.inspection_date is null or nullif(trim(coalesce(item.site,'')),'') is null
     or coalesce(jsonb_array_length(coalesce(item.items,'[]'::jsonb)),0)=0 then
    raise exception 'Add a site, inspection date and checklist before submission';
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(item.items,'[]'::jsonb)) as answer(value)
    where coalesce(answer.value->>'result','') not in ('good','insufficient','na')) then
    raise exception 'Answer every checklist item before submission';
  end if;
  perform set_config('auris.inspection_review_decision','allowed',true);
  update public.inspections set status='in_progress',review_status='pending_review',
    reviewer_profile_id=reviewer.id,submitted_at=now(),reviewed_by_profile_id=null,
    reviewed_at=null,review_notes=null,sign_reviewer=null,sign_reviewer_date=null,updated_at=now()
  where id=item.id returning * into item;
  return item;
end $$;

create or replace function public.decide_inspection_review(p_inspection_id uuid,p_decision text,p_notes text default null)
returns public.inspections language plpgsql security definer set search_path to 'public' as $$
declare item public.inspections%rowtype; actor public.profiles%rowtype;
begin
  select * into actor from public.profiles where id=auth.uid();
  select * into item from public.inspections where id=p_inspection_id for update;
  if not found or actor.id is null or actor.status<>'active' or actor.id is distinct from item.reviewer_profile_id
     or actor.company_id is distinct from item.company_id
     or not exists(select 1 from public.inspection_reviewer_grants grant_row
       where grant_row.company_id=item.company_id and grant_row.profile_id=actor.id and grant_row.enabled)
     or actor.id=item.created_by or not public.user_access_allowed('inspection','view') then
    raise exception 'Only the assigned independent reviewer may decide this inspection';
  end if;
  if item.review_status<>'pending_review' then raise exception 'This inspection is not awaiting review'; end if;
  if p_decision not in ('approved','changes_requested') then raise exception 'Invalid review decision'; end if;
  if p_decision='changes_requested' and nullif(trim(coalesce(p_notes,'')),'') is null then
    raise exception 'A reason is required when requesting changes';
  end if;
  perform set_config('auris.inspection_review_decision','allowed',true);
  update public.inspections set review_status=p_decision,reviewed_by_profile_id=actor.id,
    reviewed_at=now(),reviewed_by=actor.full_name,reviewed_date=current_date,
    sign_reviewer=case when p_decision='approved' then actor.full_name else null end,
    sign_reviewer_date=case when p_decision='approved' then current_date else null end,
    review_notes=nullif(trim(coalesce(p_notes,'')),''),
    status=case when p_decision='approved' then 'completed' else 'in_progress' end,updated_at=now()
  where id=item.id returning * into item;
  return item;
end $$;
revoke all on function public.submit_inspection_for_review(uuid,uuid) from public,anon;
revoke all on function public.decide_inspection_review(uuid,text,text) from public,anon;
revoke all on function public.list_inspection_reviewers(uuid) from public,anon;
revoke all on function public.set_inspection_reviewer_grant(uuid,boolean) from public,anon;
revoke all on function public.reassign_inspection_reviewer(uuid,uuid) from public,anon;
grant execute on function public.submit_inspection_for_review(uuid,uuid) to authenticated;
grant execute on function public.decide_inspection_review(uuid,text,text) to authenticated;
grant execute on function public.list_inspection_reviewers(uuid) to authenticated;
grant execute on function public.set_inspection_reviewer_grant(uuid,boolean) to authenticated;
grant execute on function public.reassign_inspection_reviewer(uuid,uuid) to authenticated;

-- Recurrence starts only after the independent approval, not on submission.
create or replace function public.prepare_next_recurring_inspection()
returns trigger language plpgsql as $$
declare due_on date;
begin
  if new.status not in ('completed','closed') or new.review_status <> 'approved'
     or new.recurrence_interval='none' then return new; end if;
  if tg_op='UPDATE' then
    if old.review_status='approved' then return new; end if;
  end if;
  due_on:=coalesce(new.inspection_date,current_date)+case new.recurrence_interval
    when 'weekly' then interval '7 days' when 'monthly' then interval '1 month'
    when 'quarterly' then interval '3 months' else interval '1 year' end;
  update public.inspections set next_due_date=due_on where id=new.id;
  insert into public.inspections
    (company_id,inspection_type,site,if_site,department,inspection_date,if_date,planned_date,
     inspector,if_by,audit_standard,audit_scope,lead_auditor,audit_team,auditee,priority,status,
     items,created_by,equipment_asset_id,recurrence_interval,reminder_days,recurrence_origin_id)
  values (new.company_id,new.inspection_type,new.site,new.if_site,new.department,due_on,due_on,due_on,
    new.inspector,new.if_by,new.audit_standard,new.audit_scope,new.lead_auditor,new.audit_team,
    new.auditee,new.priority,'open',
    (select coalesce(jsonb_agg(checklist_item.value-'result'-'observation'),'[]'::jsonb)
      from jsonb_array_elements(coalesce(new.items,'[]'::jsonb)) as checklist_item(value)),
    new.created_by,new.equipment_asset_id,new.recurrence_interval,new.reminder_days,new.id)
  on conflict (recurrence_origin_id) where recurrence_origin_id is not null do nothing;
  return new;
end $$;
drop trigger if exists trg_prepare_next_recurring_inspection on public.inspections;
create trigger trg_prepare_next_recurring_inspection after insert or update of status,review_status on public.inspections
for each row execute function public.prepare_next_recurring_inspection();

create table if not exists public.inspection_escalation_policy (
  company_id uuid primary key references public.companies(id) on delete cascade,
  enabled boolean not null default true,
  due_soon_days integer not null default 7,
  level_1_overdue_days integer not null default 1,
  level_2_overdue_days integer not null default 7,
  level_3_overdue_days integer not null default 21,
  updated_at timestamptz not null default now(),
  constraint inspection_escalation_order_check check
    (due_soon_days between 0 and 90 and level_1_overdue_days>=1
      and level_2_overdue_days>level_1_overdue_days
      and level_3_overdue_days>level_2_overdue_days)
);
alter table public.inspection_escalation_policy enable row level security;
create policy inspection_escalation_read on public.inspection_escalation_policy for select to authenticated
  using (exists (select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or p.company_id=inspection_escalation_policy.company_id)));
create policy inspection_escalation_manage on public.inspection_escalation_policy for all to authenticated
  using (exists (select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=inspection_escalation_policy.company_id
      and p.role in ('admin','hse_manager')))))
  with check (exists (select 1 from public.profiles p where p.id=auth.uid()
    and (p.role='sephs_admin' or (p.company_id=inspection_escalation_policy.company_id
      and p.role in ('admin','hse_manager')))));
grant select,insert,update on public.inspection_escalation_policy to authenticated;

-- A company-specific sequence: due soon, initial overdue, then supervisor,
-- management and executive escalation. Each stage is queued once per due date.
create or replace function public.process_inspection_due_reminders(
  p_run_date date default current_date,p_limit integer default 1000)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare queued_count integer;
begin
  with due_items as (
    select i.*,coalesce(pol.due_soon_days,7) as due_window,
      coalesce(pol.level_1_overdue_days,1) as level_1,
      coalesce(pol.level_2_overdue_days,7) as level_2,
      coalesce(pol.level_3_overdue_days,21) as level_3,
      p_run_date-i.planned_date as overdue_days
    from public.inspections i
    left join public.inspection_escalation_policy pol on pol.company_id=i.company_id
    join public.notification_settings ns on ns.company_id=i.company_id
    where i.status in ('open','in_progress') and i.planned_date is not null
      and coalesce(pol.enabled,true) and coalesce(ns.email_enabled,true)
      and coalesce(ns.notify_on_audit,true)
      and i.planned_date<=p_run_date+least(coalesce(i.reminder_days,7),coalesce(pol.due_soon_days,7))
    order by i.planned_date,i.id
    limit greatest(1,least(coalesce(p_limit,1000),5000))
  ), staged as (
    select i.*,
      case when overdue_days>=level_3 then 'escalation_3'
           when overdue_days>=level_2 then 'escalation_2'
           when overdue_days>=level_1 then 'escalation_1'
           when overdue_days>0 then 'overdue_initial' else 'due_soon' end as stage,
      case when overdue_days>=level_3 then 3 when overdue_days>=level_2 then 2
           when overdue_days>=level_1 then 1 else 0 end as level
    from due_items i
  ), recipients as (
    select i.*,p.id as recipient_id,p.full_name as recipient_name,
      public.notification_best_email(array[p.real_email,p.email]) as recipient_email
    from staged i join public.profiles p on p.company_id=i.company_id
    where (
      (nullif(trim(coalesce(i.inspector,i.performed_by,i.if_by,'')),'') is not null
       and regexp_replace(lower(coalesce(p.full_name,'')),'[^a-z0-9]+','','g')=
         regexp_replace(lower(coalesce(i.inspector,i.performed_by,i.if_by,'')),'[^a-z0-9]+','','g'))
      or (i.level>=1 and p.role in ('supervisor','site_manager'))
      or (i.level>=2 and p.role in ('manager','hse_manager'))
      or (i.level>=3 and p.role in ('executive','admin','sephs_admin'))
    ) and public.notification_best_email(array[p.real_email,p.email]) is not null
  )
  insert into public.notification_queue
    (company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,status,
     channel,priority,related_id,related_table,related_module,related_ref,record_url,
     metadata,idempotency_key,next_attempt_at)
  select company_id,recipient_id,'inspection_'||stage,
    '[AURIS360] Inspection '||replace(stage,'_',' ')||': '||coalesce(reference_no,id::text),
    '<p>Inspection <strong>'||public.notification_html_escape(coalesce(reference_no,id::text))||
    '</strong> at '||public.notification_html_escape(coalesce(site,'the assigned site'))||
    ' is '||case when overdue_days>0 then overdue_days::text||' day(s) overdue' else 'due on '||planned_date::text end||
    '.</p><p><a href="https://auris360.app/?goto=inspection&amp;record='||id::text||
    '&amp;table=inspections&amp;company='||company_id::text||'">Open inspection</a></p>',
    recipient_email,recipient_name,'pending','email',
    case when level>=2 then 'urgent' when overdue_days>0 then 'high' else 'normal' end,
    id,'inspections','inspection',coalesce(reference_no,id::text),
    'https://auris360.app/?goto=inspection&record='||id::text||'&table=inspections&company='||company_id::text,
    jsonb_build_object('due_date',planned_date,'escalation_level',level,'overdue_days',overdue_days),
    'inspection/'||id::text||'/'||planned_date::text||'/'||stage||'/'||recipient_id::text,now()
  from recipients
  on conflict(company_id,idempotency_key) where idempotency_key is not null do nothing;
  get diagnostics queued_count=row_count;
  return jsonb_build_object('run_date',p_run_date,'reminders_queued',queued_count);
end $$;
revoke all on function public.process_inspection_due_reminders(date,integer) from public,anon,authenticated;
grant execute on function public.process_inspection_due_reminders(date,integer) to service_role;
