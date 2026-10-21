-- auris360: allow-data-migration
-- PPE stock movements preserve the reason and balance for every manual change.
create table public.ppe_stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  ppe_id uuid not null references public.ppe_catalogue(id),
  movement_type text not null check (movement_type in ('opening','receipt','adjustment')),
  quantity_delta integer not null,
  reason text not null check (length(btrim(reason)) >= 4),
  source_reference text,
  available_before integer not null,
  available_after integer not null,
  total_before integer not null,
  total_after integer not null,
  recorded_by uuid,
  created_at timestamptz not null default now(),
  constraint ppe_stock_movement_delta_check check (movement_type='opening' or quantity_delta<>0),
  constraint ppe_stock_movement_balance_check check (movement_type='opening' or (available_after>=0 and total_after>=0))
);
create index ppe_stock_movements_item_date on public.ppe_stock_movements(company_id,ppe_id,created_at desc);
alter table public.ppe_stock_movements enable row level security;
create policy ppe_stock_movements_read on public.ppe_stock_movements for select to authenticated
  using (company_id=public.auth_company_id() or public.is_sephs_admin());
revoke all on public.ppe_stock_movements from public,anon,authenticated;
grant select on public.ppe_stock_movements to authenticated;

insert into public.ppe_stock_movements
  (company_id,ppe_id,movement_type,quantity_delta,reason,available_before,available_after,total_before,total_after,recorded_by)
select company_id,id,'opening',coalesce(quantity_available,0),
  'Opening balance when PPE transaction tracking began',0,coalesce(quantity_available,0),0,coalesce(quantity_total,0),created_by
from public.ppe_catalogue where company_id is not null;

create function public.ppe_stock_opening() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.ppe_stock_movements
    (company_id,ppe_id,movement_type,quantity_delta,reason,available_before,available_after,total_before,total_after,recorded_by)
  values (new.company_id,new.id,'opening',coalesce(new.quantity_available,0),
    'Opening balance on PPE catalogue creation',0,coalesce(new.quantity_available,0),0,coalesce(new.quantity_total,0),new.created_by);
  return new;
end $$;
create trigger ppe_stock_opening after insert on public.ppe_catalogue
for each row execute function public.ppe_stock_opening();

create function public.ppe_stock_catalogue_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if (new.quantity_total,new.quantity_available,new.quantity_issued,new.quantity_condemned)
     is distinct from (old.quantity_total,old.quantity_available,old.quantity_issued,old.quantity_condemned)
     and auth.role() is distinct from 'service_role'
     and current_setting('auris.ppe_stock_change',true) is distinct from 'on' then
    raise exception 'Use a PPE stock receipt or adjustment to change stock balances';
  end if;
  return new;
end $$;
create trigger ppe_stock_catalogue_guard before update on public.ppe_catalogue
for each row execute function public.ppe_stock_catalogue_guard();

-- The existing issuance trigger remains atomic with its catalogue update.
create or replace function public.ppe_update_stock_for_issuance() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare available_delta integer; issued_delta integer; old_credit integer; new_credit integer;
begin
  if new.ppe_id is null then return new; end if;
  if tg_op='INSERT' then
    available_delta := -new.quantity;
    issued_delta := new.quantity;
  else
    old_credit := case when old.status='returned' and old.return_condition='good' then old.quantity else 0 end;
    new_credit := case when new.status='returned' and new.return_condition='good' then new.quantity else 0 end;
    available_delta := new_credit-old_credit;
    issued_delta := (case when new.status='active' then new.quantity else 0 end)
                   -(case when old.status='active' then old.quantity else 0 end);
  end if;
  if available_delta=0 and issued_delta=0 then return new; end if;
  perform set_config('auris.ppe_stock_change','on',true);
  update public.ppe_catalogue c
  set quantity_available=coalesce(c.quantity_available,0)+available_delta,
      quantity_issued=greatest(0,coalesce(c.quantity_issued,0)+issued_delta),updated_at=now()
  where c.id=new.ppe_id and c.company_id=new.company_id
    and coalesce(c.quantity_available,0)+available_delta>=0;
  if not found then raise exception 'PPE stock unavailable or item belongs to another company'; end if;
  perform set_config('auris.ppe_stock_change','off',true);
  return new;
end $$;

create function public.ppe_stock_immutable() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'PPE stock movements are immutable';
end $$;
create trigger ppe_stock_immutable before update or delete on public.ppe_stock_movements
for each row execute function public.ppe_stock_immutable();

create function public.record_ppe_stock_movement(
  p_company_id uuid,p_ppe_id uuid,p_movement_type text,p_quantity_delta integer,
  p_reason text,p_source_reference text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor public.profiles; item public.ppe_catalogue; movement_id uuid;
begin
  select * into actor from public.profiles where id=auth.uid();
  if not found or actor.status is distinct from 'active' or actor.role is null
     or actor.role not in ('sephs_admin','admin','manager','hse_manager','site_manager')
     or (actor.role<>'sephs_admin' and actor.company_id is distinct from p_company_id) then
    raise exception 'Manager access is required for PPE stock movements' using errcode='42501';
  end if;
  if p_movement_type not in ('receipt','adjustment') or p_movement_type is null
     or p_quantity_delta is null or p_quantity_delta=0 or abs(p_quantity_delta)>100000
     or (p_movement_type='receipt' and p_quantity_delta<0) then
    raise exception 'Enter a valid receipt or signed stock adjustment';
  end if;
  if length(btrim(coalesce(p_reason,'')))<4 then raise exception 'Enter a reason of at least four characters'; end if;
  select * into item from public.ppe_catalogue
    where id=p_ppe_id and company_id=p_company_id for update;
  if not found then raise exception 'PPE item is unavailable in this company'; end if;
  if coalesce(item.quantity_available,0)+p_quantity_delta<0
     or coalesce(item.quantity_total,0)+p_quantity_delta<0 then
    raise exception 'Stock adjustment would make the balance negative';
  end if;
  perform set_config('auris.ppe_stock_change','on',true);
  update public.ppe_catalogue set
    quantity_available=coalesce(quantity_available,0)+p_quantity_delta,
    quantity_total=coalesce(quantity_total,0)+p_quantity_delta,updated_at=now()
    where id=item.id and company_id=p_company_id;
  perform set_config('auris.ppe_stock_change','off',true);
  insert into public.ppe_stock_movements
    (company_id,ppe_id,movement_type,quantity_delta,reason,source_reference,
     available_before,available_after,total_before,total_after,recorded_by)
  values (p_company_id,p_ppe_id,p_movement_type,p_quantity_delta,btrim(p_reason),nullif(btrim(p_source_reference),''),
    coalesce(item.quantity_available,0),coalesce(item.quantity_available,0)+p_quantity_delta,
    coalesce(item.quantity_total,0),coalesce(item.quantity_total,0)+p_quantity_delta,actor.id)
  returning id into movement_id;
  return jsonb_build_object('movement_id',movement_id,'available',coalesce(item.quantity_available,0)+p_quantity_delta,
    'total',coalesce(item.quantity_total,0)+p_quantity_delta);
end $$;
revoke all on function public.record_ppe_stock_movement(uuid,uuid,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.record_ppe_stock_movement(uuid,uuid,text,integer,text,text) to authenticated;

-- Milestone-based in-app reminders avoid duplicate notifications on daily runs.
create function public.process_ppe_due_reminders(p_run_date date default current_date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare queued_count integer:=0; inserted_count integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  with due as (
    select i.company_id,i.id,'ppe_inspection_due'::text kind,
      coalesce(nullif(i.issuance_ref,''),i.ppe_name) reference,
      coalesce(latest.next_inspection_date,latest.inspection_date+coalesce(c.inspection_interval_days,90),
        i.issued_date+coalesce(c.inspection_interval_days,90)) due_date
    from public.ppe_issuance i
    join public.ppe_catalogue c on c.id=i.ppe_id and c.company_id=i.company_id
    left join lateral (
      select x.next_inspection_date,x.inspection_date from public.ppe_inspections x
      where x.issuance_id=i.id and x.company_id=i.company_id
      order by x.inspection_date desc,x.created_at desc limit 1
    ) latest on true
    where i.status='active'
    union all
    select i.company_id,i.id,'ppe_replacement_due',
      coalesce(nullif(i.issuance_ref,''),i.ppe_name),
      least(coalesce(i.expected_replacement_date,i.expiry_date),coalesce(i.expiry_date,i.expected_replacement_date))
    from public.ppe_issuance i
    where i.status='active' and (i.expected_replacement_date is not null or i.expiry_date is not null)
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
    case when d.kind='ppe_inspection_due' then 'PPE inspection due: ' else 'PPE replacement due: ' end || d.reference,
    '<p>Review the linked PPE issuance and record the required inspection or replacement decision.</p>',
    coalesce(nullif(p.real_email,''),p.email),p.full_name,'pending','in_app',
    case when d.due_date<p_run_date then 'high' else 'normal' end,
    d.id,'ppe_issuance','ppe',d.reference,
    'ppe-due/'||d.kind||'/'||d.id::text||'/'||d.due_date::text||'/'||d.milestone||'/'||p.id::text,
    jsonb_build_object('due_date',d.due_date,'milestone',d.milestone)
  from milestones d join public.profiles p on p.company_id=d.company_id and p.status='active'
    and p.role in ('sephs_admin','admin','manager','hse_manager','site_manager')
  where coalesce(nullif(p.real_email,''),p.email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and coalesce(nullif(p.real_email,''),p.email) !~* '\.local$'
  on conflict do nothing;
  get diagnostics inserted_count=row_count; queued_count:=queued_count+inserted_count;

  insert into public.notification_queue
    (company_id,recipient_profile_id,type,subject,body_html,to_email,to_name,status,channel,
     priority,related_id,related_table,related_module,related_ref,idempotency_key,metadata)
  select c.company_id,p.id,'ppe_reorder_suggestion',
    'PPE stock below threshold: '||coalesce(nullif(c.ppe_code,''),c.name),
    '<p>Available PPE stock is at or below its reorder level. Review the suggested receipt in PPE Management.</p>',
    coalesce(nullif(p.real_email,''),p.email),p.full_name,'pending','in_app','normal',
    c.id,'ppe_catalogue','ppe',coalesce(nullif(c.ppe_code,''),c.name),
    'ppe-reorder/'||c.id::text||'/'||p_run_date::text||'/'||p.id::text,
    jsonb_build_object('available',c.quantity_available,'reorder_level',c.reorder_level,
      'minimum_receipt',greatest(0,coalesce(c.reorder_level,0)+1-coalesce(c.quantity_available,0)))
  from public.ppe_catalogue c
  join public.profiles p on p.company_id=c.company_id and p.status='active'
    and p.role in ('sephs_admin','admin','manager','hse_manager','site_manager')
  where c.status='active' and c.reorder_level is not null and c.quantity_available<=c.reorder_level
    and coalesce(nullif(p.real_email,''),p.email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and coalesce(nullif(p.real_email,''),p.email) !~* '\.local$'
    and extract(isodow from p_run_date)=1
  on conflict do nothing;
  get diagnostics inserted_count=row_count; queued_count:=queued_count+inserted_count;
  return jsonb_build_object('run_date',p_run_date,'notifications_queued',queued_count);
end $$;
revoke all on function public.process_ppe_due_reminders(date) from public,anon,authenticated;
grant execute on function public.process_ppe_due_reminders(date) to service_role;
