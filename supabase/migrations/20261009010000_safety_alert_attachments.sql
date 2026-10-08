-- Keep the uploaded safety alert document with its tenant-scoped alert record.
-- Files use the existing documents storage bucket under <company_id>/safety-alerts/.
alter table public.safety_alerts
  add column if not exists file_url text,
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_mime text;

comment on column public.safety_alerts.file_url is 'Public documents-bucket URL for the safety alert attachment.';
comment on column public.safety_alerts.file_path is 'Documents-bucket path, prefixed by company ID.';
