-- Optional e-learning enhancements for AURIS360.
-- Run this in Supabase SQL editor to persist the advanced fields already shown in the UI.

alter table public.elearning_courses
  add column if not exists category text,
  add column if not exists duration_minutes integer,
  add column if not exists passing_score integer,
  add column if not exists validity_months integer,
  add column if not exists target_roles text,
  add column if not exists mandatory boolean default false;

alter table public.elearning_enrolments
  add column if not exists target_date date,
  add column if not exists score integer,
  add column if not exists expiry_date date,
  add column if not exists attempts integer,
  add column if not exists time_spent_minutes integer;

notify pgrst, 'reload schema';
