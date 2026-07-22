-- AURIS360 - Allow SWMS documents and convert temporary SWMS procedure records
-- Run once in Supabase SQL Editor.

begin;

do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'documents'
      and c.contype = 'c'
      and (
        pg_get_constraintdef(c.oid) ilike '%document_type%'
        or pg_get_constraintdef(c.oid) ilike '%doc_type%'
      )
  loop
    execute format('alter table public.documents drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.documents
  add constraint documents_document_type_check
  check (
    document_type is null
    or document_type in (
      'policy',
      'procedure',
      'sop',
      'swms',
      'manual',
      'form',
      'emergency_plan',
      'risk_assessment',
      'legal',
      'certificate',
      'work_instruction',
      'technical_spec',
      'other'
    )
  );

alter table public.documents
  add constraint documents_doc_type_check
  check (
    doc_type is null
    or doc_type in (
      'policy',
      'procedure',
      'sop',
      'swms',
      'manual',
      'form',
      'emergency_plan',
      'risk_assessment',
      'legal',
      'certificate',
      'work_instruction',
      'technical_spec',
      'other'
    )
  );

update public.documents
set
  document_type = 'swms',
  doc_type = 'swms',
  category = coalesce(nullif(category, ''), 'Safe Work Method Statement'),
  updated_at = now()
where (
    doc_ref ilike 'SWMS-%'
    or reference_no ilike 'SWMS-%'
    or title ilike '%SWMS%'
    or title ilike '%Safe Work Method Statement%'
    or category ilike '%Safe Work Method Statement%'
  );

notify pgrst, 'reload schema';

commit;
