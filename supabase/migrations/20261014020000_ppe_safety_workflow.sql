-- PPE inspection and stock transitions must remain consistent even when written
-- outside the browser. Existing records are retained; new decisions are explicit.
alter table public.ppe_issuance drop constraint if exists ppe_issuance_status_check;
alter table public.ppe_issuance add constraint ppe_issuance_status_check
  check (status in ('active','quarantined','returned','expired','lost','condemned'));
alter table public.ppe_inspections alter column overall_result drop default;
alter table public.ppe_replacements add column if not exists inspection_id uuid references public.ppe_inspections(id) on delete set null;
alter table public.ppe_replacements add column if not exists new_issuance_id uuid references public.ppe_issuance(id) on delete set null;
create unique index if not exists ppe_replacement_per_inspection on public.ppe_replacements(inspection_id) where inspection_id is not null;

create or replace function public.ppe_guard_issuance() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'PPE issuance history cannot be deleted; retain its stock and inspection trail'; end if;
  if new.quantity is null or new.quantity < 1 then raise exception 'PPE quantity must be positive'; end if;
  if tg_op='UPDATE' and (new.ppe_id is distinct from old.ppe_id or new.quantity is distinct from old.quantity) then
    raise exception 'Issued item and quantity cannot be changed; record a return and create a new issuance';
  end if;
  if tg_op='INSERT' and new.status is distinct from 'active' then raise exception 'New PPE issuance must start active'; end if;
  if tg_op='UPDATE' and old.status in ('quarantined','condemned') and new.status='active' then
    raise exception 'Failed PPE cannot be returned to use by editing its issuance';
  end if;
  if new.returned=true and new.status='active' then raise exception 'Returned PPE cannot remain active'; end if;
  if new.status='returned' and new.returned is distinct from true then raise exception 'Returned status requires a recorded return'; end if;
  return new;
end $$;
drop trigger if exists ppe_issuance_guard on public.ppe_issuance;
create trigger ppe_issuance_guard before insert or update or delete on public.ppe_issuance
for each row execute function public.ppe_guard_issuance();

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
  update public.ppe_catalogue c
  set quantity_available=coalesce(c.quantity_available,0)+available_delta,
      quantity_issued=greatest(0,coalesce(c.quantity_issued,0)+issued_delta),updated_at=now()
  where c.id=new.ppe_id and c.company_id=new.company_id
    and coalesce(c.quantity_available,0)+available_delta>=0;
  if not found then raise exception 'PPE stock unavailable or item belongs to another company'; end if;
  return new;
end $$;
drop trigger if exists ppe_issuance_stock on public.ppe_issuance;
create trigger ppe_issuance_stock after insert or update of status,returned,return_condition on public.ppe_issuance
for each row execute function public.ppe_update_stock_for_issuance();

create or replace function public.ppe_guard_inspection() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare issued public.ppe_issuance; item jsonb; has_failure boolean:=false;
begin
  if new.issuance_id is null then raise exception 'Select the exact PPE issuance before inspecting'; end if;
  select * into issued from public.ppe_issuance where id=new.issuance_id and company_id=new.company_id;
  if not found or issued.ppe_id is distinct from new.ppe_id or issued.employee_name is distinct from new.employee_name then
    raise exception 'Inspection must match the selected issued item and employee';
  end if;
  if jsonb_typeof(new.checklist) is distinct from 'array' then
    raise exception 'Complete every inspection check';
  end if;
  if jsonb_array_length(new.checklist)=0 then
    raise exception 'Complete every inspection check';
  end if;
  for item in select value from jsonb_array_elements(new.checklist) loop
    if item->>'result' not in ('pass','fail','na') or item->>'result' is null then
      raise exception 'Every inspection check needs an explicit result';
    end if;
    has_failure := has_failure or item->>'result'='fail';
  end loop;
  if new.overall_result is null then raise exception 'Select an overall inspection result'; end if;
  if has_failure and (new.overall_result not in ('fail','condemn') or new.action_taken in ('cleared_for_use','repaired')) then
    raise exception 'A failed check cannot be cleared for use';
  end if;
  if new.overall_result in ('fail','condemn') and new.action_taken='cleared_for_use' then
    raise exception 'Failed PPE cannot be cleared for use';
  end if;
  return new;
end $$;
drop trigger if exists ppe_inspection_guard on public.ppe_inspections;
create trigger ppe_inspection_guard before insert or update of issuance_id,ppe_id,employee_name,checklist,overall_result,action_taken
on public.ppe_inspections for each row execute function public.ppe_guard_inspection();

create or replace function public.ppe_quarantine_failed_inspection() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.overall_result in ('fail','condemn') then
    update public.ppe_issuance set status=case when new.overall_result='condemn' then 'condemned' else 'quarantined' end,
      updated_at=now() where id=new.issuance_id and company_id=new.company_id and status in ('active','returned','quarantined');
  end if;
  return new;
end $$;
drop trigger if exists ppe_inspection_quarantine on public.ppe_inspections;
create trigger ppe_inspection_quarantine after insert or update of overall_result on public.ppe_inspections
for each row execute function public.ppe_quarantine_failed_inspection();

create or replace function public.ppe_guard_replacement() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare issued public.ppe_issuance; old_item public.ppe_issuance; inspected public.ppe_inspections; actor public.profiles;
begin
  if new.issuance_id is not null then
    select * into old_item from public.ppe_issuance where id=new.issuance_id and company_id=new.company_id;
    if not found or old_item.ppe_id is distinct from new.ppe_id or old_item.employee_name is distinct from new.employee_name then
      raise exception 'Replacement must match the original issued item'; end if;
  end if;
  if new.inspection_id is not null then
    select * into inspected from public.ppe_inspections where id=new.inspection_id and company_id=new.company_id;
    if not found or inspected.issuance_id is distinct from new.issuance_id then
      raise exception 'Replacement inspection must match the original issuance'; end if;
  end if;
  if tg_op='INSERT' and new.status is distinct from 'pending' then raise exception 'New replacement requests start pending'; end if;
  if tg_op='INSERT' and (new.approved_by is not null or new.approved_date is not null or new.new_issuance_id is not null) then
    raise exception 'Approval and fulfilment must use explicit actions'; end if;
  if tg_op='UPDATE' and new.status is distinct from old.status and not (
    (old.status='pending' and new.status in ('approved','rejected','cancelled')) or
    (old.status='approved' and new.status in ('fulfilled','cancelled'))
  ) then raise exception 'Unsupported replacement status transition'; end if;
  if tg_op='UPDATE' and new.status is distinct from old.status and new.status in ('approved','fulfilled') then
    select * into actor from public.profiles where id=auth.uid();
    if not found or actor.status is distinct from 'active' or actor.role is null or actor.role not in ('sephs_admin','admin','hse_manager')
       or (actor.role<>'sephs_admin' and actor.company_id is distinct from new.company_id) then
      raise exception 'An authorised manager must record this replacement decision' using errcode='42501'; end if;
    if new.status='approved' then new.approved_by:=coalesce(nullif(actor.full_name,''),actor.email);new.approved_date:=current_date;end if;
    if new.status='fulfilled' then new.fulfilled_date:=current_date;end if;
  elsif tg_op='UPDATE' and old.status in ('approved','fulfilled') and new.status=old.status and
    (new.approved_by is distinct from old.approved_by or new.approved_date is distinct from old.approved_date
      or new.new_issuance_id is distinct from old.new_issuance_id or new.fulfilled_date is distinct from old.fulfilled_date) then
    raise exception 'Use the approval or fulfilment action to change a decision';
  end if;
  if new.status in ('approved','fulfilled') and (nullif(new.approved_by,'') is null or new.approved_date is null) then
    raise exception 'Approval requires an approver and date'; end if;
  if new.status='fulfilled' then
    if new.new_issuance_id is null or new.fulfilled_date is null then raise exception 'Fulfilment requires a linked new issuance and date'; end if;
    select * into issued from public.ppe_issuance where id=new.new_issuance_id and company_id=new.company_id;
    if not found or issued.ppe_id is distinct from new.ppe_id or issued.employee_name is distinct from new.employee_name
       or issued.id is not distinct from new.issuance_id then
      raise exception 'Replacement issuance must be a different matching issued item'; end if;
    new.new_issuance_ref:=issued.issuance_ref;
  end if;
  return new;
end $$;
drop trigger if exists ppe_replacement_guard on public.ppe_replacements;
create trigger ppe_replacement_guard before insert or update on public.ppe_replacements
for each row execute function public.ppe_guard_replacement();
