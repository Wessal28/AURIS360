-- Remind active Emergency managers of dated, actionable records. A milestone key
-- prevents duplicate mail when a cron run is retried or runs daily.
create or replace function public.process_emergency_due_reminders(p_run_date date default current_date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_queued integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;

  with due as (
    select company_id,id,'emergency_plan_review'::text as kind,'emergency_plans'::text as source,
      coalesce(nullif(plan_ref,''),title) as reference,review_date as due_date
      from public.emergency_plans where status='active' and review_date is not null
    union all
    select company_id,id,'emergency_drill_due','emergency_drills',coalesce(nullif(drill_ref,''),'Planned drill'),drill_date
      from public.emergency_drills where status='planned' and drill_date is not null
    union all
    select company_id,id,'ert_first_aid_expiry','ert_members',name,first_aid_expiry
      from public.ert_members where status='active' and first_aid_certified=true and first_aid_expiry is not null
    union all
    select company_id,id,'ert_fire_warden_expiry','ert_members',name,fire_warden_expiry
      from public.ert_members where status='active' and fire_warden_certified=true and fire_warden_expiry is not null
    union all
    select company_id,id,'emergency_equipment_inspection','emergency_equipment',coalesce(nullif(identifier,''),equipment_type),next_inspection
      from public.emergency_equipment where status='operational' and next_inspection is not null
    union all
    select company_id,id,'emergency_equipment_service','emergency_equipment',coalesce(nullif(identifier,''),equipment_type),next_service
      from public.emergency_equipment where status='operational' and next_service is not null
  ), milestones as (
    select d.*,case
      when due_date > p_run_date + 7 then '30-day'
      when due_date > p_run_date then '7-day'
      when due_date = p_run_date then 'due'
      else 'overdue-' || ((p_run_date-due_date-1)/7)::text end as milestone
    from due d where due_date <= p_run_date + 30
  )
  insert into public.notification_queue
    (company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,
     status,channel,priority,related_id,related_table,related_module,related_ref,
     idempotency_key,metadata)
  select d.company_id,p.id,d.kind,
    'Emergency Management: ' || replace(replace(d.reference,E'\n',' '),E'\r',' '),
    '<p>An Emergency Management item is due for review. Open Emergency Management to check the record and complete the required human review.</p>',
    coalesce(nullif(p.real_email,''),p.email),p.full_name,'pending','email',
    case when d.due_date < p_run_date then 'high' else 'normal' end,
    d.id,d.source,'emergency',d.reference,
    'emergency-due/' || d.kind || '/' || d.id::text || '/' || d.due_date::text || '/' || d.milestone || '/' || p.id::text,
    jsonb_build_object('due_date',d.due_date,'milestone',d.milestone,'source',d.source)
  from milestones d
  join public.profiles p on p.company_id=d.company_id and p.status='active'
    and p.role in ('sephs_admin','admin','manager','hse_manager','site_manager')
  left join public.notification_user_preferences pref on pref.company_id=p.company_id and pref.profile_id=p.id
  where coalesce(pref.email_enabled,true)
    and coalesce(nullif(p.real_email,''),p.email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and coalesce(nullif(p.real_email,''),p.email) !~* '\.local$'
  on conflict do nothing;
  get diagnostics v_queued = row_count;
  return jsonb_build_object('run_date',p_run_date,'notifications_queued',v_queued);
end;
$$;
revoke all on function public.process_emergency_due_reminders(date) from public, anon, authenticated;
grant execute on function public.process_emergency_due_reminders(date) to service_role;
