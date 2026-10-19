-- Provisional worksheets never publish results. Approval, gaps and actions are atomic.
begin;
alter table public.legal_requirements
 add column source_verification_status text not null default 'unverified',
 add column source_verified_by uuid, add column source_verified_at timestamptz,
 add column applicability_decision text, add column applicability_rationale text,
 add column approved_assessment_id uuid;
alter table public.legal_requirements alter column applicable drop default;
alter table public.legal_requirements alter column status set default 'not_assessed';
alter table public.legal_requirements alter column compliance_status set default 'not_assessed';
alter table public.legal_requirements alter column compliance_score drop default;
alter table public.compliance_assessments add column worksheet jsonb not null default '[]',
 add column revision integer not null default 1, add column approved_by_id uuid,
 add column approved_at timestamptz, add column decision_note text,
 add column supersedes_id uuid, add column archived_at timestamptz;
alter table public.compliance_gaps add column assessment_id uuid,add column action_id uuid;
create unique index legal_assessed_open_gap on public.compliance_gaps(company_id,requirement_id)
 where assessment_id is not null and status in ('open','in_progress');
alter table public.legal_changes add column requirement_id uuid,add column previous_wording text,
 add column new_wording text,add column review_status text,add column revision integer not null default 1,
 add column reviewed_by uuid,add column reviewed_at timestamptz,add column decision_note text,
 add column archived_at timestamptz;
alter table public.action_tracker drop constraint action_tracker_source_type_check;
alter table public.action_tracker add constraint action_tracker_source_type_check check(source_type in
 ('incident','audit','inspection','complaint','risk_assessment','toolbox_talk','permit','noise_survey','observation','meeting','ohealth','esg','emergency','ppe','kpi','manual','other','legal'));
alter table public.action_tracker drop constraint action_tracker_source_module_check;
alter table public.action_tracker add constraint action_tracker_source_module_check check(source_module in
 ('inspection','event','risk_assessment','investigation','meeting','permit','noise_survey','kpi','manual','legal'));

create table public.legal_assurance_history(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,
 entity_table text not null,record_id text not null,command text not null,
 actor_id uuid not null,recorded_at timestamptz not null default clock_timestamp(),
 snapshot jsonb not null,note text);
create index legal_assurance_history_record on public.legal_assurance_history(company_id,entity_table,record_id,recorded_at desc);
alter table public.legal_assurance_history enable row level security;
create policy legal_history_read on public.legal_assurance_history for select to authenticated
 using(public.auris_can_access_company(company_id) and public.user_access_allowed('legal','view'));
grant select on public.legal_assurance_history to authenticated;

create function public.legal_assurance_actor(p_company uuid,p_approval boolean default false) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text;
begin
 select role into r from public.profiles where id=auth.uid();
 if p_company is null or auth.uid() is null or not coalesce(public.auris_can_access_company(p_company),false) or not coalesce(public.user_access_allowed('legal','edit'),false)
  or r is null or r not in ('admin','sephs_admin','hse_manager','hse_officer','manager','site_manager','supervisor','compliance_manager','legal_reviewer','document_controller')
  or (p_approval and r not in ('admin','sephs_admin','hse_manager','manager','compliance_manager','legal_reviewer'))
 then raise exception 'Legal Compliance access or reviewer authority is required' using errcode='42501';end if;
 return auth.uid();
end $$;

create function public.guard_legal_requirement_assurance() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='UPDATE' and (new.requirement,new.source_url,new.legislation,new.legislation_type) is distinct from (old.requirement,old.source_url,old.legislation,old.legislation_type) then
  new.source_verification_status:='unverified';new.source_verified_by:=null;new.source_verified_at:=null;
  new.approved_assessment_id:=null;new.status:='not_assessed';new.compliance_score:=null;
 end if;
 if new.source_verification_status='verified' and (tg_op='INSERT' or (new.source_verification_status,new.source_verified_by,new.source_verified_at) is distinct from (old.source_verification_status,old.source_verified_by,old.source_verified_at)) then
  if current_setting('auris.legal_command',true) is distinct from 'verify_source' or nullif(btrim(new.source_url),'') is null or new.source_verified_by is distinct from auth.uid() or new.source_verified_at is null then raise exception 'Use the explicit source verification decision with a source reference';end if;
 end if;
 if tg_op='UPDATE' and old.approved_assessment_id is not null and current_setting('auris.legal_command',true) is distinct from 'approve_assessment' and (new.controls,new.evidence_required,new.evidence_location,new.further_controls) is distinct from (old.controls,old.evidence_required,old.evidence_location,old.further_controls) then new.approved_assessment_id:=null;new.status:='not_assessed';new.compliance_score:=null;end if;
 if new.applicability_decision is not null then
  if new.applicability_decision not in ('applicable','not_applicable','monitoring','legal_review') then raise exception 'Invalid applicability decision';end if;
  if new.applicability_decision='not_applicable' and nullif(btrim(new.applicability_rationale),'') is null then raise exception 'Explain why the requirement is not applicable';end if;
  new.applicable:=case new.applicability_decision when 'applicable' then true when 'not_applicable' then false else null end;
  if tg_op='UPDATE' and new.applicability_decision is distinct from old.applicability_decision then new.approved_assessment_id:=null;new.status:='not_assessed';new.compliance_score:=null;end if;
  if new.applicability_decision='not_applicable' then new.status:='not_applicable';new.compliance_score:=null;
  elsif tg_op='UPDATE' and old.applicability_decision='not_applicable' then new.status:='not_assessed';new.compliance_score:=null;new.approved_assessment_id:=null;end if;
 end if;
 if tg_op='INSERT' then
  if new.status in ('compliant','partial','non_compliant') then raise exception 'New requirements remain Not assessed until an assessment is approved';end if;
 elsif (new.status,new.compliance_score,new.approved_assessment_id) is distinct from (old.status,old.compliance_score,old.approved_assessment_id) and new.status in ('compliant','partial','non_compliant') then
  if current_setting('auris.legal_command',true) is distinct from 'approve_assessment' then raise exception 'Publish compliance results through an approved assessment';end if;
 end if;
 if tg_op='UPDATE' and old.source_verification_status='verified' and new.source_verification_status<>'verified' then new.approved_assessment_id:=null;new.status:='not_assessed';new.compliance_score:=null;if new.applicability_decision='not_applicable' then new.status:='not_applicable';end if;end if;
 new.compliance_status:=new.status;new.updated_at:=clock_timestamp();return new;
end $$;
create trigger legal_requirement_assurance before insert or update on public.legal_requirements for each row execute function public.guard_legal_requirement_assurance();

create function public.save_legal_requirement(p_id uuid,p_expected timestamptz,p_body jsonb,p_profile jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.legal_requirements; prior public.legal_requirements; actor uuid; company uuid:=(p_body->>'company_id')::uuid; profile jsonb:=coalesce(p_profile,'{}');is_new boolean:=false;old_profile jsonb;
begin
 actor:=public.legal_assurance_actor(company);perform set_config('auris.legal_command','save_requirement',true);
 if p_id is not null then select * into prior from public.legal_requirements where id=p_id and company_id=company for update;end if;
 if prior.id is not null then
  if p_expected is null or prior.updated_at is distinct from p_expected then raise exception 'Requirement changed or a previous save completed. Reopen it before saving.';end if;
 else if p_expected is not null then raise exception 'Requirement unavailable';end if;is_new:=true;prior.id:=coalesce(p_id,gen_random_uuid());prior.company_id:=company;prior.req_ref:='LEG-'||upper(substr(replace(prior.id::text,'-',''),1,12));prior.status:='not_assessed';prior.source_verification_status:='unverified';prior.created_at:=clock_timestamp();prior.created_by:=actor;end if;
 r:=jsonb_populate_record(prior,p_body-'id'-'req_ref'-'created_by'-'created_at'-'updated_at'-'status'-'compliance_status'-'compliance_score'-'approved_assessment_id'-'source_verification_status'-'source_verified_by'-'source_verified_at');
 r.applicability_decision:=coalesce(nullif(profile->>'applicability_decision',''),'legal_review');r.applicability_rationale:=profile->>'applicability_rationale';r.source_url:=profile->>'official_source_url';
 select payload into old_profile from public.legal_compliance_records where company_id=company and requirement_id=prior.id::text and record_type='requirement_profile';
 if (old_profile->>'source_classification',old_profile->>'official_text') is distinct from (profile->>'source_classification',profile->>'official_text') then r.source_verification_status:='unverified';r.source_verified_by:=null;r.source_verified_at:=null;r.approved_assessment_id:=null;r.status:='not_assessed';r.compliance_score:=null;end if;
 if prior.approved_assessment_id is not null and (old_profile->>'duty_statement',old_profile->>'internal_summary',old_profile->>'applicability_scope') is distinct from (profile->>'duty_statement',profile->>'internal_summary',profile->>'applicability_scope') then r.approved_assessment_id:=null;r.status:='not_assessed';r.compliance_score:=null;end if;
 if nullif(btrim(r.legislation),'') is null then raise exception 'Enter a requirement source or policy name';end if;
 if is_new then insert into public.legal_requirements select (r).* returning * into r;
 else update public.legal_requirements set legislation=r.legislation,title=r.title,section=r.section,subsection=r.subsection,requirement=r.requirement,legislation_type=r.legislation_type,category=r.category,jurisdiction=r.jurisdiction,authority=r.authority,obligation_type=r.obligation_type,frequency=r.frequency,controls=r.controls,evidence_required=r.evidence_required,evidence_location=r.evidence_location,further_controls=r.further_controls,penalty_risk=r.penalty_risk,notes=r.notes,responsibility=r.responsibility,responsible_person=r.responsible_person,target_date=r.target_date,effective_date=r.effective_date,review_date=r.review_date,source_url=r.source_url,source_verification_status=r.source_verification_status,source_verified_by=r.source_verified_by,source_verified_at=r.source_verified_at,status=r.status,compliance_score=r.compliance_score,approved_assessment_id=r.approved_assessment_id,applicability_decision=r.applicability_decision,applicability_rationale=r.applicability_rationale where id=r.id returning * into r;end if;
 profile:=profile||jsonb_build_object('applicability_decision',r.applicability_decision,'applicability_rationale',r.applicability_rationale);
 insert into public.legal_compliance_records(company_id,requirement_id,record_type,title,status,payload,idempotency_key,created_by)
 values(company,r.id::text,'requirement_profile','Requirement governance profile','current',profile,'profile:'||r.id,actor)
 on conflict(company_id,requirement_id) where record_type='requirement_profile' do update set payload=excluded.payload,version_no=legal_compliance_records.version_no+1,updated_at=clock_timestamp();
 insert into public.legal_assurance_history(company_id,entity_table,record_id,command,actor_id,snapshot) values(company,'legal_requirements',r.id::text,'save_requirement',actor,to_jsonb(r));
 return to_jsonb(r);
end $$;

create function public.verify_legal_source(p_id uuid,p_expected timestamptz,p_note text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.legal_requirements;actor uuid;
begin
 select * into r from public.legal_requirements where id=p_id for update;if not found then raise exception 'Requirement unavailable';end if;
 actor:=public.legal_assurance_actor(r.company_id,true);
 if p_expected is null or r.updated_at is distinct from p_expected then raise exception 'Requirement changed. Reopen before verifying.';end if;
 if nullif(btrim(r.source_url),'') is null or nullif(btrim(p_note),'') is null then raise exception 'A source reference and verification note are required';end if;
 perform set_config('auris.legal_command','verify_source',true);
 update public.legal_requirements set source_verification_status='verified',source_verified_by=actor,source_verified_at=clock_timestamp(),last_verified_at=clock_timestamp() where id=p_id returning * into r;
 insert into public.legal_assurance_history(company_id,entity_table,record_id,command,actor_id,snapshot,note) values(r.company_id,'legal_requirements',p_id::text,'verify_source',actor,to_jsonb(r),p_note);
 return to_jsonb(r);
end $$;

create function public.save_legal_assessment(p_id uuid,p_revision integer,p_body jsonb,p_rows jsonb,p_command text default 'save',p_note text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.compliance_assessments;prior public.compliance_assessments;req public.legal_requirements;item jsonb;gap public.compliance_gaps;act public.action_tracker;actor uuid;company uuid;st text;c integer:=0;pa integer:=0;n integer:=0;na integer:=0;un integer:=0;outcomes jsonb:='[]';is_new boolean:=false;
begin
 company:=(p_body->>'company_id')::uuid;actor:=public.legal_assurance_actor(company,p_command='approve');
 if p_command is null or p_command not in ('save','approve','archive') then raise exception 'Unsupported assessment command';end if;
 if p_id is not null then select * into prior from public.compliance_assessments where id=p_id and company_id=company for update;
  if not found and p_revision is not null then raise exception 'Assessment unavailable in this company';end if;
  if found and p_revision is distinct from prior.revision then raise exception 'Assessment changed. Reopen before saving.';end if;
  if prior.status='approved' and p_command<>'archive' then raise exception 'Approved assessments are retained. Create a revision to make corrections.';end if;
 end if;
 if prior.id is null then is_new:=true;prior.id:=coalesce(p_id,gen_random_uuid());prior.company_id:=company;prior.revision:=0;prior.assessment_ref:='CA-'||upper(substr(replace(prior.id::text,'-',''),1,12));prior.created_by:=actor;prior.created_at:=clock_timestamp();end if;
 if p_command='archive' then update public.compliance_assessments set archived_at=clock_timestamp(),revision=revision+1 where id=prior.id returning * into a;
 else
  a:=jsonb_populate_record(prior,p_body-'id'-'revision'-'assessment_ref'-'approved_by'-'approved_by_id'-'approved_date'-'approved_at'-'worksheet'-'created_by');
  if prior.status='approved' then raise exception 'Approved assessment is read only';end if;
  if a.supersedes_id is not null and not exists(select 1 from public.compliance_assessments where id=a.supersedes_id and company_id=company and status='approved') then raise exception 'Select an approved assessment in this company to revise';end if;
  a.status:=case when p_command='approve' then 'approved' else coalesce(p_body->>'status','draft') end;
  if a.status not in ('draft','submitted','approved') or (a.status='approved' and p_command<>'approve') then raise exception 'Use the explicit approval decision to approve an assessment';end if;
  if p_command='approve' and (prior.status<>'submitted' or nullif(btrim(p_note),'') is null) then raise exception 'Submit the saved worksheet and enter an approval note first';end if;
  if p_command='approve' then p_rows:=prior.worksheet;a:=prior;a.status:='approved';end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>1000 then raise exception 'Select between one and 1000 requirements';end if;
  if (select count(*) from jsonb_array_elements(p_rows))<>(select count(distinct x->>'requirement_id') from jsonb_array_elements(p_rows) x) then raise exception 'Each requirement must appear once';end if;
  perform 1 from public.legal_requirements where company_id=company and id in(select (x->>'requirement_id')::uuid from jsonb_array_elements(p_rows) x) order by id for update;
  for item in select * from jsonb_array_elements(p_rows) loop
   select * into req from public.legal_requirements where id=(item->>'requirement_id')::uuid and company_id=company;
   if not found then raise exception 'Worksheet contains an unavailable requirement';end if;
   st:=coalesce(item->>'status','not_assessed');
   if st not in ('not_assessed','compliant','partial','non_compliant','not_applicable') then raise exception 'Unsupported compliance result';end if;
   case st when 'compliant' then c:=c+1;when 'partial' then pa:=pa+1;when 'non_compliant' then n:=n+1;when 'not_applicable' then na:=na+1;else un:=un+1;end case;
   if a.status<>'draft' and st='not_assessed' then raise exception 'Deliberately assess every selected requirement before submission';end if;
   if p_command='approve' then
    if req.source_verification_status<>'verified' then raise exception 'Verify the source for requirement % before approval',req.req_ref;end if;
    if (item->>'baseline_updated_at')::timestamptz is distinct from req.updated_at then raise exception 'Requirement % changed. Refresh and review the worksheet before approval.',req.req_ref;end if;
    if req.applicability_decision not in ('applicable','not_applicable') or req.applicability_decision is null then raise exception 'Record a definitive applicability decision for %',req.req_ref;end if;
    if (st='not_applicable') is distinct from (req.applicability_decision='not_applicable') then raise exception 'Assessment and authoritative applicability disagree for %',req.req_ref;end if;
    if st in ('partial','non_compliant') and nullif(btrim(item->>'recommendation'),'') is null then raise exception 'Describe the remediation for %',req.req_ref;end if;
   end if;
  end loop;
  a.worksheet:=p_rows;a.revision:=prior.revision+1;a.total_requirements:=c+pa+n+na+un;a.compliant_count:=c;a.partial_count:=pa;a.non_compliant_count:=n;a.na_count:=na;a.overall_score:=case when un>0 or c+pa+n=0 then null else round((c*100+pa*50)::numeric/(c+pa+n)) end;a.updated_at:=clock_timestamp();
  if p_command='approve' then a.approved_by_id:=actor;select coalesce(full_name,id::text) into a.approved_by from public.profiles where id=actor;a.approved_at:=clock_timestamp();a.approved_date:=current_date;a.decision_note:=p_note;end if;
  if is_new then insert into public.compliance_assessments select (a).* returning * into a;
  else update public.compliance_assessments set title=a.title,assessment_date=a.assessment_date,assessment_type=a.assessment_type,next_assessment_date=a.next_assessment_date,assessor=a.assessor,scope=a.scope,methodology=a.methodology,findings=a.findings,recommendations=a.recommendations,linked_audit_ref=a.linked_audit_ref,status=a.status,worksheet=a.worksheet,revision=a.revision,total_requirements=a.total_requirements,compliant_count=a.compliant_count,partial_count=a.partial_count,non_compliant_count=a.non_compliant_count,na_count=a.na_count,overall_score=a.overall_score,approved_by=a.approved_by,approved_by_id=a.approved_by_id,approved_at=a.approved_at,approved_date=a.approved_date,decision_note=a.decision_note,updated_at=a.updated_at where id=a.id returning * into a;end if;
  if p_command='approve' then
   perform set_config('auris.legal_command','approve_assessment',true);
   for item in select * from jsonb_array_elements(a.worksheet) loop
    select * into req from public.legal_requirements where id=(item->>'requirement_id')::uuid and company_id=company;st:=item->>'status';
    update public.legal_requirements set status=st,compliance_score=case st when 'compliant' then 100 when 'partial' then 50 when 'non_compliant' then 0 else null end,controls=item->>'controls',gap=st in ('partial','non_compliant'),gap_identified=st in ('partial','non_compliant'),further_controls=item->>'recommendation',last_assessed_date=a.assessment_date,assessed_by=a.assessor,approved_assessment_id=a.id where id=req.id;
    if st in ('partial','non_compliant') then
     select * into gap from public.compliance_gaps where company_id=company and requirement_id=req.id and assessment_id is not null and status in ('open','in_progress') for update;
     if not found then
      act.id:=gen_random_uuid();
      insert into public.action_tracker(id,company_id,title,description,priority,status,action_type,source_module,source_type,source_id,source_ref,action_ref,responsible,assigned_to_name,target_date,created_by,requires_verification,verification_status)
       values(act.id,company,'Close compliance gap: '||coalesce(req.title,req.legislation),item->>'recommendation','high','open','corrective','legal','legal',req.id,req.req_ref,'MAP-CA-'||extract(year from current_date)||'-'||upper(substr(replace(act.id::text,'-',''),1,12)),item->>'responsible',item->>'responsible',nullif(item->>'target_date','')::date,actor,true,'pending') returning * into act;
      insert into public.compliance_gaps(company_id,requirement_id,assessment_id,action_id,action_ref,gap_ref,legislation,section,gap_description,action_required,responsible_person,target_date,status,created_by)
       values(company,req.id,a.id,act.id,act.action_ref,'GAP-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),req.legislation,req.section,item->>'recommendation',item->>'recommendation',item->>'responsible',nullif(item->>'target_date','')::date,'open',actor) returning * into gap;
     end if;
     outcomes:=outcomes||jsonb_build_array(jsonb_build_object('requirement_id',req.id,'gap_id',gap.id,'action_id',gap.action_id,'action_ref',gap.action_ref));
    end if;
   end loop;
  end if;
 end if;
 insert into public.legal_assurance_history(company_id,entity_table,record_id,command,actor_id,snapshot,note) values(company,'compliance_assessments',a.id::text,p_command,actor,to_jsonb(a),p_note);
 return jsonb_build_object('assessment',to_jsonb(a),'remediation',outcomes);
end $$;

create function public.save_legal_evidence(p_id text,p_version integer,p_body jsonb,p_command text default 'save',p_note text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.legal_compliance_records;prior public.legal_compliance_records;actor uuid;company uuid:=(p_body->>'company_id')::uuid;item jsonb;
begin
 actor:=public.legal_assurance_actor(company,p_command in ('verify','reject'));
 if p_command is null or p_command not in ('save','verify','reject') then raise exception 'Unsupported evidence decision';end if;
 if p_id is null or p_id !~ '^[a-fA-F0-9-]{36}$' then raise exception 'An exact evidence ID is required';end if;
 select * into prior from public.legal_compliance_records where id=p_id and company_id=company for update;
 if found then
  if p_version is distinct from prior.version_no then raise exception 'Evidence changed or a previous save completed. Reopen it before retrying.';end if;
  if prior.record_type not in ('evidence','permit_licence') then raise exception 'Use the requirement editor for source profiles';end if;
 else
  if p_version is not null or p_command<>'save' then raise exception 'Evidence unavailable';end if;
  prior.id:=p_id;prior.reference:=case p_body->>'record_type' when 'permit_licence' then 'PER-' else 'EVD-' end||upper(substr(replace(p_id,'-',''),1,12));prior.company_id:=company;prior.version_no:=0;prior.created_by:=actor;prior.created_at:=clock_timestamp();
 end if;
 r:=jsonb_populate_record(prior,p_body-'id'-'version_no'-'created_by'-'created_at'-'updated_at');
 if r.record_type not in ('evidence','permit_licence') or nullif(btrim(r.title),'') is null or not exists(select 1 from public.legal_requirements where id::text=r.requirement_id and company_id=company) then raise exception 'Select a requirement in this company and enter an evidence title';end if;
 if jsonb_typeof(r.payload) is distinct from 'object' or jsonb_typeof(coalesce(r.payload->'attachments','[]'))<>'array' or jsonb_array_length(coalesce(r.payload->'attachments','[]'))>20 then raise exception 'At most 20 document attachments are supported';end if;
 for item in select * from jsonb_array_elements(coalesce(r.payload->'attachments','[]')) loop
  if not coalesce(((item->>'bucket'='evidence' and starts_with(item->>'path',company::text||'/legal/'||p_id||'/')) or (item->>'url' ~ '^https://[^/@[:space:]]+([/:?#]|$)' and item->>'url' !~ '^https://[^/]*@')),false) then raise exception 'Invalid evidence document location';end if;
 end loop;
 r.version_no:=prior.version_no+1;r.updated_at:=clock_timestamp();
 if p_command='save' then
  if r.status not in ('draft','submitted','applied') then raise exception 'Use Verify or Reject to record an evidence decision';end if;
  r.payload:=r.payload-'reviewed_by'-'reviewed_by_name'-'reviewed_at'-'decision_note';
 else
  if prior.status not in ('submitted','applied') or nullif(btrim(p_note),'') is null then raise exception 'Submit the evidence and enter a review note before deciding';end if;
  r:=prior;r.version_no:=prior.version_no+1;r.updated_at:=clock_timestamp();
  if p_command='verify' and nullif(btrim(r.source_id),'') is null and jsonb_array_length(coalesce(r.payload->'attachments','[]'))=0 then raise exception 'Attach a document or enter a controlled document reference before verification';end if;
  r.status:=case when p_command='reject' then 'rejected' when r.record_type='permit_licence' then 'valid' else 'verified' end;
  r.payload:=r.payload||jsonb_build_object('reviewed_by',actor,'reviewed_by_name',(select coalesce(full_name,id::text) from public.profiles where id=actor),'reviewed_at',clock_timestamp(),'decision_note',p_note);
 end if;
 if prior.version_no>0 then insert into public.legal_assurance_history(company_id,entity_table,record_id,command,actor_id,snapshot,note) values(company,'legal_compliance_records',p_id,'before_update',actor,to_jsonb(prior),p_note);end if;
 if prior.version_no=0 then insert into public.legal_compliance_records select (r).* returning * into r;
 else update public.legal_compliance_records set title=r.title,requirement_id=r.requirement_id,status=r.status,owner_name=r.owner_name,expiry_date=r.expiry_date,source_module=r.source_module,source_id=r.source_id,payload=r.payload,version_no=r.version_no,updated_at=r.updated_at where id=p_id returning * into r;end if;
 insert into public.legal_assurance_history(company_id,entity_table,record_id,command,actor_id,snapshot,note) values(company,'legal_compliance_records',p_id,p_command,actor,to_jsonb(r),p_note);
 return to_jsonb(r);
end $$;

create function public.save_legal_change(p_id uuid,p_revision integer,p_body jsonb,p_command text default 'save',p_note text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.legal_changes;prior public.legal_changes;req public.legal_requirements;company uuid:=(p_body->>'company_id')::uuid;actor uuid;
begin
 actor:=public.legal_assurance_actor(company,p_command='apply');
 if p_command is null or p_command not in ('save','apply','archive') then raise exception 'Unsupported regulatory-change command';end if;
 if p_id is not null then
  select * into prior from public.legal_changes where id=p_id and company_id=company for update;
  if not found or prior.revision is distinct from p_revision then raise exception 'Change is unavailable or was updated. Reopen it.';end if;
  if (prior.review_status='applied' or prior.implemented=true) and p_command<>'archive' then raise exception 'Applied changes are retained. Create a new change for further wording.';end if;
 else prior.id:=gen_random_uuid();prior.company_id:=company;prior.created_by:=actor;prior.created_at:=clock_timestamp();prior.revision:=0;end if;
 if p_command='save' then
  r:=jsonb_populate_record(prior,p_body-'id'-'revision'-'implemented'-'review_status'-'reviewed_by'-'reviewed_at'-'decision_note'-'created_by'-'created_at');
  r.implemented:=false;r.review_status:='draft';
  if r.requirement_id is not null and not exists(select 1 from public.legal_requirements where id=r.requirement_id and company_id=company) then raise exception 'Requirement must belong to this company';end if;
 elsif p_command='apply' then
  if p_id is null or nullif(btrim(p_note),'') is null or nullif(btrim(prior.source),'') is null then raise exception 'Save the proposal, record its source, and enter a review note before applying it';end if;
  r:=prior;
  select * into req from public.legal_requirements where id=r.requirement_id and company_id=company for update;
  if not found or r.previous_wording is distinct from req.requirement then raise exception 'The selected requirement changed. Refresh and review its wording before applying.';end if;
  if nullif(btrim(r.new_wording),'') is null then raise exception 'Enter the proposed replacement wording';end if;
  update public.legal_requirements set requirement=r.new_wording where id=req.id;
  r.implemented:=true;r.review_status:='applied';r.reviewed_by:=actor;r.reviewed_at:=clock_timestamp();r.decision_note:=p_note;
 else r:=prior;r.archived_at:=clock_timestamp();end if;
 r.revision:=prior.revision+1;r.updated_at:=clock_timestamp();
 if p_id is not null then insert into public.legal_assurance_history(company_id,entity_table,record_id,command,actor_id,snapshot,note) values(company,'legal_changes',prior.id::text,'before_update',actor,to_jsonb(prior),p_note);end if;
 if p_id is null then insert into public.legal_changes select (r).* returning * into r;
 else update public.legal_changes set date_received=r.date_received,source=r.source,jurisdiction=r.jurisdiction,legislation=r.legislation,category=r.category,changes_identified=r.changes_identified,changes=r.changes,action_required=r.action_required,action=r.action,responsible_person=r.responsible_person,effective_date=r.effective_date,applicable=r.applicable,comments=r.comments,requirement_id=r.requirement_id,previous_wording=r.previous_wording,new_wording=r.new_wording,implemented=r.implemented,review_status=r.review_status,reviewed_by=r.reviewed_by,reviewed_at=r.reviewed_at,decision_note=r.decision_note,revision=r.revision,updated_at=r.updated_at,archived_at=r.archived_at where id=r.id returning * into r;end if;
 insert into public.legal_assurance_history(company_id,entity_table,record_id,command,actor_id,snapshot,note) values(company,'legal_changes',r.id::text,p_command,actor,to_jsonb(r),p_note);
 return to_jsonb(r);
end $$;

revoke all on function public.save_legal_evidence(text,integer,jsonb,text,text),public.save_legal_change(uuid,integer,jsonb,text,text) from public,anon;
grant execute on function public.save_legal_evidence(text,integer,jsonb,text,text),public.save_legal_change(uuid,integer,jsonb,text,text) to authenticated;
-- These records are changed through explicit decisions, never status dropdown writes.
revoke insert,update,delete on public.compliance_assessments,public.legal_compliance_records,public.legal_changes from authenticated,anon;
revoke all on function public.legal_assurance_actor(uuid,boolean),public.guard_legal_requirement_assurance() from public,anon,authenticated;
revoke all on function public.save_legal_requirement(uuid,timestamptz,jsonb,jsonb),public.verify_legal_source(uuid,timestamptz,text),public.save_legal_assessment(uuid,integer,jsonb,jsonb,text,text) from public,anon;
grant execute on function public.save_legal_requirement(uuid,timestamptz,jsonb,jsonb),public.verify_legal_source(uuid,timestamptz,text),public.save_legal_assessment(uuid,integer,jsonb,jsonb,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
