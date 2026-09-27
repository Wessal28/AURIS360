-- Local replay only. Fixtures, temporary routines and grants are rolled back.
begin;
set local row_security=on;
create or replace function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
insert into auth.users(id) values ('a0000000-0000-4000-8000-000000000001');
insert into public.companies(id,name) values ('a0000000-0000-4000-8000-000000000002','User access replay fixture');
insert into public.profiles(id,company_id,role,status,permissions) values
 ('a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','admin','active',
 '{"access_v1":{"people":{"view":true,"create":false,"edit":false,"delete":false},"settings":{"view":false}}}');
insert into public.people(id,company_id,first_name,last_name) values
 ('a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000002','Access','Fixture');
grant usage on schema public,auth to authenticated;
grant select,insert,update,delete on public.people,public.profiles to authenticated;
grant execute on function auth.uid() to authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ declare affected integer; begin
 if not public.user_access_allowed('people','view') then raise exception 'Read-only view was denied'; end if;
 if public.user_access_allowed('people','edit') then raise exception 'Read-only edit was allowed'; end if;
 if public.user_access_allowed('settings.company','view') then raise exception 'Settings parent restriction was ignored'; end if;
 if (select count(*) from public.people where id='a0000000-0000-4000-8000-000000000003')<>1 then raise exception 'Read-only record was hidden'; end if;
 begin
   insert into public.people(company_id,first_name,last_name) values ('a0000000-0000-4000-8000-000000000002','Unauthorised','Create');
   raise exception 'Denied insert succeeded';
 exception when insufficient_privilege then null; end;
 update public.people set job_title='Unauthorised' where id='a0000000-0000-4000-8000-000000000003';
 get diagnostics affected=row_count;
 if affected<>0 then
   raise exception 'Denied update changed a row';
 end if;
 begin
   update public.profiles set permissions='{}' where id=auth.uid();
   get diagnostics affected=row_count;
   if affected<>0 then raise exception 'User removed their own access restrictions';end if;
 exception when insufficient_privilege then null; end;
 begin
   update public.profiles set role='sephs_admin' where id=auth.uid();
   get diagnostics affected=row_count;
   if affected<>0 then raise exception 'User elevated their own role';end if;
 exception when insufficient_privilege then null; end;
end $$;
reset role;
create function public.qa_self_permissions() returns void language sql security definer as $$update public.profiles set permissions='{}' where id=auth.uid()$$;
do $$ begin
 begin perform public.qa_self_permissions();raise exception 'SECURITY DEFINER removed own restrictions';
 exception when insufficient_privilege then null;end;
end $$;
-- SECURITY DEFINER still retains the session identity; write triggers must stop it.
create function public.qa_write_person() returns void language sql security definer as $$
 update public.people set job_title='Bypass attempt' where id='a0000000-0000-4000-8000-000000000003'
$$;
do $$ begin
 begin perform public.qa_write_person();raise exception 'SECURITY DEFINER write bypassed access';
 exception when insufficient_privilege then null; end;
end $$;
-- Prepare hidden module with a maintenance identity, then restore the user.
select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"people":{"view":false}}}' where id='a0000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.people where id='a0000000-0000-4000-8000-000000000003') then raise exception 'Hidden module leaked a record';end if;
end $$;
reset role;
create function public.qa_read_people() returns bigint language sql security definer as $$select count(*) from public.people$$;
create function public.qa_nested_read_people() returns bigint language sql security definer as $$select public.qa_read_people()$$;
select set_config('request.path','/rpc/qa_nested_read_people',true);
do $$ begin
 begin perform public.user_access_preflight();raise exception 'Read RPC bypassed a hidden module';
 exception when insufficient_privilege then null;end;
end $$;

select set_config('request.jwt.claim.sub','',true);
update public.profiles set permissions='{"access_v1":{"ppe.issuance":{"view":false},"ppe":{"edit":false}}}' where id='a0000000-0000-4000-8000-000000000001';
insert into public.ppe_issuance(company_id,ppe_name,employee_name,issued_date) values ('a0000000-0000-4000-8000-000000000002','Helmet','Access Fixture',current_date);
grant select,insert,update,delete on public.ppe_issuance to authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$begin
 if exists(select 1 from public.ppe_issuance where company_id='a0000000-0000-4000-8000-000000000002') then raise exception 'Hidden issuance records disclosed';end if;
 if public.user_access_allowed('ppe.issuance','view') then raise exception 'Hidden section granted';end if;
 if public.user_access_allowed('ppe.catalogue','edit') then raise exception 'Parent action restriction bypassed';end if;
 if not public.user_access_allowed('ppe.catalogue','view') then raise exception 'Unrelated section blocked';end if;
end $$;
rollback;
