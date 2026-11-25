-- Edit an unissued document's metadata without replacing its identity, revision or files.
-- Existing issued documents continue through the controlled change/revision workflow.
begin;

do $preflight$
declare required record;expected record;missing_helpers text;
begin
 for required in select * from (values
  ('public.documents'),('public.document_control_revisions'),('public.document_control_files'),
  ('public.document_control_audit_events')
 ) prerequisites(table_name) loop
  if not exists(select 1 from pg_class c
   where c.oid=to_regclass(required.table_name) and c.relkind='r' and c.relrowsecurity) then
   raise exception 'Document metadata setup requires the existing % table with row security enabled. Install the Document Control workflow migrations first.',required.table_name;
  end if;
 end loop;
 for expected in select * from (values
  ('public.documents','id','uuid'),('public.documents','company_id','uuid'),
  ('public.documents','current_revision_id','text'),('public.documents','updated_at','timestamptz'),
  ('public.documents','title','text'),('public.documents','document_type','text'),
  ('public.documents','doc_type','text'),('public.documents','department','text'),
  ('public.documents','category','text'),('public.documents','owner','text'),
  ('public.documents','description','text'),('public.documents','scope','text'),
  ('public.documents','tags','text[]'),('public.documents','legal_refs','text[]'),
  ('public.documents','issue_date','date'),('public.documents','review_date','date'),
  ('public.documents','language_code','text'),('public.documents','scope_type','text'),
  ('public.documents','scope_id','text'),('public.documents','confidentiality','text'),
  ('public.documents','status','text'),('public.documents','approval_status','text'),
  ('public.documents','lifecycle_state','text'),('public.documents','effective_date','date'),
  ('public.documents','approved_at','timestamptz'),('public.documents','archived_at','timestamptz'),
  ('public.document_control_revisions','id','text'),('public.document_control_revisions','company_id','uuid'),
  ('public.document_control_revisions','document_id','text'),('public.document_control_revisions','status','text'),
  ('public.document_control_revisions','title','text'),('public.document_control_revisions','language_code','text'),
  ('public.document_control_revisions','scope_type','text'),('public.document_control_revisions','scope_id','text'),
  ('public.document_control_revisions','content_json','jsonb'),('public.document_control_revisions','metadata_json','jsonb'),
  ('public.document_control_revisions','content_hash','text'),('public.document_control_revisions','updated_at','timestamptz'),
  ('public.document_control_revisions','effective_from','timestamptz'),('public.document_control_revisions','approved_at','timestamptz'),
  ('public.document_control_files','company_id','uuid'),('public.document_control_files','document_id','text'),
  ('public.document_control_files','revision_id','text'),('public.document_control_files','file_role','text'),
  ('public.document_control_audit_events','id','text'),('public.document_control_audit_events','company_id','uuid'),
  ('public.document_control_audit_events','document_id','text'),('public.document_control_audit_events','revision_id','text'),
  ('public.document_control_audit_events','entity_type','text'),('public.document_control_audit_events','entity_id','text'),
  ('public.document_control_audit_events','action','text'),('public.document_control_audit_events','before_json','jsonb'),
  ('public.document_control_audit_events','after_json','jsonb'),('public.document_control_audit_events','reason','text'),
  ('public.document_control_audit_events','performed_by','uuid'),('public.document_control_audit_events','performed_by_name','text')
 ) columns(table_name,column_name,type_name) loop
  if not exists(select 1 from pg_attribute a where a.attrelid=to_regclass(expected.table_name)
   and a.attname=expected.column_name and a.attnum>0 and not a.attisdropped
   and a.atttypid=to_regtype(expected.type_name)) then
   raise exception 'Document metadata setup requires %.% with type %. Install the Document Control workflow migrations first.',expected.table_name,expected.column_name,expected.type_name;
  end if;
 end loop;
 -- Metadata editing does not upload files or call document_upload_command.
 -- Check only the authentication helpers that this function actually executes.
 select string_agg(h.signature||' returns '||h.type_name,', ' order by h.signature)
 into missing_helpers from (values
  ('auth.uid()','uuid'),
  ('public.auris_can_access_company(uuid)','boolean'),
  ('public.user_access_allowed(text,text)','boolean')
 ) h(signature,type_name)
 left join pg_proc p on p.oid=to_regprocedure(h.signature)
 where p.oid is null or p.prorettype is distinct from to_regtype(h.type_name);
 if missing_helpers is not null then
  raise exception 'Document metadata setup requires these existing authentication helpers with the stated return types: %. Install the corresponding authentication/access migration first.',missing_helpers;
 end if;
 for required in select * from (values
  ('public.documents','document_release_guard'),
  ('public.document_control_revisions','document_revision_guard')
 ) guards(table_name,trigger_name) loop
  if not exists(select 1 from pg_trigger t
   where t.tgrelid=to_regclass(required.table_name) and t.tgname=required.trigger_name
   and t.tgfoid=to_regprocedure('public.guard_document_decisions()')
   and not t.tgisinternal and t.tgenabled in ('O','A')) then
   raise exception 'Document metadata setup requires the enabled % control on %. Install the Document Control workflow migrations first.',required.trigger_name,required.table_name;
  end if;
 end loop;
end $preflight$;

create or replace function public.save_document_metadata(
 p_document uuid,
 p_revision text,
 p_expected jsonb,
 p_meta jsonb,
 p_reason text
) returns jsonb
language plpgsql security invoker
set search_path=pg_catalog,public
as $$
declare
 d public.documents;
 previous_document public.documents;
 r public.document_control_revisions;
 previous_revision public.document_control_revisions;
 audit_row public.document_control_audit_events;
 audit_id text:=gen_random_uuid()::text;
 actor uuid:=auth.uid();
 actor_name text;
 actor_role text;
 clean jsonb:='{}'::jsonb;
 snapshot jsonb;
 before_snapshot jsonb;
 item record;
 field_name text;
 affected bigint;
 changed_at timestamptz:=clock_timestamp();
 allowed_fields constant text[]:=array[
  'title','document_type','department','category','owner','description','scope',
  'tags','legal_refs','issue_date','review_date','language_code','scope_type',
  'scope_id','confidentiality'
 ];
begin
 if actor is null then
  raise exception 'Document controller access is required' using errcode='42501';
 end if;
 if p_document is null or nullif(btrim(p_revision),'') is null
 or jsonb_typeof(p_expected) is distinct from 'object'
 or not (p_expected ?& array['document_updated_at','revision_updated_at','content_hash'])
 or jsonb_typeof(p_meta) is distinct from 'object'
 or p_meta='{}'::jsonb or octet_length(p_meta::text)>131072 then
  raise exception 'Open the current document details before saving metadata';
 end if;
 if nullif(btrim(p_reason),'') is null or length(p_reason)>4000 then
  raise exception 'Enter a reason for changing the document details';
 end if;

 -- Match the upload lock order, then retain the caller's row security on every write.
 perform pg_advisory_xact_lock(hashtextextended(p_document::text,0));
 select * into d from public.documents where id=p_document for update;
 if not found then
  raise exception 'Document is unavailable in this company' using errcode='42501';
 end if;
 -- Equivalent to assert_document_controller, which is intentionally not caller-executable.
 select full_name,role into actor_name,actor_role from public.profiles where id=actor;
 if not coalesce(public.auris_can_access_company(d.company_id),false)
 or not coalesce(public.user_access_allowed('documents','edit'),false)
 or actor_role is null or actor_role not in (
  'admin','sephs_admin','hse_manager','hse_officer','manager','site_manager',
  'document_controller','records_manager') then
  raise exception 'Document controller access is required' using errcode='42501';
 end if;
 select * into r from public.document_control_revisions
 where id=p_revision and document_id=d.id::text and company_id=d.company_id for update;
 if not found or d.current_revision_id is distinct from p_revision then
  raise exception 'The current revision changed. Reopen the document details';
 end if;
 if d.updated_at is distinct from (p_expected->>'document_updated_at')::timestamptz
 or r.updated_at is distinct from (p_expected->>'revision_updated_at')::timestamptz
 or r.content_hash is distinct from (p_expected->>'content_hash') then
  raise exception 'Document details changed or a previous save completed. Reopen before saving';
 end if;

 -- Generated renditions embed their source details and bind the revision's hash.
 -- Only their source editor can regenerate that content after a metadata change.
 if exists(select 1 from public.document_control_files f
  where f.company_id=d.company_id and f.document_id=d.id::text and f.revision_id=r.id
   and f.file_role='generated_rendition') then
  raise exception 'Generated document details must be edited in the source module and the rendition regenerated before review or release.';
 end if;

 -- Parent metadata must never silently replace the operational details of an issued revision.
 -- The existing release action does not project a new metadata snapshot onto the parent.
 if d.status='superseded' or d.archived_at is not null or d.effective_date is not null
 or d.approved_at is not null
 or coalesce(d.lifecycle_state,'draft') in ('effective','published','approved_awaiting_release','superseded','withdrawn','archived')
 or exists(select 1 from public.document_control_revisions prior
  where prior.company_id=d.company_id and prior.document_id=d.id::text
  and (prior.status in ('approved','effective','published','superseded')
   or prior.effective_from is not null or prior.approved_at is not null)) then
  raise exception 'Issued document details are protected; use the controlled change/revision workflow.';
 end if;
 if r.status not in ('draft','rejected','changes_requested')
 or coalesce(d.approval_status,'draft') not in ('draft','rejected','changes_requested') then
  raise exception 'Only a draft, rejected or changes-requested revision can have its details edited. Complete the current review first';
 end if;

 for item in select key,value from jsonb_each(p_meta) loop
  if not (item.key=any(allowed_fields)) then
   raise exception 'This document field cannot be changed in the details editor: %',item.key;
  end if;
  if item.key in ('tags','legal_refs') then
   if jsonb_typeof(item.value) is distinct from 'array'
   or jsonb_array_length(item.value)>200 then
    raise exception 'Tags and legal references must be lists of text values';
   end if;
   if exists(select 1 from jsonb_array_elements(item.value) v
    where jsonb_typeof(v) is distinct from 'string' or length(v#>>'{}')>1000) then
    raise exception 'Tags and legal references must be lists of text values';
   end if;
   clean:=clean||jsonb_build_object(item.key,item.value);
  else
   if jsonb_typeof(item.value) not in ('string','null')
   or length(item.value#>>'{}')>20000 then
    raise exception 'Enter a text value for document field: %',item.key;
   end if;
   clean:=clean||jsonb_build_object(item.key,
    case when item.value='null'::jsonb then null else btrim(item.value#>>'{}') end);
  end if;
 end loop;

 previous_document:=d;previous_revision:=r;
 d:=jsonb_populate_record(d,clean);
 if nullif(btrim(d.title),'') is null or length(d.title)>500
 or d.document_type is null or d.document_type not in (
  'policy','procedure','sop','swms','manual','form','emergency_plan','risk_assessment',
  'legal','certificate','work_instruction','technical_spec','other','plan','checklist',
  'drawing','external_standard','legal_document','safety_data_sheet','external') then
  raise exception 'Enter a title and supported document type';
 end if;
 if d.language_code is null or d.language_code not in ('en','fr','ar','other')
 or d.scope_type is null or d.scope_type not in ('company','site','department','role','project')
 or d.confidentiality is null or d.confidentiality not in ('public','internal','restricted','confidential') then
  raise exception 'Choose a supported language, scope type and confidentiality';
 end if;

 -- Store a complete metadata snapshot while preserving unrelated workflow/source metadata.
 snapshot:='{}'::jsonb;before_snapshot:='{}'::jsonb;
 foreach field_name in array allowed_fields loop
  snapshot:=snapshot||jsonb_build_object(field_name,to_jsonb(d)->field_name);
  before_snapshot:=before_snapshot||jsonb_build_object(field_name,to_jsonb(previous_document)->field_name);
 end loop;
 snapshot:=coalesce(r.metadata_json,'{}'::jsonb)||snapshot||jsonb_build_object('last_edited_by',actor);

 update public.document_control_revisions
 set title=d.title,language_code=d.language_code,scope_type=d.scope_type,scope_id=d.scope_id,
  metadata_json=snapshot,
  content_hash=encode(sha256(convert_to((r.content_json||jsonb_build_object('metadata',snapshot))::text,'UTF8')),'hex'),
  updated_at=changed_at
 where id=r.id and company_id=d.company_id and document_id=d.id::text
 returning * into r;
 if not found or r.metadata_json is distinct from snapshot or r.title is distinct from d.title
 or r.status is distinct from previous_revision.status or r.content_json is distinct from previous_revision.content_json
 or r.content_hash is distinct from encode(sha256(convert_to((r.content_json||jsonb_build_object('metadata',snapshot))::text,'UTF8')),'hex') then
  raise exception 'The revised document details were not saved. No changes were applied';
 end if;

 update public.documents set
  title=d.title,document_type=d.document_type,doc_type=d.document_type,
  department=d.department,category=d.category,owner=d.owner,description=d.description,
  scope=d.scope,tags=d.tags,legal_refs=d.legal_refs,issue_date=d.issue_date,review_date=d.review_date,
  language_code=d.language_code,scope_type=d.scope_type,scope_id=d.scope_id,
  confidentiality=d.confidentiality,updated_at=changed_at
 where id=d.id and company_id=d.company_id returning * into d;
 if not found then
  raise exception 'The document details were not saved. No changes were applied';
 end if;
 foreach field_name in array allowed_fields loop
  if (to_jsonb(d)->field_name) is distinct from (snapshot->field_name) then
   raise exception 'The document details were not saved. No changes were applied';
  end if;
 end loop;

 -- Audit insertion shares the transaction. A failed or suppressed audit cannot confirm a save.
 insert into public.document_control_audit_events(
  id,company_id,document_id,revision_id,entity_type,entity_id,action,
  before_json,after_json,reason,performed_by,performed_by_name
 ) values(
  audit_id,d.company_id,d.id::text,r.id,'document',d.id::text,'metadata_updated',
  jsonb_build_object('metadata',before_snapshot,'revision_metadata',previous_revision.metadata_json,'content_hash',previous_revision.content_hash),
  jsonb_build_object('metadata',snapshot,'content_hash',r.content_hash),btrim(p_reason),actor,actor_name
 );
 get diagnostics affected=row_count;
 if affected<>1 then
  raise exception 'The document change history was not saved. No changes were applied';
 end if;
 -- Some controller roles can append history but cannot read it. Respect that read policy.
 select * into audit_row from public.document_control_audit_events
 where id=audit_id and company_id=d.company_id and document_id=d.id::text and revision_id=r.id;
 return jsonb_build_object('document',to_jsonb(d),'revision',to_jsonb(r),
  'audit',case when audit_row.id is not null then to_jsonb(audit_row) else null end);
end $$;

revoke all on function public.save_document_metadata(uuid,text,jsonb,jsonb,text) from public,anon;
grant execute on function public.save_document_metadata(uuid,text,jsonb,jsonb,text) to authenticated;
comment on function public.save_document_metadata(uuid,text,jsonb,jsonb,text) is
 'Atomic same-identity metadata edits for unissued controlled drafts; retains caller RLS, files and decision history.';
notify pgrst,'reload schema';
commit;
