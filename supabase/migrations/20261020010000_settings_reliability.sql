-- Settings route saves are atomic: a failed stage never removes saved approvers.
begin;
create or replace function public.save_company_approval_route(
 p_company_id uuid,p_workflow_id uuid,p_expected_updated_at timestamptz,
 p_module_name text,p_name text,p_applies_to text,p_active boolean,p_steps jsonb
) returns public.approval_workflows language plpgsql security definer set search_path=public as $$
declare actor public.profiles; saved public.approval_workflows; old public.approval_workflows;
 step jsonb; previous public.approval_workflow_steps; person public.people; stage_id uuid;
 seen integer[]:='{}'; kept uuid[]:='{}'; n integer; person_id uuid; role_name text;
begin
 select * into actor from public.profiles where id=auth.uid();
 if actor.id is null or not(actor.role='sephs_admin' or (actor.company_id=p_company_id and actor.role in ('admin','hse_manager'))) then raise exception 'Approval administration is not permitted for this company';end if;
 if p_workflow_id is not null then
  select * into old from public.approval_workflows where id=p_workflow_id and company_id=p_company_id for update;
  if old.id is null or old.updated_at is distinct from p_expected_updated_at then raise exception 'The approval route changed. Reload before saving';end if;
 end if;
 if char_length(trim(coalesce(p_name,''))) not between 1 and 160 or char_length(coalesce(p_module_name,'')) not between 1 and 80 then raise exception 'Workflow name and module are required';end if;
 if p_module_name is distinct from old.module_name and p_module_name not in ('permit','documents','risk','events','investigation','legal','chemical','actions') then raise exception 'Unsupported approval module';end if;
 if jsonb_typeof(p_steps) is distinct from 'array' or jsonb_array_length(p_steps) not between 1 and 50 then raise exception 'Configure between one and fifty stages';end if;
 if old.id is null then
  insert into public.approval_workflows(company_id,module_name,workflow_name,applies_to,is_active,created_by)
  values(p_company_id,p_module_name,trim(p_name),p_applies_to,coalesce(p_active,false),actor.id) returning * into saved;
 else
  update public.approval_workflows set module_name=p_module_name,workflow_name=trim(p_name),applies_to=p_applies_to,is_active=coalesce(p_active,false),updated_at=clock_timestamp() where id=old.id returning * into saved;
 end if;
 for step in select value from jsonb_array_elements(p_steps) loop
  n:=(step->>'step_no')::integer;
  if n is null or n not between 1 and 50 or n=any(seen) then raise exception 'Stage numbers must be unique and between one and fifty';end if;
  seen:=array_append(seen,n);previous:=null;
  if nullif(step->>'id','') is not null then
   select * into previous from public.approval_workflow_steps where id=(step->>'id')::uuid and workflow_id=saved.id;
   if previous.id is null then raise exception 'Saved stage does not belong to this route';end if;
  end if;
  person_id:=nullif(step->>'approver_person_id','')::uuid;role_name:=nullif(step->>'approver_role','');
  if person_id is null and role_name is null then raise exception 'Every stage requires a role or named approver';end if;
  if role_name is not null and role_name not in ('employee','supervisor','site_manager','hse_officer','hse_manager','admin','sephs_admin') and role_name is distinct from previous.approver_role then raise exception 'Unsupported approval role';end if;
  if person_id is not null and person_id is distinct from previous.approver_person_id and not exists(select 1 from public.people where id=person_id and company_id=p_company_id) then raise exception 'Choose an approver in this company';end if;
  stage_id:=coalesce(previous.id,gen_random_uuid());kept:=array_append(kept,stage_id);
  insert into public.approval_workflow_steps(id,workflow_id,step_no,approver_role,approver_person_id,approver_name,approver_email,required,notify_channels)
  values(stage_id,saved.id,n,role_name,person_id,step->>'approver_name',step->>'approver_email',coalesce((step->>'required')::boolean,true),coalesce(array(select jsonb_array_elements_text(step->'notify_channels')),array['email','in_app']))
  on conflict(id) do update set step_no=excluded.step_no,approver_role=excluded.approver_role,approver_person_id=excluded.approver_person_id,approver_name=excluded.approver_name,approver_email=excluded.approver_email,required=excluded.required,notify_channels=excluded.notify_channels;
 end loop;
 delete from public.approval_workflow_steps where workflow_id=saved.id and not(id=any(kept));
 insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code)
 values(p_company_id,actor.id,actor.full_name,actor.role,'approval_route_saved','settings','approval_workflows',saved.id,'Approval stages saved',jsonb_build_object('module',saved.module_name,'stage_count',cardinality(kept),'previous_updated_at',old.updated_at),'settings.approval_route_saved');
 return saved;
end;$$;
revoke all on function public.save_company_approval_route(uuid,uuid,timestamptz,text,text,text,boolean,jsonb) from public,anon;
grant execute on function public.save_company_approval_route(uuid,uuid,timestamptz,text,text,text,boolean,jsonb) to authenticated;

-- Narrow read contract uses the same company/role authority as automation writes.
create or replace function public.list_company_automation_rules(p_company_id uuid)
returns setof public.automation_rules language plpgsql security definer set search_path=public as $$
begin
 perform public.automation_require_admin(p_company_id);
 return query select * from public.automation_rules where company_id=p_company_id order by updated_at desc limit 101;
end;$$;
revoke all on function public.list_company_automation_rules(uuid) from public,anon;
grant execute on function public.list_company_automation_rules(uuid) to authenticated;
commit;
notify pgrst,'reload schema';
