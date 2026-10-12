-- Fleet servicing intervals and externally supplied job references.
alter table public.equipment_maintenance_events
  add column if not exists external_job_number text,
  add column if not exists service_interval_days integer,
  add column if not exists service_interval_km numeric(12,1),
  add column if not exists service_interval_hours numeric(12,1),
  add column if not exists completed_meter numeric(12,1),
  add column if not exists next_due_date date,
  add column if not exists next_due_meter numeric(12,1);

alter table public.equipment_maintenance_events
  add constraint fleet_service_interval_days_positive check (service_interval_days is null or service_interval_days > 0),
  add constraint fleet_service_interval_km_positive check (service_interval_km is null or service_interval_km > 0),
  add constraint fleet_service_interval_hours_positive check (service_interval_hours is null or service_interval_hours > 0),
  add constraint fleet_service_completed_meter_nonnegative check (completed_meter is null or completed_meter >= 0);

create index if not exists fleet_service_next_due_idx
  on public.equipment_maintenance_events (company_id, next_due_date)
  where next_due_date is not null;
