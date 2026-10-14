-- Fire certificate succession, inspection decisions and service evidence.
alter table public.fire_certificates add column if not exists supersedes_certificate_id uuid references public.fire_certificates(id);
alter table public.fire_certificates add column if not exists site_id uuid references public.sites(id);
alter table public.fire_equipment add column if not exists site_id uuid references public.sites(id);
alter table public.fire_inspection_findings add column if not exists action_id uuid references public.action_tracker(id);
alter table public.fire_inspections alter column overall_result set default 'pending';
alter table public.fire_inspections add constraint fire_inspection_closed_result_check
  check (status<>'closed' or overall_result is distinct from 'pending') not valid;

create function public.fire_reference_scope() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_table_name='fire_certificates' then
    if new.supersedes_certificate_id=new.id then raise exception 'A certificate cannot replace itself'; end if;
    if new.supersedes_certificate_id is not null and not exists
      (select 1 from public.fire_certificates old where old.id=new.supersedes_certificate_id and old.company_id=new.company_id) then
      raise exception 'Previous certificate must belong to the same company';
    end if;
  end if;
  if new.site_id is not null and not exists
    (select 1 from public.sites s where s.id=new.site_id and s.company_id=new.company_id) then
    raise exception 'Site or area must belong to the same company';
  end if;
  return new;
end $$;
create trigger fire_certificate_reference_scope before insert or update of supersedes_certificate_id,site_id,company_id
  on public.fire_certificates for each row execute function public.fire_reference_scope();
create trigger fire_equipment_reference_scope before insert or update of site_id,company_id
  on public.fire_equipment for each row execute function public.fire_reference_scope();

create table public.fire_equipment_services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  equipment_id uuid not null references public.fire_equipment(id),
  service_date date not null,
  next_due_date date,
  performed_by text not null,
  result text not null check (result in ('passed','requires_attention','failed')),
  notes text,
  recorded_by uuid,
  created_at timestamptz not null default now()
);
create index fire_equipment_services_item_date on public.fire_equipment_services(company_id,equipment_id,service_date desc);
alter table public.fire_equipment_services enable row level security;
create policy fire_equipment_services_read on public.fire_equipment_services for select to authenticated
  using (company_id=public.auth_company_id() or public.is_sephs_admin());
revoke all on public.fire_equipment_services from public,anon,authenticated;
grant select on public.fire_equipment_services to authenticated;

create function public.record_fire_equipment_service(
  p_company_id uuid,p_equipment_id uuid,p_service_date date,p_next_due_date date,
  p_performed_by text,p_result text,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare actor public.profiles; item public.fire_equipment; event_id uuid;
begin
  select * into actor from public.profiles where id=auth.uid();
  if not found or actor.status is distinct from 'active'
    or actor.role not in ('sephs_admin','admin','manager','hse_manager','site_manager')
    or (actor.role<>'sephs_admin' and actor.company_id is distinct from p_company_id) then
    raise exception 'Manager access is required for fire equipment service' using errcode='42501';
  end if;
  if p_service_date is null or p_service_date>current_date or p_next_due_date is null
    or p_next_due_date<=p_service_date or length(btrim(coalesce(p_performed_by,'')))<2
    or p_result not in ('passed','requires_attention','failed') then
    raise exception 'Complete the service date, next due date, technician and result';
  end if;
  select * into item from public.fire_equipment where id=p_equipment_id and company_id=p_company_id for update;
  if not found then raise exception 'Fire equipment is unavailable in this company'; end if;
  insert into public.fire_equipment_services
    (company_id,equipment_id,service_date,next_due_date,performed_by,result,notes,recorded_by)
  values (p_company_id,p_equipment_id,p_service_date,p_next_due_date,btrim(p_performed_by),p_result,
    nullif(btrim(p_notes),''),actor.id) returning id into event_id;
  update public.fire_equipment set last_service_date=p_service_date,next_service_date=p_next_due_date,
    status=case when p_result='passed' then 'operational' when p_result='failed' then 'defective' else 'requires_service' end,updated_at=now()
    where id=p_equipment_id and company_id=p_company_id;
  return event_id;
end $$;
revoke all on function public.record_fire_equipment_service(uuid,uuid,date,date,text,text,text) from public,anon,authenticated;
grant execute on function public.record_fire_equipment_service(uuid,uuid,date,date,text,text,text) to authenticated;

create function public.fire_finding_action() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare inspection public.fire_inspections; action_uuid uuid;
begin
  if nullif(btrim(new.action_required),'') is null then return new; end if;
  select * into inspection from public.fire_inspections where id=new.inspection_id and company_id=new.company_id;
  if not found then raise exception 'Finding must belong to the same company as its inspection'; end if;
  insert into public.action_tracker
    (company_id,source_module,source_type,source_id,source_ref,title,description,responsible,
     target_date,priority,status,created_by)
  values (new.company_id,'inspection','inspection',new.inspection_id,
    'Fire inspection '||inspection.inspection_date::text,left(new.finding,80),new.action_required,
    nullif(btrim(new.responsible_person),''),new.due_date,
    case when new.severity='critical' then 'critical' when new.severity='major' then 'high' else 'medium' end,
    'open',auth.uid()) returning id into action_uuid;
  update public.fire_inspection_findings set action_id=action_uuid where id=new.id and company_id=new.company_id;
  return new;
end $$;
create trigger fire_finding_action after insert on public.fire_inspection_findings
for each row execute function public.fire_finding_action();

create function public.process_fire_due_reminders(p_run_date date default current_date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare queued integer:=0; inserted_count integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  with due as (
    select c.company_id,c.id,'fire_certificate_expiry'::text kind,c.expiry_date due_date,
      coalesce(nullif(c.cert_number,''),c.premises_name) reference,'fire_certificates'::text table_name
    from public.fire_certificates c where c.status not in ('archived','suspended') and c.expiry_date is not null
    union all
    select e.company_id,e.id,'fire_equipment_service',e.next_service_date,
      coalesce(nullif(e.serial_number,''),e.description,e.location),'fire_equipment'
    from public.fire_equipment e where e.status not in ('decommissioned','out_of_service') and e.next_service_date is not null
    union all
    select f.company_id,f.id,'fire_finding_followup',f.due_date,left(f.finding,80),'fire_inspection_findings'
    from public.fire_inspection_findings f left join public.action_tracker a
      on a.id=f.action_id and a.company_id=f.company_id
    where f.status<>'closed' and f.due_date is not null and (a.id is null or a.status<>'closed')
  ), milestones as (
    select d.*,case when d.due_date>p_run_date+7 then '30-day'
      when d.due_date>p_run_date then '7-day'
      when d.due_date=p_run_date then 'due'
      else 'overdue-'||((p_run_date-d.due_date-1)/7)::text end milestone
    from due d where d.due_date<=p_run_date+30
  )
  insert into public.notification_queue
    (company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,status,channel,
     priority,related_id,related_table,related_module,related_ref,idempotency_key,metadata)
  select d.company_id,p.id,d.kind,
    case d.kind when 'fire_certificate_expiry' then 'Fire certificate expiry: '
      when 'fire_equipment_service' then 'Fire equipment service due: ' else 'Fire inspection finding due: ' end||d.reference,
    '<p>Review the linked Fire Certificates record and record the responsible follow-up.</p>',
    coalesce(nullif(p.real_email,''),p.email),p.full_name,'pending','in_app',
    case when d.due_date<p_run_date then 'high' else 'normal' end,
    d.id,d.table_name,'fire',d.reference,
    'fire-due/'||d.kind||'/'||d.id::text||'/'||d.due_date::text||'/'||d.milestone||'/'||p.id::text,
    jsonb_build_object('due_date',d.due_date,'milestone',d.milestone)
  from milestones d join public.profiles p on p.company_id=d.company_id and p.status='active'
    and p.role in ('sephs_admin','admin','manager','hse_manager','site_manager')
  where coalesce(nullif(p.real_email,''),p.email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and coalesce(nullif(p.real_email,''),p.email) !~* '\.local$'
  on conflict do nothing;
  get diagnostics inserted_count=row_count;queued:=queued+inserted_count;
  return jsonb_build_object('run_date',p_run_date,'notifications_queued',queued);
end $$;
revoke all on function public.process_fire_due_reminders(date) from public,anon,authenticated;
grant execute on function public.process_fire_due_reminders(date) to service_role;
