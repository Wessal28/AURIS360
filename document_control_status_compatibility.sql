-- AURIS360 - Document Control status compatibility
-- Run once in Supabase SQL Editor only if Document Control still rejects
-- withdrawn/superseded document lifecycle states after the app deployment.

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
      and lower(pg_get_constraintdef(c.oid)) like '%status%'
  loop
    execute format('alter table public.documents drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.documents
  add constraint documents_status_check
  check (
    status is null or status in (
      'draft',
      'pending_review',
      'under_review',
      'pending_approval',
      'approved',
      'rejected',
      'withdrawn',
      'superseded',
      'archived',
      'active',
      'current',
      'published'
    )
  );

alter table public.documents
  add constraint documents_approval_status_check
  check (
    approval_status is null or approval_status in (
      'draft',
      'pending_review',
      'under_review',
      'pending_approval',
      'approved',
      'rejected',
      'withdrawn',
      'superseded',
      'archived',
      'active',
      'current',
      'published'
    )
  );

notify pgrst, 'reload schema';

commit;
