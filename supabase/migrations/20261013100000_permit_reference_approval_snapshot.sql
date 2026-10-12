-- auris360: allow-data-migration
-- Retain the exact linked revisions when a permit first becomes approved.
alter table public.permits
  add column if not exists linked_reference_snapshot jsonb not null default '{}'::jsonb;

create or replace function public.permit_linked_reference_snapshot()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  assessment public.risk_assessments%rowtype;
  statement public.documents%rowtype;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    if new.risk_assessment_id is not null then
      select * into assessment from public.risk_assessments
        where id = new.risk_assessment_id and company_id = new.company_id;
    end if;
    if new.method_statement_id is not null then
      select * into statement from public.documents
        where id = new.method_statement_id and company_id = new.company_id;
    end if;
    new.linked_reference_snapshot = jsonb_strip_nulls(jsonb_build_object(
      'risk_assessment_id', new.risk_assessment_id,
      'risk_assessment_revision', assessment.revision,
      'method_statement_id', new.method_statement_id,
      'method_statement_revision_id', statement.current_revision_id,
      'method_statement_version_major', statement.version_major,
      'method_statement_version_minor', statement.version_minor,
      'approved_at', now()
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists permit_linked_reference_snapshot_trigger on public.permits;
create trigger permit_linked_reference_snapshot_trigger
  before update of status on public.permits
  for each row execute function public.permit_linked_reference_snapshot();

-- Existing approved/active permits start with the current linked revisions.
update public.permits p
set linked_reference_snapshot = jsonb_strip_nulls(jsonb_build_object(
  'risk_assessment_id', p.risk_assessment_id,
  'risk_assessment_revision', (select r.revision from public.risk_assessments r
    where r.id=p.risk_assessment_id and r.company_id=p.company_id),
  'method_statement_id', p.method_statement_id,
  'method_statement_revision_id', (select d.current_revision_id from public.documents d
    where d.id=p.method_statement_id and d.company_id=p.company_id),
  'method_statement_version_major', (select d.version_major from public.documents d
    where d.id=p.method_statement_id and d.company_id=p.company_id),
  'method_statement_version_minor', (select d.version_minor from public.documents d
    where d.id=p.method_statement_id and d.company_id=p.company_id),
  'approved_at', coalesce(p.approval_l3_at,p.approval_l2_at,p.approval_l1_at,p.updated_at)
))
where p.status in ('approved','active') and p.linked_reference_snapshot = '{}'::jsonb;

revoke all on function public.permit_linked_reference_snapshot() from public, anon, authenticated;
