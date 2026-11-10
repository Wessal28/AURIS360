-- Editable display references retain UUID relationships and historical snapshots.
-- References are descriptive labels and may repeat across legislation.
begin;

do $legal_reference_preflight$
declare missing text[]:='{}'; signature text; relation text; item record;
begin
 foreach signature in array array[
  'public.save_legal_requirement(uuid,timestamptz,jsonb,jsonb)',
  'public.legal_assurance_actor(uuid,boolean)'
 ] loop
  if to_regprocedure(signature) is null then missing:=array_append(missing,'function '||signature);end if;
 end loop;
 foreach relation in array array[
  'public.legal_requirements','public.legal_compliance_records',
  'public.legal_assurance_history','public.legal_compliance_one_requirement_profile'
 ] loop
  if to_regclass(relation) is null then missing:=array_append(missing,'relation '||relation);end if;
 end loop;
 for item in select * from (values
  ('legal_requirements','source_verification_status'),('legal_requirements','source_verified_by'),
  ('legal_requirements','source_verified_at'),('legal_requirements','applicability_decision'),
  ('legal_requirements','applicability_rationale'),('legal_requirements','approved_assessment_id')
 ) as required(table_name,column_name) loop
  if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||item.table_name)
   and attname=item.column_name and attnum>0 and not attisdropped)
  then missing:=array_append(missing,'column public.'||item.table_name||'.'||item.column_name);end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.legal_requirements')
  and tgname='legal_requirement_assurance' and not tgisinternal and tgenabled in ('O','A'))
 then missing:=array_append(missing,'active legal_requirement_assurance trigger');end if;
 if cardinality(missing)>0 then
  raise exception using message='Legal requirement reference upgrade needs the Legal Assurance migration',
   detail=array_to_string(missing,'; '),
   hint='Install and verify 20261019010000_legal_assurance.sql before applying this reference upgrade.';
 end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.save_legal_requirement(uuid,timestamptz,jsonb,jsonb)')
  and proargnames=array['p_id','p_expected','p_body','p_profile']::text[]
  and prorettype='jsonb'::regtype and not proretset and prokind='f' and prosecdef)
 then
  raise exception 'Legal requirement save signature differs from the reviewed Legal Assurance routine. Review it before applying this upgrade.';
 end if;
end $legal_reference_preflight$;

create or replace function public.save_legal_requirement(p_id uuid,p_expected timestamptz,p_body jsonb,p_profile jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.legal_requirements; prior public.legal_requirements; actor uuid; company uuid:=(p_body->>'company_id')::uuid; profile jsonb:=coalesce(p_profile,'{}');is_new boolean:=false;reference_only boolean:=false;old_profile jsonb;
begin
 actor:=public.legal_assurance_actor(company);perform set_config('auris.legal_command','save_requirement',true);
 if p_id is not null then select * into prior from public.legal_requirements where id=p_id and company_id=company for update;end if;
 if prior.id is not null then
  if p_expected is null or prior.updated_at is distinct from p_expected then raise exception 'Requirement changed or a previous save completed. Reopen it before saving.';end if;
 else if p_expected is not null then raise exception 'Requirement unavailable';end if;is_new:=true;prior.id:=coalesce(p_id,gen_random_uuid());prior.company_id:=company;prior.req_ref:='LEG-'||upper(substr(replace(prior.id::text,'-',''),1,12));prior.status:='not_assessed';prior.source_verification_status:='unverified';prior.created_at:=clock_timestamp();prior.created_by:=actor;end if;
 reference_only:=not is_new and p_profile is null and p_body ? 'req_ref'
  and (p_body-'company_id'-'req_ref')='{}'::jsonb;
 if p_profile is null and not reference_only then
  raise exception 'Supply the governance profile for a general requirement edit';
 end if;
 r:=jsonb_populate_record(prior,p_body-'id'-'created_by'-'created_at'-'updated_at'-'status'-'compliance_status'-'compliance_score'-'approved_assessment_id'-'source_verification_status'-'source_verified_by'-'source_verified_at');
 if p_body ? 'req_ref' then
  if p_body->'req_ref'<>'null'::jsonb and jsonb_typeof(p_body->'req_ref')<>'string' then
   raise exception 'Requirement reference must be text';
  end if;
  r.req_ref:=nullif(btrim(p_body->>'req_ref'),'');
  if r.req_ref is null then
   if not is_new then raise exception 'Enter a requirement reference';end if;
   r.req_ref:=prior.req_ref;
  end if;
 end if;
 if reference_only then
  update public.legal_requirements set req_ref=r.req_ref where id=prior.id returning * into r;
  if (to_jsonb(r)-'req_ref'-'updated_at') is distinct from (to_jsonb(prior)-'req_ref'-'updated_at') then
   raise exception 'Reference-only update would change other requirement data. Review the requirement before editing its reference.';
  end if;
 else
 r.applicability_decision:=coalesce(nullif(profile->>'applicability_decision',''),'legal_review');r.applicability_rationale:=profile->>'applicability_rationale';r.source_url:=profile->>'official_source_url';
 select payload into old_profile from public.legal_compliance_records where company_id=company and requirement_id=prior.id::text and record_type='requirement_profile';
 if (old_profile->>'source_classification',old_profile->>'official_text') is distinct from (profile->>'source_classification',profile->>'official_text') then r.source_verification_status:='unverified';r.source_verified_by:=null;r.source_verified_at:=null;r.approved_assessment_id:=null;r.status:='not_assessed';r.compliance_score:=null;end if;
 if prior.approved_assessment_id is not null and (old_profile->>'duty_statement',old_profile->>'internal_summary',old_profile->>'applicability_scope') is distinct from (profile->>'duty_statement',profile->>'internal_summary',profile->>'applicability_scope') then r.approved_assessment_id:=null;r.status:='not_assessed';r.compliance_score:=null;end if;
 if nullif(btrim(r.legislation),'') is null then raise exception 'Enter a requirement source or policy name';end if;
 if is_new then insert into public.legal_requirements select (r).* returning * into r;
 else update public.legal_requirements set req_ref=r.req_ref,legislation=r.legislation,title=r.title,section=r.section,subsection=r.subsection,requirement=r.requirement,legislation_type=r.legislation_type,category=r.category,jurisdiction=r.jurisdiction,authority=r.authority,obligation_type=r.obligation_type,frequency=r.frequency,controls=r.controls,evidence_required=r.evidence_required,evidence_location=r.evidence_location,further_controls=r.further_controls,penalty_risk=r.penalty_risk,notes=r.notes,responsibility=r.responsibility,responsible_person=r.responsible_person,target_date=r.target_date,effective_date=r.effective_date,review_date=r.review_date,source_url=r.source_url,source_verification_status=r.source_verification_status,source_verified_by=r.source_verified_by,source_verified_at=r.source_verified_at,status=r.status,compliance_score=r.compliance_score,approved_assessment_id=r.approved_assessment_id,applicability_decision=r.applicability_decision,applicability_rationale=r.applicability_rationale where id=r.id returning * into r;end if;
 profile:=profile||jsonb_build_object('applicability_decision',r.applicability_decision,'applicability_rationale',r.applicability_rationale);
 insert into public.legal_compliance_records(company_id,requirement_id,record_type,title,status,payload,idempotency_key,created_by)
 values(company,r.id::text,'requirement_profile','Requirement governance profile','current',profile,'profile:'||r.id,actor)
 on conflict(company_id,requirement_id) where record_type='requirement_profile' do update set payload=excluded.payload,version_no=legal_compliance_records.version_no+1,updated_at=clock_timestamp();
 end if;
 if not is_new and prior.req_ref is distinct from r.req_ref then
  insert into public.legal_assurance_history(company_id,entity_table,record_id,command,actor_id,snapshot)
   values(company,'legal_requirements',r.id::text,'before_reference_update',actor,to_jsonb(prior));
 end if;
 insert into public.legal_assurance_history(company_id,entity_table,record_id,command,actor_id,snapshot) values(company,'legal_requirements',r.id::text,'save_requirement',actor,to_jsonb(r));
 return to_jsonb(r);
end $$;

-- The explicit fifth argument lets clients require this narrow capability before writing.
-- Existing four-argument callers keep their normal requirement-edit contract.
create or replace function public.save_legal_requirement(
 p_id uuid,p_expected timestamptz,p_body jsonb,p_profile jsonb,p_reference_only boolean
) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if p_reference_only is not true or p_id is null or p_expected is null
  or p_profile is not null or jsonb_typeof(p_body) is distinct from 'object' then
  raise exception 'Reference-only saving needs an existing record, its saved version and no governance profile';
 end if;
 if not (p_body ?& array['company_id','req_ref'])
  or (p_body-'company_id'-'req_ref')<>'{}'::jsonb then
  raise exception 'Reference-only saving accepts exactly company_id and req_ref';
 end if;
 return public.save_legal_requirement(p_id,p_expected,p_body,p_profile);
end $$;

revoke all on function public.save_legal_requirement(uuid,timestamptz,jsonb,jsonb) from public,anon;
grant execute on function public.save_legal_requirement(uuid,timestamptz,jsonb,jsonb) to authenticated;
revoke all on function public.save_legal_requirement(uuid,timestamptz,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.save_legal_requirement(uuid,timestamptz,jsonb,jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
