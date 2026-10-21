-- Disposable migration replay only. No permit is activated in a live tenant;
-- synthetic records, source revisions and any queued notices are rolled back.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
insert into public.companies(id,name) values
 ('c2090000-0000-4000-8000-000000000010','Fictional permit snapshot company A'),
 ('c2090000-0000-4000-8000-000000000020','Fictional permit snapshot company B');
insert into public.risk_assessments(id,company_id,title,status,revision) values
 ('c2090000-0000-4000-8000-000000000030','c2090000-0000-4000-8000-000000000010','Fictional linked assessment','active',4),
 ('c2090000-0000-4000-8000-000000000031','c2090000-0000-4000-8000-000000000020','Foreign assessment must not leak','active',79);
insert into public.documents(id,company_id,title,status,current_revision_id,version_major,version_minor) values
 ('c2090000-0000-4000-8000-000000000040','c2090000-0000-4000-8000-000000000010','Fictional linked method','current','permit-fixture-revision-01',2,3),
 ('c2090000-0000-4000-8000-000000000041','c2090000-0000-4000-8000-000000000020','Foreign method must not leak','current','foreign-private-revision',81,82);
insert into public.permits(id,company_id,permit_number,status,risk_assessment_id,method_statement_id) values
 ('c2090000-0000-4000-8000-000000000050','c2090000-0000-4000-8000-000000000010','PTW-FICTIONAL-SNAPSHOT','draft','c2090000-0000-4000-8000-000000000030','c2090000-0000-4000-8000-000000000040'),
 ('c2090000-0000-4000-8000-000000000051','c2090000-0000-4000-8000-000000000010','PTW-FICTIONAL-FOREIGN','draft','c2090000-0000-4000-8000-000000000031','c2090000-0000-4000-8000-000000000041'),
 ('c2090000-0000-4000-8000-000000000052','c2090000-0000-4000-8000-000000000010','PTW-FICTIONAL-NO-REFERENCE','draft',null,null);

do $$
declare routine pg_proc; routine_id regprocedure; snapshot jsonb; original_snapshot jsonb;
begin
  routine_id:=to_regprocedure('public.permit_linked_reference_snapshot()');
  if routine_id is null then raise exception 'Permit reference snapshot trigger routine is missing';end if;
  select * into routine from pg_proc where oid=routine_id;
  if routine.prorettype<>'trigger'::regtype or not routine.prosecdef
    or not coalesce(routine.proconfig @> array['search_path=public, pg_temp'],false)
    or has_function_privilege('anon',routine_id,'execute') or has_function_privilege('authenticated',routine_id,'execute')
  then raise exception 'Permit snapshot function execution grants or search path changed';end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='permit_linked_reference_snapshot')<>1
    or (select count(*) from pg_trigger where tgrelid='public.permits'::regclass and tgname='permit_linked_reference_snapshot_trigger' and tgfoid=routine_id and not tgisinternal)<>1
  then raise exception 'Permit snapshot installation duplicated its routine or trigger';end if;

  update public.permits set status='pending_approval' where id='c2090000-0000-4000-8000-000000000050';
  if (select linked_reference_snapshot from public.permits where id='c2090000-0000-4000-8000-000000000050')<>'{}'::jsonb
  then raise exception 'An unapproved permit acquired an approval snapshot';end if;
  update public.permits set status='approved' where id='c2090000-0000-4000-8000-000000000050';
  select linked_reference_snapshot into original_snapshot from public.permits where id='c2090000-0000-4000-8000-000000000050';
  if original_snapshot->>'risk_assessment_id' is distinct from 'c2090000-0000-4000-8000-000000000030'
    or original_snapshot->>'risk_assessment_revision' is distinct from '4'
    or original_snapshot->>'method_statement_id' is distinct from 'c2090000-0000-4000-8000-000000000040'
    or original_snapshot->>'method_statement_revision_id' is distinct from 'permit-fixture-revision-01'
    or original_snapshot->>'method_statement_version_major' is distinct from '2' or original_snapshot->>'method_statement_version_minor' is distinct from '3'
    or original_snapshot->>'approved_at' is null
  then raise exception 'Permit approval did not capture exact same-company linked revisions';end if;

  update public.risk_assessments set revision=5 where id='c2090000-0000-4000-8000-000000000030';
  update public.documents set current_revision_id='permit-fixture-revision-02',version_minor=4 where id='c2090000-0000-4000-8000-000000000040';
  update public.permits set status='active' where id='c2090000-0000-4000-8000-000000000050';
  if (select linked_reference_snapshot from public.permits where id='c2090000-0000-4000-8000-000000000050') is distinct from original_snapshot
  then raise exception 'Activation replaced the approval-bound reference snapshot';end if;
  update public.permits set status='suspended' where id='c2090000-0000-4000-8000-000000000050';
  update public.permits set status='approved' where id='c2090000-0000-4000-8000-000000000050';
  select linked_reference_snapshot into snapshot from public.permits where id='c2090000-0000-4000-8000-000000000050';
  if snapshot->>'risk_assessment_revision' is distinct from '5' or snapshot->>'method_statement_revision_id' is distinct from 'permit-fixture-revision-02'
    or snapshot->>'method_statement_version_minor' is distinct from '4'
  then raise exception 'A new approval transition did not capture the updated linked revisions';end if;
  update public.permits set status='approved' where id='c2090000-0000-4000-8000-000000000050';
  if (select linked_reference_snapshot from public.permits where id='c2090000-0000-4000-8000-000000000050') is distinct from snapshot
  then raise exception 'An unchanged approved status replaced its saved reference baseline';end if;

  update public.permits set status='approved' where id='c2090000-0000-4000-8000-000000000051';
  select linked_reference_snapshot into snapshot from public.permits where id='c2090000-0000-4000-8000-000000000051';
  if snapshot->'risk_assessment_revision' is not null or snapshot->'method_statement_revision_id' is not null
    or snapshot->'method_statement_version_major' is not null or snapshot->'method_statement_version_minor' is not null
  then raise exception 'Permit reference snapshot disclosed another company revision';end if;
  update public.permits set status='approved' where id='c2090000-0000-4000-8000-000000000052';
  select linked_reference_snapshot into snapshot from public.permits where id='c2090000-0000-4000-8000-000000000052';
  if snapshot->>'approved_at' is null or snapshot->'risk_assessment_id' is not null or snapshot->'method_statement_id' is not null
  then raise exception 'A no-reference approval snapshot fabricated linked evidence';end if;
end $$;
rollback;
