-- Retain uploaded safety data sheets so the chemical register can preview
-- the authoritative source document, rather than only remembering its name.
alter table public.chemical_register
  add column if not exists sds_file_url text,
  add column if not exists sds_file_path text,
  add column if not exists sds_file_mime text;

alter table public.chemical_sds_versions
  add column if not exists file_url text,
  add column if not exists file_path text,
  add column if not exists file_mime text;

notify pgrst, 'reload schema';
