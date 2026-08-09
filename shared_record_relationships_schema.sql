-- AURIS360 shared reciprocal relationship platform (AP-030)
-- Safe to rerun. Existing module-specific relationship tables remain unchanged.

begin;

create table if not exists public.relationship_module_registry (
  module_key text not null,
  table_name text not null,
  id_column text not null default 'id',
  ref_column text,
  display_label text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(module_key, table_name)
);

insert into public.relationship_module_registry(module_key, table_name, id_column, ref_column, display_label, enabled)
values
  ('event','events','id','event_ref','Incident / Event',to_regclass('public.events') is not null),
  ('investigation','investigations','id','investigation_ref','Investigation',to_regclass('public.investigations') is not null),
  ('observation','safety_observations','id','obs_ref','BBS Observation',to_regclass('public.safety_observations') is not null),
  ('observation','bbs_themes','id',null,'BBS Barrier Theme',to_regclass('public.bbs_themes') is not null),
  ('inspection','inspections','id','reference_no','Audit / Inspection',to_regclass('public.inspections') is not null),
  ('risk','risk_assessments','id','ra_ref','Risk Assessment',to_regclass('public.risk_assessments') is not null),
  ('permit','permits','id','permit_number','Permit to Work',to_regclass('public.permits') is not null),
  ('meeting','toolbox_talks','id','tbt_ref','Toolbox Talk',to_regclass('public.toolbox_talks') is not null),
  ('legal','legal_requirements','id','req_ref','Legal Requirement',to_regclass('public.legal_requirements') is not null),
  ('legal','compliance_gaps','id','gap_ref','Compliance Gap',to_regclass('public.compliance_gaps') is not null),
  ('legal','legal_compliance_records','id','reference','Legal Evidence / Permit',to_regclass('public.legal_compliance_records') is not null),
  ('chemical','chemical_register','id','chemical_ref','Chemical',to_regclass('public.chemical_register') is not null),
  ('atex','atex_areas','id','area_ref','ATEX Area',to_regclass('public.atex_areas') is not null),
  ('moc','action_tracker','id','source_ref','Management of Change',to_regclass('public.action_tracker') is not null),
  ('action','action_tracker','id','action_ref','Master Action',to_regclass('public.action_tracker') is not null),
  ('contractor','contractors','id','contractor_ref','Contractor',to_regclass('public.contractors') is not null),
  ('contractor','contractor_incidents','id','ref_number','Contractor Incident',to_regclass('public.contractor_incidents') is not null),
  ('esg','spill_reports','id','ref_number','Environmental Spill',to_regclass('public.spill_reports') is not null),
  ('esg','environmental_inspections','id',null,'Environmental Inspection',to_regclass('public.environmental_inspections') is not null),
  ('emergency','emergency_drills','id','drill_ref','Emergency Drill',to_regclass('public.emergency_drills') is not null),
  ('emergency','emergency_activations','id','activation_ref','Emergency Activation',to_regclass('public.emergency_activations') is not null),
  ('emergency','emergency_equipment','id','identifier','Emergency Equipment',to_regclass('public.emergency_equipment') is not null),
  ('ohealth','medical_surveillance','id',null,'Medical Surveillance',to_regclass('public.medical_surveillance') is not null),
  ('ohealth','audiometry_records','id',null,'Audiometry Record',to_regclass('public.audiometry_records') is not null),
  ('ohealth','spirometry_records','id',null,'Spirometry Record',to_regclass('public.spirometry_records') is not null),
  ('ohealth','exposure_monitoring','id','monitoring_ref','Exposure Monitoring',to_regclass('public.exposure_monitoring') is not null),
  ('ohealth','occupational_diseases','id','disease_ref','Occupational Disease',to_regclass('public.occupational_diseases') is not null),
  ('noise','noise_surveys','id',null,'Noise Survey',to_regclass('public.noise_surveys') is not null),
  ('training','training_followup','id',null,'Training Record',to_regclass('public.training_followup') is not null),
  ('training','competency_matrix','id',null,'Competency Record',to_regclass('public.competency_matrix') is not null),
  ('training','elearning_courses','id','course_code','Learning Course',to_regclass('public.elearning_courses') is not null),
  ('documents','documents','id','doc_ref','Controlled Document',to_regclass('public.documents') is not null),
  ('sop','sop_video_projects','id','reference','SOP Project',to_regclass('public.sop_video_projects') is not null),
  ('swms','documents','id','doc_ref','SWMS / Method Statement',to_regclass('public.documents') is not null)
on conflict(module_key, table_name) do update
set id_column = excluded.id_column,
    ref_column = excluded.ref_column,
    display_label = excluded.display_label,
    enabled = excluded.enabled,
    updated_at = now();

-- Early builds registered a table name that is not used by the application.
delete from public.relationship_module_registry
where module_key='swms' and table_name='swms_documents';

create table if not exists public.record_relationships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_module text not null,
  source_table text not null,
  source_id text not null,
  source_ref text,
  target_module text not null,
  target_table text not null,
  target_id text not null,
  target_ref text,
  relationship_type text not null default 'related_to',
  status text not null default 'active' check(status in ('active','pending_verification','unresolved','broken','superseded','archived')),
  source_revision text,
  target_revision text,
  applicability jsonb not null default '{}'::jsonb,
  source_valid boolean not null default false,
  target_valid boolean not null default false,
  validation_error text,
  last_validated_at timestamptz,
  verified_at timestamptz,
  verified_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  endpoint_a text generated always as (
    least(lower(source_module)||':'||lower(source_table)||':'||source_id,
          lower(target_module)||':'||lower(target_table)||':'||target_id)
  ) stored,
  endpoint_b text generated always as (
    greatest(lower(source_module)||':'||lower(source_table)||':'||source_id,
             lower(target_module)||':'||lower(target_table)||':'||target_id)
  ) stored,
  check(lower(source_module)||':'||lower(source_table)||':'||source_id <>
        lower(target_module)||':'||lower(target_table)||':'||target_id)
);

create unique index if not exists record_relationships_canonical_unique
  on public.record_relationships(company_id, relationship_type, endpoint_a, endpoint_b)
  where status <> 'archived';
create index if not exists record_relationships_source_lookup
  on public.record_relationships(company_id, source_module, source_table, source_id, status);
create index if not exists record_relationships_target_lookup
  on public.record_relationships(company_id, target_module, target_table, target_id, status);
create index if not exists record_relationships_validation_queue
  on public.record_relationships(company_id, status, last_validated_at)
  where status in ('unresolved','broken','pending_verification');

create or replace function public.relationship_endpoint_exists(
  p_company_id uuid,
  p_module text,
  p_table text,
  p_record_id text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg record;
  endpoint_found boolean := false;
begin
  if p_company_id is null or nullif(btrim(p_record_id),'') is null then return false; end if;
  select * into cfg
  from public.relationship_module_registry
  where module_key = lower(btrim(p_module))
    and table_name = lower(btrim(p_table))
    and enabled = true;
  if not found or to_regclass('public.'||cfg.table_name) is null then return false; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name=cfg.table_name and column_name=cfg.id_column
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name=cfg.table_name and column_name='company_id'
  ) then return false; end if;
  execute format(
    'select exists(select 1 from public.%I where %I::text=$1 and company_id=$2)',
    cfg.table_name, cfg.id_column
  ) into endpoint_found using p_record_id, p_company_id;
  return coalesce(endpoint_found,false);
end;
$$;

create or replace function public.validate_record_relationship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.source_module := lower(btrim(new.source_module));
  new.source_table := lower(btrim(new.source_table));
  new.source_id := btrim(new.source_id);
  new.target_module := lower(btrim(new.target_module));
  new.target_table := lower(btrim(new.target_table));
  new.target_id := btrim(new.target_id);
  new.relationship_type := lower(btrim(new.relationship_type));
  new.source_valid := public.relationship_endpoint_exists(new.company_id,new.source_module,new.source_table,new.source_id);
  new.target_valid := public.relationship_endpoint_exists(new.company_id,new.target_module,new.target_table,new.target_id);
  new.last_validated_at := now();
  new.updated_at := now();
  if new.status = 'archived' then
    new.validation_error := case when new.source_valid and new.target_valid then null else concat_ws('; ',
      case when not new.source_valid then 'Archived source record is unavailable or outside the company' end,
      case when not new.target_valid then 'Archived target record is unavailable or outside the company' end
    ) end;
  elsif new.source_valid and new.target_valid then
    new.validation_error := null;
    if new.status in ('unresolved','broken') then new.status := 'active'; end if;
  else
    new.status := 'unresolved';
    new.validation_error := concat_ws('; ',
      case when not new.source_valid then 'Source record is unavailable or outside the company' end,
      case when not new.target_valid then 'Target record is unavailable or outside the company' end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists record_relationships_validate on public.record_relationships;
create trigger record_relationships_validate
before insert or update of company_id,source_module,source_table,source_id,target_module,target_table,target_id,status
on public.record_relationships
for each row execute function public.validate_record_relationship();

-- Promote existing SWMS selector links into the reciprocal service. Both IDs
-- and professional references are supported because early SWMS builds stored
-- the selected reference in related_record_id.
do $$
begin
  if to_regclass('public.swms_relationships') is not null then
    insert into public.record_relationships(
      company_id,source_module,source_table,source_id,source_ref,
      target_module,target_table,target_id,target_ref,relationship_type,
      source_revision,target_revision,applicability,status,created_by,created_at,updated_at
    )
    select s.company_id,'swms','documents',d.id::text,d.doc_ref,
           'risk','risk_assessments',r.id::text,r.ra_ref,coalesce(nullif(s.relationship_type,''),'derived_from'),
           s.revision_code,null,coalesce(s.applicability,'{}'::jsonb)||'{"origin":"swms_relationships_backfill"}'::jsonb,
           'active',s.created_by,s.created_at,s.updated_at
    from public.swms_relationships s
    join public.documents d on d.id::text=s.swms_document_id and d.company_id=s.company_id
    join public.risk_assessments r on r.company_id=s.company_id and (r.id::text=s.related_record_id or r.ra_ref=s.related_record_id)
    where s.related_module in ('risk','risk_assessment') and s.status<>'archived'
    union all
    select s.company_id,'swms','documents',d.id::text,d.doc_ref,
           'permit','permits',p.id::text,p.permit_number,coalesce(nullif(s.relationship_type,''),'interfaces_with'),
           s.revision_code,null,coalesce(s.applicability,'{}'::jsonb)||'{"origin":"swms_relationships_backfill"}'::jsonb,
           'active',s.created_by,s.created_at,s.updated_at
    from public.swms_relationships s
    join public.documents d on d.id::text=s.swms_document_id and d.company_id=s.company_id
    join public.permits p on p.company_id=s.company_id and (p.id::text=s.related_record_id or p.permit_number=s.related_record_id)
    where s.related_module='permit' and s.status<>'archived'
    on conflict (company_id,relationship_type,endpoint_a,endpoint_b) where status<>'archived' do nothing;
  end if;
end $$;

-- Promote governed legal evidence and permit/licence records that already have
-- an exact parent requirement. No inference or free-text matching is used.
do $$
begin
  if to_regclass('public.legal_compliance_records') is not null then
    insert into public.record_relationships(
      company_id,source_module,source_table,source_id,source_ref,
      target_module,target_table,target_id,target_ref,relationship_type,
      applicability,status,created_by,created_at,updated_at
    )
    select r.company_id,'legal','legal_requirements',q.id::text,q.req_ref,
           'legal','legal_compliance_records',r.id::text,r.reference,
           case when r.record_type='evidence' then 'evidence_for' else 'licence_for' end,
           jsonb_build_object('origin','legal_compliance_records_backfill','record_type',r.record_type),
           'active',r.created_by,r.created_at,r.updated_at
    from public.legal_compliance_records r
    join public.legal_requirements q on q.id::text=r.requirement_id and q.company_id=r.company_id
    where r.record_type in ('evidence','permit_licence')
    on conflict (company_id,relationship_type,endpoint_a,endpoint_b) where status<>'archived' do nothing;
  end if;
end $$;

-- Promote exact SOP project links. The publication link is authoritative only
-- when sop_document_id resolves to a controlled Document in the same tenant.
-- Legacy project relationships are migrated by explicit record ID only; no
-- title or free-text inference is performed.
do $$
begin
  if to_regclass('public.sop_video_projects') is not null then
    insert into public.record_relationships(
      company_id,source_module,source_table,source_id,source_ref,
      target_module,target_table,target_id,target_ref,relationship_type,
      target_revision,applicability,status,created_by,created_at,updated_at
    )
    select p.company_id,'sop','sop_video_projects',p.id::text,p.reference,
           'documents','documents',d.id::text,d.doc_ref,'published_as',
           coalesce(nullif(to_jsonb(d)->>'version',''),nullif(to_jsonb(d)->>'doc_version','')),jsonb_build_object('origin','sop_document_id_backfill'),
           'active',p.created_by,p.created_at,p.updated_at
    from public.sop_video_projects p
    join public.documents d on d.id::text=p.sop_document_id and d.company_id=p.company_id
    where nullif(btrim(p.sop_document_id),'') is not null
      and p.processing_status='published'
    on conflict (company_id,relationship_type,endpoint_a,endpoint_b) where status<>'archived' do nothing;
  end if;

  if to_regclass('public.sop_video_relationships') is not null then
    insert into public.record_relationships(
      company_id,source_module,source_table,source_id,source_ref,
      target_module,target_table,target_id,target_ref,relationship_type,
      source_revision,applicability,status,created_by,created_at,updated_at
    )
    select r.company_id,'sop','sop_video_projects',p.id::text,p.reference,
           'risk','risk_assessments',ra.id::text,ra.ra_ref,coalesce(nullif(r.relationship_type,''),'derived_from'),
           r.revision_code,jsonb_build_object('origin','sop_video_relationships_backfill'),
           'active',r.created_by,r.created_at,r.created_at
    from public.sop_video_relationships r
    join public.sop_video_projects p on p.id::text=r.project_id and p.company_id=r.company_id
    join public.risk_assessments ra on ra.id::text=r.related_record_id and ra.company_id=r.company_id
    where r.related_module in ('risk','risk_assessment')
    union all
    select r.company_id,'sop','sop_video_projects',p.id::text,p.reference,
           'permit','permits',pt.id::text,pt.permit_number,coalesce(nullif(r.relationship_type,''),'interfaces_with'),
           r.revision_code,jsonb_build_object('origin','sop_video_relationships_backfill'),
           'active',r.created_by,r.created_at,r.created_at
    from public.sop_video_relationships r
    join public.sop_video_projects p on p.id::text=r.project_id and p.company_id=r.company_id
    join public.permits pt on pt.id::text=r.related_record_id and pt.company_id=r.company_id
    where r.related_module in ('permit','ptw')
    union all
    select r.company_id,'sop','sop_video_projects',p.id::text,p.reference,
           'documents','documents',d.id::text,d.doc_ref,coalesce(nullif(r.relationship_type,''),'published_as'),
           r.revision_code,jsonb_build_object('origin','sop_video_relationships_backfill'),
           'active',r.created_by,r.created_at,r.created_at
    from public.sop_video_relationships r
    join public.sop_video_projects p on p.id::text=r.project_id and p.company_id=r.company_id
    join public.documents d on d.id::text=r.related_record_id and d.company_id=r.company_id
    where r.related_module in ('document','documents','document_control')
    on conflict (company_id,relationship_type,endpoint_a,endpoint_b) where status<>'archived' do nothing;
  end if;
end $$;

-- Promote exact controlled sources already registered against learning course
-- versions. The active UI writes both this canonical service and the
-- learning-specific impact register; this block preserves earlier valid links.
do $$
begin
  if to_regclass('public.learning_source_relationships') is not null
     and to_regclass('public.elearning_courses') is not null
     and to_regclass('public.documents') is not null
     and to_regclass('public.risk_assessments') is not null
     and to_regclass('public.legal_requirements') is not null
     and to_regclass('public.events') is not null
     and to_regclass('public.action_tracker') is not null
     and exists(select 1 from information_schema.columns where table_schema='public' and table_name='learning_source_relationships' and column_name='related_table') then
    insert into public.record_relationships(
      company_id,source_module,source_table,source_id,source_ref,
      target_module,target_table,target_id,target_ref,relationship_type,
      source_revision,target_revision,applicability,status,created_by,created_at,updated_at
    )
    select r.company_id,'training','elearning_courses',c.id::text,c.course_code,
           'documents','documents',d.id::text,d.doc_ref,coalesce(nullif(r.relationship_type,''),'learning_source'),
           r.course_version::text,r.related_revision,jsonb_build_object('origin','learning_source_relationships_backfill'),
           'active',r.created_by,r.created_at,r.updated_at
    from public.learning_source_relationships r
    join public.elearning_courses c on c.id::text=r.course_id and c.company_id=r.company_id
    join public.documents d on d.id::text=r.related_record_id and d.company_id=r.company_id
    where r.related_module='documents' and r.related_table='documents' and r.impact_status<>'superseded'
    union all
    select r.company_id,'training','elearning_courses',c.id::text,c.course_code,
           'risk','risk_assessments',ra.id::text,ra.ra_ref,coalesce(nullif(r.relationship_type,''),'learning_source'),
           r.course_version::text,r.related_revision,jsonb_build_object('origin','learning_source_relationships_backfill'),
           'active',r.created_by,r.created_at,r.updated_at
    from public.learning_source_relationships r
    join public.elearning_courses c on c.id::text=r.course_id and c.company_id=r.company_id
    join public.risk_assessments ra on ra.id::text=r.related_record_id and ra.company_id=r.company_id
    where r.related_module='risk' and r.related_table='risk_assessments' and r.impact_status<>'superseded'
    union all
    select r.company_id,'training','elearning_courses',c.id::text,c.course_code,
           'legal','legal_requirements',l.id::text,l.req_ref,coalesce(nullif(r.relationship_type,''),'learning_source'),
           r.course_version::text,r.related_revision,jsonb_build_object('origin','learning_source_relationships_backfill'),
           'active',r.created_by,r.created_at,r.updated_at
    from public.learning_source_relationships r
    join public.elearning_courses c on c.id::text=r.course_id and c.company_id=r.company_id
    join public.legal_requirements l on l.id::text=r.related_record_id and l.company_id=r.company_id
    where r.related_module='legal' and r.related_table='legal_requirements' and r.impact_status<>'superseded'
    union all
    select r.company_id,'training','elearning_courses',c.id::text,c.course_code,
           'event','events',ev.id::text,ev.event_ref,coalesce(nullif(r.relationship_type,''),'learning_source'),
           r.course_version::text,r.related_revision,jsonb_build_object('origin','learning_source_relationships_backfill'),
           'active',r.created_by,r.created_at,r.updated_at
    from public.learning_source_relationships r
    join public.elearning_courses c on c.id::text=r.course_id and c.company_id=r.company_id
    join public.events ev on ev.id::text=r.related_record_id and ev.company_id=r.company_id
    where r.related_module='event' and r.related_table='events' and r.impact_status<>'superseded'
    union all
    select r.company_id,'training','elearning_courses',c.id::text,c.course_code,
           'moc','action_tracker',m.id::text,coalesce(to_jsonb(m)->>'source_ref',to_jsonb(m)->>'action_ref'),coalesce(nullif(r.relationship_type,''),'learning_source'),
           r.course_version::text,r.related_revision,jsonb_build_object('origin','learning_source_relationships_backfill'),
           'active',r.created_by,r.created_at,r.updated_at
    from public.learning_source_relationships r
    join public.elearning_courses c on c.id::text=r.course_id and c.company_id=r.company_id
    join public.action_tracker m on m.id::text=r.related_record_id and m.company_id=r.company_id
    where r.related_module='moc' and r.related_table='action_tracker' and r.impact_status<>'superseded'
    on conflict (company_id,relationship_type,endpoint_a,endpoint_b) where status<>'archived' do nothing;
  end if;
end $$;

create or replace function public.create_record_relationship(
  p_company_id uuid,
  p_source_module text,
  p_source_table text,
  p_source_id text,
  p_source_ref text,
  p_target_module text,
  p_target_table text,
  p_target_id text,
  p_target_ref text,
  p_relationship_type text default 'related_to',
  p_source_revision text default null,
  p_target_revision text default null,
  p_applicability jsonb default '{}'::jsonb,
  p_allow_unresolved boolean default false
) returns public.record_relationships
language plpgsql
security invoker
set search_path = public
as $$
declare
  result public.record_relationships;
  source_ok boolean;
  target_ok boolean;
begin
  source_ok := public.relationship_endpoint_exists(p_company_id,p_source_module,p_source_table,p_source_id);
  target_ok := public.relationship_endpoint_exists(p_company_id,p_target_module,p_target_table,p_target_id);
  if (not source_ok or not target_ok) and not p_allow_unresolved then
    raise exception 'Relationship endpoint validation failed (source %, target %)', source_ok, target_ok
      using errcode = '23503';
  end if;
  select * into result
  from public.record_relationships r
  where r.company_id=p_company_id
    and r.relationship_type=lower(btrim(p_relationship_type))
    and r.status<>'archived'
    and r.endpoint_a=least(lower(btrim(p_source_module))||':'||lower(btrim(p_source_table))||':'||btrim(p_source_id),lower(btrim(p_target_module))||':'||lower(btrim(p_target_table))||':'||btrim(p_target_id))
    and r.endpoint_b=greatest(lower(btrim(p_source_module))||':'||lower(btrim(p_source_table))||':'||btrim(p_source_id),lower(btrim(p_target_module))||':'||lower(btrim(p_target_table))||':'||btrim(p_target_id));
  if found then return result; end if;
  insert into public.record_relationships(
    company_id,source_module,source_table,source_id,source_ref,
    target_module,target_table,target_id,target_ref,relationship_type,
    source_revision,target_revision,applicability,status,created_by
  ) values (
    p_company_id,p_source_module,p_source_table,p_source_id,p_source_ref,
    p_target_module,p_target_table,p_target_id,p_target_ref,coalesce(nullif(btrim(p_relationship_type),''),'related_to'),
    p_source_revision,p_target_revision,coalesce(p_applicability,'{}'::jsonb),
    case when source_ok and target_ok then 'active' else 'unresolved' end,auth.uid()
  ) returning * into result;
  return result;
end;
$$;

-- Promote governed BBS barrier responses into the reciprocal relationship
-- service. bbs_action_links remains the compatibility/operational cache while
-- action_tracker remains authoritative for owner, due date and closure state.
do $$
begin
  if to_regclass('public.bbs_action_links') is not null
     and to_regclass('public.bbs_themes') is not null
     and to_regclass('public.action_tracker') is not null then
    insert into public.record_relationships(
      company_id,source_module,source_table,source_id,source_ref,
      target_module,target_table,target_id,target_ref,relationship_type,
      applicability,status,created_by,created_at,updated_at
    )
    select l.company_id,'observation','bbs_themes',t.id::text,t.title,
           'action','action_tracker',a.id::text,coalesce(a.action_ref,l.action_ref),'action_for',
           jsonb_build_object('origin','bbs_action_links','bbs_action_link_id',l.id::text),
           'active',l.created_by,l.created_at,coalesce(l.status_checked_at,l.created_at)
    from public.bbs_action_links l
    join public.bbs_themes t on t.id::text=l.theme_id and t.company_id=l.company_id
    join public.action_tracker a on a.id::text=l.action_id and a.company_id=l.company_id
    where l.theme_id is not null
    on conflict (company_id,relationship_type,endpoint_a,endpoint_b) where status<>'archived' do nothing;
  end if;
end;
$$;

create or replace view public.record_relationships_bidirectional
with (security_invoker=true)
as
select
  id,company_id,
  source_module as record_module,source_table as record_table,source_id as record_id,source_ref as record_ref,source_revision as record_revision,
  target_module as related_module,target_table as related_table,target_id as related_id,target_ref as related_ref,target_revision as related_revision,
  relationship_type,status,applicability,source_valid as record_valid,target_valid as related_valid,validation_error,last_validated_at,verified_at,created_by,created_at,updated_at
from public.record_relationships
union all
select
  id,company_id,
  target_module,target_table,target_id,target_ref,target_revision,
  source_module,source_table,source_id,source_ref,source_revision,
  relationship_type,status,applicability,target_valid,source_valid,validation_error,last_validated_at,verified_at,created_by,created_at,updated_at
from public.record_relationships;

alter table public.relationship_module_registry enable row level security;
alter table public.record_relationships enable row level security;

drop policy if exists "relationship_registry_read" on public.relationship_module_registry;
create policy "relationship_registry_read" on public.relationship_module_registry
for select using (auth.uid() is not null);
drop policy if exists "relationship_registry_admin" on public.relationship_module_registry;
create policy "relationship_registry_admin" on public.relationship_module_registry
for all using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='sephs_admin'))
with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='sephs_admin'));

drop policy if exists "record_relationships_tenant_read" on public.record_relationships;
create policy "record_relationships_tenant_read" on public.record_relationships
for select using (exists(select 1 from public.profiles p where p.id=auth.uid()
  and (p.role='sephs_admin' or p.company_id=record_relationships.company_id)
  and (coalesce(record_relationships.applicability->>'confidentiality','general')<>'privileged'
       or p.role in ('sephs_admin','admin','hse_manager','compliance_manager'))));
drop policy if exists "record_relationships_tenant_write" on public.record_relationships;
create policy "record_relationships_tenant_write" on public.record_relationships
for all using (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=record_relationships.company_id and p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor','document_controller','compliance_manager','risk_assessor','training_admin','hr_manager')))))
with check (exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='sephs_admin' or (p.company_id=record_relationships.company_id and p.role in ('admin','hse_manager','hse_officer','manager','site_manager','supervisor','document_controller','compliance_manager','risk_assessor','training_admin','hr_manager')))));

grant select on public.relationship_module_registry to authenticated;
grant select,insert,update,delete on public.record_relationships to authenticated;
grant select on public.record_relationships_bidirectional to authenticated;
grant execute on function public.relationship_endpoint_exists(uuid,text,text,text) to authenticated;
grant execute on function public.create_record_relationship(uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb,boolean) to authenticated;

commit;
notify pgrst, 'reload schema';

select 'AURIS360_SHARED_RELATIONSHIPS_AP030_READY' as migration_status;
