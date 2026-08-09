-- AURIS 360 E-Learning and Competency assurance upgrade
-- Additive and rerunnable. Existing training, e-learning, certificate and competency data is preserved.
-- No fictional courses, assessments, results or competence decisions are inserted.

begin;
create extension if not exists pgcrypto;

create table if not exists public.learning_course_governance (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  course_id text not null,
  version_no integer not null default 1,
  lifecycle_status text not null default 'draft' check (lifecycle_status in ('draft','sme_review','hse_accessibility_review','awaiting_approval','published','under_revision','archived')),
  owner_name text,
  risk_class text not null default 'standard' check (risk_class in ('standard','elevated','safety_critical')),
  audience_summary text,
  language_codes text[] not null default array['en']::text[],
  source_module text,
  source_record_id text,
  source_reference text,
  source_revision text,
  source_status text,
  learning_objectives text,
  accessibility_metadata jsonb not null default '{}'::jsonb,
  sme_review_status text not null default 'pending' check (sme_review_status in ('pending','approved','changes_requested','not_required')),
  hse_review_status text not null default 'pending' check (hse_review_status in ('pending','approved','changes_requested','not_required')),
  accessibility_review_status text not null default 'pending' check (accessibility_review_status in ('pending','approved','changes_requested')),
  material_change_class text check (material_change_class is null or material_change_class in ('editorial','acknowledgement','microlearning','full_reassessment','practical_reassessment','immediate_suspension')),
  effective_date date,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,course_id,version_no)
);
create index if not exists learning_course_governance_queue on public.learning_course_governance(company_id,lifecycle_status,risk_class,updated_at desc);

create table if not exists public.learning_practical_assessments (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  reference text not null,
  candidate_id uuid,
  candidate_name text not null,
  course_id text,
  course_title text,
  competency_id text,
  competency_name text not null,
  scope_text text,
  assessor_id uuid,
  assessor_name text not null,
  assessor_scope_confirmed boolean not null default false,
  scheduled_at timestamptz,
  assessed_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled','in_progress','submitted','awaiting_verification','final','cancelled')),
  result text not null default 'pending' check (result in ('pending','competent','not_yet_competent','stopped_critical_fail')),
  criteria jsonb not null default '[]'::jsonb,
  critical_failure boolean not null default false,
  evidence_reference text,
  assessor_comments text,
  candidate_acknowledged boolean not null default false,
  verifier_id uuid,
  verifier_name text,
  verification_status text not null default 'not_required' check (verification_status in ('not_required','pending','confirmed','returned')),
  verified_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists learning_practical_reference on public.learning_practical_assessments(company_id,reference);
create index if not exists learning_practical_queue on public.learning_practical_assessments(company_id,status,result,scheduled_at);

create table if not exists public.learning_source_relationships (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  course_id text not null,
  course_version integer not null default 1,
  related_module text not null,
  related_record_id text not null,
  related_revision text,
  relationship_type text not null default 'learning_source',
  impact_status text not null default 'current' check (impact_status in ('current','review_required','affected','superseded')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,course_id,course_version,related_module,related_record_id,relationship_type)
);
create index if not exists learning_source_reverse on public.learning_source_relationships(company_id,related_module,related_record_id,impact_status);

alter table public.learning_source_relationships add column if not exists related_table text;
alter table public.learning_source_relationships add column if not exists source_current_revision text;
alter table public.learning_source_relationships add column if not exists impact_note text;
alter table public.learning_source_relationships add column if not exists impact_detected_at timestamptz;
alter table public.learning_source_relationships add column if not exists reviewed_at timestamptz;
alter table public.learning_source_relationships add column if not exists reviewed_by uuid;

-- Preserve exact legacy course-governance sources in the relationship register.
-- Only IDs that resolve inside the same company are migrated; no title matching
-- or inferred relationship is used.
do $$
begin
if to_regclass('public.documents') is not null
   and to_regclass('public.risk_assessments') is not null
   and to_regclass('public.legal_requirements') is not null
   and to_regclass('public.events') is not null
   and to_regclass('public.action_tracker') is not null then
insert into public.learning_source_relationships(
  company_id,course_id,course_version,related_module,related_table,related_record_id,
  related_revision,relationship_type,impact_status,created_by,created_at,updated_at
)
select g.company_id,g.course_id,g.version_no,'documents','documents',d.id::text,
       coalesce(g.source_revision,nullif(to_jsonb(d)->>'version',''),nullif(to_jsonb(d)->>'doc_version','')),
       'learning_source','current',g.created_by,g.created_at,g.updated_at
from public.learning_course_governance g
join public.documents d on d.id::text=g.source_record_id and d.company_id=g.company_id
where g.source_module='documents' and nullif(g.source_record_id,'') is not null
union all
select g.company_id,g.course_id,g.version_no,'risk','risk_assessments',r.id::text,
       coalesce(g.source_revision,nullif(to_jsonb(r)->>'revision',''),nullif(to_jsonb(r)->>'updated_at','')),
       'learning_source','current',g.created_by,g.created_at,g.updated_at
from public.learning_course_governance g
join public.risk_assessments r on r.id::text=g.source_record_id and r.company_id=g.company_id
where g.source_module='risk' and nullif(g.source_record_id,'') is not null
union all
select g.company_id,g.course_id,g.version_no,'legal','legal_requirements',l.id::text,
       coalesce(g.source_revision,nullif(to_jsonb(l)->>'revision',''),nullif(to_jsonb(l)->>'updated_at','')),
       'learning_source','current',g.created_by,g.created_at,g.updated_at
from public.learning_course_governance g
join public.legal_requirements l on l.id::text=g.source_record_id and l.company_id=g.company_id
where g.source_module='legal' and nullif(g.source_record_id,'') is not null
union all
select g.company_id,g.course_id,g.version_no,'event','events',e.id::text,
       coalesce(g.source_revision,nullif(to_jsonb(e)->>'revision',''),nullif(to_jsonb(e)->>'updated_at','')),
       'learning_source','current',g.created_by,g.created_at,g.updated_at
from public.learning_course_governance g
join public.events e on e.id::text=g.source_record_id and e.company_id=g.company_id
where g.source_module='incident' and nullif(g.source_record_id,'') is not null
union all
select g.company_id,g.course_id,g.version_no,'moc','action_tracker',m.id::text,
       coalesce(g.source_revision,nullif(to_jsonb(m)->>'revision',''),nullif(to_jsonb(m)->>'updated_at','')),
       'learning_source','current',g.created_by,g.created_at,g.updated_at
from public.learning_course_governance g
join public.action_tracker m on m.id::text=g.source_record_id and m.company_id=g.company_id
where g.source_module='moc' and nullif(g.source_record_id,'') is not null
on conflict(company_id,course_id,course_version,related_module,related_record_id,relationship_type)
do update set related_table=excluded.related_table,
              related_revision=coalesce(public.learning_source_relationships.related_revision,excluded.related_revision),
              updated_at=now();
end if;
end $$;

create or replace function public.refresh_learning_source_impacts(p_company_id uuid)
returns table(current_count bigint, review_required_count bigint, affected_count bigint)
language plpgsql
security invoker
set search_path=public
as $$
declare
  rel record;
  source_row jsonb;
  current_revision text;
begin
  for rel in
    select * from public.learning_source_relationships
    where company_id=p_company_id and impact_status<>'superseded'
  loop
    source_row:=null;
    current_revision:=null;
    if rel.related_table is null or rel.related_table!~'^[a-z0-9_]+$'
       or to_regclass('public.'||rel.related_table) is null
       or not exists(select 1 from information_schema.columns where table_schema='public' and table_name=rel.related_table and column_name='id')
       or not exists(select 1 from information_schema.columns where table_schema='public' and table_name=rel.related_table and column_name='company_id') then
      update public.learning_source_relationships
      set impact_status='affected',impact_note='The linked source type is unavailable.',
          impact_detected_at=coalesce(impact_detected_at,now()),updated_at=now()
      where id=rel.id;
      continue;
    end if;
    execute format('select to_jsonb(t) from public.%I t where t.id::text=$1 and t.company_id=$2 limit 1',rel.related_table)
      into source_row using rel.related_record_id,p_company_id;
    if source_row is null then
      update public.learning_source_relationships
      set impact_status='affected',impact_note='The linked source record no longer resolves in this company.',
          impact_detected_at=coalesce(impact_detected_at,now()),updated_at=now()
      where id=rel.id;
      continue;
    end if;
    current_revision:=coalesce(
      nullif(source_row->>'revision',''),nullif(source_row->>'revision_code',''),
      nullif(source_row->>'doc_version',''),nullif(source_row->>'version',''),
      nullif(source_row->>'current_revision_id',''),nullif(source_row->>'updated_at','')
    );
    if rel.related_revision is null then
      update public.learning_source_relationships
      set related_revision=current_revision,source_current_revision=current_revision,
          impact_note=null,updated_at=now()
      where id=rel.id;
    elsif current_revision is distinct from rel.related_revision then
      update public.learning_source_relationships
      set source_current_revision=current_revision,impact_status='review_required',
          impact_note='The controlled source changed after this learning version was linked.',
          impact_detected_at=coalesce(impact_detected_at,now()),updated_at=now()
      where id=rel.id;
    else
      update public.learning_source_relationships
      set source_current_revision=current_revision,updated_at=now()
      where id=rel.id;
    end if;
  end loop;
  return query
  select count(*) filter(where l.impact_status='current'),
         count(*) filter(where l.impact_status='review_required'),
         count(*) filter(where l.impact_status='affected')
  from public.learning_source_relationships l where l.company_id=p_company_id;
end;
$$;

create table if not exists public.learning_external_providers (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  provider_name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  accreditation_scope text,
  accreditation_reference text,
  accreditation_expiry date,
  approved_status text not null default 'pending' check (approved_status in ('pending','approved','conditional','suspended','expired','archived')),
  evaluation_notes text,
  evidence_reference text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,provider_name)
);
create index if not exists learning_external_provider_status on public.learning_external_providers(company_id,approved_status,accreditation_expiry);

do $$
declare t text;
begin
  foreach t in array array['learning_course_governance','learning_practical_assessments','learning_source_relationships','learning_external_providers'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_read',t);
    execute format('create policy %I on public.%I for select using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id)))',t||'_tenant_read',t,t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_write',t);
    execute format('create policy %I on public.%I for all using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''training_admin'',''hr_manager''))))) with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''training_admin'',''hr_manager'')))))',t||'_tenant_write',t,t,t);
  end loop;
end $$;

grant execute on function public.refresh_learning_source_impacts(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
