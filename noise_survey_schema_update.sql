-- Optional Noise Survey enhancements for AURIS360.
-- Run this in Supabase SQL editor to persist layout plans, measurement points,
-- generated noise-map markers, and hearing protector adequacy assessment.

alter table public.noise_surveys
  add column if not exists layout_title text,
  add column if not exists layout_url text,
  add column if not exists layout_image text,
  add column if not exists measurements jsonb default '[]'::jsonb,
  add column if not exists hpe_assessment jsonb default '[]'::jsonb,
  add column if not exists updated_at timestamptz default now();

notify pgrst, 'reload schema';
