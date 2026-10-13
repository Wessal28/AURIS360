-- Existing report references may identify a document, not an examination.
-- auris360: allow-data-migration
-- Give every examination its own immutable, readable identifier.
alter table public.medical_surveillance
  add column if not exists examination_ref text;
update public.medical_surveillance
set examination_ref = 'MED-' || to_char(coalesce(exam_date,current_date),'YYYY') || '-'
  || upper(replace(id::text,'-',''))
where examination_ref is null;
alter table public.medical_surveillance
  alter column examination_ref set default ('MED-' || to_char(current_date,'YYYY') || '-'
    || upper(substr(replace(gen_random_uuid()::text,'-',''),1,16)));
create unique index if not exists medical_surveillance_company_examination_ref_key
  on public.medical_surveillance(company_id,examination_ref);
alter table public.medical_surveillance alter column fitness_status set default 'pending';
alter table public.medical_surveillance alter column status set default 'pending_review';

-- A missing comparator is unassessed, not a low exposure or adequate control.
alter table public.exposure_monitoring alter column risk_level drop default;
alter table public.exposure_monitoring alter column exceeded_oel drop default;
alter table public.exposure_monitoring alter column controls_adequate drop default;

alter table public.vaccination_records alter column status set default 'scheduled';
alter table public.occupational_diseases alter column work_related drop default;
alter table public.spirometry_records alter column pattern drop default;
alter table public.audiometry_records add column if not exists comparison_baseline_id uuid
  references public.audiometry_records(id) on delete set null;
