-- Pre-start forms are stored in the inspections register. The separate legacy
-- prestart_inspections table is not used by this form. Preserve both tables.
-- Additive only: no record updates, no new grants, no RLS changes or defaults
-- that would fabricate answers for historical inspections.
begin;
alter table public.inspections
  add column if not exists activity text,
  add column if not exists location text,
  add column if not exists inspection_time time without time zone,
  add column if not exists duration_hours numeric,
  add column if not exists supervisor text,
  add column if not exists team_members text,
  add column if not exists ra_ref text,
  add column if not exists ptw_ref text,
  add column if not exists tbt_done boolean,
  add column if not exists tbt_topics text,
  add column if not exists stop_work_briefed boolean,
  add column if not exists decision text,
  add column if not exists decision_notes text,
  add column if not exists hazards text,
  add column if not exists controls text,
  add column if not exists ppe_required jsonb,
  add column if not exists ppe_extra text,
  add column if not exists prestart_signed_at timestamp without time zone;
comment on column public.inspections.prestart_signed_at is
  'Local date and time entered on the pre-start form; legacy sign_date remains date-only.';
notify pgrst, 'reload schema';
commit;
