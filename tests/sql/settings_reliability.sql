begin;
insert into auth.users(id) values('50200000-0000-4000-8000-000000000001'),('50200000-0000-4000-8000-000000000002');
insert into public.companies(id,name) values('50200000-0000-4000-8000-000000000010','Fictional settings company'),('50200000-0000-4000-8000-000000000011','Other settings company');
insert into public.profiles(id,company_id,full_name,role,status) values
 ('50200000-0000-4000-8000-000000000001','50200000-0000-4000-8000-000000000010','Fictional settings admin','admin','active'),
 ('50200000-0000-4000-8000-000000000002','50200000-0000-4000-8000-000000000010','Fictional settings employee','employee','active');
create or replace function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('settings.fixture_actor',true),''),'50200000-0000-4000-8000-000000000001')::uuid$$;
grant usage on schema public,auth to authenticated;
grant select on public.profiles,public.approval_workflows,public.approval_workflow_steps,public.notification_user_preferences to authenticated;
set local role authenticated;
do $$declare company uuid:='50200000-0000-4000-8000-000000000010'; w public.approval_workflows; before_save timestamptz; stages jsonb; bad jsonb; pref public.notification_user_preferences;begin
 stages:='[{"step_no":1,"approver_role":"hse_manager","required":true,"notify_channels":["in_app"]},{"step_no":2,"approver_role":"admin","required":false,"notify_channels":["email"]},{"step_no":3,"approver_role":"admin","required":true,"notify_channels":["email","in_app"]},{"step_no":4,"approver_role":"admin","required":true,"notify_channels":["in_app"]}]';
 w:=public.save_company_approval_route(company,null,null,'documents','Fictional document route','all',true,stages);
 if (select count(*) from public.approval_workflow_steps where workflow_id=w.id)<>4 then raise exception 'Not all stages retained';end if;
 if (select required from public.approval_workflow_steps where workflow_id=w.id and step_no=2) then raise exception 'Optional stage changed';end if;
 select jsonb_agg(to_jsonb(s) order by step_no) into stages from public.approval_workflow_steps s where workflow_id=w.id;
 before_save:=w.updated_at;
 bad:=jsonb_set(stages,'{3,approver_role}','"unsupported_new_role"');
 begin perform public.save_company_approval_route(company,w.id,w.updated_at,'documents','Invalid partial save','all',true,bad);raise exception 'Invalid role accepted';exception when raise_exception then if sqlerrm<>'Unsupported approval role' then raise;end if;end;
 if (select workflow_name from public.approval_workflows where id=w.id)<>'Fictional document route' or (select count(*) from public.approval_workflow_steps where workflow_id=w.id)<>4 then raise exception 'Failed stage save partially modified route';end if;
 w:=public.save_company_approval_route(company,w.id,w.updated_at,'documents','Fictional updated route','all',true,stages);
 if w.module_name<>'documents' or (select notify_channels from public.approval_workflow_steps where workflow_id=w.id and step_no=1)<>array['in_app'] then raise exception 'Saved module or notification channels changed';end if;
 begin perform public.save_company_approval_route(company,w.id,before_save,'permit','Stale route','all',true,stages);raise exception 'Stale update accepted';exception when raise_exception then if sqlerrm not like 'The approval route changed%' then raise;end if;end;
 begin perform public.save_company_approval_route('50200000-0000-4000-8000-000000000011',w.id,w.updated_at,'documents','Other company','all',true,stages);raise exception 'Foreign route accepted';exception when raise_exception then if sqlerrm not like 'Approval administration is not permitted%' then raise;end if;end;
 perform public.list_company_automation_rules(company);
 begin perform public.list_company_automation_rules('50200000-0000-4000-8000-000000000011');raise exception 'Foreign automation read accepted';exception when raise_exception then if sqlerrm not like 'Automation administration is not permitted%' then raise;end if;end;
 pref:=public.set_my_notification_preferences('Asia/Dubai',true,'21:00','07:00',false,true,false,false,8);
 if pref.profile_id<>auth.uid() or pref.company_id<>company then raise exception 'Preference ownership lost';end if;
 select * into pref from public.notification_user_preferences where profile_id=auth.uid();
 if not pref.quiet_hours_enabled or pref.quiet_start<>'21:00'::time or pref.max_external_alerts_per_hour<>8 or pref.push_enabled then raise exception 'Preferences failed save/reload';end if;
 perform set_config('settings.fixture_actor','50200000-0000-4000-8000-000000000002',true);
 if exists(select 1 from public.notification_user_preferences where profile_id='50200000-0000-4000-8000-000000000001') then raise exception 'Another user preferences exposed';end if;
 begin perform public.save_company_approval_route(company,w.id,w.updated_at,'documents','Employee change','all',true,stages);raise exception 'Employee route accepted';exception when raise_exception then if sqlerrm not like 'Approval administration is not permitted%' then raise;end if;end;
end;$$;
reset role;
do $$begin
 if has_function_privilege('anon','public.save_company_approval_route(uuid,uuid,timestamptz,text,text,text,boolean,jsonb)','execute') or has_function_privilege('anon','public.list_company_automation_rules(uuid)','execute') then raise exception 'Anonymous Settings access';end if;
end;$$;
rollback;
