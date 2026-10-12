-- Assign a company-scoped inspection reference in the inserting transaction.
-- Existing references are retained, including historical duplicates for manual review.
create or replace function public.assign_inspection_reference()
returns trigger language plpgsql as $$
declare prefix text; yr text; serial_no integer;
begin
  if nullif(new.reference_no, '') is not null then return new; end if;
  prefix := case new.inspection_type
    when 'workplace' then 'WI' when 'fire' then 'FS' when 'ppe' then 'PPE'
    when 'equipment' then 'EQ' when 'environmental' then 'ENV'
    when 'iso_audit' then 'ISO' when 'internal_audit' then 'AUD'
    when 'supplier_audit' then 'SA' when 'contractor_audit' then 'CA'
    when 'regulatory' then 'REG' when 'behavioral' then 'BBO'
    when 'prestart' then 'PS' else 'INS' end;
  yr := to_char(coalesce(new.inspection_date, current_date), 'YYYY');
  perform pg_advisory_xact_lock(hashtextextended(coalesce(new.company_id::text, '') || ':' || prefix || ':' || yr, 0));
  select coalesce(max(substring(reference_no from '[0-9]+$')::integer), 0)+1 into serial_no
    from public.inspections
   where company_id is not distinct from new.company_id
     and reference_no like prefix || '-' || yr || '-%'
     and reference_no ~ ('^' || prefix || '-' || yr || '-[0-9]+$');
  new.reference_no := prefix || '-' || yr || '-' || lpad(serial_no::text, 3, '0');
  return new;
end $$;
drop trigger if exists trg_assign_inspection_reference on public.inspections;
create trigger trg_assign_inspection_reference before insert on public.inspections
for each row execute function public.assign_inspection_reference();

alter table public.inspections add column if not exists equipment_asset_id uuid;
create index if not exists inspections_company_equipment_asset_idx on public.inspections(company_id,equipment_asset_id)
where equipment_asset_id is not null;

alter table public.audit_findings drop constraint if exists audit_findings_status_check;
alter table public.audit_findings add constraint audit_findings_status_check
check (status in ('open','in_progress','awaiting_verification','closed','accepted'));
alter table public.audit_findings add column if not exists verification_evidence text;
