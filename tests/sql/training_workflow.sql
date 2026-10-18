-- Disposable authenticated fixtures only. No notifications or live data.
begin;
grant usage on schema public,auth to authenticated;
grant select on public.profiles,public.people to authenticated;
grant select,insert,update on public.training_plan,public.training_followup,public.competency_matrix,public.induction_records to authenticated;
insert into auth.users(id) values('d1800000-0000-4000-8000-000000000001');
insert into public.companies(id,name) values('d1800000-0000-4000-8000-000000000010','Training fixture A'),('d1800000-0000-4000-8000-000000000020','Training fixture B');
insert into public.profiles(id,company_id,role,status) values('d1800000-0000-4000-8000-000000000001','d1800000-0000-4000-8000-000000000010','admin','active');
create or replace function auth.uid() returns uuid language sql stable as $$select 'd1800000-0000-4000-8000-000000000001'::uuid$$;
create or replace function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
insert into public.people(id,company_id,first_name,last_name) values
('d1800000-0000-4000-8000-000000000031','d1800000-0000-4000-8000-000000000010','Fictional','One'),
('d1800000-0000-4000-8000-000000000032','d1800000-0000-4000-8000-000000000010','Fictional','Two'),
('d1800000-0000-4000-8000-000000000033','d1800000-0000-4000-8000-000000000020','Foreign','Person');
insert into public.training_plan(id,company_id,training_topic,planned_date,training_type,trainer,training_provider,location,duration_hours,participant_ids)
values('d1800000-0000-4000-8000-000000000040','d1800000-0000-4000-8000-000000000010','Fictional linked session','2026-10-18','external','Fictional trainer','Fictional provider','Fictional room',2,array['d1800000-0000-4000-8000-000000000031','d1800000-0000-4000-8000-000000000032']::uuid[]);
insert into public.competencies(id,company_id,name) values('d1800000-0000-4000-8000-000000000050','d1800000-0000-4000-8000-000000000010','Fictional skill');
set local role authenticated;
do $$declare r public.training_followup; a uuid; cnt integer; begin
 select count(*) into cnt from public.create_training_attendance('d1800000-0000-4000-8000-000000000040',array['d1800000-0000-4000-8000-000000000031','d1800000-0000-4000-8000-000000000032']::uuid[],'2026-10-18',null);
 if cnt<>2 then raise exception 'two attendee records were not created';end if;
 select * into r from public.training_followup where person_id='d1800000-0000-4000-8000-000000000031';a:=r.id;
 if r.passed is not null or r.attendance_status<>'pending' or r.training_topic<>'Fictional linked session' or r.training_date<>'2026-10-18'::date or r.provider_snapshot<>'Fictional provider' or r.trainer<>'Fictional trainer' then raise exception 'session prefill or pending defaults are wrong';end if;
 perform public.create_training_attendance('d1800000-0000-4000-8000-000000000040',array['d1800000-0000-4000-8000-000000000031','d1800000-0000-4000-8000-000000000032']::uuid[],'2026-10-19','Changed retry');
 if (select count(*) from public.training_followup)<>2 or (select training_date from public.training_followup where id=a)<>'2026-10-18'::date then raise exception 'retry duplicated or overwrote learner records';end if;
 begin perform public.create_training_attendance('d1800000-0000-4000-8000-000000000040',array['d1800000-0000-4000-8000-000000000033']::uuid[],'2026-10-18',null);raise exception 'foreign learner accepted';
 exception when raise_exception then if sqlerrm not like 'All attendees must belong%' then raise;end if;end;
 begin perform public.review_training_evidence(a,'reviewed','Fictional review');raise exception 'unassessed evidence reviewed';
 exception when raise_exception then if sqlerrm not like 'Record the outcome%' then raise;end if;end;
 update public.training_followup set passed=true,certificate='FICTIONAL-EVIDENCE',expiry_date=current_date+30 where id=a;
 perform public.review_training_evidence(a,'reviewed','Fictional reviewed evidence');
 if (select evidence_review_status from public.training_followup where id=a)<>'reviewed' then raise exception 'explicit review was not retained';end if;
 if exists(select 1 from public.competency_matrix where person_id='d1800000-0000-4000-8000-000000000031') then raise exception 'evidence review automatically changed competency';end if;
 insert into public.competency_matrix(company_id,person_id,competency_id,current_level,required_level,supporting_training_id) values('d1800000-0000-4000-8000-000000000010','d1800000-0000-4000-8000-000000000031','d1800000-0000-4000-8000-000000000050',2,3,a);
 begin insert into public.competency_matrix(company_id,person_id,competency_id,current_level,supporting_training_id) values('d1800000-0000-4000-8000-000000000010','d1800000-0000-4000-8000-000000000032','d1800000-0000-4000-8000-000000000050',2,a);raise exception 'another learner evidence accepted';
 exception when raise_exception then if sqlerrm not like 'Select current, reviewed, passed evidence%' then raise;end if;end;
 update public.training_followup set certificate='CHANGED-FICTIONAL-EVIDENCE' where id=a;
 if (select evidence_review_status from public.training_followup where id=a)<>'pending' then raise exception 'changed evidence retained its review';end if;
 begin update public.competency_matrix set current_level=3 where supporting_training_id=a;raise exception 'unreviewed changed evidence accepted';
 exception when raise_exception then if sqlerrm not like 'Select current, reviewed, passed evidence%' then raise;end if;end;
 insert into public.induction_records(company_id,person_name) values('d1800000-0000-4000-8000-000000000010','Fictional induction');
 if not exists(select 1 from public.induction_records where person_name='Fictional induction' and status='in_progress' and passed is null and completed=false) then raise exception 'induction started completed';end if;
 begin insert into public.induction_records(company_id,person_name,status,completed) values('d1800000-0000-4000-8000-000000000010','Fictional empty induction','completed',true);raise exception 'empty induction completed';
 exception when raise_exception then if sqlerrm not like 'Confirm the induction checklist%' then raise;end if;end;
end $$;
reset role;
rollback;
