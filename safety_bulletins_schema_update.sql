-- Optional Safety Bulletin enhancements for AURIS360.
-- Run this in Supabase SQL editor to persist who opened/checked each bulletin.

alter table public.safety_bulletins
  add column if not exists checked_by jsonb default '[]'::jsonb,
  add column if not exists acknowledged_by jsonb default '[]'::jsonb,
  add column if not exists file_url text,
  add column if not exists file_name text,
  add column if not exists last_checked_at timestamptz,
  add column if not exists updated_at timestamptz default now();

notify pgrst, 'reload schema';
