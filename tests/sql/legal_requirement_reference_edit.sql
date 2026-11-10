-- Run only in the disposable migration replay database. All fixtures roll back.
begin;
set local row_security=on;
insert into auth.users(id) values
 ('af111000-0000-4000-8000-000000000001'),
 ('af111000-0000-4000-8000-000000000002');
insert into public.companies(id,name) values
 ('af111000-0000-4000-8000-000000000010','Fictional reference company A'),
 ('af111000-0000-4000-8000-000000000020','Fictional reference company B');
insert into public.profiles(id,company_id,full_name,role,status) values
 ('af111000-0000-4000-8000-000000000001','af111000-0000-4000-8000-000000000010','Fictional reference reviewer','admin','active'),
 ('af111000-0000-4000-8000-000000000002','af111000-0000-4000-8000-000000000020','Fictional foreign reviewer','admin','active');
create or replace function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
select set_config('request.jwt.claim.sub','af111000-0000-4000-8000-000000000001',true);
grant usage on schema public,auth to authenticated;
grant select on public.profiles,public.legal_requirements,public.compliance_assessments,
 public.compliance_gaps,public.action_tracker,public.legal_compliance_records,
 public.legal_compliance_relationships,public.compliance_calendar to authenticated;

set local role authenticated;
do $create_reference_fixtures$
declare
 company uuid:='af111000-0000-4000-8000-000000000010';
 r jsonb; second_requirement jsonb; generated jsonb; generated_reference text;
 profile jsonb:='{"source_classification":"internal","official_source_url":"Controlled fictional policy POL-REF","applicability_decision":"applicable"}';
begin
 r:=public.save_legal_requirement('af111000-0000-4000-8000-000000000101',null,
  jsonb_build_object('company_id',company,'legislation','Fictional Fire Policy',
   'legislation_type','internal_policy','req_ref','  Section 4  ','requirement','Fictional fire duty','title','Fictional fire requirement'),profile);
 if r->>'req_ref'<>'Section 4' then raise exception 'Explicit reference was not trimmed';end if;
 second_requirement:=public.save_legal_requirement('af111000-0000-4000-8000-000000000102',null,
  jsonb_build_object('company_id',company,'legislation','Fictional Equipment Policy',
   'req_ref','Section 4','title','Fictional equipment requirement'),profile);
 if second_requirement->>'req_ref'<>'Section 4' or second_requirement->>'id'=r->>'id'
 then raise exception 'A repeated reference in different legislation lost its independent identity';end if;
 generated:=public.save_legal_requirement('af111000-0000-4000-8000-000000000103',null,
  jsonb_build_object('company_id',company,'legislation','Fictional Legacy Client'),profile);
 if generated->>'req_ref'!~'^LEG-[A-F0-9]{12}$' then raise exception 'Omitted reference stopped automatic generation';end if;
 generated_reference:=generated->>'req_ref';
 generated:=public.save_legal_requirement((generated->>'id')::uuid,(generated->>'updated_at')::timestamptz,
  jsonb_build_object('company_id',company,'title','Fictional legacy edit'),profile);
 if generated->>'req_ref'<>generated_reference then raise exception 'Omitting the reference changed a generated reference';end if;
end $create_reference_fixtures$;
reset role;

-- Seed existing linked records as the replay owner. Later RPC edits run as authenticated.
insert into public.compliance_calendar(id,company_id,title,due_date,obligation_ref,legal_requirement_id)
 values('af111000-0000-4000-8000-000000000201','af111000-0000-4000-8000-000000000010',
  'Fictional review calendar','2027-01-01','Section 4','af111000-0000-4000-8000-000000000101');
insert into public.legal_compliance_records(id,company_id,requirement_id,record_type,title,reference,status,payload)
 values('af111000-0000-4000-8000-000000000202','af111000-0000-4000-8000-000000000010',
  'af111000-0000-4000-8000-000000000101','evidence','Fictional retained evidence','EVD-REF','submitted',
  '{"requirement_reference":"Section 4","notes":"Historical evidence label"}');
insert into public.legal_compliance_relationships(id,company_id,requirement_id,record_id,related_module,related_record_id)
 values('af111000-0000-4000-8000-000000000203','af111000-0000-4000-8000-000000000010',
  'af111000-0000-4000-8000-000000000101','af111000-0000-4000-8000-000000000202','legal','af111000-0000-4000-8000-000000000101');

set local role authenticated;
do $edit_reference_assertions$
declare
 company uuid:='af111000-0000-4000-8000-000000000010';
 target_requirement uuid:='af111000-0000-4000-8000-000000000101';
 profile jsonb:='{"source_classification":"internal","official_source_url":"Controlled fictional policy POL-REF","applicability_decision":"applicable"}';
 r jsonb; old_requirement jsonb; assessment jsonb; assessment_before jsonb; profile_before jsonb; reference_before jsonb;
 evidence_before jsonb; calendar_before jsonb; relationship_before jsonb; gap_before jsonb; action_before jsonb;
 worksheet jsonb; old_timestamp timestamptz; before_count integer; next_before_count integer; invalid_call record;
begin
 select to_jsonb(q) into r from public.legal_requirements q where q.id=target_requirement;
 r:=public.verify_legal_source(target_requirement,(r->>'updated_at')::timestamptz,'Fictional source decision for reference test');
 worksheet:=jsonb_build_array(jsonb_build_object('requirement_id',target_requirement,
  'baseline_updated_at',r->>'updated_at','status','partial','controls','Fictional recorded controls',
  'recommendation','Fictional remediation','requirement_snapshot',jsonb_build_object('reference','Section 4','requirement','Fictional fire duty')));
 assessment:=public.save_legal_assessment('af111000-0000-4000-8000-000000000204',null,
  jsonb_build_object('company_id',company,'title','Fictional retained assessment','assessment_date','2026-11-10',
   'assessor','Fictional reviewer','status','submitted'),worksheet);
 assessment:=public.save_legal_assessment((assessment->'assessment'->>'id')::uuid,1,
  jsonb_build_object('company_id',company),worksheet,'approve','Fictional approval before a display-reference edit');
 select to_jsonb(q) into old_requirement from public.legal_requirements q where q.id=target_requirement;
 select to_jsonb(q) into assessment_before from public.compliance_assessments q where q.id=(assessment->'assessment'->>'id')::uuid;
 select to_jsonb(q) into evidence_before from public.legal_compliance_records q where q.id='af111000-0000-4000-8000-000000000202';
 select to_jsonb(q) into calendar_before from public.compliance_calendar q where q.id='af111000-0000-4000-8000-000000000201';
 select to_jsonb(q) into relationship_before from public.legal_compliance_relationships q where q.id='af111000-0000-4000-8000-000000000203';
 select to_jsonb(q) into gap_before from public.compliance_gaps q where q.requirement_id=target_requirement;
 select to_jsonb(q) into action_before from public.action_tracker q where q.id=(gap_before->>'action_id')::uuid;
 if gap_before is null or action_before is null then raise exception 'Fictional approval did not provide linked remediation fixtures';end if;
 old_timestamp:=(old_requirement->>'updated_at')::timestamptz;
 select count(*) into before_count from public.legal_assurance_history
  where record_id=target_requirement::text and command='before_reference_update';
 r:=public.save_legal_requirement(target_requirement,old_timestamp,
  jsonb_build_object('company_id',company,'req_ref','  Section 9(a)  '),profile);
 if r->>'id'<>target_requirement::text or r->>'req_ref'<>'Section 9(a)' or r->>'updated_at'=old_requirement->>'updated_at'
 then raise exception 'Reference edit did not retain the exact record identity and advance its version';end if;
 if (r-'req_ref'-'updated_at') is distinct from (old_requirement-'req_ref'-'updated_at')
 then raise exception 'Reference-only edit changed source verification, approval or other requirement data';end if;
 if (select req_ref from public.legal_requirements where id='af111000-0000-4000-8000-000000000102')<>'Section 4'
 then raise exception 'Editing one repeated reference changed the other legislation';end if;
 if (select to_jsonb(q) from public.compliance_assessments q where q.id=(assessment_before->>'id')::uuid) is distinct from assessment_before
  or (select to_jsonb(q) from public.legal_compliance_records q where q.id=evidence_before->>'id') is distinct from evidence_before
  or (select to_jsonb(q) from public.compliance_calendar q where q.id=(calendar_before->>'id')::uuid) is distinct from calendar_before
  or (select to_jsonb(q) from public.legal_compliance_relationships q where q.id=relationship_before->>'id') is distinct from relationship_before
  or (select to_jsonb(q) from public.compliance_gaps q where q.id=(gap_before->>'id')::uuid) is distinct from gap_before
  or (select to_jsonb(q) from public.action_tracker q where q.id=(action_before->>'id')::uuid) is distinct from action_before
 then raise exception 'Reference edit rewrote linked IDs or historical snapshots';end if;
 if not exists(select 1 from public.legal_assurance_history where company_id=company and record_id=target_requirement::text
  and command='before_reference_update' and actor_id=auth.uid() and snapshot=old_requirement)
  or not exists(select 1 from public.legal_assurance_history where company_id=company and record_id=target_requirement::text
   and command='save_requirement' and actor_id=auth.uid() and snapshot=r)
 then raise exception 'Reference change lacks authenticated before and after snapshots';end if;
 select count(*) into next_before_count from public.legal_assurance_history where record_id=target_requirement::text and command='before_reference_update';
 if next_before_count<>before_count+1 then raise exception 'Reference edit recorded an unexpected number of prior snapshots';end if;
 r:=public.save_legal_requirement(target_requirement,(r->>'updated_at')::timestamptz,jsonb_build_object('company_id',company),profile);
 if r->>'req_ref'<>'Section 9(a)' then raise exception 'An older client omitted and lost the edited reference';end if;
 r:=public.save_legal_requirement(target_requirement,(r->>'updated_at')::timestamptz,jsonb_build_object('company_id',company,'req_ref',' Section 9(a) '),profile);
 if (select count(*) from public.legal_assurance_history where record_id=target_requirement::text and command='before_reference_update')<>next_before_count
 then raise exception 'An unchanged reference fabricated a reference-change history entry';end if;
 select to_jsonb(q) into profile_before from public.legal_compliance_records q
  where q.requirement_id=target_requirement::text and q.record_type='requirement_profile';
 if profile_before is null then raise exception 'The governed reference-only fixture has no existing profile';end if;
 reference_before:=r;
 r:=public.save_legal_requirement(target_requirement,(r->>'updated_at')::timestamptz,
  jsonb_build_object('company_id',company,'req_ref',' Section 10 '),null,true);
 if r->>'req_ref'<>'Section 10'
  or (r-'req_ref'-'updated_at') is distinct from (reference_before-'req_ref'-'updated_at')
 then raise exception 'Reference-only RPC changed other saved requirement data';end if;
 if (select to_jsonb(q) from public.legal_compliance_records q where q.id=profile_before->>'id') is distinct from profile_before
 then raise exception 'Reference-only RPC changed the governance profile row, version or timestamps';end if;
 if not exists(select 1 from public.legal_assurance_history where record_id=target_requirement::text
  and command='before_reference_update' and actor_id=auth.uid() and snapshot=reference_before)
  or not exists(select 1 from public.legal_assurance_history where record_id=target_requirement::text
   and command='save_requirement' and actor_id=auth.uid() and snapshot=r)
 then raise exception 'Reference-only RPC did not retain authenticated change snapshots';end if;
 for invalid_call in
  select * from (values
   (target_requirement,(r->>'updated_at')::timestamptz,jsonb_build_object('company_id',company,'req_ref','Invalid false marker'),null::jsonb,false),
   (target_requirement,(r->>'updated_at')::timestamptz,jsonb_build_object('company_id',company,'req_ref','Invalid null marker'),null::jsonb,null::boolean),
   (null::uuid,(r->>'updated_at')::timestamptz,jsonb_build_object('company_id',company,'req_ref','Invalid create'),null::jsonb,true),
   (target_requirement,null::timestamptz,jsonb_build_object('company_id',company,'req_ref','Missing version'),null::jsonb,true),
   (target_requirement,(r->>'updated_at')::timestamptz,jsonb_build_object('company_id',company,'req_ref','Unexpected profile'),'{}'::jsonb,true),
   (target_requirement,(r->>'updated_at')::timestamptz,jsonb_build_object('company_id',company,'req_ref','General edit','title','Unexpected title'),null::jsonb,true),
   (target_requirement,(r->>'updated_at')::timestamptz,jsonb_build_object('company_id',company),null::jsonb,true),
   (target_requirement,(r->>'updated_at')::timestamptz,'[]'::jsonb,null::jsonb,true)
  ) as calls(id,expected,body,governance,reference_only)
 loop
  begin
   perform public.save_legal_requirement(invalid_call.id,invalid_call.expected,invalid_call.body,
    invalid_call.governance,invalid_call.reference_only);
   raise exception 'The reference-only overload accepted an invalid or broader request';
  exception when raise_exception then
   if sqlerrm not like 'Reference-only saving %' then raise;end if;
  end;
 end loop;
 if (select to_jsonb(q) from public.legal_requirements q where q.id=target_requirement) is distinct from r
  or (select to_jsonb(q) from public.legal_compliance_records q where q.id=profile_before->>'id') is distinct from profile_before
 then raise exception 'Rejected overload arguments changed requirement or governance data';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.save_legal_requirement(uuid,timestamptz,jsonb,jsonb,boolean)')
  and not prosecdef and pronargdefaults=0 and proargnames=array['p_id','p_expected','p_body','p_profile','p_reference_only']::text[])
  or not has_function_privilege('authenticated','public.save_legal_requirement(uuid,timestamptz,jsonb,jsonb,boolean)','EXECUTE')
  or has_function_privilege('anon','public.save_legal_requirement(uuid,timestamptz,jsonb,jsonb,boolean)','EXECUTE')
 then raise exception 'Reference-only RPC discovery or execution privileges differ from its intended contract';end if;
 begin
  perform public.save_legal_requirement(target_requirement,(r->>'updated_at')::timestamptz,
   jsonb_build_object('company_id',company,'title','Unintended general edit'),null);
  raise exception 'A missing general-edit profile silently rewrote governance';
 exception when raise_exception then
  if sqlerrm<>'Supply the governance profile for a general requirement edit' then raise;end if;
 end;
 begin
  perform public.save_legal_requirement(target_requirement,old_timestamp,jsonb_build_object('company_id',company,'req_ref','Stale overwrite'),profile);
  raise exception 'A stale reference edit overwrote the saved record';
 exception when raise_exception then
  if sqlerrm not like 'Requirement changed%' then raise;end if;
 end;
 begin
  perform public.save_legal_requirement(target_requirement,(r->>'updated_at')::timestamptz,jsonb_build_object('company_id',company,'req_ref','  '),profile);
  raise exception 'A blank reference cleared an existing reference';
 exception when raise_exception then
  if sqlerrm<>'Enter a requirement reference' then raise;end if;
 end;
 begin
  perform public.save_legal_requirement(target_requirement,(r->>'updated_at')::timestamptz,jsonb_build_object('company_id',company,'req_ref',null),profile);
  raise exception 'A null reference cleared an existing reference';
 exception when raise_exception then
  if sqlerrm<>'Enter a requirement reference' then raise;end if;
 end;
 begin
  perform public.save_legal_requirement(target_requirement,(r->>'updated_at')::timestamptz,jsonb_build_object('company_id',company,'req_ref',42),profile);
  raise exception 'A non-text reference was silently stored';
 exception when raise_exception then
  if sqlerrm<>'Requirement reference must be text' then raise;end if;
 end;
 begin
  perform public.save_legal_requirement(target_requirement,(r->>'updated_at')::timestamptz,
   '{"company_id":"af111000-0000-4000-8000-000000000020","req_ref":"Foreign edit"}',profile);
  raise exception 'A different-company request changed the reference';
 exception when insufficient_privilege then null;
 end;
 if (select req_ref from public.legal_requirements where id=target_requirement)<>'Section 10'
 then raise exception 'A failed reference edit changed persisted data';end if;
end $edit_reference_assertions$;
reset role;
rollback;
