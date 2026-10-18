-- Planned milestones are separate from the actual collection/disposal evidence.
alter table public.hazardous_waste add column planned_collection_date date;
alter table public.hazardous_waste add column planned_disposal_date date;
alter table public.hazardous_waste add column responsible_profile_id uuid references public.profiles(id);
alter table public.fuel_consumption add column equipment_id uuid references public.tools_register(id);
alter table public.fuel_consumption add column document_reference text;
alter table public.water_usage add column document_reference text;
alter table public.fuel_consumption add column factor_source_url text;
alter table public.fuel_consumption add column factor_scope text;
alter table public.fuel_consumption add column factor_confirmed boolean not null default false;

create function public.esg_fuel_assurance_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare estimate_changed boolean; reference_value numeric;
begin
  if new.equipment_id is not null and not exists (select 1 from public.tools_register t
    where t.id=new.equipment_id and t.company_id=new.company_id) then
    raise exception 'Linked vehicle/equipment must belong to the selected company'; end if;
  estimate_changed:=tg_op='INSERT';
  if tg_op='UPDATE' then
    estimate_changed:=new.carbon_kg is distinct from old.carbon_kg
      or new.factor_value is distinct from old.factor_value or new.factor_unit is distinct from old.factor_unit
      or new.factor_source is distinct from old.factor_source or new.factor_version is distinct from old.factor_version
      or new.factor_source_url is distinct from old.factor_source_url or new.factor_scope is distinct from old.factor_scope
      or new.factor_confirmed is distinct from old.factor_confirmed
      or (new.carbon_kg is not null and (new.quantity is distinct from old.quantity
        or new.unit is distinct from old.unit or new.fuel_type is distinct from old.fuel_type));
  end if;
  if estimate_changed and new.carbon_kg is not null then
    if not new.factor_confirmed or new.factor_value is null or new.factor_value<0
      or new.factor_value::text in ('NaN','Infinity','-Infinity')
      or new.quantity is null or new.quantity<=0 or new.quantity::text in ('NaN','Infinity','-Infinity')
      or new.factor_unit is distinct from ('kg CO2e/'||new.unit)
      or nullif(btrim(new.factor_source),'') is null or nullif(btrim(new.factor_version),'') is null
      or coalesce(new.factor_source_url,'') !~ '^https://[^/@[:space:]]+\.[^/@[:space:]]+'
      or new.factor_source_url ~ '^https://[^/?#]*@'
      or nullif(btrim(new.factor_scope),'') is null then
      raise exception 'An emissions estimate requires a sourced factor, version, evidence URL, scope and explicit applicability confirmation';
    end if;
    if new.factor_source like 'UK DESNZ 2026;%' then
      reference_value:=case new.fuel_type when 'diesel' then 2.66155 when 'petrol' then 2.35372
        when 'lpg' then 1.55713 when 'natural_gas' then 2.04987 when 'heavy_fuel_oil' then 3.17492 end;
      if reference_value is null or new.factor_value<>reference_value then
        raise exception 'The selected DESNZ 2026 reference does not match this fuel'; end if;
    end if;
    if new.carbon_kg<>round(new.quantity*new.factor_value,2) then
      raise exception 'Emissions estimate must equal quantity multiplied by the recorded factor'; end if;
  end if;
  return new;
end $$;
create trigger esg_fuel_assurance_guard before insert or update on public.fuel_consumption
for each row execute function public.esg_fuel_assurance_guard();

create function public.esg_hazardous_milestone_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then
    update public.notification_queue set status='cancelled'
    where company_id=old.company_id and related_table='hazardous_waste' and related_id=old.id
      and type='hazardous_waste_milestone' and status in ('pending','sent');
    update public.user_notifications u set dismissed_at=coalesce(u.dismissed_at,now()),updated_at=now()
    from public.notification_queue q where u.source_notification_id=q.id and q.company_id=old.company_id
      and q.related_table='hazardous_waste' and q.related_id=old.id and q.type='hazardous_waste_milestone';
    return old;
  end if;
  if new.responsible_profile_id is not null and not exists (select 1 from public.profiles p
    where p.id=new.responsible_profile_id and p.company_id=new.company_id) then
    raise exception 'Milestone owner must belong to the selected company'; end if;
  if new.planned_collection_date>new.planned_disposal_date then
    raise exception 'Planned disposal cannot precede planned collection'; end if;
  if tg_op='UPDATE' then
    update public.notification_queue q set status='cancelled'
    where q.company_id=old.company_id and q.related_table='hazardous_waste' and q.related_id=old.id
      and q.type='hazardous_waste_milestone' and q.status in ('pending','sent')
      and (new.status='disposed' or new.company_id is distinct from old.company_id or new.responsible_profile_id is distinct from old.responsible_profile_id
        or (q.metadata->>'kind'='collection' and (new.collection_date is not null
          or new.planned_collection_date is distinct from old.planned_collection_date))
        or (q.metadata->>'kind'='disposal' and (new.disposal_date is not null
          or new.planned_disposal_date is distinct from old.planned_disposal_date)));
    update public.user_notifications u set dismissed_at=coalesce(u.dismissed_at,now()),updated_at=now()
    from public.notification_queue q where u.source_notification_id=q.id and q.company_id=old.company_id
      and q.related_table='hazardous_waste' and q.related_id=old.id
      and q.type='hazardous_waste_milestone' and q.status='cancelled' and u.dismissed_at is null;
  end if;
  return new;
end $$;
create trigger esg_hazardous_milestone_guard before insert or update or delete on public.hazardous_waste
for each row execute function public.esg_hazardous_milestone_guard();
revoke all on function public.esg_hazardous_milestone_guard() from public,anon,authenticated;

create function public.process_environmental_due_reminders(p_run_date date default current_date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare queued integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  with due as (
    select w.company_id,w.id,w.waste_name,w.responsible_profile_id,'collection'::text kind,w.planned_collection_date due_date
    from public.hazardous_waste w where w.status<>'disposed' and w.collection_date is null
      and w.planned_collection_date<=p_run_date+7
    union all
    select w.company_id,w.id,w.waste_name,w.responsible_profile_id,'disposal',w.planned_disposal_date
    from public.hazardous_waste w where w.status<>'disposed' and w.disposal_date is null
      and w.planned_disposal_date<=p_run_date+7
  ), milestones as (
    select d.*,case when due_date>p_run_date then '7-day' when due_date=p_run_date then 'due'
      else 'overdue-'||((p_run_date-due_date-1)/7)::text end milestone from due d
  )
  insert into public.notification_queue
    (company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,status,sent_at,channel,priority,
     related_id,related_table,related_module,related_ref,record_url,idempotency_key,metadata)
  select d.company_id,p.id,'hazardous_waste_milestone','Hazardous waste '||d.kind||' due: '||d.waste_name,
    '<p>Open the linked waste record, confirm the planned milestone and record the actual completion date.</p>',
    '',p.full_name,'sent',now(),'in_app',
    case when d.due_date<p_run_date then 'high' else 'normal' end,
    d.id,'hazardous_waste','esg',d.waste_name,
    'https://auris360.app/?goto=esg&table=hazardous_waste&record='||d.id||'&company='||d.company_id,
    'esg-waste/'||d.id||'/'||d.kind||'/'||d.due_date||'/'||d.milestone||'/'||p.id,
    jsonb_build_object('kind',d.kind,'due_date',d.due_date,'milestone',d.milestone)
  from milestones d join public.profiles p on p.company_id=d.company_id and p.status='active'
    and ((d.responsible_profile_id is not null and p.id=d.responsible_profile_id)
      or (d.responsible_profile_id is null and p.role in ('sephs_admin','company_admin','admin','manager','hse_manager','site_manager')))
  on conflict do nothing;
  get diagnostics queued=row_count;
  return jsonb_build_object('run_date',p_run_date,'notifications_queued',queued);
end $$;
revoke all on function public.process_environmental_due_reminders(date) from public,anon,authenticated;
grant execute on function public.process_environmental_due_reminders(date) to service_role;
