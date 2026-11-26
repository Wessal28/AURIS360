-- Disposable rollback-only metadata edits. Stored PDFs are fictional records;
-- no storage client, delivery worker, file replacement or external message runs.
begin;
set local row_security=on;
grant usage on schema public,auth to authenticated;
grant select on public.profiles to authenticated;
grant select,insert,update,delete on public.documents,public.document_control_revisions,public.document_control_records,
 public.document_control_files,public.doc_acknowledgements,public.doc_controlled_copies to authenticated;
grant select,insert on public.document_control_audit_events to authenticated;
create schema if not exists storage;
create table if not exists storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
grant usage on schema storage to authenticated;
grant select,insert,update,delete on storage.objects to authenticated;
create trigger qa_metadata_stored_object_guard before update or delete on storage.objects for each row execute function public.guard_controlled_document_object();
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create or replace function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
do $$declare routine oid:=to_regprocedure('public.save_document_metadata(uuid,text,jsonb,jsonb,text)');begin
 if routine is null or not exists(select 1 from pg_proc where oid=routine and not prosecdef and prorettype='jsonb'::regtype
   and proargnames=array['p_document','p_revision','p_expected','p_meta','p_reason']::text[])
   or not has_function_privilege('authenticated',routine,'EXECUTE') or has_function_privilege('anon',routine,'EXECUTE') then
   raise exception 'Document metadata RPC signature, invoker security or authenticated-only execution differs';end if;
end$$;
insert into auth.users(id) values
 ('d1263000-0000-4000-8000-000000000001'),('d1263000-0000-4000-8000-000000000002'),('d1263000-0000-4000-8000-000000000003'),
 ('d1263000-0000-4000-8000-000000000004'),('d1263000-0000-4000-8000-000000000005'),('d1263000-0000-4000-8000-000000000006');
insert into public.companies(id,name) values('d1263000-0000-4000-8000-000000000010','Document metadata fixture A'),('d1263000-0000-4000-8000-000000000020','Document metadata fixture B');
insert into public.profiles(id,company_id,full_name,role,status) values
 ('d1263000-0000-4000-8000-000000000001','d1263000-0000-4000-8000-000000000010','Fictional metadata author','admin','active'),
 ('d1263000-0000-4000-8000-000000000002','d1263000-0000-4000-8000-000000000010','Fictional independent reviewer','admin','active'),
 ('d1263000-0000-4000-8000-000000000003','d1263000-0000-4000-8000-000000000010','Fictional employee recipient','employee','active'),
 ('d1263000-0000-4000-8000-000000000004','d1263000-0000-4000-8000-000000000020','Fictional foreign controller','admin','active'),
 ('d1263000-0000-4000-8000-000000000005','d1263000-0000-4000-8000-000000000010','Inactive document controller','admin','inactive'),
 ('d1263000-0000-4000-8000-000000000006','d1263000-0000-4000-8000-000000000010','Fictional document manager','manager','active');
create function public.qa_metadata_expected(p_id uuid) returns jsonb language sql stable security invoker as $$
 select jsonb_build_object('document_updated_at',d.updated_at,'revision_updated_at',r.updated_at,'content_hash',r.content_hash)
 from public.documents d left join public.document_control_revisions r on r.id=d.current_revision_id and r.company_id=d.company_id and r.document_id=d.id::text where d.id=p_id
$$;
create function public.qa_metadata_body() returns jsonb language sql immutable as $$
 select jsonb_build_object('title','Corrected fictional document title','document_type','procedure','department','Operations','category','Fictional policy',
 'owner','Fictional record owner','description','Corrected description','scope','Fictional company scope','tags',jsonb_build_array('reviewed','fictional'),
 'legal_refs',jsonb_build_array('Fictional source 1'),'issue_date','2026-11-01','review_date','2027-11-01',
 'language_code','en','scope_type','company','scope_id',null,'confidentiality','internal')
$$;
create function public.qa_metadata_snapshot() returns jsonb language sql stable security invoker as $$
 select jsonb_build_object(
 'documents',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.documents x where company_id='d1263000-0000-4000-8000-000000000010'),
 'revisions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.document_control_revisions x where company_id='d1263000-0000-4000-8000-000000000010'),
 'files',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.document_control_files x where company_id='d1263000-0000-4000-8000-000000000010'),
 'records',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.document_control_records x where company_id='d1263000-0000-4000-8000-000000000010'),
 'audit',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.document_control_audit_events x where company_id='d1263000-0000-4000-8000-000000000010'),
 'copies',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.doc_controlled_copies x where company_id='d1263000-0000-4000-8000-000000000010'),
 'acknowledgements',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.doc_acknowledgements x where company_id='d1263000-0000-4000-8000-000000000010'),
 'storage',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from storage.objects x where name like 'd1263000-0000-4000-8000-000000000010/document-control/%'))
$$;
create function public.qa_metadata_failure() returns trigger language plpgsql as $$declare mode text:=current_setting('qa.metadata.failure',true);begin
 if tg_table_name='documents' and mode='document_suppress' then return null;end if;
 if tg_table_name='document_control_revisions' and mode='revision_suppress' then return null;end if;
 if tg_table_name='document_control_audit_events' then
   if new.action='metadata_updated' then
     if mode='audit_raise' then raise exception 'QA metadata audit failure';end if;
     if mode='audit_suppress' then return null;end if;
   end if;
 end if;
 return new;end$$;
create trigger qa_metadata_document_failure before update on public.documents for each row execute function public.qa_metadata_failure();
create trigger qa_metadata_revision_failure before update on public.document_control_revisions for each row execute function public.qa_metadata_failure();
create trigger qa_metadata_audit_failure before insert on public.document_control_audit_events for each row execute function public.qa_metadata_failure();
select set_config('request.jwt.claim.sub','d1263000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare doc_id uuid;operation uuid;file jsonb;metadata jsonb;result jsonb;begin
 foreach doc_id in array array['d1263000-0000-4000-8000-000000000100'::uuid,'d1263000-0000-4000-8000-000000000110'::uuid] loop
   operation:=case when doc_id='d1263000-0000-4000-8000-000000000100' then 'd1263000-0000-4000-8000-000000000150'::uuid else 'd1263000-0000-4000-8000-000000000151'::uuid end;
   file:=jsonb_build_object('name','fictional-document.pdf','path','d1263000-0000-4000-8000-000000000010/document-control/'||doc_id||'.pdf',
     'url','https://fixture.supabase.co/storage/v1/object/public/documents/d1263000-0000-4000-8000-000000000010/document-control/'||doc_id||'.pdf',
     'mime','application/pdf','size',1024,'sha256',repeat('a',64));
   insert into storage.objects(bucket_id,name,metadata) values('documents',file->>'path','{}');
   metadata:=jsonb_build_object('company_id','d1263000-0000-4000-8000-000000000010','title','Original fictional document','document_type','plan','file_role','approved_rendition','change_summary','Fictional original upload');
   result:=public.document_upload_command('create',doc_id,null,null,operation,metadata,file);
   update public.document_control_revisions set metadata_json=metadata_json||'{"source_workflow":"Retain unrelated workflow metadata"}',updated_at=clock_timestamp() where id=result->>'current_revision_id';
 end loop;
end$$;
reset role;
select set_config('qa.metadata.initial',public.qa_metadata_snapshot()::text,true);
select set_config('qa.metadata.original_doc',(select to_jsonb(d)::text from public.documents d where id='d1263000-0000-4000-8000-000000000100'),true);
select set_config('qa.metadata.original_revision',(select to_jsonb(r)::text from public.document_control_revisions r where id='d1263000-0000-4000-8000-000000000150'),true);
select set_config('qa.metadata.initial_expected',public.qa_metadata_expected('d1263000-0000-4000-8000-000000000100')::text,true);
-- Staging may already contain these PDFs while the separate upload service is
-- not deployed. Editing an existing record must not depend on that service.
alter function public.document_upload_command(text,uuid,text,text,uuid,jsonb,jsonb) rename to qa_metadata_hidden_upload_command;
set local role authenticated;
do $$declare result jsonb;d public.documents;r public.document_control_revisions;expected jsonb:=current_setting('qa.metadata.initial_expected')::jsonb;
 document_changes text[]:=array['title','document_type','doc_type','department','category','owner','description','scope','tags','legal_refs','issue_date','review_date','language_code','scope_type','scope_id','confidentiality','updated_at'];
 revision_changes text[]:=array['title','metadata_json','content_hash','language_code','scope_type','scope_id','updated_at'];begin
 if to_regprocedure('public.document_upload_command(text,uuid,text,text,uuid,jsonb,jsonb)') is not null then raise exception 'Partial-deployment fixture unexpectedly retained its upload RPC';end if;
 result:=public.save_document_metadata('d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000150',expected,public.qa_metadata_body(),'Correct initial unissued record details');
 select * into strict d from public.documents where id='d1263000-0000-4000-8000-000000000100';
 select * into strict r from public.document_control_revisions where id=d.current_revision_id;
 if result->'document' is distinct from to_jsonb(d) or result->'revision' is distinct from to_jsonb(r)
   or d.title<>'Corrected fictional document title' or d.document_type<>'procedure' or d.doc_type<>'procedure'
   or d.department<>'Operations' or d.description<>'Corrected description' or d.owner<>'Fictional record owner'
   or d.tags is distinct from array['reviewed','fictional']::text[] or d.legal_refs is distinct from array['Fictional source 1']::text[]
   or r.title<>d.title or r.id<>'d1263000-0000-4000-8000-000000000150' then raise exception 'Metadata edit did not reconcile the same document and draft revision';end if;
 if r.content_hash is not distinct from expected->>'content_hash'
   or r.content_hash is distinct from encode(sha256(convert_to((r.content_json||jsonb_build_object('metadata',r.metadata_json))::text,'UTF8')),'hex') then
   raise exception 'Metadata edit did not produce its canonical new revision hash';end if;
 if (r.metadata_json->>'last_edited_by')::uuid<>auth.uid() then raise exception 'Metadata edit lost the actual editor identity';end if;
 if not (r.metadata_json @> public.qa_metadata_body()) or r.metadata_json->>'source_workflow' is distinct from 'Retain unrelated workflow metadata'
   or (to_jsonb(d)-document_changes) is distinct from (current_setting('qa.metadata.original_doc')::jsonb-document_changes)
   or (to_jsonb(r)-revision_changes) is distinct from (current_setting('qa.metadata.original_revision')::jsonb-revision_changes) then
   raise exception 'Metadata edit changed non-metadata content or lost its complete revision snapshot';end if;
end$$;
reset role;
do $$begin if to_regprocedure('public.document_upload_command(text,uuid,text,text,uuid,jsonb,jsonb)') is not null then raise exception 'Metadata editing installed an unrelated upload RPC';end if;end$$;
alter function public.qa_metadata_hidden_upload_command(text,uuid,text,text,uuid,jsonb,jsonb) rename to document_upload_command;
do $$declare before_rows jsonb:=current_setting('qa.metadata.initial')::jsonb;original jsonb:=current_setting('qa.metadata.original_doc')::jsonb;d jsonb;notice public.document_control_audit_events;begin
 if public.qa_metadata_snapshot()-'documents'-'revisions'-'audit' is distinct from before_rows-'documents'-'revisions'-'audit' then
   raise exception 'Metadata edit changed files, approval records, copies, acknowledgements or stored PDF objects';end if;
 select to_jsonb(x) into strict d from public.documents x where id='d1263000-0000-4000-8000-000000000100';
 if d->>'id' is distinct from original->>'id' or d->>'created_at' is distinct from original->>'created_at' or d->>'created_by' is distinct from original->>'created_by'
   or d->>'file_url' is distinct from original->>'file_url' or d->>'file_name' is distinct from original->>'file_name'
   or d->>'doc_ref' is distinct from original->>'doc_ref' or d->>'current_revision_id' is distinct from original->>'current_revision_id' then
   raise exception 'Metadata edit replaced identity, original PDF or document reference';end if;
 if (select count(*) from public.document_control_audit_events where document_id=d->>'id' and action='metadata_updated')<>1 then raise exception 'Metadata edit did not append exactly one history event';end if;
 select * into strict notice from public.document_control_audit_events where document_id=d->>'id' and action='metadata_updated';
 if notice.performed_by<>'d1263000-0000-4000-8000-000000000001' or notice.reason<>'Correct initial unissued record details'
   or notice.before_json is null or notice.after_json is null then raise exception 'Metadata edit history lost its actor, reason or before/after snapshot';end if;
end$$;
select set_config('qa.metadata.valid_before',public.qa_metadata_snapshot()::text,true);
set local role authenticated;
-- Stale timestamps, stale hash and forbidden field injection all reject without
-- changing any row or turning the editor into a file/lifecycle command.
do $$declare expected jsonb:=public.qa_metadata_expected('d1263000-0000-4000-8000-000000000100');candidate jsonb;body jsonb;key text;rejected boolean;begin
 foreach candidate in array array[current_setting('qa.metadata.initial_expected')::jsonb,
   expected-'document_updated_at',expected-'revision_updated_at',expected-'content_hash',
   expected||'{"document_updated_at":"2000-01-01T00:00:00Z"}',expected||'{"revision_updated_at":"2000-01-01T00:00:00Z"}',expected||jsonb_build_object('content_hash',repeat('0',64))] loop
   rejected:=false;begin perform public.save_document_metadata('d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000150',candidate,public.qa_metadata_body(),'Rejected stale edit');exception when others then rejected:=true;end;
   if not rejected then raise exception 'Stale or incomplete metadata snapshot was accepted';end if;
 end loop;
 rejected:=false;begin perform public.save_document_metadata('d1263000-0000-4000-8000-000000000100','wrong-revision',expected,public.qa_metadata_body(),'Wrong revision');exception when others then rejected:=true;end;
 if not rejected then raise exception 'An edit targeted a different revision';end if;
 foreach key in array array['company_id','status','approval_status','lifecycle_state','file_url','current_revision_id','doc_ref'] loop
   body:=public.qa_metadata_body()||jsonb_build_object(key,'forbidden-value');rejected:=false;
   begin perform public.save_document_metadata('d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000150',expected,body,'Forbidden metadata field');exception when others then rejected:=true;end;
   if not rejected then raise exception 'Metadata edit accepted forbidden field %',key;end if;
 end loop;
 rejected:=false;begin perform public.save_document_metadata('d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000150',expected,public.qa_metadata_body(),'');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Metadata change without a history reason was accepted';end if;
end$$;
reset role;
do $$begin if public.qa_metadata_snapshot() is distinct from current_setting('qa.metadata.valid_before')::jsonb then raise exception 'A rejected metadata edit left partial document, revision, file or history changes';end if;end$$;
set local role authenticated;
do $$declare mode text;rejected boolean;begin
 foreach mode in array array['document_suppress','revision_suppress','audit_raise','audit_suppress'] loop
   perform set_config('qa.metadata.failure',mode,true);rejected:=false;
   begin perform public.save_document_metadata('d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000150',public.qa_metadata_expected('d1263000-0000-4000-8000-000000000100'),public.qa_metadata_body()||'{"title":"Must roll back"}','Synthetic transaction test');exception when others then rejected:=true;end;
   if not rejected then raise exception 'Suppressed or failing metadata write % reported success',mode;end if;
   perform set_config('qa.metadata.failure','',true);
 end loop;
end$$;
reset role;
do $$begin if public.qa_metadata_snapshot() is distinct from current_setting('qa.metadata.valid_before')::jsonb then raise exception 'Failed document, revision or audit write left a partial metadata edit';end if;end$$;
-- A manager who cannot SELECT the audit table must still append the required
-- history through the existing insert policy; the RPC must not require RETURNING.
select set_config('request.jwt.claim.sub','d1263000-0000-4000-8000-000000000006',true);
set local role authenticated;
do $$declare result jsonb;begin
 if exists(select 1 from public.document_control_audit_events where document_id='d1263000-0000-4000-8000-000000000110') then raise exception 'Manager fixture unexpectedly has audit read access';end if;
 result:=public.save_document_metadata('d1263000-0000-4000-8000-000000000110','d1263000-0000-4000-8000-000000000151',public.qa_metadata_expected('d1263000-0000-4000-8000-000000000110'),public.qa_metadata_body()||'{"title":"Manager metadata correction"}','Manager correction without audit read');
 if result->'document'->>'title'<>'Manager metadata correction' then raise exception 'Manager metadata edit failed without audit read access';end if;
end$$;
reset role;
do $$begin if (select count(*) from public.document_control_audit_events where document_id='d1263000-0000-4000-8000-000000000110' and action='metadata_updated' and performed_by='d1263000-0000-4000-8000-000000000006')<>1 then raise exception 'Manager edit did not retain its immutable actor-stamped history';end if;end$$;

-- Real independent review preserves earlier decisions when changes are
-- requested, and prevents metadata changes once submitted, approved or issued.
select set_config('request.jwt.claim.sub','d1263000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.submit_document_review('d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000150',
 (public.qa_metadata_expected('d1263000-0000-4000-8000-000000000100')->>'content_hash'),'d1263000-0000-4000-8000-000000000002',current_date+7,'Fictional metadata review');
reset role;
select set_config('qa.metadata.pending',public.qa_metadata_snapshot()::text,true);
set local role authenticated;
do $$declare rejected boolean:=false;begin
 begin perform public.save_document_metadata('d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000150',public.qa_metadata_expected('d1263000-0000-4000-8000-000000000100'),public.qa_metadata_body(),'Must not bypass review');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Pending review metadata was edited directly';end if;
end$$;
reset role;
do $$begin if public.qa_metadata_snapshot() is distinct from current_setting('qa.metadata.pending')::jsonb then raise exception 'Rejected submitted edit changed review records';end if;end$$;
select set_config('request.jwt.claim.sub','d1263000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.decide_document_revision('d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000150',
 (public.qa_metadata_expected('d1263000-0000-4000-8000-000000000100')->>'content_hash'),'changes_requested','Fictional metadata correction requested');
reset role;
select set_config('qa.metadata.decisions_before',(select jsonb_agg(to_jsonb(r) order by r.id)::text from public.document_control_records r where document_id='d1263000-0000-4000-8000-000000000100'),true);
select set_config('request.jwt.claim.sub','d1263000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.save_document_metadata('d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000150',public.qa_metadata_expected('d1263000-0000-4000-8000-000000000100'),public.qa_metadata_body()||'{"title":"Corrected after independent review"}','Resolve requested metadata correction');
reset role;
do $$begin if (select jsonb_agg(to_jsonb(r) order by r.id) from public.document_control_records r where document_id='d1263000-0000-4000-8000-000000000100') is distinct from current_setting('qa.metadata.decisions_before')::jsonb then raise exception 'Metadata correction rewrote a historical review decision or task';end if;end$$;
set local role authenticated;
select public.submit_document_review('d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000150',
 (public.qa_metadata_expected('d1263000-0000-4000-8000-000000000100')->>'content_hash'),'d1263000-0000-4000-8000-000000000002',current_date+7,'Fictional corrected review');
select set_config('request.jwt.claim.sub','d1263000-0000-4000-8000-000000000002',true);
select public.decide_document_revision('d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000150',
 (public.qa_metadata_expected('d1263000-0000-4000-8000-000000000100')->>'content_hash'),'approved','Fictional independent approval');
reset role;
select set_config('qa.metadata.approved',public.qa_metadata_snapshot()::text,true);
set local role authenticated;
do $$declare rejected boolean:=false;begin
 begin perform public.save_document_metadata('d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000150',public.qa_metadata_expected('d1263000-0000-4000-8000-000000000100'),public.qa_metadata_body(),'Must not change approved content');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Approved metadata was overwritten directly';end if;
 rejected:=false;begin update public.documents set title='Direct approved overwrite' where id='d1263000-0000-4000-8000-000000000100';exception when others then rejected:=true;end;
 if not rejected then raise exception 'Existing approved document guard was bypassed';end if;
 rejected:=false;begin update public.document_control_revisions set title='Direct approved revision overwrite' where id='d1263000-0000-4000-8000-000000000150';exception when others then rejected:=true;end;
 if not rejected then raise exception 'Existing approved revision guard was bypassed';end if;
end$$;
reset role;
do $$begin if public.qa_metadata_snapshot() is distinct from current_setting('qa.metadata.approved')::jsonb then raise exception 'Rejected approved edit changed controlled data';end if;end$$;
set local role authenticated;
select public.release_document_revision('d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000150',
 (public.qa_metadata_expected('d1263000-0000-4000-8000-000000000100')->>'content_hash'));
select public.distribute_document_revision('d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000150',
 (public.qa_metadata_expected('d1263000-0000-4000-8000-000000000100')->>'content_hash'),'d1263000-0000-4000-8000-000000000250',
 array['d1263000-0000-4000-8000-000000000003'::uuid],'print',true,current_date+7,'Fictional retained controlled copy');
select set_config('request.jwt.claim.sub','d1263000-0000-4000-8000-000000000003',true);
select public.acknowledge_controlled_document(id) from public.doc_acknowledgements where distribution_id='d1263000-0000-4000-8000-000000000250';
reset role;
select set_config('qa.metadata.effective',public.qa_metadata_snapshot()::text,true);
select set_config('request.jwt.claim.sub','d1263000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare rejected boolean:=false;begin
 begin perform public.save_document_metadata('d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000150',public.qa_metadata_expected('d1263000-0000-4000-8000-000000000100'),public.qa_metadata_body(),'Must not change released details');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Effective document details were overwritten';end if;
end$$;
reset role;
do $$begin if public.qa_metadata_snapshot() is distinct from current_setting('qa.metadata.effective')::jsonb then raise exception 'Rejected effective edit changed issued content or copies';end if;end$$;
set local role authenticated;
select public.document_upload_command('revision','d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000150',
 (public.qa_metadata_expected('d1263000-0000-4000-8000-000000000100')->>'content_hash'),'d1263000-0000-4000-8000-000000000251',
 '{"revision_code":"2.0","change_summary":"Fictional controlled new revision"}',null);
reset role;
select set_config('qa.metadata.parent_copy',public.qa_metadata_snapshot()::text,true);
set local role authenticated;
do $$declare rejected boolean:=false;begin
 begin perform public.save_document_metadata('d1263000-0000-4000-8000-000000000100','d1263000-0000-4000-8000-000000000251',public.qa_metadata_expected('d1263000-0000-4000-8000-000000000100'),public.qa_metadata_body(),'Cannot rewrite issued metadata from a new draft');exception when others then rejected:=true;end;
 if not rejected then raise exception 'New-draft metadata edit bypassed the initial-unissued-only scope';end if;
end$$;
reset role;
do $$begin if public.qa_metadata_snapshot() is distinct from current_setting('qa.metadata.parent_copy')::jsonb then raise exception 'Rejected child-draft edit changed the released parent, published PDF, approval, distribution, copy or acknowledgement';end if;end$$;

-- A generated rendition binds its stored file to the revision hash. A record
-- metadata edit must send that document through its generating editor rather
-- than changing only the revision hash and making release impossible.
select set_config('request.jwt.claim.sub','d1263000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.save_swms_revision('d1263000-0000-4000-8000-000000000120',null,
 '{"company_id":"d1263000-0000-4000-8000-000000000010","title":"Fictional generated SWMS draft","version":"1.0","doc_ref":"QA-SWMS-GENERATED-120","revision_summary":"Fictional generated draft"}',
 '{"steps":[{"activity":"Fictional generated work","controls":"Retain generated controls"}]}','<p>Fictional generated method</p>');
reset role;
do $$begin
 if not exists(select 1 from public.document_control_files f join public.document_control_revisions r on r.id=f.revision_id
   where f.document_id='d1263000-0000-4000-8000-000000000120' and f.file_role='generated_rendition'
     and f.status='draft' and f.content_hash=r.content_hash and r.status='draft') then
   raise exception 'Generated rendition fixture is not bound to its draft hash';end if;
end$$;
select set_config('qa.metadata.generated_before',public.qa_metadata_snapshot()::text,true);
set local role authenticated;
do $$declare rejected boolean:=false;revision text;begin
 select current_revision_id into strict revision from public.documents where id='d1263000-0000-4000-8000-000000000120';
 begin perform public.save_document_metadata('d1263000-0000-4000-8000-000000000120',revision,
   public.qa_metadata_expected('d1263000-0000-4000-8000-000000000120'),'{"title":"Must not overwrite generated title"}','Generated title requires its module editor');
 exception when others then
   if sqlerrm not like 'Generated document details must be edited in the source module%' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'Generated rendition metadata changed without regenerating its bound file';end if;
end$$;
reset role;
do $$begin if public.qa_metadata_snapshot() is distinct from current_setting('qa.metadata.generated_before')::jsonb then
 raise exception 'Rejected generated-rendition edit changed document content, file hash, revision hash or history';end if;end$$;

-- Existing user role, active account, company and module guards still apply.
select set_config('qa.metadata.permissions_before',public.qa_metadata_snapshot()::text,true);
select set_config('qa.metadata.manager_expected',public.qa_metadata_expected('d1263000-0000-4000-8000-000000000110')::text,true);
set local role authenticated;
do $$declare actor uuid;rejected boolean;begin
 foreach actor in array array['d1263000-0000-4000-8000-000000000003'::uuid,'d1263000-0000-4000-8000-000000000004'::uuid,'d1263000-0000-4000-8000-000000000005'::uuid] loop
   perform set_config('request.jwt.claim.sub',actor::text,true);rejected:=false;
   begin perform public.save_document_metadata('d1263000-0000-4000-8000-000000000110','d1263000-0000-4000-8000-000000000151',current_setting('qa.metadata.manager_expected')::jsonb,public.qa_metadata_body(),'Unauthorised correction');exception when others then rejected:=true;end;
   if not rejected then raise exception 'Employee, foreign or inactive account edited controlled metadata';end if;
 end loop;
end$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"documents":{"view":true,"edit":false}}}' where id='d1263000-0000-4000-8000-000000000006';
select set_config('request.jwt.claim.sub','d1263000-0000-4000-8000-000000000006',true);
set local role authenticated;
do $$declare rejected boolean:=false;begin
 begin perform public.save_document_metadata('d1263000-0000-4000-8000-000000000110','d1263000-0000-4000-8000-000000000151',current_setting('qa.metadata.manager_expected')::jsonb,public.qa_metadata_body(),'Revoked module correction');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Revoked Document Control edit permission was ignored';end if;
end$$;
reset role;
do $$begin if public.qa_metadata_snapshot() is distinct from current_setting('qa.metadata.permissions_before')::jsonb then raise exception 'Rejected metadata permissions left partial document, revision, audit or file writes';end if;end$$;
rollback;
