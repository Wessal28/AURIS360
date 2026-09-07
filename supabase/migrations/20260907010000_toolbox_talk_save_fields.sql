-- Fields used by the Toolbox Talks editor but absent from the original schema.
-- Additive and safe to re-run; existing records and access policies are retained.
begin;

alter table public.toolbox_talks
  add column if not exists tbt_ref text,
  add column if not exists topic_category text,
  add column if not exists presenter text,
  add column if not exists duration_mins integer,
  add column if not exists incidents_referenced text;

notify pgrst, 'reload schema';
commit;
