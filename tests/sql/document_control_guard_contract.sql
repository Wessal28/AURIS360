-- Disposable guard-alias regression. Aliases retain their original trigger IDs;
-- protected history remains immutable and the fixture rolls back completely.
begin;
set local row_security=on;
grant usage on schema public,auth to authenticated;
grant select on public.profiles to authenticated;
grant select,insert,update,delete on public.documents,public.document_control_revisions,public.document_control_files,public.document_control_records to authenticated;
grant select,insert on public.document_control_audit_events to authenticated;
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create or replace function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
do $$declare required record;routine oid:=to_regprocedure('public.guard_document_decisions()');begin
 if routine is null or not exists(select 1 from pg_proc where oid=routine and pronargs=0 and prorettype='trigger'::regtype and not prosecdef)
   or has_function_privilege('authenticated',routine,'EXECUTE') or has_function_privilege('anon',routine,'EXECUTE') then
   raise exception 'Shared document guard must remain a private invoker trigger function';end if;
 for required in select * from (values('public.documents',23),('public.document_control_revisions',31),('public.document_control_files',31),('public.document_control_records',31)) controls(relation_name,event_bits) loop
   if not exists(select 1 from pg_trigger where tgrelid=to_regclass(required.relation_name) and tgfoid=routine
     and tgtype=required.event_bits and tgenabled in ('O','A') and not tgisinternal and tgqual is null
     and tgattr=''::int2vector and tgnargs=0 and not tgdeferrable and not tginitdeferred) then
     raise exception 'Document table % lacks complete row guard coverage',required.relation_name;end if;
 end loop;
end$$;
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id) values('d1264000-0000-4000-8000-000000000001');
insert into public.companies(id,name) values('d1264000-0000-4000-8000-000000000010','Document guard alias fixture');
insert into public.profiles(id,company_id,full_name,role,status) values('d1264000-0000-4000-8000-000000000001','d1264000-0000-4000-8000-000000000010','Fictional guarded editor','admin','active');
insert into public.documents(id,company_id,title,doc_type,document_type,version,status,approval_status,lifecycle_state,current_revision_id,created_by,effective_date) values
 ('d1264000-0000-4000-8000-000000000100','d1264000-0000-4000-8000-000000000010','Original unissued document','plan','plan','1.0','draft','draft','draft','qa-guard-draft','d1264000-0000-4000-8000-000000000001',null),
 ('d1264000-0000-4000-8000-000000000101','d1264000-0000-4000-8000-000000000010','Retained issued document','plan','plan','1.0','current','approved','effective','qa-guard-issued','d1264000-0000-4000-8000-000000000001',current_date);
insert into public.document_control_revisions(id,company_id,document_id,revision_code,status,title,content_json,metadata_json,content_hash,effective_from,created_by)
 select revision_id,'d1264000-0000-4000-8000-000000000010',document_id,'1.0',state,title,
   '{"fixture":"Retain original content"}'::jsonb,'{"source_workflow":"Retain original metadata"}'::jsonb,
   encode(sha256(convert_to(('{"fixture":"Retain original content"}'::jsonb||jsonb_build_object('metadata','{"source_workflow":"Retain original metadata"}'::jsonb))::text,'UTF8')),'hex'),
   effective_from,'d1264000-0000-4000-8000-000000000001'
 from (values
  ('qa-guard-draft','d1264000-0000-4000-8000-000000000100','draft','Original unissued document',null::timestamptz),
  ('qa-guard-issued','d1264000-0000-4000-8000-000000000101','effective','Retained issued document',clock_timestamp())
 ) fixtures(revision_id,document_id,state,title,effective_from);
insert into public.document_control_files(id,company_id,document_id,revision_id,file_role,file_name,file_url,mime_type,content_hash,status) values
 ('qa-guard-draft-pdf','d1264000-0000-4000-8000-000000000010','d1264000-0000-4000-8000-000000000100','qa-guard-draft','approved_rendition','draft.pdf','https://example.invalid/draft.pdf','application/pdf',repeat('a',64),'draft'),
 ('qa-guard-issued-pdf','d1264000-0000-4000-8000-000000000010','d1264000-0000-4000-8000-000000000101','qa-guard-issued','approved_rendition','issued.pdf','https://example.invalid/issued.pdf','application/pdf',repeat('b',64),'published');
insert into public.document_control_records(id,company_id,document_id,revision_id,record_type,title,status,payload) values
 ('qa-guard-approved-decision','d1264000-0000-4000-8000-000000000010','d1264000-0000-4000-8000-000000000101','qa-guard-issued','approval_decision','Retained historical decision','approved','{"fixture":"Retain original decision"}');
create function public.qa_guard_issued_snapshot() returns jsonb language sql stable security invoker as $$
 select jsonb_build_object('document',(select to_jsonb(d) from public.documents d where id='d1264000-0000-4000-8000-000000000101'),
  'revision',(select to_jsonb(r) from public.document_control_revisions r where id='qa-guard-issued'),
  'file',(select to_jsonb(f) from public.document_control_files f where id='qa-guard-issued-pdf'),
  'decision',(select to_jsonb(a) from public.document_control_records a where id='qa-guard-approved-decision'))
$$;
select set_config('qa.guard.issued',public.qa_guard_issued_snapshot()::text,true);
select set_config('qa.guard.function',pg_get_functiondef('public.guard_document_decisions()'::regprocedure),true);
select set_config('qa.guard.release_oid',(select oid::text from pg_trigger where tgrelid='public.documents'::regclass and tgname='document_release_guard'),true);
select set_config('qa.guard.revision_oid',(select oid::text from pg_trigger where tgrelid='public.document_control_revisions'::regclass and tgname='document_revision_guard'),true);
alter trigger document_release_guard on public.documents rename to qa_existing_document_release_alias;
alter trigger document_revision_guard on public.document_control_revisions rename to qa_existing_document_revision_alias;
select set_config('request.jwt.claim.sub','d1264000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare expected jsonb;result jsonb;rejected boolean;begin
 select jsonb_build_object('document_updated_at',d.updated_at,'revision_updated_at',r.updated_at,'content_hash',r.content_hash) into expected
 from public.documents d join public.document_control_revisions r on r.id=d.current_revision_id where d.id='d1264000-0000-4000-8000-000000000100';
 result:=public.save_document_metadata('d1264000-0000-4000-8000-000000000100','qa-guard-draft',expected,'{"title":"Corrected with guard aliases"}','Correct draft with existing semantic guard aliases');
 if result->'document'->>'id'<>'d1264000-0000-4000-8000-000000000100' or result->'document'->>'title'<>'Corrected with guard aliases'
   or result->'revision'->>'id'<>'qa-guard-draft' then raise exception 'Existing semantic guard aliases blocked a valid same-ID draft correction';end if;
 rejected:=false;begin update public.documents set title='Must not rewrite issued title' where id='d1264000-0000-4000-8000-000000000101';exception when raise_exception then rejected:=true;end;
 if not rejected then raise exception 'Renamed release guard failed to protect issued parent details';end if;
 rejected:=false;begin update public.document_control_revisions set content_json='{"altered":true}' where id='qa-guard-issued';exception when raise_exception then rejected:=true;end;
 if not rejected then raise exception 'Renamed revision guard failed to protect issued content';end if;
 rejected:=false;begin delete from public.document_control_revisions where id='qa-guard-issued';exception when raise_exception then rejected:=true;end;
 if not rejected then raise exception 'Renamed revision guard allowed issued history deletion';end if;
 rejected:=false;begin update public.document_control_files set file_url='https://example.invalid/altered.pdf' where id='qa-guard-issued-pdf';exception when raise_exception then rejected:=true;end;
 if not rejected then raise exception 'Existing issued-file protection was bypassed';end if;
 rejected:=false;begin update public.document_control_records set payload='{"altered":true}' where id='qa-guard-approved-decision';exception when raise_exception then rejected:=true;end;
 if not rejected then raise exception 'Existing immutable approval history was bypassed';end if;
end$$;
reset role;
do $$begin
 if public.qa_guard_issued_snapshot() is distinct from current_setting('qa.guard.issued')::jsonb then raise exception 'Alias coverage changed protected IDs, issued files or decision history';end if;
 if (select oid::text from pg_trigger where tgrelid='public.documents'::regclass and tgname='qa_existing_document_release_alias') is distinct from current_setting('qa.guard.release_oid')
   or (select oid::text from pg_trigger where tgrelid='public.document_control_revisions'::regclass and tgname='qa_existing_document_revision_alias') is distinct from current_setting('qa.guard.revision_oid')
   or pg_get_functiondef('public.guard_document_decisions()'::regprocedure) is distinct from current_setting('qa.guard.function') then
   raise exception 'Guard alias use replaced an existing trigger or changed the control function';end if;
end$$;
rollback;
