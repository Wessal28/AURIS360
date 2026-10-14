-- Keep an incomplete chemical assessment unscored and retain reviewed card text separately from extraction.
alter table public.chemical_register alter column risk_score drop default;
alter table public.chemical_register alter column risk_level set default 'unassessed';
alter table public.chemical_sds_versions add column if not exists emergency_summary jsonb;
alter table public.chemical_sds_versions add column if not exists emergency_summary_reviewed_at timestamptz;
alter table public.chemical_sds_versions add column if not exists emergency_summary_reviewed_by uuid;
alter table public.chemical_use_approvals add column if not exists sds_review_required boolean not null default false;
alter table public.chemical_use_approvals add column if not exists owner_person_id uuid references public.people(id);
alter table public.chemical_use_approvals add column if not exists site_id uuid references public.sites(id);
alter table public.chemical_use_approvals add column if not exists ppe_item_id uuid references public.ppe_catalogue(id);
alter table public.chemical_use_approvals add column if not exists risk_assessment_id uuid references public.risk_assessments(id);

create function public.chemical_use_link_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.owner_person_id is not null and not exists
    (select 1 from public.people p where p.id=new.owner_person_id and p.company_id=new.company_id) then
    raise exception 'Linked person must belong to the selected company'; end if;
  if new.site_id is not null and not exists
    (select 1 from public.sites s where s.id=new.site_id and s.company_id=new.company_id) then
    raise exception 'Linked site must belong to the selected company'; end if;
  if new.ppe_item_id is not null and not exists
    (select 1 from public.ppe_catalogue p where p.id=new.ppe_item_id and p.company_id=new.company_id) then
    raise exception 'Linked PPE must belong to the selected company'; end if;
  if new.risk_assessment_id is not null and not exists
    (select 1 from public.risk_assessments r where r.id=new.risk_assessment_id and r.company_id=new.company_id) then
    raise exception 'Linked assessment must belong to the selected company'; end if;
  return new;
end $$;
create trigger chemical_use_link_guard before insert or update of
  company_id,owner_person_id,site_id,ppe_item_id,risk_assessment_id
on public.chemical_use_approvals for each row execute function public.chemical_use_link_guard();

alter table public.chemical_sds_versions add constraint chemical_card_review_content_check
  check (emergency_summary_reviewed_at is null or
    (validation_status='current' and not material_change and emergency_summary_reviewed_by is not null
     and length(btrim(coalesce(emergency_summary->>'hazards','')))>0
     and length(btrim(coalesce(emergency_summary->>'first_aid','')))>0
     and length(btrim(coalesce(emergency_summary->>'ppe','')))>0
     and length(btrim(coalesce(emergency_summary->>'storage','')))>0)) not valid;

create function public.chemical_sds_validation_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare reviewer_role text;
begin
  if not exists (select 1 from public.chemical_register c where c.id=new.chemical_id and c.company_id=new.company_id)
    then raise exception 'SDS product must belong to the selected company'; end if;
  if new.validation_status in ('validated','current') then
    if new.revision_date is null or nullif(btrim(new.source_reference),'') is null
      or nullif(btrim(new.language_code),'') is null or nullif(btrim(new.jurisdiction),'') is null
      or new.reviewer_id is null or new.validated_at is null then
      raise exception 'Complete source and reviewer evidence before SDS validation'; end if;
    if auth.role() is distinct from 'service_role' then
      select p.role into reviewer_role from public.profiles p where p.id=auth.uid() and p.status='active'
        and (p.company_id=new.company_id or p.role='sephs_admin');
      if new.reviewer_id is distinct from auth.uid() or coalesce(reviewer_role,'') not in
        ('sephs_admin','company_admin','admin','hse_manager','hse_officer','manager','site_manager') then
        raise exception 'Authorised reviewer must record their own SDS decision' using errcode='42501';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger chemical_sds_validation_guard before insert or update of
  validation_status,revision_date,source_reference,language_code,jurisdiction,reviewer_id,validated_at,emergency_summary_reviewed_at
on public.chemical_sds_versions for each row execute function public.chemical_sds_validation_guard();

create function public.chemical_use_assurance_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.status in ('approved','conditional') then
    if new.sds_review_required or not exists (
      select 1 from public.chemical_sds_versions s
      where s.company_id=new.company_id and s.chemical_id=new.chemical_id
        and s.validation_status='current' and not s.material_change
        and s.validated_at is not null and s.reviewer_id is not null
    ) then raise exception 'Current competent SDS validation and change review are required before approval'; end if;
    if nullif(btrim(new.task_name),'') is null or nullif(btrim(new.location_name),'') is null
      or new.maximum_quantity is null or new.maximum_quantity<=0
      or nullif(btrim(new.quantity_unit),'') is null or not new.substitution_considered
      or nullif(btrim(new.substitution_outcome),'') is null
      or nullif(btrim(new.controls_required),'') is null
      or nullif(btrim(new.emergency_arrangements),'') is null
      or nullif(btrim(new.waste_arrangements),'') is null then
      raise exception 'Complete task scope, substitution, controls, emergency and waste arrangements before approval';
    end if;
  end if;
  return new;
end $$;
create trigger chemical_use_assurance_guard before insert or update on public.chemical_use_approvals
for each row execute function public.chemical_use_assurance_guard();

create function public.chemical_sds_change_impact() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then
    update public.chemical_use_approvals u
      set status='suspended',sds_review_required=true,updated_at=now()
      where u.company_id=old.company_id and u.chemical_id=old.chemical_id
        and u.status in ('approved','conditional') and old.validation_status='current';
    return old;
  end if;
  if (tg_op='INSERT' and new.validation_status='current') or
     (tg_op='UPDATE' and (old.validation_status is distinct from new.validation_status
        or old.revision_date is distinct from new.revision_date
        or old.material_change is distinct from new.material_change)
       and (old.validation_status='current' or new.validation_status='current')) then
    update public.chemical_use_approvals u
      set status='suspended',sds_review_required=true,updated_at=now()
      where u.company_id=new.company_id and u.chemical_id=new.chemical_id
        and u.status in ('approved','conditional');
  end if;
  return new;
end $$;
create trigger chemical_sds_change_impact after insert or update of validation_status,revision_date,material_change
on public.chemical_sds_versions for each row execute function public.chemical_sds_change_impact();
create trigger chemical_sds_delete_impact after delete on public.chemical_sds_versions
for each row execute function public.chemical_sds_change_impact();

create function public.chemical_sds_review_action() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare product_name text; due_on date;
begin
  if new.validation_status in ('pending','invalid') or new.material_change then
    if not exists (select 1 from public.action_tracker a where a.company_id=new.company_id
      and a.source_module='chemical' and a.source_type='sds_validation' and a.source_id=new.id
      and a.status not in ('closed','cancelled')) then
      select c.product_name,c.review_date into product_name,due_on from public.chemical_register c
        where c.id=new.chemical_id and c.company_id=new.company_id;
      insert into public.action_tracker
        (company_id,source_module,source_type,source_id,source_ref,title,description,target_date,priority,status,created_by)
      values (new.company_id,'chemical','sds_validation',new.id,coalesce(new.file_name,'SDS'),
        'Review SDS for '||coalesce(product_name,'chemical'),
        case when new.material_change then 'Assess changed hazards, controls and affected use approvals.'
          else 'Complete competent SDS validation before approving use.' end,
        due_on,case when new.material_change then 'high' else 'medium' end,'open',auth.uid());
    end if;
  elsif new.validation_status='current' then
    update public.action_tracker a set status='closed',completion_date=current_date,updated_at=now()
      where a.company_id=new.company_id and a.source_module='chemical'
        and a.source_type='sds_validation' and a.source_id=new.id
        and a.status not in ('closed','cancelled');
  end if;
  return new;
end $$;
create trigger chemical_sds_review_action after insert or update of validation_status,material_change
on public.chemical_sds_versions for each row execute function public.chemical_sds_review_action();

create function public.process_chemical_due_reminders(p_run_date date default current_date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare queued integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  with due as (
    select c.company_id,c.id,'chemical_review'::text kind,c.review_date due_date,
      coalesce(c.chemical_ref,c.product_name) reference
    from public.chemical_register c where c.status='active' and c.review_date<=p_run_date+30
    union all
    select s.company_id,s.chemical_id,'sds_validation',p_run_date,
      coalesce(s.file_name,'SDS review')
    from public.chemical_sds_versions s where (s.validation_status in ('pending','invalid') or s.material_change)
      and extract(isodow from p_run_date)=1
    union all
    select u.company_id,u.chemical_id,'chemical_use_change',p_run_date,
      coalesce(u.reference,u.task_name)
    from public.chemical_use_approvals u where u.sds_review_required
      and extract(isodow from p_run_date)=1
  ), milestones as (
    select d.*,case when d.kind<>'chemical_review' then 'weekly-'||p_run_date::text
      when d.due_date>p_run_date+7 then '30-day'
      when d.due_date>p_run_date then '7-day'
      when d.due_date=p_run_date then 'due'
      else 'overdue-'||((p_run_date-d.due_date-1)/7)::text end milestone
    from due d
  )
  insert into public.notification_queue
    (company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,status,channel,
     priority,related_id,related_table,related_module,related_ref,idempotency_key,metadata)
  select d.company_id,p.id,d.kind,
    case d.kind when 'chemical_review' then 'Chemical review due: '
      when 'sds_validation' then 'SDS validation needed: ' else 'Chemical use review required: ' end||d.reference,
    '<p>Open the linked Chemical Control product and record the review decision.</p>',
    coalesce(nullif(p.real_email,''),p.email),p.full_name,'pending','in_app',
    case when d.due_date<p_run_date then 'high' else 'normal' end,
    d.id,'chemical_register','chemical',d.reference,
    'chemical-due/'||d.kind||'/'||d.id::text||'/'||d.milestone||'/'||p.id::text,
    jsonb_build_object('due_date',d.due_date,'milestone',d.milestone)
  from milestones d join public.profiles p on p.company_id=d.company_id and p.status='active'
    and p.role in ('sephs_admin','company_admin','admin','manager','hse_manager','site_manager')
  where coalesce(nullif(p.real_email,''),p.email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and coalesce(nullif(p.real_email,''),p.email) !~* '\.local$'
  on conflict do nothing;
  get diagnostics queued=row_count;
  return jsonb_build_object('run_date',p_run_date,'notifications_queued',queued);
end $$;
revoke all on function public.process_chemical_due_reminders(date) from public,anon,authenticated;
grant execute on function public.process_chemical_due_reminders(date) to service_role;
