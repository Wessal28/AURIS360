-- AURIS360 user notification contact fields
-- Run this in Supabase SQL Editor before storing WhatsApp/SMS/email preferences.

alter table public.profiles
  add column if not exists real_email text,
  add column if not exists mobile_phone text,
  add column if not exists whatsapp_phone text,
  add column if not exists preferred_notification_channel text default 'in_app',
  add column if not exists notification_notes text;

alter table public.profiles
  drop constraint if exists profiles_preferred_notification_channel_check;

alter table public.profiles
  add constraint profiles_preferred_notification_channel_check
  check (preferred_notification_channel in ('in_app', 'email', 'whatsapp', 'sms'));

comment on column public.profiles.email is
  'Login username. May be an app-generated .local address and should not always be used for notifications.';

comment on column public.profiles.real_email is
  'Real deliverable email address used for notifications when preferred_notification_channel is email.';

comment on column public.profiles.mobile_phone is
  'Mobile number for SMS or phone contact.';

comment on column public.profiles.whatsapp_phone is
  'WhatsApp-enabled mobile number for future WhatsApp Business notifications.';

notify pgrst, 'reload schema';
