-- All data is fictional and rolled back; no delivery worker is invoked.
begin;
insert into auth.users(id) values('ac180000-0000-4000-8000-000000000001');
insert into public.companies(id,name) values('ac180000-0000-4000-8000-000000000010','Closure fixture A'),('ac180000-0000-4000-8000-000000000020','Closure fixture B');
insert into public.profiles(id,company_id,full_name,role,status) values('ac180000-0000-4000-8000-000000000001','ac180000-0000-4000-8000-000000000010','Fictional closure reviewer','admin','active');
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
insert into public.action_tracker(id,company_id,description,status,progress_pct,evidence,requires_verification,verification_status,closure_notes)
values('ac180000-0000-4000-8000-000000000030','ac180000-0000-4000-8000-000000000010','Fictional closure test','pending_closure',100,'Controlled test evidence',true,'passed','Reviewed completion');
insert into public.action_tracker(id,company_id,description,status) values('ac180000-0000-4000-8000-000000000031','ac180000-0000-4000-8000-000000000020','Unrelated foreign action','open');
-- Noise in another tenant must neither be scanned globally nor modified.
insert into public.notification_queue(company_id,type,subject,body_html,to_email,metadata,related_module,related_table,related_id,related_ref)
select 'ac180000-0000-4000-8000-000000000020','acknowledgement_reminder','Fixture','Not sent','fixture@example.invalid',jsonb_build_object('parent_user_notification_id',gen_random_uuid()),'actions','action_tracker','ac180000-0000-4000-8000-000000000031','MAP-FOREIGN' from generate_series(1,12000);
insert into public.notification_queue(id,company_id,type,subject,body_html,to_email,related_table,related_id,status,related_module,related_ref)
values('ac180000-0000-4000-8000-000000000040','ac180000-0000-4000-8000-000000000010','action','Fixture','Not sent','fixture@example.invalid','action_tracker','ac180000-0000-4000-8000-000000000030','sent','actions','MAP-FIXTURE');
insert into public.user_notifications(id,company_id,recipient_profile_id,source_notification_id,title,related_table,related_id)
values('ac180000-0000-4000-8000-000000000050','ac180000-0000-4000-8000-000000000010','ac180000-0000-4000-8000-000000000001','ac180000-0000-4000-8000-000000000040','Fixture','action_tracker','ac180000-0000-4000-8000-000000000030');
insert into public.notification_queue(id,company_id,type,subject,body_html,to_email,metadata,related_module,related_table,related_id,related_ref)
values('ac180000-0000-4000-8000-000000000060','ac180000-0000-4000-8000-000000000010','acknowledgement_reminder','Fixture','Not sent','fixture@example.invalid','{"parent_user_notification_id":"ac180000-0000-4000-8000-000000000050"}','actions','action_tracker','ac180000-0000-4000-8000-000000000030','MAP-FIXTURE');
-- A foreign-company follow-up forged with the same parent is still untouched.
insert into public.notification_queue(id,company_id,type,subject,body_html,to_email,metadata,related_module,related_table,related_id,related_ref)
values('ac180000-0000-4000-8000-000000000061','ac180000-0000-4000-8000-000000000020','acknowledgement_reminder','Fixture','Not sent','fixture@example.invalid','{"parent_user_notification_id":"ac180000-0000-4000-8000-000000000050"}','actions','action_tracker','ac180000-0000-4000-8000-000000000031','MAP-FOREIGN');

select set_config('request.jwt.claim.sub','ac180000-0000-4000-8000-000000000001',true);

do $$declare checks jsonb:='{}'; n integer;begin
 for n in 1..6 loop checks:=checks||jsonb_build_object(n::text,jsonb_build_object('confirmed',true));end loop;
 begin update public.action_tracker set status='closed' where id='ac180000-0000-4000-8000-000000000030';raise exception 'Empty confirmations accepted';exception when raise_exception then if sqlerrm not like 'Closure confirmation %' then raise;end if;end;
 begin update public.action_tracker set status='closed',closure_checklist='{"4":{"confirmed":true},"5":{"confirmed":true},"6":{"confirmed":true}}' where id='ac180000-0000-4000-8000-000000000030';raise exception 'Arbitrary three confirmations accepted';exception when raise_exception then if sqlerrm not like 'Closure confirmation %' then raise;end if;end;
 begin update public.action_tracker set status='closed',progress_pct=99,closure_checklist=checks where id='ac180000-0000-4000-8000-000000000030';raise exception 'Incomplete work accepted';exception when raise_exception then if sqlerrm not like 'Closure requires%' then raise;end if;end;
 begin update public.action_tracker set status='closed',requires_verification=false,closure_checklist=checks where id='ac180000-0000-4000-8000-000000000030';raise exception 'Verification bypass accepted';exception when raise_exception then if sqlerrm not like 'Complete the required verification%' then raise;end if;end;
 checks:=jsonb_set(checks,'{4}','{"not_applicable":true,"reason":""}');
 begin update public.action_tracker set status='closed',closure_checklist=checks where id='ac180000-0000-4000-8000-000000000030';raise exception 'Unjustified N/A accepted';exception when raise_exception then if sqlerrm not like 'Closure confirmation %' then raise;end if;end;
 update public.action_tracker set closure_checklist=checks where id='ac180000-0000-4000-8000-000000000030';
 if exists(select 1 from public.map_activity_log where action_id='ac180000-0000-4000-8000-000000000030') then raise exception 'Failed closure left partial history';end if;
 if (select status from public.notification_queue where id='ac180000-0000-4000-8000-000000000060')<>'pending' then raise exception 'Failed closure stopped notifications';end if;
end $$;
-- Authenticated caller exercises real RLS and the guard. Do not widen production grants.
grant usage on schema public,auth to authenticated;
grant select on public.profiles to authenticated;
grant select,update on public.action_tracker to authenticated;
set local role authenticated;
set local statement_timeout='3s';
update public.action_tracker set status='closed',closure_approved_by='Spoofed',closure_checklist=jsonb_set(closure_checklist,'{4}','{"not_applicable":true,"reason":"No root cause applies to this improvement"}') where id='ac180000-0000-4000-8000-000000000030';
-- Unchanged retry cannot duplicate the committed closure entry.
update public.action_tracker set status='closed' where id='ac180000-0000-4000-8000-000000000030';
reset role;
set local statement_timeout=0;
do $$begin
 if (select count(*) from public.map_activity_log where action_id='ac180000-0000-4000-8000-000000000030')<>1 then raise exception 'Closure history missing or duplicated';end if;
 if (select closure_approved_by from public.action_tracker where id='ac180000-0000-4000-8000-000000000030')<>'Fictional closure reviewer' then raise exception 'Closure actor was not authenticated';end if;
 if (select status from public.notification_queue where id='ac180000-0000-4000-8000-000000000060')<>'skipped' then raise exception 'Action follow-up not stopped';end if;
 if exists(select 1 from public.notification_queue where company_id='ac180000-0000-4000-8000-000000000020' and status<>'pending') then raise exception 'Foreign notifications modified';end if;
 if (select dismissed_at from public.user_notifications where id='ac180000-0000-4000-8000-000000000050') is null then raise exception 'Action inbox not dismissed';end if;
end $$;
rollback;
