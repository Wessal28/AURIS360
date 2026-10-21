-- Disposable PostgreSQL replay only. No account invitation is sent. All data,
-- grants and fixture changes roll back; auth.users here contains only IDs.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
insert into auth.users(id) select ('c2100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,30) n;
insert into public.companies(id,name) values
 ('c2100000-0000-4000-8000-000000000100','Fictional linking company A'),
 ('c2100000-0000-4000-8000-000000000200','Fictional linking company B');
insert into public.profiles(id,company_id,full_name,email,phone,role,status,synthetic_email,permissions) values
 ('c2100000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000100','Fictional Admin','admin@linking.test',null,'admin','active',false,'{}'),
 ('c2100000-0000-4000-8000-000000000002',null,'Fictional SEPHS Admin','sephs@linking.test',null,'sephs_admin','active',false,'{}'),
 ('c2100000-0000-4000-8000-000000000003','c2100000-0000-4000-8000-000000000100','Fictional Worker','worker@linking.test',null,'employee','active',false,'{}'),
 ('c2100000-0000-4000-8000-000000000004','c2100000-0000-4000-8000-000000000100','Inactive Admin','inactive-admin@linking.test',null,'admin','inactive',false,'{}'),
 ('c2100000-0000-4000-8000-000000000005','c2100000-0000-4000-8000-000000000100','Restricted Admin','restricted@linking.test',null,'admin','active',false,'{}'),
 ('c2100000-0000-4000-8000-000000000020','c2100000-0000-4000-8000-000000000100','Existing Manager','existing.manager@linking.test',null,'manager','inactive',false,'{"retained":true}'),
 ('c2100000-0000-4000-8000-000000000021','c2100000-0000-4000-8000-000000000100','Legacy Login','retry@users.local','+23058882222','employee','active',true,'{}'),
 ('c2100000-0000-4000-8000-000000000022','c2100000-0000-4000-8000-000000000100','Existing Occupied','occupied-account@linking.test',null,'employee','active',false,'{}'),
 ('c2100000-0000-4000-8000-000000000023','c2100000-0000-4000-8000-000000000200','Private Foreign User','foreign-account@linking.test',null,'employee','active',false,'{}'),
 ('c2100000-0000-4000-8000-000000000024','c2100000-0000-4000-8000-000000000100','Duplicate Contact One','contact-one@linking.test','+23057773333','employee','active',false,'{}'),
 ('c2100000-0000-4000-8000-000000000025','c2100000-0000-4000-8000-000000000100','Duplicate Contact Two','contact-two@linking.test','+230 5777 3333','employee','active',false,'{}');
insert into public.people(id,company_id,first_name,last_name,email,phone,employee_number,job_title,status) values
 ('c2100000-0000-4000-8000-000000000300','c2100000-0000-4000-8000-000000000100','Manual','Worker','  Manual.Worker@linking.test ',null,'KEEP-001','Retain existing title','active'),
 ('c2100000-0000-4000-8000-000000000301','c2100000-0000-4000-8000-000000000100','Phone','Worker',null,'+230 (5888) 1111','KEEP-002','Retain phone worker','active'),
 ('c2100000-0000-4000-8000-000000000302','c2100000-0000-4000-8000-000000000100','Email','Conflict','email-conflict@linking.test',null,null,null,'active'),
 ('c2100000-0000-4000-8000-000000000303','c2100000-0000-4000-8000-000000000100','Phone','Conflict',null,'+23059990000',null,null,'active'),
 ('c2100000-0000-4000-8000-000000000304','c2100000-0000-4000-8000-000000000100','Same','Name',null,null,'NAME-ONLY',null,'active'),
 ('c2100000-0000-4000-8000-000000000305','c2100000-0000-4000-8000-000000000100','Explicit','Selection',null,null,'KEEP-003','Manual records retained','active'),
 ('c2100000-0000-4000-8000-000000000306','c2100000-0000-4000-8000-000000000100','Inactive','Manager','existing.manager@linking.test',null,'KEEP-004',null,'inactive'),
 ('c2100000-0000-4000-8000-000000000307','c2100000-0000-4000-8000-000000000200','Private','Foreign','foreign-person@linking.test',null,null,null,'active'),
 ('c2100000-0000-4000-8000-000000000308','c2100000-0000-4000-8000-000000000100','Already','Occupied','occupied-person@linking.test',null,null,null,'active'),
 ('c2100000-0000-4000-8000-000000000309','c2100000-0000-4000-8000-000000000100','Inactive','Unlinked','inactive-person@linking.test',null,null,null,'inactive');
update public.profiles set person_id='c2100000-0000-4000-8000-000000000308' where id='c2100000-0000-4000-8000-000000000022';

do $$
declare actor uuid:='c2100000-0000-4000-8000-000000000001'; company uuid:='c2100000-0000-4000-8000-000000000100';
  result jsonb; payload jsonb; before_person jsonb; people_count integer; audit_count integer; new_person uuid;
begin
  if public.user_person_email_key(' A.User@Example.test ')<>'a.user@example.test'
    or public.user_person_email_key('phone@users.local') is not null
    or public.user_person_email_key('not email') is not null
    or public.user_person_phone_key('+230 (5888) 1111')<>'+23058881111'
    or public.user_person_phone_key('58881111') is not null
  then raise exception 'Identity normalization guessed or lost contact information';end if;
  if has_function_privilege('anon','public.admin_link_user_person(uuid,uuid,uuid,jsonb,uuid,boolean,boolean)','execute')
    or has_function_privilege('authenticated','public.admin_link_user_person(uuid,uuid,uuid,jsonb,uuid,boolean,boolean)','execute')
    or not has_function_privilege('service_role','public.admin_link_user_person(uuid,uuid,uuid,jsonb,uuid,boolean,boolean)','execute')
  then raise exception 'User/People provisioning must remain service-only';end if;

  select to_jsonb(p) into before_person from public.people p where id='c2100000-0000-4000-8000-000000000300';
  select count(*) into people_count from public.people;select count(*) into audit_count from public.person_identity_decisions;
  payload:='{"full_name":"New Login Display Name","email":"manual.worker@linking.test","role":"employee","job_title":"Do not replace manual title"}';
  result:=public.admin_link_user_person(actor,company,null,payload,null,true,false);
  if result->>'ok'<>'true' or result->>'person_id'<>'c2100000-0000-4000-8000-000000000300' or result->>'user_id' is not null
    or (select count(*) from public.people)<>people_count or (select count(*) from public.person_identity_decisions)<>audit_count
  then raise exception 'Preview did not identify the manual person without writes';end if;
  result:=public.admin_link_user_person(actor,company,'c2100000-0000-4000-8000-000000000010',payload,null,false,false);
  if result->>'ok'<>'true' or result->>'person_created'<>'false'
    or (select person_id from public.profiles where id='c2100000-0000-4000-8000-000000000010')<>'c2100000-0000-4000-8000-000000000300'
    or (select to_jsonb(p) from public.people p where id='c2100000-0000-4000-8000-000000000300') is distinct from before_person
  then raise exception 'User creation duplicated or modified manually entered People';end if;
  select count(*) into audit_count from public.person_identity_decisions;
  result:=public.admin_link_user_person(actor,company,'c2100000-0000-4000-8000-000000000010',payload,null,false,false);
  if result->>'ok'<>'true' or (select count(*) from public.person_identity_decisions)<>audit_count or (select count(*) from public.people)<>people_count
  then raise exception 'A repeated link duplicated People or its decision history';end if;
  result:=public.admin_link_user_person(actor,company,'c2100000-0000-4000-8000-000000000010',payload,'c2100000-0000-4000-8000-000000000305',false,false);
  if result->>'code'<>'identity_conflict' then raise exception 'An authoritative user/person link was reassigned';end if;

  result:=public.admin_link_user_person(actor,company,'c2100000-0000-4000-8000-000000000011','{"full_name":"Phone Login","email":"phone-login@users.local","synthetic_email":true,"phone":"+230 5888 1111","role":"employee"}',null,false,false);
  if result->>'ok'<>'true' or result->>'person_id'<>'c2100000-0000-4000-8000-000000000301' then raise exception 'Canonical E164 phone did not reuse the manual person';end if;

  payload:='{"full_name":"Entirely New Worker","email":"new.worker@linking.test","phone":"+23056661234","role":"employee","department":"Operations"}';
  result:=public.admin_link_user_person(actor,company,null,payload,null,true,false);
  if result->>'ok'<>'true' or result->>'will_create_person'<>'true' then raise exception 'A new identity could not be previewed';end if;
  result:=public.admin_link_user_person(actor,company,'c2100000-0000-4000-8000-000000000012',payload,null,false,false);new_person:=(result->>'person_id')::uuid;
  if result->>'ok'<>'true' or result->>'person_created'<>'true'
    or not exists(select 1 from public.people where id=new_person and company_id=company and first_name='Entirely' and last_name='New Worker' and department='Operations')
  then raise exception 'New user and People identity did not save together';end if;

  payload:='{"full_name":"Same Name","email":"same-name-new@linking.test","role":"employee"}';
  result:=public.admin_link_user_person(actor,company,'c2100000-0000-4000-8000-000000000013',payload,null,false,false);
  if result->>'code'<>'person_match_required' or jsonb_array_length(result->'candidates')<>1
    or exists(select 1 from public.profiles where id='c2100000-0000-4000-8000-000000000013')
  then raise exception 'A name-only match linked or wrote an identity without confirmation';end if;
  result:=public.admin_link_user_person(actor,company,'c2100000-0000-4000-8000-000000000013',payload,null,false,true);
  if result->>'ok'<>'true' or result->>'person_id'='c2100000-0000-4000-8000-000000000304' then raise exception 'Explicit new-person confirmation reused an unverified name';end if;

  select count(*) into people_count from public.people;
  result:=public.admin_link_user_person(actor,company,'c2100000-0000-4000-8000-000000000014','{"full_name":"Conflicting Contacts","email":"email-conflict@linking.test","phone":"+23059990000"}',null,false,true);
  if result->>'code'<>'identity_conflict' or jsonb_array_length(result->'candidates')<>2 or (select count(*) from public.people)<>people_count
    or exists(select 1 from public.profiles where id='c2100000-0000-4000-8000-000000000014')
  then raise exception 'Conflicting email and phone matches were silently combined';end if;

  select to_jsonb(p) into before_person from public.people p where id='c2100000-0000-4000-8000-000000000305';
  result:=public.admin_link_user_person(actor,company,'c2100000-0000-4000-8000-000000000015','{"full_name":"Explicit Selection","email":"selected@linking.test","role":"employee"}','c2100000-0000-4000-8000-000000000305',false,false);
  if result->>'ok'<>'true' or result->>'person_created'<>'false'
    or (select to_jsonb(p) from public.people p where id='c2100000-0000-4000-8000-000000000305') is distinct from before_person
  then raise exception 'Explicit selection changed manually recorded People details';end if;

  result:=public.admin_link_user_person(actor,company,'c2100000-0000-4000-8000-000000000020','{"full_name":"Overwrite attempt","role":"admin","status":"active","email":"existing.manager@linking.test"}',null,false,false);
  if result->>'ok'<>'true' or result->>'user_status'<>'inactive' or result->>'person_status'<>'inactive'
    or not exists(select 1 from public.profiles where id='c2100000-0000-4000-8000-000000000020' and role='manager' and status='inactive' and permissions='{"retained":true}'::jsonb)
  then raise exception 'Reconciliation changed an existing role, permissions or inactive status';end if;
  result:=public.admin_link_user_person(actor,company,null,'{"full_name":"Inactive Unlinked","email":"inactive-person@linking.test"}',null,true,false);
  if result->>'code'<>'identity_conflict' then raise exception 'An inactive Person could receive a new login from preview';end if;
  insert into public.profiles(id,company_id,full_name,email,role,status) values
    ('c2100000-0000-4000-8000-000000000017',company,'Inactive Unlinked','inactive-person@linking.test','employee','active');
  result:=public.admin_link_user_person(actor,company,'c2100000-0000-4000-8000-000000000017','{"full_name":"Inactive Unlinked","email":"inactive-person@linking.test","_new_account":true}',null,false,false);
  if result->>'code'<>'identity_conflict' or (select person_id from public.profiles where id='c2100000-0000-4000-8000-000000000017') is not null
  then raise exception 'Commit created access after the selected Person became inactive';end if;

  result:=public.admin_link_user_person(actor,company,null,'{"full_name":"Ignored new name","email":"RETRY@users.local","synthetic_email":true}',null,true,false);
  if result->>'ok'<>'true' or result->>'user_id'<>'c2100000-0000-4000-8000-000000000021' then raise exception 'A synthetic login retry did not resolve its existing account';end if;
  result:=public.admin_link_user_person(actor,company,null,'{"email":"occupied-person@linking.test"}',null,true,false);
  if result->>'ok'<>'true' or result->>'user_id'<>'c2100000-0000-4000-8000-000000000022' then raise exception 'A matched Person did not resolve their existing user account';end if;
  result:=public.admin_link_user_person(actor,company,null,'{"email":"foreign-account@linking.test","full_name":"Foreign Attempt"}',null,true,false);
  if result->>'code'<>'identity_conflict' or result->'candidates'<>'[]'::jsonb or result::text like '%Private Foreign%'
  then raise exception 'Cross-company account conflict leaked private candidates or linked users';end if;
  result:=public.admin_link_user_person(actor,company,null,'{"phone":"+23057773333","full_name":"Duplicate Contacts"}',null,true,false);
  if result->>'code'<>'identity_conflict' then raise exception 'Multiple normalized user contact matches were accepted';end if;
  result:=public.admin_link_user_person(actor,company,'c2100000-0000-4000-8000-000000000016','{"full_name":"Fictional HSE Officer","email":"officer@linking.test","role":"hse_officer"}',null,false,false);
  if result->>'ok'<>'true' or not exists(select 1 from public.profiles where id='c2100000-0000-4000-8000-000000000016' and role='hse_officer' and person_id is not null)
  then raise exception 'The supported HSE Officer role could not be provisioned';end if;
  begin
    perform public.admin_link_user_person(actor,company,null,'{}','c2100000-0000-4000-8000-000000000307',true,false);
    raise exception 'A foreign explicit Person was accepted';
  exception when insufficient_privilege then null;end;
end $$;

-- Verify actual service execution and deny direct authenticated/anonymous RPCs.
set local role service_role;
do $$declare result jsonb;begin
  result:=public.admin_link_user_person('c2100000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000100',null,'{"email":"new.worker@linking.test"}',null,true,false);
  if result->>'ok'<>'true' or result->>'user_id'<>'c2100000-0000-4000-8000-000000000012' then raise exception 'Service-role provisioning could not resolve the saved user';end if;
end $$;
reset role;
set local role authenticated;
do $$begin
  begin
    perform public.admin_link_user_person('c2100000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000100',null,'{}',null,true,false);
    raise exception 'An authenticated caller invoked service-only provisioning';
  exception when insufficient_privilege then null;end;
end $$;
reset role;

do $$declare denied_actor uuid; result jsonb;begin
  foreach denied_actor in array array['c2100000-0000-4000-8000-000000000003'::uuid,'c2100000-0000-4000-8000-000000000004'::uuid] loop
    begin
      perform public.admin_link_user_person(denied_actor,'c2100000-0000-4000-8000-000000000100',null,'{}',null,true,false);
      raise exception 'An inactive or non-admin actor provisioned a user';
    exception when insufficient_privilege then null;end;
  end loop;
  begin
    perform public.admin_link_user_person('c2100000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000200',null,'{}',null,true,false);
    raise exception 'An administrator provisioned outside their company';
  exception when insufficient_privilege then null;end;
  update public.profiles set permissions='{"access_v1":{"users":{"create":false}}}' where id='c2100000-0000-4000-8000-000000000005';
  begin
    perform public.admin_link_user_person('c2100000-0000-4000-8000-000000000005','c2100000-0000-4000-8000-000000000100',null,'{"email":"denied@linking.test","full_name":"Denied New User"}',null,true,false);
    raise exception 'User creation permission was bypassed';
  exception when insufficient_privilege then null;end;
  update public.profiles set permissions='{"access_v1":{"people":{"create":false}}}' where id='c2100000-0000-4000-8000-000000000005';
  begin
    perform public.admin_link_user_person('c2100000-0000-4000-8000-000000000005','c2100000-0000-4000-8000-000000000100',null,'{"email":"denied@linking.test","full_name":"Denied New User"}',null,true,false);
    raise exception 'People creation permission was bypassed';
  exception when insufficient_privilege then null;end;
  -- A just-created Auth profile already has metadata role/status. The trusted
  -- server marker permits creation without granting later account edit rights.
  update public.profiles set permissions='{"access_v1":{"users":{"create":true,"edit":false}}}' where id='c2100000-0000-4000-8000-000000000005';
  insert into public.profiles(id,company_id,full_name,email,role,status,permissions) values
    ('c2100000-0000-4000-8000-000000000018','c2100000-0000-4000-8000-000000000100','Auth Trigger User','auth-trigger@linking.test','employee','active','{"keep":true}');
  result:=public.admin_link_user_person('c2100000-0000-4000-8000-000000000005','c2100000-0000-4000-8000-000000000100','c2100000-0000-4000-8000-000000000018',
    '{"full_name":"Auth Trigger User","email":"auth-trigger@linking.test","role":"admin","status":"inactive","_new_account":true}',null,false,false);
  if result->>'ok'<>'true' or not exists(select 1 from public.profiles where id='c2100000-0000-4000-8000-000000000018' and role='employee' and status='active' and permissions='{"keep":true}'::jsonb and person_id is not null)
  then raise exception 'Create-only provisioning changed Auth metadata or could not finalize its new account';end if;
  begin
    perform public.admin_link_user_person('c2100000-0000-4000-8000-000000000005','c2100000-0000-4000-8000-000000000100','c2100000-0000-4000-8000-000000000020','{}',null,true,false);
    raise exception 'Create-only administrator edited an existing account';
  exception when insufficient_privilege then null;end;
  begin
    update public.profiles set person_id='c2100000-0000-4000-8000-000000000307' where id='c2100000-0000-4000-8000-000000000010';
    raise exception 'The company link guard allowed a foreign Person';
  exception when check_violation then null;end;
  begin
    update public.people set company_id='c2100000-0000-4000-8000-000000000200' where id='c2100000-0000-4000-8000-000000000300';
    raise exception 'A linked person moved outside their user company';
  exception when check_violation then null;end;
  begin
    insert into public.profiles(id,company_id,person_id,role,status) values('c2100000-0000-4000-8000-000000000019','c2100000-0000-4000-8000-000000000100','c2100000-0000-4000-8000-000000000300','employee','active');
    raise exception 'One person acquired two different user accounts';
  exception when unique_violation then null;end;
end $$;
rollback;
