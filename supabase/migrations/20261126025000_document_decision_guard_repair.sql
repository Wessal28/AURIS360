-- Restore missing shared Document Control decision guards without changing existing records.
-- Existing complete guards, helper definitions and permissions are retained unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $repair$
declare
 required record;
 expected record;
 existing_function pg_proc;
 function_id oid;
 missing_helpers text;
 guards_missing boolean;
 existing_body text;
 reviewed_body text;
 canonical_body constant text:=$canonical$
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
end
$canonical$;
begin
 for required in select * from (values
  ('public.document_control_files'),('public.document_control_records'),
  ('public.document_control_revisions'),('public.documents')
 ) prerequisites(table_name) loop
  if not exists(select 1 from pg_class c
   where c.oid=to_regclass(required.table_name) and c.relkind='r' and c.relrowsecurity) then
   raise exception 'Document guard repair requires the existing % table with row security enabled. No guards were changed.',required.table_name;
  end if;
 end loop;
 for expected in select * from (values
  ('public.documents','id','uuid'),('public.documents','company_id','uuid'),
  ('public.documents','title','text'),('public.documents','revision_summary','text'),
  ('public.documents','current_revision_id','text'),('public.documents','approval_status','text'),
  ('public.documents','lifecycle_state','text'),
  ('public.document_control_revisions','id','text'),('public.document_control_revisions','company_id','uuid'),
  ('public.document_control_revisions','document_id','text'),('public.document_control_revisions','status','text'),
  ('public.document_control_revisions','content_json','jsonb'),('public.document_control_revisions','metadata_json','jsonb'),
  ('public.document_control_revisions','content_hash','text'),
  ('public.document_control_files','company_id','uuid'),('public.document_control_files','revision_id','text'),
  ('public.document_control_records','company_id','uuid'),('public.document_control_records','record_type','text')
 ) columns(table_name,column_name,type_name) loop
  if not exists(select 1 from pg_attribute a where a.attrelid=to_regclass(expected.table_name)
   and a.attname=expected.column_name and a.attnum>0 and not a.attisdropped
   and a.atttypid=to_regtype(expected.type_name)) then
   raise exception 'Document guard repair requires %.% with type %. No guards were changed.',expected.table_name,expected.column_name,expected.type_name;
  end if;
 end loop;
 select string_agg(h.signature||' returns '||h.type_name,', ' order by h.signature)
 into missing_helpers from (values ('auth.uid()','uuid')) h(signature,type_name)
 left join pg_proc p on p.oid=to_regprocedure(h.signature)
 where p.oid is null or p.prorettype is distinct from to_regtype(h.type_name);
 if missing_helpers is not null then
  raise exception 'Document guard repair requires these existing authentication helpers with the stated return types: %. No guards were changed.',missing_helpers;
 end if;

 -- Match the workflows' document-first order before locking their dependent rows.
 lock table public.documents,public.document_control_revisions,
  public.document_control_files,public.document_control_records in share row exclusive mode;

 function_id:=to_regprocedure('public.guard_document_decisions()');
 if function_id is null then
  -- Exact reviewed body from 20261019030000_swms_controlled_release.sql.
  execute 'create function public.guard_document_decisions() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $guard$'
   ||canonical_body||'$guard$';
  revoke all on function public.guard_document_decisions() from public,anon,authenticated;
  function_id:=to_regprocedure('public.guard_document_decisions()');
 else
  select exists(select 1 from (values
   ('public.documents',23),('public.document_control_revisions',31),
   ('public.document_control_records',31),('public.document_control_files',31)
  ) coverage(table_name,trigger_type)
  where not exists(select 1 from pg_trigger t
   where t.tgrelid=to_regclass(coverage.table_name) and t.tgfoid=function_id
   and not t.tgisinternal and t.tgenabled in ('O','A') and t.tgtype=coverage.trigger_type
   and t.tgqual is null and t.tgattr::text='' and t.tgnargs=0
   and not t.tgdeferrable and not t.tginitdeferred)) into guards_missing;

  if guards_missing then
   select * into existing_function from pg_proc where oid=function_id;
   if existing_function.prokind<>'f' or existing_function.prorettype<>'trigger'::regtype
   or existing_function.pronargs<>0 or existing_function.prosecdef
   or existing_function.prolang<>(select oid from pg_language where lanname='plpgsql')
   or coalesce(array_length(existing_function.proconfig,1),0)<>1
   or regexp_replace(existing_function.proconfig[1],'[[:space:]]','','g')<>'search_path=pg_catalog,public' then
    raise exception 'Existing public.guard_document_decisions() has unreviewed execution settings. Review that function before attaching missing guards; its definition and permissions were preserved.';
   end if;
   -- Normalize whitespace only outside quoted SQL literals. Literal values stay exact.
   select btrim(string_agg(case when left(parts.token[1],1)='''' then parts.token[1]
    else regexp_replace(parts.token[1],'[[:space:]]+',' ','g') end,'' order by parts.position))
   into existing_body
   from regexp_matches(existing_function.prosrc,$tokens$('(?:''|[^'])*'|[^']+)$tokens$,'g')
    with ordinality parts(token,position);
   select btrim(string_agg(case when left(parts.token[1],1)='''' then parts.token[1]
    else regexp_replace(parts.token[1],'[[:space:]]+',' ','g') end,'' order by parts.position))
   into reviewed_body
   from regexp_matches(canonical_body,$tokens$('(?:''|[^'])*'|[^']+)$tokens$,'g')
    with ordinality parts(token,position);
   if existing_body is distinct from reviewed_body then
    raise exception 'Existing public.guard_document_decisions() contains unreviewed logic. Review that function before attaching missing guards; its definition and permissions were preserved.';
   end if;
  end if;
 end if;

 for required in select * from (values
  ('public.documents','document_release_guard',23,'insert or update'),
  ('public.document_control_revisions','document_revision_guard',31,'insert or update or delete'),
  ('public.document_control_records','document_decision_guard',31,'insert or update or delete'),
  ('public.document_control_files','document_file_guard',31,'insert or update or delete')
 ) guards(table_name,trigger_name,trigger_type,operations) loop
  if exists(select 1 from pg_trigger t
   where t.tgrelid=to_regclass(required.table_name) and t.tgfoid=function_id
   and not t.tgisinternal and t.tgenabled in ('O','A') and t.tgtype=required.trigger_type
   and t.tgqual is null and t.tgattr::text='' and t.tgnargs=0
   and not t.tgdeferrable and not t.tginitdeferred) then
   continue;
  end if;
  if exists(select 1 from pg_trigger t
   where t.tgrelid=to_regclass(required.table_name) and t.tgname=required.trigger_name) then
   raise exception 'Trigger % on % already exists without the required enabled coverage. Review it before retrying; no existing trigger was changed.',required.trigger_name,required.table_name;
  end if;
  execute format('create trigger %I before %s on %s for each row execute function public.guard_document_decisions()',
   required.trigger_name,required.operations,required.table_name);
 end loop;
end $repair$;

notify pgrst,'reload schema';
commit;
