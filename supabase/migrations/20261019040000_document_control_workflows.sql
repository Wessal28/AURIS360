-- Purpose-built document workflows. Historical decisions and files are retained.
begin;
alter table public.doc_acknowledgements add column if not exists recipient_user_id uuid;
alter table public.doc_acknowledgements add column if not exists revision_id text;
alter table public.doc_acknowledgements add column if not exists distribution_id text;
alter table public.doc_controlled_copies add column if not exists recipient_user_id uuid;
alter table public.doc_controlled_copies add column if not exists revision_id text;
alter table public.doc_controlled_copies add column if not exists revision_code text;
alter table public.doc_controlled_copies add column if not exists distribution_id text;
create unique index document_distribution_ack_unique on public.doc_acknowledgements(distribution_id,recipient_user_id) where distribution_id is not null;
alter table public.documents drop constraint documents_doc_type_check;
alter table public.documents add constraint documents_doc_type_check check(doc_type is null or doc_type in ('policy','procedure','sop','swms','manual','form','emergency_plan','risk_assessment','legal','certificate','work_instruction','technical_spec','other','plan','checklist','drawing','external_standard','legal_document','safety_data_sheet','external'));
alter table public.documents drop constraint documents_document_type_check;
alter table public.documents add constraint documents_document_type_check check(document_type is null or document_type in ('policy','procedure','sop','swms','manual','form','emergency_plan','risk_assessment','legal','certificate','work_instruction','technical_spec','other','plan','checklist','drawing','external_standard','legal_document','safety_data_sheet','external'));

create function public.assert_document_controller(p_company uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text;
begin
 select role into r from public.profiles where id=auth.uid();
 if auth.uid() is null or not coalesce(public.auris_can_access_company(p_company),false) or not coalesce(public.user_access_allowed('documents','edit'),false) or r is null or r not in ('admin','sephs_admin','hse_manager','hse_officer','manager','site_manager','document_controller','records_manager') then raise exception 'Document controller access is required' using errcode='42501';end if;
end $$;

create function public.document_upload_command(p_command text,p_document uuid,p_revision text,p_hash text,p_key uuid,p_meta jsonb,p_file jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.documents;r public.document_control_revisions;f public.document_control_files;company uuid;actor uuid:=auth.uid();actor_name text;object_exists boolean;uploads jsonb;chosen_revision text;old_hash text;privacy text;
begin
 if p_document is null or p_key is null or p_command is null or p_command not in ('create','attach','revision') then raise exception 'Choose a document and upload operation';end if;
 if p_command='create' then company:=(p_meta->>'company_id')::uuid;else select company_id into company from public.documents where id=p_document;end if;
 perform public.assert_document_controller(company);select full_name into actor_name from public.profiles where id=actor;
 perform pg_advisory_xact_lock(hashtextextended(p_document::text,0));select * into d from public.documents where id=p_document and company_id=company for update;
 if p_command<>'create' and not found then raise exception 'Document is unavailable';end if;
 select * into f from public.document_control_files where id=p_key::text and company_id=company and document_id=p_document::text;
 if found then
  if f.storage_path is distinct from p_file->>'path' or f.content_hash is distinct from p_file->>'sha256' or f.file_role is distinct from coalesce(p_meta->>'file_role','approved_rendition') or (p_command='create' and d.title is distinct from btrim(p_meta->>'title')) then raise exception 'This upload operation already completed with different content. Reopen the document';end if;
  return to_jsonb(d);
 end if;
 if p_command='create' and d.id is not null then raise exception 'This document already exists. Reopen it before retrying';end if;
 if p_file is null and p_command<>'revision' then raise exception 'Choose a PDF to upload';end if;
 if p_command='revision' and p_file is null and exists(select 1 from public.document_control_revisions where id=p_key::text and company_id=company and document_id=d.id::text and source_revision_id is not distinct from p_revision and revision_code=p_meta->>'revision_code') then return to_jsonb(d);end if;
 if p_file is not null then
 if nullif(p_file->>'name','') is null or p_file->>'name' !~* '\.pdf$' or p_file->>'mime' is distinct from 'application/pdf' or coalesce((p_file->>'size')::bigint,0) not between 1 and 26214400 or p_file->>'sha256' is null or p_file->>'sha256' !~ '^[a-f0-9]{64}$' or p_file->>'path' is null or p_file->>'path' not like company::text||'/document-control/%' or p_file->>'path' like '%..%' or p_file->>'url' is null or p_file->>'url' !~ '^https://[^/]+/storage/v1/object/public/documents/' then raise exception 'Upload a PDF of at most 25 MB to this company document store';end if;
 if to_regclass('storage.objects') is null then raise exception 'Document storage is unavailable';end if;
 execute 'select exists(select 1 from storage.objects where bucket_id=''documents'' and name=$1)' into object_exists using p_file->>'path';
 if not object_exists then raise exception 'The PDF upload is not present in storage. Retry the upload';end if;
 end if;
 if p_command='create' then
  if nullif(btrim(p_meta->>'title'),'') is null or p_meta->>'document_type' not in ('policy','procedure','sop','swms','manual','form','emergency_plan','risk_assessment','legal','certificate','work_instruction','technical_spec','other','plan','checklist','drawing','external_standard','legal_document','safety_data_sheet','external') or p_meta->>'document_type' is null then raise exception 'Enter a title and supported document type';end if;
  select payload->>'confidentiality_default' into privacy from public.document_control_config where company_id=company and workspace='Metadata & Taxonomy' and status='published' and (effective_from is null or effective_from<=current_date) and (effective_to is null or effective_to>=current_date) order by version_no desc,created_at desc limit 1;
  privacy:=coalesce(privacy,'internal');if privacy not in ('public','internal','restricted','confidential') then raise exception 'The published confidentiality default is invalid. Ask an administrator to correct it';end if;
  insert into public.documents(id,company_id,title,document_type,doc_type,doc_ref,reference_no,version,approval_status,status,lifecycle_state,owner,author,created_by,updated_at,confidentiality)
  values(p_document,company,btrim(p_meta->>'title'),p_meta->>'document_type',p_meta->>'document_type','DOC-'||extract(year from current_date)||'-'||upper(substr(replace(p_document::text,'-',''),1,12)),'DOC-'||extract(year from current_date)||'-'||upper(substr(replace(p_document::text,'-',''),1,12)),'1.0','draft','draft','draft',actor_name,actor_name,actor,clock_timestamp(),privacy) returning * into d;
  chosen_revision:='1.0';
 else
  select * into r from public.document_control_revisions where id=d.current_revision_id and document_id=d.id::text and company_id=company for update;
  if d.current_revision_id is distinct from p_revision or (r.id is not null and r.content_hash is distinct from p_hash) then raise exception 'The revision changed. Reopen the upload panel';end if;
  if p_command='attach' and r.id is not null and r.status not in ('draft','rejected','changes_requested') then raise exception 'Create a new revision before replacing an approved or submitted file';end if;
  if p_command='revision' then
   if r.status in ('draft','pending_review','under_review','pending_approval') then raise exception 'A working draft already exists. Add its replacement PDF instead';end if;
   chosen_revision:=btrim(p_meta->>'revision_code');
   if chosen_revision is null or chosen_revision !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,31}$' or nullif(btrim(p_meta->>'change_summary'),'') is null then raise exception 'Enter a revision number and change summary';end if;
   if exists(select 1 from public.document_control_revisions where document_id=d.id::text and company_id=company and document_control_revisions.revision_code=chosen_revision) then raise exception 'That revision number already exists';end if;
  else chosen_revision:=coalesce(r.revision_code,d.version,'1.0');end if;
 end if;
 perform set_config('auris.document_command','upload',true);
 if p_command in ('create','revision') or r.id is null then
  insert into public.document_control_revisions(id,company_id,document_id,revision_code,status,title,source_revision_id,change_summary,content_json,metadata_json,created_by,language_code,scope_type,scope_id)
  values(p_key::text,company,d.id::text,chosen_revision,'draft',d.title,r.id,coalesce(nullif(p_meta->>'change_summary',''),'PDF uploaded'),coalesce(r.content_json,'{}')-'rendition_html'-'uploads'-'file_url'-'file_name',coalesce(r.metadata_json,'{}')||jsonb_build_object('document_type',d.document_type,'owner',d.owner,'last_edited_by',actor),actor,coalesce(r.language_code,d.language_code,'en'),coalesce(r.scope_type,d.scope_type,'company'),coalesce(r.scope_id,d.scope_id)) returning * into r;
 end if;
 old_hash:=r.content_hash;
 -- Prior files remain in history but cease to be the rendition for this draft.
 if p_file is not null and coalesce(p_meta->>'file_role','approved_rendition')='approved_rendition' then update public.document_control_files set status='superseded' where company_id=company and revision_id=r.id and file_role in ('approved_rendition','published_pdf','generated_rendition') and status='draft';end if;
 if coalesce(p_meta->>'file_role','approved_rendition') not in ('approved_rendition','source','attachment','translation') then raise exception 'Choose a supported file role';end if;
 if p_file is not null then insert into public.document_control_files(id,company_id,document_id,revision_id,file_role,file_name,file_url,storage_path,mime_type,file_size,content_hash,status,control_marking,created_by)
 values(p_key::text,company,d.id::text,r.id,coalesce(p_meta->>'file_role','approved_rendition'),p_file->>'name',p_file->>'url',p_file->>'path','application/pdf',(p_file->>'size')::bigint,p_file->>'sha256','draft','DRAFT / NOT AUTHORISED',actor);end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'sha256',content_hash,'path',storage_path,'role',file_role,'name',file_name) order by id),'[]') into uploads from public.document_control_files where company_id=company and revision_id=r.id and storage_path is not null and status<>'superseded';
 r.content_json:=r.content_json||jsonb_build_object('uploads',uploads);r.metadata_json:=r.metadata_json||jsonb_build_object('last_edited_by',actor);r.content_hash:=encode(sha256(convert_to((r.content_json||jsonb_build_object('metadata',r.metadata_json))::text,'UTF8')),'hex');
 update public.document_control_revisions set content_json=r.content_json,metadata_json=r.metadata_json,content_hash=r.content_hash,status='draft',approved_at=null,updated_at=clock_timestamp() where id=r.id;
 update public.document_control_records set status='cancelled',payload=payload||jsonb_build_object('cancellation_reason','Draft content changed; submit the updated revision for review'),updated_at=clock_timestamp() where company_id=company and revision_id=r.id and record_type='workflow_task' and status not in ('completed','cancelled');
 update public.documents set current_revision_id=r.id,version=chosen_revision,approval_status='draft',status='draft',lifecycle_state='draft',file_url=case when p_command='attach' and p_meta->>'file_role' in ('source','attachment','translation') then file_url else p_file->>'url' end,file_name=case when p_command='attach' and p_meta->>'file_role' in ('source','attachment','translation') then file_name else p_file->>'name' end,file_mime=case when p_command='attach' and p_meta->>'file_role' in ('source','attachment','translation') then file_mime else 'application/pdf' end,updated_at=clock_timestamp() where id=d.id returning * into d;
 insert into public.document_control_audit_events(company_id,document_id,revision_id,entity_type,entity_id,action,before_json,after_json,reason,performed_by) values(company,d.id::text,r.id,'file',p_key::text,'pdf_'||p_command,jsonb_build_object('content_hash',old_hash),jsonb_build_object('content_hash',r.content_hash,'file_sha256',p_file->>'sha256'),p_meta->>'change_summary',actor);
 perform set_config('auris.document_command','',true);return to_jsonb(d);
end $$;

create function public.submit_document_review(p_document uuid,p_revision text,p_hash text,p_reviewer uuid,p_due date,p_comments text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.documents;r public.document_control_revisions;reviewer public.profiles;t public.document_control_records;
begin
 select * into d from public.documents where id=p_document for update;perform public.assert_document_controller(d.company_id);
 select * into r from public.document_control_revisions where id=p_revision and company_id=d.company_id and document_id=d.id::text for update;
 if not found or r.id is distinct from d.current_revision_id or r.content_hash is null or r.content_hash is distinct from p_hash then raise exception 'The draft changed. Reopen Submit for review';end if;
 select * into reviewer from public.profiles where id=p_reviewer and company_id=d.company_id and coalesce(status,'active')='active' and role in ('admin','hse_manager','manager','site_manager','document_controller','records_manager');
 if not found then raise exception 'Select an active company user with approval access';end if;
 if p_reviewer=coalesce((r.metadata_json->>'last_edited_by')::uuid,r.created_by,d.created_by) then raise exception 'Choose an independent reviewer';end if;
 if r.status='pending_review' then select * into t from public.document_control_records where company_id=d.company_id and revision_id=r.id and record_type='workflow_task' and status='open' and assignee_id=p_reviewer and payload->>'content_hash'=p_hash order by created_at desc limit 1;if found then return to_jsonb(t);end if;end if;
 if r.status not in ('draft','rejected','changes_requested') then raise exception 'Only a working draft can be submitted for review';end if;
 if not exists(select 1 from public.document_control_files where company_id=d.company_id and revision_id=r.id and status='draft' and file_role in ('approved_rendition','published_pdf','generated_rendition')) then raise exception 'Add a rendition before submitting for review';end if;
 if p_due is null or p_due<current_date then raise exception 'Choose a review due date today or later';end if;
 perform set_config('auris.document_command','submit',true);
 insert into public.document_control_records(company_id,document_id,revision_id,record_type,title,status,assignee_id,assignee_name,owner_id,owner_name,due_date,payload,created_by)
 values(d.company_id,d.id::text,r.id,'workflow_task','Review '||coalesce(d.doc_ref,d.title)||' · Revision '||r.revision_code,'open',p_reviewer,reviewer.full_name,auth.uid(),(select full_name from public.profiles where id=auth.uid()),p_due,jsonb_build_object('stage','Independent review','revision_code',r.revision_code,'content_hash',p_hash,'comments',p_comments),auth.uid()) returning * into t;
 update public.document_control_revisions set status='pending_review',updated_at=clock_timestamp() where id=r.id;
 update public.documents set approval_status='pending_review',lifecycle_state='pending_review',reviewer_id=p_reviewer,reviewer=reviewer.full_name,review_requested_at=clock_timestamp(),updated_at=clock_timestamp() where id=d.id;
 insert into public.document_control_audit_events(company_id,document_id,revision_id,entity_type,entity_id,action,after_json,performed_by) values(d.company_id,d.id::text,r.id,'workflow_task',t.id,'submitted_for_review',t.payload,auth.uid());
 perform set_config('auris.document_command','',true);return to_jsonb(t);
end $$;

create function public.distribute_document_revision(p_document uuid,p_revision text,p_hash text,p_key uuid,p_recipients uuid[],p_channel text,p_ack boolean,p_due date,p_notes text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.documents;r public.document_control_revisions;t public.document_control_records;recipient public.profiles;recipient_id uuid;n integer:=0;copy_ref text;
begin
 select * into d from public.documents where id=p_document for update;perform public.assert_document_controller(d.company_id);
 if p_key is null or p_channel is null or p_channel not in ('electronic','print','offline','emergency') or p_ack is null or coalesce(cardinality(p_recipients),0) not between 1 and 100 or array_position(p_recipients,null) is not null or (select count(distinct x) from unnest(p_recipients)x)<>cardinality(p_recipients) then raise exception 'Choose unique recipients, a delivery method and acknowledgement requirement';end if;
 select * into t from public.document_control_records where id=p_key::text and company_id=d.company_id and document_id=d.id::text and record_type='distribution';
 if found then if t.revision_id is distinct from p_revision or t.payload->'recipient_ids' is distinct from to_jsonb(p_recipients) or t.payload->>'channel' is distinct from p_channel then raise exception 'This distribution operation already completed with different details';end if;return to_jsonb(t);end if;
 select * into r from public.document_control_revisions where id=p_revision and document_id=d.id::text and company_id=d.company_id for update;
 if not found or r.status<>'effective' or r.content_hash is distinct from p_hash or r.effective_to is not null then raise exception 'Select the current released revision before distribution';end if;
 if p_ack and (p_due is null or p_due<current_date) then raise exception 'Choose an acknowledgement due date today or later';end if;
 insert into public.document_control_records(id,company_id,document_id,revision_id,record_type,title,status,payload,created_by)
 values(p_key::text,d.company_id,d.id::text,r.id,'distribution','Distribution · '||coalesce(d.doc_ref,d.title)||' · Revision '||r.revision_code,'issued',jsonb_build_object('revision_code',r.revision_code,'content_hash',p_hash,'recipient_ids',p_recipients,'channel',p_channel,'acknowledgement_required',p_ack,'notes',p_notes,'delivery_status','Recorded for controlled delivery; no email or message sent'),auth.uid()) returning * into t;
 foreach recipient_id in array p_recipients loop
  select * into recipient from public.profiles where id=recipient_id and company_id=d.company_id and coalesce(status,'active')='active';
  if not found or (d.confidentiality in ('confidential','restricted') and recipient.role not in ('admin','hse_manager','hse_officer','manager','site_manager','document_controller','records_manager')) then raise exception 'A recipient is unavailable or is not permitted for this document';end if;
  n:=n+1;copy_ref:='COPY-'||upper(substr(replace(p_key::text,'-',''),1,10))||'-'||n;
  insert into public.doc_controlled_copies(company_id,document_id,copy_number,copy_holder,issued_date,issued_by,format,status,recipient_user_id,revision_id,revision_code,distribution_id,notes)
  values(d.company_id,d.id,copy_ref,recipient.full_name,current_date,(select full_name from public.profiles where id=auth.uid()),case when p_channel='print' then 'print' else 'electronic' end,'active',recipient_id,r.id,r.revision_code,t.id,p_notes);
  if p_ack then insert into public.doc_acknowledgements(company_id,document_id,doc_ref,doc_title,doc_version,employee_name,status,due_date,created_by,recipient_user_id,revision_id,distribution_id) values(d.company_id,d.id,d.doc_ref,d.title,r.revision_code,recipient.full_name,'pending',p_due,auth.uid(),recipient_id,r.id,t.id);end if;
 end loop;
 update public.document_control_records set payload=payload||jsonb_build_object('recipient', (select string_agg(full_name,', ' order by full_name) from public.profiles where id=any(p_recipients) and company_id=d.company_id)) where id=t.id returning * into t;
 insert into public.document_control_audit_events(company_id,document_id,revision_id,entity_type,entity_id,action,after_json,performed_by) values(d.company_id,d.id::text,r.id,'distribution',t.id,'distribution_recorded',t.payload,auth.uid());return to_jsonb(t);
end $$;

create function public.acknowledge_controlled_document(p_assignment uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.doc_acknowledgements;
begin
 select * into a from public.doc_acknowledgements where id=p_assignment for update;
 if not found or auth.uid() is null or a.recipient_user_id is distinct from auth.uid() or not coalesce(public.auris_can_access_company(a.company_id),false) or not coalesce(public.user_access_allowed('documents','view'),false) then raise exception 'Only the assigned signed-in recipient can acknowledge' using errcode='42501';end if;
 if a.status='acknowledged' then return to_jsonb(a);end if;
 if not exists(select 1 from public.document_control_revisions where id=a.revision_id and company_id=a.company_id and document_id=a.document_id::text and status='effective' and effective_to is null) then raise exception 'This revision is no longer current. Request the released replacement';end if;
 perform set_config('auris.document_ack','acknowledge',true);
 update public.doc_acknowledgements set status='acknowledged',acknowledged=true,acknowledged_at=clock_timestamp(),signature_text=(select full_name from public.profiles where id=auth.uid()) where id=a.id returning * into a;
 insert into public.document_control_audit_events(company_id,document_id,revision_id,entity_type,entity_id,action,performed_by) values(a.company_id,a.document_id::text,a.revision_id,'acknowledgement',a.id::text,'acknowledged',auth.uid());perform set_config('auris.document_ack','',true);return to_jsonb(a);
end $$;

create function public.guard_document_acknowledgement() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if auth.uid() is not null and coalesce(current_setting('auris.document_ack',true),'')<>'acknowledge' and old.recipient_user_id is not null and (tg_op='DELETE' or new.recipient_user_id is distinct from old.recipient_user_id or new.revision_id is distinct from old.revision_id or new.acknowledged is distinct from old.acknowledged or new.acknowledged_at is distinct from old.acknowledged_at or new.status is distinct from old.status) then raise exception 'Use the assigned-recipient acknowledgement action';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger controlled_document_ack_guard before update or delete on public.doc_acknowledgements for each row execute function public.guard_document_acknowledgement();

create function public.guard_controlled_document_object() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if (tg_op='DELETE' or new.name is distinct from old.name or new.bucket_id is distinct from old.bucket_id or new.metadata is distinct from old.metadata or to_jsonb(new)->'version' is distinct from to_jsonb(old)->'version') and exists(select 1 from public.document_control_files f join public.document_control_revisions r on r.id=f.revision_id and r.company_id=f.company_id where old.bucket_id='documents' and f.storage_path=old.name) then raise exception 'This stored file belongs to a controlled revision. Upload a new file for a draft revision';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
do $$begin if to_regclass('storage.objects') is not null then execute 'create trigger controlled_document_object_guard before update or delete on storage.objects for each row execute function public.guard_controlled_document_object()';end if;end $$;
revoke all on function public.assert_document_controller(uuid),public.document_upload_command(text,uuid,text,text,uuid,jsonb,jsonb),public.submit_document_review(uuid,text,text,uuid,date,text),public.distribute_document_revision(uuid,text,text,uuid,uuid[],text,boolean,date,text),public.acknowledge_controlled_document(uuid),public.guard_document_acknowledgement(),public.guard_controlled_document_object() from public;
grant execute on function public.document_upload_command(text,uuid,text,text,uuid,jsonb,jsonb),public.submit_document_review(uuid,text,text,uuid,date,text),public.distribute_document_revision(uuid,text,text,uuid,uuid[],text,boolean,date,text),public.acknowledge_controlled_document(uuid) to authenticated;
create or replace function public.decide_document_revision(p_document uuid,p_revision text,p_hash text,p_decision text,p_comments text,p_evidence text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.documents;r public.document_control_revisions;a public.document_control_records;actor uuid:=auth.uid();person public.profiles;actual text;uploads jsonb;
begin
 select * into person from public.profiles where id=actor;
 select * into d from public.documents where id=p_document for update;
 if not found or actor is null or not coalesce(public.auris_can_access_company(d.company_id),false) or not coalesce(public.user_access_allowed('documents','edit'),false) or person.role is null or person.role not in ('admin','sephs_admin','hse_manager','manager','site_manager','document_controller','records_manager') then raise exception 'Document approval access is required' using errcode='42501';end if;
 select * into r from public.document_control_revisions where id=p_revision and document_id=d.id::text and company_id=d.company_id for update;
 if not found or d.current_revision_id is distinct from r.id or r.status not in ('draft','pending_review','under_review','pending_approval','rejected','changes_requested') then raise exception 'Select the current draft revision for a new decision';end if;
 if r.content_json ? 'uploads' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'sha256',content_hash,'path',storage_path,'role',file_role,'name',file_name) order by id),'[]') into uploads from public.document_control_files where company_id=d.company_id and revision_id=r.id and storage_path is not null and status<>'superseded';
  if uploads is distinct from r.content_json->'uploads' then raise exception 'The revision files changed. Save the updated PDF before recording a decision';end if;
 end if;
 if r.status='pending_review' and exists(select 1 from public.document_control_records where revision_id=r.id and company_id=d.company_id and record_type='workflow_task' and status='open' and assignee_id is not null) and not exists(select 1 from public.document_control_records where revision_id=r.id and company_id=d.company_id and record_type='workflow_task' and status='open' and assignee_id=actor and payload->>'content_hash'=p_hash) then raise exception 'The assigned reviewer must record this decision';end if;
 actual:=encode(sha256(convert_to((r.content_json||jsonb_build_object('metadata',r.metadata_json))::text,'UTF8')),'hex');
 -- A hash supplied by the viewer is an optimistic snapshot, never approval authority.
 if nullif(p_hash,'') is null or r.content_hash is distinct from p_hash then raise exception 'Revision content changed. Reopen the decision form';end if;
 if p_decision is null or p_decision not in ('approved','rejected','changes_requested') or nullif(btrim(p_comments),'') is null then raise exception 'Choose a decision and enter review comments';end if;
 if actor=coalesce((r.metadata_json->>'last_edited_by')::uuid,r.created_by,d.created_by) and not exists(select 1 from public.document_control_config c where c.company_id=d.company_id and c.workspace='Review & Approval' and c.status='published' and (c.effective_from is null or c.effective_from<=current_date) and (c.effective_to is null or c.effective_to>=current_date) and c.payload->>'self_approval_allowed'='true') then raise exception 'An independent approver must review this revision';end if;
 perform set_config('auris.document_command','decide',true);
 insert into public.document_control_records(company_id,document_id,revision_id,record_type,title,status,assignee_id,assignee_name,payload,created_by,completed_at)
 values(d.company_id,d.id::text,r.id,'approval_decision','Revision '||r.revision_code||' decision',p_decision,actor,person.full_name,jsonb_build_object('revision_code',r.revision_code,'content_hash',actual,'comments',p_comments,'evidence_reference',p_evidence,'decided_by',actor,'decided_at',clock_timestamp()),actor,clock_timestamp()) returning * into a;
 update public.document_control_records set status='completed',completed_at=clock_timestamp(),payload=payload||jsonb_build_object('decision_id',a.id,'decision',p_decision),updated_at=clock_timestamp() where company_id=d.company_id and revision_id=r.id and record_type='workflow_task' and assignee_id=actor and payload->>'content_hash'=actual and status='open';
 update public.document_control_revisions set status=p_decision,content_hash=actual,approved_at=case when p_decision='approved' then clock_timestamp() end,updated_at=clock_timestamp() where id=r.id;
 update public.documents set approval_status=case when p_decision='changes_requested' then 'rejected' else p_decision end,lifecycle_state=case when p_decision='approved' then 'approved_awaiting_release' else 'draft' end,approver_id=actor,approved_at=case when p_decision='approved' then clock_timestamp() end,updated_at=clock_timestamp() where id=d.id;
 insert into public.document_control_audit_events(company_id,document_id,revision_id,entity_type,entity_id,action,after_json,performed_by) values(d.company_id,d.id::text,r.id,'approval_decision',a.id,p_decision,a.payload,actor);
 perform set_config('auris.document_command','',true);return to_jsonb(a);
end $$;

create or replace function public.release_document_revision(p_document uuid,p_revision text,p_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.documents;r public.document_control_revisions;actor uuid:=auth.uid();role_name text;actual text;
begin
 select role into role_name from public.profiles where id=actor;select * into d from public.documents where id=p_document for update;
 if not found or actor is null or not coalesce(public.auris_can_access_company(d.company_id),false) or not coalesce(public.user_access_allowed('documents','edit'),false) or role_name is null or role_name not in ('admin','sephs_admin','hse_manager','manager','site_manager','document_controller','records_manager') then raise exception 'Document release access is required' using errcode='42501';end if;
 select * into r from public.document_control_revisions where id=p_revision and document_id=d.id::text and company_id=d.company_id for update;
 if not found or r.status<>'approved' or d.current_revision_id is distinct from r.id then raise exception 'The current revision needs an authenticated approval before release';end if;
 actual:=encode(sha256(convert_to((r.content_json||jsonb_build_object('metadata',r.metadata_json))::text,'UTF8')),'hex');
 if p_hash is distinct from actual or not exists(select 1 from public.document_control_records where document_id=d.id::text and revision_id=r.id and company_id=d.company_id and record_type='approval_decision' and status='approved' and payload->>'content_hash'=actual and assignee_id is not null) then raise exception 'Approval does not bind to this content. Obtain a new decision';end if;
 if exists(select 1 from public.document_control_records where document_id=d.id::text and revision_id=r.id and company_id=d.company_id and record_type='workflow_task' and status not in ('approved','completed','cancelled')) then raise exception 'Complete the outstanding review tasks before release';end if;
 if not exists(select 1 from public.document_control_files where document_id=d.id::text and revision_id=r.id and company_id=d.company_id and status='draft' and ((file_role='generated_rendition' and nullif(r.content_json->>'rendition_html','') is not null and content_hash=actual) or (file_role in ('approved_rendition','published_pdf') and nullif(file_url,'') is not null))) then raise exception 'Attach a rendition to this revision before release';end if;
 perform set_config('auris.document_command','release',true);
 update public.document_control_revisions set status='superseded',effective_to=clock_timestamp(),superseded_at=clock_timestamp() where document_id=d.id::text and company_id=d.company_id and id<>r.id and status='effective';
 update public.document_control_files set status='superseded' where document_id=d.id::text and company_id=d.company_id and revision_id<>r.id and status='published';
 update public.document_control_revisions set status='effective',effective_from=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
 update public.document_control_files set status='published',control_marking='CONTROLLED',verified_by=actor,verified_at=clock_timestamp() where document_id=d.id::text and company_id=d.company_id and revision_id=r.id and status='draft';
 update public.documents set status='current',approval_status='approved',lifecycle_state='effective',effective_date=current_date,updated_at=clock_timestamp() where id=d.id returning * into d;
 insert into public.document_control_audit_events(company_id,document_id,revision_id,entity_type,entity_id,action,after_json,performed_by) values(d.company_id,d.id::text,r.id,'revision',r.id,'released',jsonb_build_object('content_hash',actual),actor);
 perform set_config('auris.document_command','',true);return to_jsonb(d);
end $$;

commit;
