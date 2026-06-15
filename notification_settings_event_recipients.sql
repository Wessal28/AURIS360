-- Adds storage for Company Admin incident email recipient rules.
-- Run once in Supabase SQL Editor if saving notification settings says:
-- "Database update needed: add event_recipients to notification_settings."

alter table public.notification_settings
add column if not exists event_recipients jsonb not null default '{}'::jsonb;
