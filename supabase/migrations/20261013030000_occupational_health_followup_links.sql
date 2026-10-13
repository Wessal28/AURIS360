-- Keep clinical follow-up ownership explicit and linked records within the same tenant.
alter table public.medical_surveillance add column if not exists follow_up_owner_id uuid references public.profiles(id) on delete set null;
alter table public.exposure_monitoring add column if not exists follow_up_owner_id uuid references public.profiles(id) on delete set null;
alter table public.exposure_monitoring add column if not exists risk_assessment_id uuid references public.risk_assessments(id) on delete set null;
alter table public.exposure_monitoring add column if not exists audiometry_record_id uuid references public.audiometry_records(id) on delete set null;
alter table public.exposure_monitoring add column if not exists spirometry_record_id uuid references public.spirometry_records(id) on delete set null;

create or replace function public.check_occupational_health_links() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.follow_up_owner_id is not null and not exists (
    select 1 from public.profiles p where p.id=new.follow_up_owner_id and p.company_id=new.company_id
      and p.status='active' and p.role in ('occupational_health','sephs_admin')
  ) then raise exception 'Follow-up owner must be an active Occupational Health user in this company'; end if;
  if tg_table_name='exposure_monitoring' then
    if new.risk_assessment_id is not null and not exists (
      select 1 from public.risk_assessments r where r.id=new.risk_assessment_id and r.company_id=new.company_id
    ) then raise exception 'Risk assessment must belong to this company'; end if;
    if new.audiometry_record_id is not null and not exists (
      select 1 from public.audiometry_records a where a.id=new.audiometry_record_id and a.company_id=new.company_id
    ) then raise exception 'Audiometry record must belong to this company'; end if;
    if new.spirometry_record_id is not null and not exists (
      select 1 from public.spirometry_records s where s.id=new.spirometry_record_id and s.company_id=new.company_id
    ) then raise exception 'Spirometry record must belong to this company'; end if;
  end if;
  return new;
end $$;
drop trigger if exists medical_surveillance_links_guard on public.medical_surveillance;
create trigger medical_surveillance_links_guard before insert or update of company_id,follow_up_owner_id
on public.medical_surveillance for each row execute function public.check_occupational_health_links();
drop trigger if exists exposure_monitoring_links_guard on public.exposure_monitoring;
create trigger exposure_monitoring_links_guard before insert or update of company_id,follow_up_owner_id,risk_assessment_id,audiometry_record_id,spirometry_record_id
on public.exposure_monitoring for each row execute function public.check_occupational_health_links();

-- Reminders contain no worker names, clinical values or findings. The linked record
-- remains protected by Occupational Health permissions when opened in the app.
create or replace function public.process_occupational_health_reminders(p_run_date date default current_date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_queued integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  with due as (
    select company_id,id,follow_up_owner_id,'medical_exam_due'::text as kind,'medical_surveillance'::text as source,next_exam_date as due_date
      from public.medical_surveillance where status not in ('cancelled') and next_exam_date is not null
    union all
    select company_id,id,follow_up_owner_id,'medical_followup_due','medical_surveillance',follow_up_date
      from public.medical_surveillance where follow_up_required=true and status not in ('cancelled') and follow_up_date is not null
    union all
    select company_id,id,follow_up_owner_id,'exposure_reassessment_due','exposure_monitoring',reassessment_date
      from public.exposure_monitoring where status<>'closed' and reassessment_date is not null
    union all
    select company_id,id,null::uuid,'vaccination_dose_due','vaccination_records',next_dose_date
      from public.vaccination_records where status not in ('declined','not_applicable') and next_dose_date is not null
    union all
    select company_id,id,null::uuid,'audiometry_retest_due','audiometry_records',next_test_date
      from public.audiometry_records where next_test_date is not null
    union all
    select company_id,id,null::uuid,'spirometry_retest_due','spirometry_records',next_test_date
      from public.spirometry_records where next_test_date is not null
  ), milestones as (
    select d.*,case when due_date>p_run_date+7 then '30-day'
      when due_date>p_run_date then '7-day' when due_date=p_run_date then 'due'
      else 'overdue-'||((p_run_date-due_date-1)/7)::text end as milestone
    from due d where due_date<=p_run_date+30
  )
  insert into public.notification_queue
    (company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,status,channel,priority,
     related_id,related_table,related_module,idempotency_key,metadata)
  select d.company_id,p.id,d.kind,'Occupational Health review due',
    '<p>An Occupational Health item needs review. Sign in and open the restricted record to assess and complete it.</p>',
    coalesce(nullif(p.real_email,''),p.email),p.full_name,'pending','email',
    case when d.due_date<p_run_date then 'high' else 'normal' end,d.id,d.source,'ohealth',
    'ohealth-due/'||d.kind||'/'||d.id::text||'/'||d.due_date::text||'/'||d.milestone||'/'||p.id::text,
    jsonb_build_object('due_date',d.due_date,'milestone',d.milestone,'source',d.source)
  from milestones d join public.profiles p on p.company_id=d.company_id and p.status='active'
    and p.role in ('occupational_health','sephs_admin')
    and (d.follow_up_owner_id is null or p.id=d.follow_up_owner_id)
  left join public.notification_user_preferences pref on pref.company_id=p.company_id and pref.profile_id=p.id
  where coalesce(pref.email_enabled,true)
    and coalesce(nullif(p.real_email,''),p.email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and coalesce(nullif(p.real_email,''),p.email) !~* '\.local$'
  on conflict do nothing;
  get diagnostics v_queued=row_count;
  return jsonb_build_object('run_date',p_run_date,'notifications_queued',v_queued);
end $$;
revoke all on function public.process_occupational_health_reminders(date) from public, anon, authenticated;
grant execute on function public.process_occupational_health_reminders(date) to service_role;
