-- Runs only on disposable migration replay. All fixtures roll back.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$ select 'a1800000-0000-4000-8000-000000000001'::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
insert into auth.users(id) values ('a1800000-0000-4000-8000-000000000001');
insert into public.companies(id,name) values ('a1800000-0000-4000-8000-000000000010','Noise fixture A'),('a1800000-0000-4000-8000-000000000020','Noise fixture B');
insert into public.profiles(id,company_id,role,status,full_name) values ('a1800000-0000-4000-8000-000000000001','a1800000-0000-4000-8000-000000000010','admin','active','Noise test manager');
do $$ declare c uuid:='a1800000-0000-4000-8000-000000000010'; pr text; m text; a text; report text; rev public.noise_mgmt_exposure_assessments; snapshot jsonb; begin
 insert into public.noise_mgmt_exposure_assessments(company_id,code,subject_type,subject_name,profile_name,status)
 values(c,'TEST-NOISE-PENDING','area','Fictional fixture','Unconfirmed','draft') returning id into a;
 begin
   update public.noise_mgmt_exposure_assessments set status='approved',data_quality_status='acceptable',duration_confirmed=true where id=a;
   raise exception 'incomplete approval accepted';
 exception when raise_exception then if sqlerrm not like 'Select a published assessment profile%' then raise;end if;end;
 if (select status from public.noise_mgmt_exposure_assessments where id=a)<>'draft' then raise exception 'draft was lost';end if;
 insert into public.noise_mgmt_assessment_profiles(company_id,code,name,scope,effective_from,reference_duration_hours,bands_json,status)
 values(c,'TEST-PROFILE','Fictional profile','Disposable tests only','2026-01-01',8,
 '[{"code":"below_action","min":null,"max":80},{"code":"above_action","min":80,"max":85},{"code":"above_limit","min":85,"max":null}]','published') returning id into pr;
 insert into public.noise_mgmt_instruments(id,company_id,asset_code,equipment_type,serial_number,calibration_date,calibration_due_date,calibration_certificate,status)
 values('noise-fixture-instrument',c,'TEST-SLM','sound_level_meter','TEST-SERIAL','2026-01-01','2026-12-31','Fictional replay certificate','available');
 insert into public.noise_mgmt_measurements(company_id,code,measurement_type,subject_type,subject_name,measurement_date,descriptor,raw_value,unit,valid_duration_minutes,instrument_id,data_quality_status,status)
 values(c,'TEST-MEASURE','area_task','area','Fictional fixture','2026-10-17','LAeq',85,'dB(A)',240,'noise-fixture-instrument','acceptable','accepted') returning id into m;
 begin
   update public.noise_mgmt_exposure_assessments set profile_id=pr,assessment_date='2026-10-18',source_measurement_versions=jsonb_build_array(jsonb_build_object('id',m,'version_no',2)),duration_confirmed=true,data_quality_status='acceptable',status='approved' where id=a;
   raise exception 'wrong source version approved';
 exception when raise_exception then if sqlerrm not like 'A linked measurement is unavailable%' then raise;end if;end;
 update public.noise_mgmt_exposure_assessments set profile_id=pr,assessment_date='2026-10-18',source_measurement_versions=jsonb_build_array(jsonb_build_object('id',m,'version_no',1)),duration_confirmed=true,data_quality_status='acceptable',status='approved',result_value=999,classification='below_action' where id=a;
 if (select result_value from public.noise_mgmt_exposure_assessments where id=a)<>81.99 then raise exception 'database did not recompute the result';end if;
 if (select classification from public.noise_mgmt_exposure_assessments where id=a)<>'above_action' then raise exception 'profile classification incorrect';end if;
 select to_jsonb(x) into snapshot from public.noise_mgmt_exposure_assessments x where id=a;
 begin
   update public.noise_mgmt_exposure_assessments set status='draft' where id=a;
   raise exception 'approved assessment changed';
 exception when raise_exception then if sqlerrm not like 'This approved or accepted version is immutable%' then raise;end if;end;
 select * into rev from public.noise_create_assessment_revision(a,'Correct fictional subject notes');
 if rev.status<>'draft' or rev.version_no<>2 or rev.supersedes_id<>a or rev.approved_at is not null then raise exception 'revision did not preserve the approval boundary';end if;
 if snapshot is distinct from (select to_jsonb(x) from public.noise_mgmt_exposure_assessments x where id=a) then raise exception 'revision altered the approved version';end if;
 begin
   update public.noise_mgmt_measurements set raw_value=20 where id=m;
   raise exception 'accepted measurement changed';
 exception when raise_exception then if sqlerrm not like 'This approved or accepted version is immutable%' then raise;end if;end;
 begin
   perform public.noise_assessment_evidence('a1800000-0000-4000-8000-000000000020',pr,jsonb_build_array(jsonb_build_object('id',m,'version_no',1)),'2026-10-18','area',null,'Fictional fixture');
   raise exception 'foreign profile approved';
 exception when raise_exception then if sqlerrm not like 'Select a published assessment profile%' then raise;end if;end;
 insert into public.noise_mgmt_reports(company_id,code,name,report_type,data_as_of,source_versions,status)
 values(c,'TEST-REPORT','Fictional noise report','personal','2026-10-18',jsonb_build_array(jsonb_build_object('table','noise_mgmt_exposure_assessments','id',a,'version_no',1)),'draft') returning id into report;
 update public.noise_mgmt_reports set generated_at=now() where id=report;
 if (select jsonb_array_length(report_snapshot->'sources') from public.noise_mgmt_reports where id=report)<>1 then raise exception 'report source snapshot missing';end if;
 update public.noise_mgmt_reports set status='approved',approver_id=auth.uid() where id=report;
 update public.noise_mgmt_reports set status='issued' where id=report;
 begin
   update public.noise_mgmt_reports set report_snapshot='{}' where id=report;
   raise exception 'issued report changed';
 exception when raise_exception then if sqlerrm not like 'This approved or accepted version is immutable%' then raise;end if;end;
 if not exists(select 1 from public.noise_mgmt_audit_events where entity_id=a and action='update' and after_json->>'status'='approved') then raise exception 'approval audit missing';end if;
end $$;
rollback;
