-- Idempotent in-app reminders for assigned equipment and fleet follow-up.
create or replace function public.process_equipment_due_reminders(p_run_date date default current_date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_queued integer := 0;
  v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;

  -- The assignee must resolve to an active account with a real email address.
  insert into public.notification_queue
    (company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,
     status,channel,priority,related_id,related_table,related_module,related_ref,
     idempotency_key,metadata)
  select t.company_id,p.id,'equipment_inspection_due',
    'Equipment inspection due: ' || coalesce(t.ref_number,t.registration_number,t.name),
    '<p>Your assigned equipment has an inspection due. Open Tools &amp; Equipment to complete or arrange the check.</p>',
    coalesce(nullif(p.real_email,''),p.email),p.full_name,'pending','in_app',
    case when due.due_date < p_run_date then 'high' else 'normal' end,
    t.id,'tools_register','tools',coalesce(t.ref_number,t.registration_number,t.name),
    'equipment-check/' || t.id::text || '/' || due.due_date::text || '/' || p_run_date::text,
    jsonb_build_object('due_date',due.due_date,'frequency',t.inspection_frequency)
  from public.tools_register t
  join public.people person on person.id=t.assigned_to and person.company_id=t.company_id
  join public.profiles p on p.company_id=t.company_id and p.status='active'
    and lower(coalesce(nullif(p.real_email,''),p.email))=lower(person.email)
  cross join lateral (
    select coalesce(
      case when t.inspection_frequency='statutory' then t.next_statutory_date end,
      (select coalesce(i.next_inspection_date,
        i.inspection_date + case t.inspection_frequency
          when 'daily' then 1 when 'weekly' then 7 when 'monthly' then 30
          when 'quarterly' then 90 when 'annual' then 365 else 30 end)
       from public.tool_inspections i where i.tool_id=t.id and i.company_id=t.company_id
         and coalesce(i.status,'active')='active'
       order by i.inspection_date desc,i.created_at desc limit 1),
      t.created_at::date + case t.inspection_frequency
        when 'daily' then 1 when 'weekly' then 7 when 'monthly' then 30
        when 'quarterly' then 90 when 'annual' then 365 else 30 end
    ) as due_date
  ) due
  where t.status='active' and person.status='active' and person.email is not null
    and coalesce(nullif(p.real_email,''),p.email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and coalesce(nullif(p.real_email,''),p.email) !~* '\.local$'
    and due.due_date <= p_run_date + 7
  on conflict do nothing;
  get diagnostics v_count = row_count;
  v_queued := v_queued + v_count;

  insert into public.notification_queue
    (company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,
     status,channel,priority,related_id,related_table,related_module,related_ref,
     idempotency_key,metadata)
  select s.company_id,p.id,'fleet_service_due',
    'Vehicle service due: ' || coalesce(t.registration_number,t.ref_number,t.name),
    '<p>A registered vehicle has a service due. Review its service record in Fleet Management.</p>',
    coalesce(nullif(p.real_email,''),p.email),p.full_name,'pending','in_app',
    case when s.next_due_date < p_run_date then 'high' else 'normal' end,
    s.id,'equipment_maintenance_events','fleet',s.reference,
    'fleet-service/' || s.id::text || '/' || s.next_due_date::text || '/' || p_run_date::text || '/' || p.id::text,
    jsonb_build_object('due_date',s.next_due_date,'vehicle_id',t.id)
  from public.equipment_maintenance_events s
  join public.tools_register t on t.id=s.equipment_id and t.company_id=s.company_id and t.is_vehicle=true
  join public.profiles p on p.company_id=s.company_id and p.status='active'
    and p.role in ('sephs_admin','admin','manager','hse_manager','site_manager')
  where s.status='completed' and s.next_due_date <= p_run_date + 7
    and s.id=(select latest.id from public.equipment_maintenance_events latest
      where latest.equipment_id=s.equipment_id and latest.company_id=s.company_id
        and latest.status='completed' and latest.next_due_date is not null
      order by latest.completed_date desc,latest.created_at desc limit 1)
    and coalesce(nullif(p.real_email,''),p.email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and coalesce(nullif(p.real_email,''),p.email) !~* '\.local$'
  on conflict do nothing;
  get diagnostics v_count = row_count;
  v_queued := v_queued + v_count;

  insert into public.notification_queue
    (company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,
     status,channel,priority,related_id,related_table,related_module,related_ref,
     idempotency_key,metadata)
  select a.company_id,p.id,'equipment_document_expiry',
    'Equipment document expiry: ' || a.reference,
    '<p>An equipment certificate or assurance document is approaching expiry. Review it in Tools &amp; Equipment.</p>',
    coalesce(nullif(p.real_email,''),p.email),p.full_name,'pending','in_app',
    case when a.expiry_date < p_run_date then 'high' else 'normal' end,
    a.id,'equipment_assurance_records','tools',a.reference,
    'equipment-document/' || a.id::text || '/' || a.expiry_date::text || '/' || p_run_date::text || '/' || p.id::text,
    jsonb_build_object('expiry_date',a.expiry_date,'equipment_id',a.equipment_id)
  from public.equipment_assurance_records a
  join public.profiles p on p.company_id=a.company_id and p.status='active'
    and p.role in ('sephs_admin','admin','manager','hse_manager','site_manager')
  where a.expiry_date is not null and a.expiry_date <= p_run_date + 30
    and a.validation_status='validated'
    and coalesce(nullif(p.real_email,''),p.email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and coalesce(nullif(p.real_email,''),p.email) !~* '\.local$'
  on conflict do nothing;
  get diagnostics v_count = row_count;
  v_queued := v_queued + v_count;
  return jsonb_build_object('run_date',p_run_date,'notifications_queued',v_queued);
end;
$$;
revoke all on function public.process_equipment_due_reminders(date) from public, anon, authenticated;
grant execute on function public.process_equipment_due_reminders(date) to service_role;
