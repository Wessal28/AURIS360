-- Keep uploaded licence and certificate evidence on the authorisation record.
-- Earlier clients could silently retry writes without these missing columns.
alter table public.authorisations
  add column if not exists certificate_url text,
  add column if not exists evidence_url text,
  add column if not exists scope text,
  add column if not exists restrictions text;
