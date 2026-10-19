-- Atomic SWMS rendition saves and authenticated, content-bound decisions.
begin;
create function public.save_swms_revision(p_id uuid,p_expected timestamptz,p_body jsonb,p_payload jsonb,p_html text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.documents;r public.document_control_revisions;actor uuid:=auth.uid();company uuid:=(p_body->>'company_id')::uuid;role_name text;is_new boolean;clean jsonb;content jsonb;
begin
 select role into role_name from public.profiles where id=actor;
 if actor is null or not coalesce(public.auris_can_access_company(company),false) or not coalesce(public.user_access_allowed('swms','edit'),false)
 or role_name is null or role_name not in ('admin','sephs_admin','hse_manager','hse_officer','manager','site_manager','supervisor','document_controller') then raise exception 'SWMS editing access is required' using errcode='42501';end if;
 if p_id is null or nullif(btrim(p_body->>'title'),'') is null or nullif(btrim(p_body->>'version'),'') is null or jsonb_typeof(p_payload) is distinct from 'object' or nullif(p_html,'') is null or octet_length(p_html)>4194304 then raise exception 'Title, revision, structured method and rendition are required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into d from public.documents where id=p_id and company_id=company for update;is_new:=not found;
 if is_new then
  if p_expected is not null then raise exception 'SWMS is unavailable in this company';end if;
  d.id:=p_id;d.company_id:=company;d.created_by:=actor;d.created_at:=clock_timestamp();d.language_code:='en';d.scope_type:='company';d.confidentiality:='internal';
 else
  if p_expected is null or d.updated_at is distinct from p_expected then raise exception 'SWMS changed or a previous save completed. Reopen before saving.';end if;
  if d.doc_type is distinct from 'swms' and d.category is distinct from 'Safe Work Method Statement' then raise exception 'This document is not a SWMS';end if;
  select * into r from public.document_control_revisions where id=d.current_revision_id and document_id=d.id::text for update;
  if r.id is not null and r.status not in ('draft','rejected','changes_requested') or r.id is null and coalesce(d.approval_status,'draft') not in ('draft','rejected') then raise exception 'Create a draft revision in Document Control before editing controlled content';end if;
  if r.id is not null and r.revision_code<>p_body->>'version' then raise exception 'Revision differs from the controlled draft. Reopen the SWMS';end if;
 end if;
 select jsonb_object_agg(key,value) into clean from jsonb_each(p_body) where key=any(array['title','department','description','scope','tags','version','doc_version','doc_ref','reference_no','issue_date','review_date','review_interval_months','author','owner','reviewer','approver','legal_refs','location','linked_risk_assessment_id','linked_ra_ref','linked_permit_id','linked_permit_ref','revision_summary']);
 d:=jsonb_populate_record(d,clean);d.doc_type:='swms';d.document_type:='swms';d.category:='Safe Work Method Statement';d.status:='draft';d.approval_status:='draft';d.lifecycle_state:='draft';d.controlled_copy:=true;d.effective_date:=null;d.updated_at:=clock_timestamp();
 content:=jsonb_build_object('swms_payload',p_payload||jsonb_build_object('version',d.version),'rendition_html',p_html);
 if r.id is null then r.id:=gen_random_uuid()::text;r.company_id:=company;r.document_id:=d.id::text;r.revision_code:=d.version;r.language_code:='en';r.scope_type:='company';r.created_by:=actor;r.created_at:=clock_timestamp();end if;
 r.status:='draft';r.title:=d.title;r.content_json:=content;r.metadata_json:=jsonb_build_object('document_type','swms','title',d.title,'owner',d.owner,'reviewer',d.reviewer,'approver',d.approver,'last_edited_by',actor);r.content_hash:=encode(sha256(convert_to((content||jsonb_build_object('metadata',r.metadata_json))::text,'UTF8')),'hex');r.updated_at:=clock_timestamp();d.current_revision_id:=r.id;
 perform set_config('auris.document_command','save',true);
 if is_new then insert into public.documents select (d).*;
 else update public.documents set title=d.title,document_type=d.document_type,doc_type=d.doc_type,category=d.category,department=d.department,description=d.description,scope=d.scope,tags=d.tags,version=d.version,doc_ref=d.doc_ref,reference_no=d.reference_no,issue_date=d.issue_date,effective_date=null,review_date=d.review_date,author=d.author,owner=d.owner,reviewer=d.reviewer,approver=d.approver,legal_refs=d.legal_refs,location=d.location,linked_risk_assessment_id=d.linked_risk_assessment_id,linked_ra_ref=d.linked_ra_ref,linked_permit_id=d.linked_permit_id,linked_permit_ref=d.linked_permit_ref,revision_summary=d.revision_summary,current_revision_id=r.id,status='draft',approval_status='draft',lifecycle_state='draft',updated_at=d.updated_at where id=d.id;end if;
 insert into public.document_control_revisions select (r).* on conflict(id) do update set content_json=excluded.content_json,metadata_json=excluded.metadata_json,content_hash=excluded.content_hash,title=excluded.title,status='draft',updated_at=excluded.updated_at;
 delete from public.document_control_files where revision_id=r.id and company_id=company and file_role='generated_rendition';
 insert into public.document_control_files(company_id,document_id,revision_id,file_role,file_name,mime_type,content_hash,status,control_marking,created_by) values(company,d.id::text,r.id,'generated_rendition',coalesce(d.doc_ref,'SWMS')||'-'||r.revision_code||'.html','text/html',r.content_hash,'draft','DRAFT / NOT AUTHORISED',actor);
 insert into public.document_control_audit_events(company_id,document_id,revision_id,entity_type,entity_id,action,after_json,performed_by) values(company,d.id::text,r.id,'revision',r.id,'swms_saved',jsonb_build_object('content_hash',r.content_hash),actor);
 perform set_config('auris.document_command','',true);return to_jsonb(d);
end $$;

create function public.decide_document_revision(p_document uuid,p_revision text,p_hash text,p_decision text,p_comments text,p_evidence text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.documents;r public.document_control_revisions;a public.document_control_records;actor uuid:=auth.uid();person public.profiles;actual text;
begin
 select * into person from public.profiles where id=actor;
 select * into d from public.documents where id=p_document for update;
 if not found or actor is null or not coalesce(public.auris_can_access_company(d.company_id),false) or not coalesce(public.user_access_allowed('documents','edit'),false) or person.role is null or person.role not in ('admin','sephs_admin','hse_manager','manager','site_manager','document_controller','records_manager') then raise exception 'Document approval access is required' using errcode='42501';end if;
 select * into r from public.document_control_revisions where id=p_revision and document_id=d.id::text and company_id=d.company_id for update;
 if not found or d.current_revision_id is distinct from r.id or r.status not in ('draft','pending_review','under_review','pending_approval','rejected','changes_requested') then raise exception 'Select the current draft revision for a new decision';end if;
 actual:=encode(sha256(convert_to((r.content_json||jsonb_build_object('metadata',r.metadata_json))::text,'UTF8')),'hex');
 -- A hash supplied by the viewer is an optimistic snapshot, never approval authority.
 if nullif(p_hash,'') is null or r.content_hash is distinct from p_hash then raise exception 'Revision content changed. Reopen the decision form';end if;
 if p_decision is null or p_decision not in ('approved','rejected','changes_requested') or nullif(btrim(p_comments),'') is null then raise exception 'Choose a decision and enter review comments';end if;
 if actor=coalesce((r.metadata_json->>'last_edited_by')::uuid,r.created_by,d.created_by) and not exists(select 1 from public.document_control_config c where c.company_id=d.company_id and c.workspace='Review & Approval' and c.status='published' and (c.effective_from is null or c.effective_from<=current_date) and (c.effective_to is null or c.effective_to>=current_date) and c.payload->>'self_approval_allowed'='true') then raise exception 'An independent approver must review this revision';end if;
 perform set_config('auris.document_command','decide',true);
 insert into public.document_control_records(company_id,document_id,revision_id,record_type,title,status,assignee_id,assignee_name,payload,created_by,completed_at)
 values(d.company_id,d.id::text,r.id,'approval_decision','Revision '||r.revision_code||' decision',p_decision,actor,person.full_name,jsonb_build_object('revision_code',r.revision_code,'content_hash',actual,'comments',p_comments,'evidence_reference',p_evidence,'decided_by',actor,'decided_at',clock_timestamp()),actor,clock_timestamp()) returning * into a;
 update public.document_control_revisions set status=p_decision,content_hash=actual,approved_at=case when p_decision='approved' then clock_timestamp() end,updated_at=clock_timestamp() where id=r.id;
 update public.documents set approval_status=case when p_decision='changes_requested' then 'rejected' else p_decision end,lifecycle_state=case when p_decision='approved' then 'approved_awaiting_release' else 'draft' end,approver_id=actor,approved_at=case when p_decision='approved' then clock_timestamp() end,updated_at=clock_timestamp() where id=d.id;
 insert into public.document_control_audit_events(company_id,document_id,revision_id,entity_type,entity_id,action,after_json,performed_by) values(d.company_id,d.id::text,r.id,'approval_decision',a.id,p_decision,a.payload,actor);
 perform set_config('auris.document_command','',true);return to_jsonb(a);
end $$;

create function public.release_document_revision(p_document uuid,p_revision text,p_hash text) returns jsonb
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
 if not exists(select 1 from public.document_control_files where document_id=d.id::text and revision_id=r.id and company_id=d.company_id and ((file_role='generated_rendition' and nullif(r.content_json->>'rendition_html','') is not null and content_hash=actual) or (file_role in ('approved_rendition','published_pdf') and nullif(file_url,'') is not null))) then raise exception 'Attach a rendition to this revision before release';end if;
 perform set_config('auris.document_command','release',true);
 update public.document_control_revisions set status='superseded',effective_to=clock_timestamp(),superseded_at=clock_timestamp() where document_id=d.id::text and company_id=d.company_id and id<>r.id and status='effective';
 update public.document_control_files set status='superseded' where document_id=d.id::text and company_id=d.company_id and revision_id<>r.id and status='published';
 update public.document_control_revisions set status='effective',effective_from=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
 update public.document_control_files set status='published',control_marking='CONTROLLED',verified_by=actor,verified_at=clock_timestamp() where document_id=d.id::text and company_id=d.company_id and revision_id=r.id;
 update public.documents set status='current',approval_status='approved',lifecycle_state='effective',effective_date=current_date,updated_at=clock_timestamp() where id=d.id returning * into d;
 insert into public.document_control_audit_events(company_id,document_id,revision_id,entity_type,entity_id,action,after_json,performed_by) values(d.company_id,d.id::text,r.id,'revision',r.id,'released',jsonb_build_object('content_hash',actual),actor);
 perform set_config('auris.document_command','',true);return to_jsonb(d);
end $$;

create function public.guard_document_decisions() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if coalesce(current_setting('auris.document_command',true),'')<>'' or auth.uid() is null then if tg_op='DELETE' then return old;else return new;end if;end if;
 if tg_table_name='document_control_records' then
  if (tg_op<>'INSERT' and old.record_type='approval_decision') or (tg_op<>'DELETE' and new.record_type='approval_decision') then raise exception 'Use the authenticated revision decision action; decision history is immutable';end if;
 elsif tg_table_name='document_control_files' then
  if exists(select 1 from public.document_control_revisions where id=case when tg_op='DELETE' then old.revision_id else new.revision_id end and status in ('approved','effective','published','superseded')) or (tg_op='UPDATE' and exists(select 1 from public.document_control_revisions where id=old.revision_id and status in ('approved','effective','published','superseded'))) then raise exception 'Files bound to a controlled revision are immutable. Create a new draft revision';end if;
 elsif tg_table_name='document_control_revisions' then
  if tg_op<>'INSERT' and old.status in ('approved','effective','published','superseded') then raise exception 'Controlled revisions are immutable. Create a new draft revision';end if;
  if tg_op<>'DELETE' and new.status in ('approved','effective','published') then raise exception 'Use the decision and release actions';end if;
  if tg_op<>'DELETE' then new.metadata_json:=new.metadata_json||jsonb_build_object('last_edited_by',auth.uid());new.content_hash:=encode(sha256(convert_to((new.content_json||jsonb_build_object('metadata',new.metadata_json))::text,'UTF8')),'hex');end if;
 elsif tg_table_name='documents' then
  if tg_op='UPDATE' and (new.revision_summary is distinct from old.revision_summary or new.title is distinct from old.title) and exists(select 1 from public.document_control_revisions where document_id=old.id::text and status in ('approved','effective') and id=old.current_revision_id) then raise exception 'Create a draft revision before changing controlled content';end if;
  if tg_op<>'DELETE' and new.current_revision_id is not null and (tg_op='INSERT' or new.approval_status is distinct from old.approval_status or new.lifecycle_state is distinct from old.lifecycle_state) and (new.lifecycle_state in ('effective','published','approved_awaiting_release') or new.approval_status='approved') then raise exception 'Use the decision and release actions';end if;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger document_decision_guard before insert or update or delete on public.document_control_records for each row execute function public.guard_document_decisions();
create trigger document_revision_guard before insert or update or delete on public.document_control_revisions for each row execute function public.guard_document_decisions();
create trigger document_file_guard before insert or update or delete on public.document_control_files for each row execute function public.guard_document_decisions();
create trigger document_release_guard before insert or update on public.documents for each row execute function public.guard_document_decisions();

create function public.guard_swms_record_revision() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare actual text;
begin
 if tg_op='UPDATE' and new.swms_document_id=old.swms_document_id and new.revision_code=old.revision_code then return new;end if;
 select coalesce(r.revision_code,d.version) into actual from public.documents d left join public.document_control_revisions r on r.id=d.current_revision_id and r.company_id=d.company_id and r.document_id=d.id::text where d.id::text=new.swms_document_id and d.company_id=new.company_id;
 if actual is null or new.revision_code is distinct from actual then raise exception 'Select the SWMS current revision before saving this execution record';end if;return new;
end $$;
create trigger swms_record_revision_guard before insert or update on public.swms_operational_records for each row execute function public.guard_swms_record_revision();
revoke all on function public.save_swms_revision(uuid,timestamptz,jsonb,jsonb,text),public.decide_document_revision(uuid,text,text,text,text,text),public.release_document_revision(uuid,text,text),public.guard_document_decisions(),public.guard_swms_record_revision() from public;
grant execute on function public.save_swms_revision(uuid,timestamptz,jsonb,jsonb,text),public.decide_document_revision(uuid,text,text,text,text,text),public.release_document_revision(uuid,text,text) to authenticated;
commit;
