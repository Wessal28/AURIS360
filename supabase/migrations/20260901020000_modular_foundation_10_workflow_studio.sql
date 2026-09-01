-- AURIS360 Modular Foundation 10: governed multi-stage Workflow Studio approvals.

alter table public.approval_requests
  add column if not exists policy_version text,
  add column if not exists approval_stages jsonb not null default '[]'::jsonb;

alter table public.approval_requests drop constraint if exists approval_requests_approval_stages_array_check;
alter table public.approval_requests add constraint approval_requests_approval_stages_array_check
  check (jsonb_typeof(approval_stages) = 'array' and jsonb_array_length(approval_stages) <= 5);

create or replace function public.request_workflow_approval_v2(
  p_company_id uuid,p_module_name text,p_related_table text,p_source_record_id text,p_source_page text,p_source_ref text,p_source_adapter_key text,p_from_state text,p_to_state text,p_reason text default '',p_idempotency_key text default null,p_policy_version text default null,p_approval_stages jsonb default '[]'::jsonb
) returns setof public.approval_requests
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.approval_requests;v_uuid uuid;v_stage jsonb;
begin
  if not public.auris_can_access_company(p_company_id) then raise exception 'AURIS_APPROVAL_TENANT_MISMATCH' using errcode='42501';end if;
  if nullif(trim(p_source_record_id),'') is null then raise exception 'AURIS_APPROVAL_SOURCE_REQUIRED' using errcode='22023';end if;
  if jsonb_typeof(coalesce(p_approval_stages,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_approval_stages,'[]'::jsonb))>5 then raise exception 'AURIS_APPROVAL_STAGES_INVALID' using errcode='22023';end if;
  for v_stage in select value from jsonb_array_elements(coalesce(p_approval_stages,'[]'::jsonb)) loop
    if coalesce(v_stage->>'role','') not in ('employee','supervisor','site_manager','hse_officer','hse_manager','admin','sephs_admin') then raise exception 'AURIS_APPROVAL_STAGE_ROLE_INVALID' using errcode='22023';end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_module_name||':'||p_related_table||':'||p_source_record_id||':'||p_from_state||':'||p_to_state,0));
  if nullif(p_idempotency_key,'') is not null then select * into v_row from public.approval_requests where company_id=p_company_id and idempotency_key=p_idempotency_key;if found then return next v_row;return;end if;end if;
  select * into v_row from public.approval_requests where company_id=p_company_id and module_name=p_module_name and related_table=p_related_table and source_record_id=p_source_record_id and coalesce(from_state,'')=coalesce(p_from_state,'') and coalesce(to_state,'')=coalesce(p_to_state,'') and status='pending' limit 1;
  if found then return next v_row;return;end if;
  if p_source_record_id~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then v_uuid=p_source_record_id::uuid;end if;
  insert into public.approval_requests(company_id,module_name,related_table,related_id,source_record_id,source_page,source_ref,source_adapter_key,from_state,to_state,request_reason,idempotency_key,submitted_by,requested_by,status,policy_version,approval_stages,current_step_no)
  values(p_company_id,p_module_name,p_related_table,v_uuid,p_source_record_id,p_source_page,nullif(p_source_ref,''),nullif(p_source_adapter_key,''),nullif(p_from_state,''),nullif(p_to_state,''),nullif(p_reason,''),nullif(p_idempotency_key,''),auth.uid(),auth.uid(),'pending',nullif(p_policy_version,''),coalesce(p_approval_stages,'[]'::jsonb),1) returning * into v_row;
  return next v_row;
end;$$;

create or replace function public.decide_workflow_approval_v2(
  p_request_id uuid,p_decision text,p_reason text default '',p_expected_revision integer default null
) returns setof public.approval_requests
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.approval_requests;v_name text;v_actor_role text;v_required_role text;v_stage_count integer;
begin
  if p_decision not in ('approved','rejected','changes_requested','cancelled') then raise exception 'AURIS_APPROVAL_INVALID_DECISION' using errcode='22023';end if;
  select * into v_row from public.approval_requests where id=p_request_id for update;
  if not found then raise exception 'AURIS_APPROVAL_NOT_FOUND' using errcode='P0002';end if;
  if v_row.status<>'pending' then raise exception 'AURIS_APPROVAL_ALREADY_DECIDED' using errcode='40001';end if;
  if p_expected_revision is not null and v_row.revision<>p_expected_revision then raise exception 'AURIS_APPROVAL_REVISION_CONFLICT' using errcode='40001';end if;
  select role,coalesce(full_name,email) into v_actor_role,v_name from public.profiles where id=auth.uid() and (company_id=v_row.company_id or role='sephs_admin');
  if v_actor_role is null then raise exception 'AURIS_APPROVAL_DECISION_DENIED' using errcode='42501';end if;
  v_stage_count=jsonb_array_length(coalesce(v_row.approval_stages,'[]'::jsonb));
  if v_stage_count>0 then
    v_required_role=coalesce(v_row.approval_stages->(v_row.current_step_no-1)->>'role','');
    if v_actor_role<>'sephs_admin' and v_actor_role<>v_required_role then raise exception 'AURIS_APPROVAL_STAGE_ROLE_DENIED' using errcode='42501';end if;
  elsif not public.auris_can_manage_company(v_row.company_id) then raise exception 'AURIS_APPROVAL_DECISION_DENIED' using errcode='42501';end if;
  insert into public.approval_decisions(request_id,step_no,decision,decided_by,decided_by_name,comments) values(v_row.id,v_row.current_step_no,p_decision,auth.uid(),v_name,nullif(p_reason,''));
  if p_decision='approved' and v_row.current_step_no<v_stage_count then
    update public.approval_requests set current_step_no=current_step_no+1,revision=revision+1,updated_at=now() where id=v_row.id returning * into v_row;
  else
    update public.approval_requests set status=p_decision,decided_by=auth.uid(),decided_at=now(),decision_reason=nullif(p_reason,''),completed_at=now(),released_by=case when p_decision='approved' then auth.uid() else released_by end,release_reason=case when p_decision='approved' then nullif(p_reason,'') else release_reason end,revision=revision+1,updated_at=now() where id=v_row.id returning * into v_row;
  end if;
  return next v_row;
end;$$;

revoke all on function public.request_workflow_approval_v2(uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb) from public;
revoke all on function public.decide_workflow_approval_v2(uuid,text,text,integer) from public;
grant execute on function public.request_workflow_approval_v2(uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb) to authenticated;
grant execute on function public.decide_workflow_approval_v2(uuid,text,text,integer) to authenticated;

notify pgrst,'reload schema';
