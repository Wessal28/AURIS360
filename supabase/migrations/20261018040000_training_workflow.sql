alter table public.training_plan add column participant_ids uuid[] not null default '{}';
alter table public.training_plan add column if not exists training_provider text;
alter table public.training_plan add column source_training_id uuid references public.training_followup(id);
alter table public.training_followup add column attendance_status text not null default 'pending' check(attendance_status in ('pending','attended','absent'));
alter table public.training_followup add column provider_snapshot text;
alter table public.training_followup add column location_snapshot text;
alter table public.training_followup add column duration_hours numeric;
alter table public.training_followup add column if not exists certificate_url text;
alter table public.training_followup add column if not exists evidence_url text;
alter table public.training_followup add column evidence_review_status text not null default 'pending' check(evidence_review_status in ('pending','reviewed','rejected'));
alter table public.training_followup add column evidence_review_note text;
alter table public.training_followup add column evidence_reviewed_by uuid;
alter table public.training_followup add column evidence_reviewed_at timestamptz;
alter table public.training_followup alter column passed drop default;
alter table public.induction_records alter column status set default 'in_progress';
alter table public.induction_records alter column passed drop default;
alter table public.induction_records drop constraint induction_records_status_check;
alter table public.induction_records add constraint induction_records_status_check check(status in ('pending','in_progress','completed','failed','cancelled','archived'));
alter table public.authorisations add column record_kind text check(record_kind in ('certificate','work_authorisation'));
-- Existing records remain unclassified; do not invent historical authority.
alter table public.competency_matrix add column supporting_training_id uuid references public.training_followup(id);
create index training_attendance_plan_person on public.training_followup(company_id,plan_id,person_id);

create function public.guard_training_workflow_links() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare pid uuid; evidence public.training_followup;
begin
 if tg_table_name='training_plan' then
  foreach pid in array new.participant_ids loop
   if not exists(select 1 from public.people where id=pid and company_id=new.company_id) then raise exception 'Participants must belong to this company';end if;
  end loop;
  if new.source_training_id is not null and not exists(select 1 from public.training_followup where id=new.source_training_id and company_id=new.company_id) then raise exception 'Refresher source is unavailable in this company';end if;
 elsif tg_table_name='training_followup' then
  if new.plan_id is not null and not exists(select 1 from public.training_plan where id=new.plan_id and company_id=new.company_id) then raise exception 'Training session is unavailable in this company';end if;
  if new.person_id is not null and not exists(select 1 from public.people where id=new.person_id and company_id=new.company_id) then raise exception 'Learner must belong to this company';end if;
  if tg_op='INSERT' then
   if new.evidence_review_status<>'pending' then raise exception 'Create the learner record before reviewing its evidence';end if;
  else
   if (new.certificate,new.certificate_url,new.evidence_url,new.expiry_date,new.passed,new.person_id,new.training_topic,new.training_date) is distinct from
      (old.certificate,old.certificate_url,old.evidence_url,old.expiry_date,old.passed,old.person_id,old.training_topic,old.training_date) then
    new.evidence_review_status:='pending';new.evidence_reviewed_by:=null;new.evidence_reviewed_at:=null;new.evidence_review_note:=null;
   elsif (new.evidence_review_status,new.evidence_review_note,new.evidence_reviewed_by,new.evidence_reviewed_at) is distinct from
         (old.evidence_review_status,old.evidence_review_note,old.evidence_reviewed_by,old.evidence_reviewed_at) then
    if new.evidence_review_status not in ('reviewed','rejected') or new.evidence_reviewed_by is distinct from auth.uid()
       or new.evidence_reviewed_at is null or nullif(btrim(new.evidence_review_note),'') is null then raise exception 'Record an explicit evidence review decision and reviewer';end if;
    if public.current_user_role() not in ('sephs_admin','admin','company_admin','manager','hse_manager','hse_officer','site_manager') then raise exception 'Manager access is required for evidence review';end if;
    if new.evidence_review_status='reviewed' and (new.passed is null or coalesce(nullif(new.certificate,''),nullif(new.certificate_url,''),nullif(new.evidence_url,'')) is null) then raise exception 'Record the outcome and supporting evidence before review';end if;
   end if;
  end if;
 elsif tg_table_name='induction_records' then
  if new.status='completed' and (tg_op='INSERT' or old.status is distinct from 'completed' or new.topics_covered is distinct from old.topics_covered) then
   if jsonb_typeof(new.topics_covered) is distinct from 'array' or not (new.topics_covered ? 'entrant_declaration_understood') then raise exception 'Confirm the induction checklist and entrant understanding before completion';end if;
  end if;
 elsif tg_table_name='competency_matrix' and new.supporting_training_id is not null then
  if tg_op='UPDATE' and (new.supporting_training_id,new.person_id,new.current_level,new.required_level) is not distinct from (old.supporting_training_id,old.person_id,old.current_level,old.required_level) then return new;end if;
  select * into evidence from public.training_followup where id=new.supporting_training_id and company_id=new.company_id and person_id=new.person_id;
  if not found or evidence.passed is distinct from true or evidence.evidence_review_status<>'reviewed' or evidence.expiry_date<current_date then raise exception 'Select current, reviewed, passed evidence for the same learner';end if;
 end if;
 return new;
end $$;
create trigger training_plan_links before insert or update on public.training_plan for each row execute function public.guard_training_workflow_links();
create trigger training_record_links before insert or update on public.training_followup for each row execute function public.guard_training_workflow_links();
create trigger competency_training_evidence before insert or update on public.competency_matrix for each row execute function public.guard_training_workflow_links();
create trigger induction_explicit_completion before insert or update on public.induction_records for each row execute function public.guard_training_workflow_links();

create function public.create_training_attendance(p_plan_id uuid,p_people uuid[],p_date date,p_trainer text default null)
returns setof public.training_followup language plpgsql set search_path=public,pg_temp as $$
declare plan public.training_plan; pid uuid; person public.people; saved public.training_followup;
begin
 select * into plan from public.training_plan where id=p_plan_id;
 if not found or (plan.company_id is distinct from public.auth_company_id() and not public.is_sephs_admin()) then raise exception 'Training session is unavailable in this company';end if;
 if public.current_user_role() not in ('sephs_admin','admin','company_admin','manager','hse_manager','hse_officer','site_manager') or not public.user_access_allowed('training.followup','create') then raise exception 'Access to create training records is required';end if;
 if plan.status='cancelled' then raise exception 'A cancelled session cannot create attendee records';end if;
 if p_date is null or coalesce(array_length(p_people,1),0)=0 then raise exception 'Enter the session date and select attendees';end if;
 perform pg_advisory_xact_lock(hashtextextended('training-attendance/'||p_plan_id::text,0));
 for pid in select distinct unnest(p_people) loop
  select * into person from public.people where id=pid and company_id=plan.company_id;
  if not found then raise exception 'All attendees must belong to this company';end if;
  select * into saved from public.training_followup where company_id=plan.company_id and plan_id=p_plan_id and person_id=pid order by created_at limit 1;
  if not found then
   insert into public.training_followup(company_id,plan_id,person_id,person_name,training_topic,training_date,trainer,provider_snapshot,location_snapshot,duration_hours,passed,attendance_status,created_by)
   values(plan.company_id,plan.id,pid,concat_ws(' ',person.first_name,person.last_name),plan.training_topic,p_date,coalesce(p_trainer,plan.trainer),coalesce(plan.training_provider,substring(plan.notes from '\[Training institution / provider: ([^\]]+)\]')),plan.location,plan.duration_hours,null,'pending',auth.uid()) returning * into saved;
  end if;
  return next saved;
 end loop;
end $$;
create function public.review_training_evidence(p_id uuid,p_decision text,p_note text) returns public.training_followup
language plpgsql set search_path=public,pg_temp as $$
declare saved public.training_followup;
begin
 if p_decision not in ('reviewed','rejected') or nullif(btrim(p_note),'') is null then raise exception 'Enter an evidence review decision and note';end if;
 update public.training_followup set evidence_review_status=p_decision,evidence_review_note=p_note,evidence_reviewed_by=auth.uid(),evidence_reviewed_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=p_id and (company_id=public.auth_company_id() or public.is_sephs_admin()) returning * into saved;
 if not found then raise exception 'Training evidence is unavailable in this company';end if;
 return saved;
end $$;
revoke all on function public.create_training_attendance(uuid,uuid[],date,text),public.review_training_evidence(uuid,text,text) from public,anon;
grant execute on function public.create_training_attendance(uuid,uuid[],date,text),public.review_training_evidence(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
