-- AURIS360 Modular Foundation Phase 22: exact-record governed reconciliation.
begin;

alter table public.data_import_batches add column if not exists operation text not null default 'create';
alter table public.data_import_batches drop constraint if exists data_import_batches_operation_check;
alter table public.data_import_batches add constraint data_import_batches_operation_check check(operation in ('create','update'));
alter table public.data_import_rows add column if not exists operation text not null default 'create';
alter table public.data_import_rows add column if not exists target_record_id uuid;
alter table public.data_import_rows add column if not exists expected_updated_at timestamptz;
alter table public.data_import_rows add column if not exists before_data jsonb;
alter table public.data_import_rows add column if not exists reverted_at timestamptz;
alter table public.data_import_rows drop constraint if exists data_import_rows_operation_check;
alter table public.data_import_rows add constraint data_import_rows_operation_check check(operation in ('create','update'));
create index if not exists data_import_rows_target_idx on public.data_import_rows(company_id,target_record_id) where target_record_id is not null;

create or replace function public.stage_action_reconciliation(p_company_id uuid,p_rows jsonb)
returns setof public.data_import_batches language plpgsql security definer set search_path=public as $$
declare actor public.profiles; saved public.data_import_batches; item jsonb; target public.action_tracker; clean jsonb; before_value jsonb; row_number integer:=0; seen_ids uuid[]:=array[]::uuid[]; target_id uuid; expected_time timestamptz; fingerprint text;
begin
  actor:=public.integration_require_admin(p_company_id);
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 or octet_length(p_rows::text)>1048576 then raise exception 'Reconciliation staging requires 1 to 500 reviewed rows within 1 MiB'; end if;
  fingerprint:=md5('update:'||p_rows::text);
  insert into public.data_import_batches(company_id,operation,row_count,payload_fingerprint,requested_by) values(p_company_id,'update',jsonb_array_length(p_rows),fingerprint,actor.id) returning * into saved;
  for item in select value from jsonb_array_elements(p_rows) loop
    row_number:=row_number+1;
    begin target_id:=(item->>'record_id')::uuid; expected_time:=(item->>'expected_updated_at')::timestamptz; exception when others then raise exception 'Reconciliation row % has an invalid record identity or revision',row_number; end;
    if target_id=any(seen_ids) then raise exception 'Reconciliation repeats the same target at row %',row_number; end if;
    select * into target from public.action_tracker where id=target_id and company_id=p_company_id for share;
    if target.id is null or target.action_ref is distinct from left(trim(coalesce(item->>'action_ref','')),160) then raise exception 'Reconciliation row % does not match the exact company action',row_number; end if;
    if target.updated_at is distinct from expected_time then raise exception 'Reconciliation row % is stale; export a fresh update template',row_number; end if;
    if coalesce(item->>'status',target.status) not in ('open','in_progress','overdue','closed') or coalesce(item->>'priority',target.priority) not in ('low','medium','high','critical') then raise exception 'Reconciliation row % contains an invalid controlled value',row_number; end if;
    if coalesce(item->>'target_date','')<>'' and (item->>'target_date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Reconciliation row % contains an invalid target date',row_number; end if;
    clean:=jsonb_build_object('record_id',target.id,'action_ref',target.action_ref,'expected_updated_at',target.updated_at,'title',left(trim(coalesce(item->>'title','')),500),'description',left(trim(coalesce(item->>'description','')),2000),'status',coalesce(item->>'status',target.status),'priority',coalesce(item->>'priority',target.priority),'target_date',nullif(item->>'target_date',''));
    before_value:=jsonb_build_object('title',target.title,'description',target.description,'status',target.status,'priority',target.priority,'target_date',target.target_date,'updated_at',target.updated_at);
    insert into public.data_import_rows(batch_id,company_id,row_no,operation,target_record_id,expected_updated_at,source_data,before_data,row_fingerprint) values(saved.id,p_company_id,row_number,'update',target.id,target.updated_at,clean,before_value,md5(clean::text));
    seen_ids:=array_append(seen_ids,target.id);
  end loop;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code)
  values(p_company_id,actor.id,actor.full_name,actor.role,'data_reconciliation_staged','integrations','data_import_batches',saved.id,'Exact-record action reconciliation staged without mutation',jsonb_build_object('row_count',saved.row_count,'fingerprint',saved.payload_fingerprint),'integrations.reconciliation_staged');
  return next saved;
exception when unique_violation then raise exception 'An identical reconciliation batch already exists for this company';
end;
$$;

create or replace function public.apply_governed_data_batch(p_batch_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare batch public.data_import_batches; imported public.data_import_rows; target public.action_tracker; action_id uuid; applied integer:=0;
begin
  select * into batch from public.data_import_batches where id=p_batch_id and lease_token=p_lease_token and status='processing' for update;
  if batch.id is null then raise exception 'Governed data execution lease is invalid or expired'; end if;
  for imported in select * from public.data_import_rows where batch_id=batch.id and company_id=batch.company_id order by row_no for update loop
    if batch.operation='create' then
      if imported.operation<>'create' or exists(select 1 from public.action_tracker where company_id=batch.company_id and lower(action_ref)=lower(imported.source_data->>'action_ref')) then raise exception 'An action reference now conflicts with staged row %',imported.row_no; end if;
      insert into public.action_tracker(company_id,action_ref,title,description,status,priority,target_date,source_module,source_type,action_type,created_by,import_batch_id)
      values(batch.company_id,imported.source_data->>'action_ref',nullif(imported.source_data->>'title',''),coalesce(nullif(imported.source_data->>'description',''),nullif(imported.source_data->>'title',''),imported.source_data->>'action_ref'),imported.source_data->>'status',imported.source_data->>'priority',nullif(imported.source_data->>'target_date','')::date,'manual','manual','corrective',batch.requested_by,batch.id) returning id into action_id;
    elsif batch.operation='update' then
      if imported.operation<>'update' then raise exception 'Reconciliation row operation does not match its batch'; end if;
      select * into target from public.action_tracker where id=imported.target_record_id and company_id=batch.company_id for update;
      if target.id is null or target.action_ref is distinct from imported.source_data->>'action_ref' or target.updated_at is distinct from imported.expected_updated_at or jsonb_build_object('title',target.title,'description',target.description,'status',target.status,'priority',target.priority,'target_date',target.target_date,'updated_at',target.updated_at) is distinct from imported.before_data then raise exception 'Reconciliation row % has a revision conflict',imported.row_no; end if;
      update public.action_tracker set title=nullif(imported.source_data->>'title',''),description=coalesce(nullif(imported.source_data->>'description',''),target.description),status=imported.source_data->>'status',priority=imported.source_data->>'priority',target_date=nullif(imported.source_data->>'target_date','')::date,updated_at=now() where id=target.id and company_id=batch.company_id returning id into action_id;
    else raise exception 'Unsupported governed batch operation'; end if;
    update public.data_import_rows set applied_record_id=action_id,applied_at=now() where id=imported.id; applied:=applied+1;
  end loop;
  update public.data_import_batches set status='completed',lease_token=null,locked_at=null,completed_at=now(),revision=revision+1,updated_at=now() where id=batch.id;
  insert into public.audit_events(company_id,actor_user_id,action,module_name,related_table,related_id,summary,details,event_code)
  values(batch.company_id,batch.approved_by,'data_batch_completed','integrations','data_import_batches',batch.id,'Approved governed data batch completed atomically',jsonb_build_object('operation',batch.operation,'row_count',applied,'requested_by',batch.requested_by,'approved_by',batch.approved_by),'integrations.batch_completed');
  return jsonb_build_object('id',batch.id,'status','completed','operation',batch.operation,'applied',applied);
end;
$$;

create or replace function public.apply_action_import_batch(p_batch_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare operation_value text;
begin
  select operation into operation_value from public.data_import_batches where id=p_batch_id and lease_token=p_lease_token;
  if operation_value is distinct from 'create' then raise exception 'Legacy create execution cannot apply a reconciliation batch'; end if;
  return public.apply_governed_data_batch(p_batch_id,p_lease_token);
end;
$$;

create or replace function public.rollback_action_import_batch(p_batch_id uuid,p_company_id uuid,p_expected_revision integer)
returns setof public.data_import_batches language plpgsql security definer set search_path=public as $$
declare actor public.profiles; batch public.data_import_batches; imported public.data_import_rows; target public.action_tracker; changed integer:=0; saved public.data_import_batches;
begin
  actor:=public.integration_require_admin(p_company_id);
  select * into batch from public.data_import_batches where id=p_batch_id and company_id=p_company_id and revision=p_expected_revision for update;
  if batch.id is null or batch.status<>'completed' then raise exception 'Only a completed company batch may be rolled back'; end if;
  if batch.completed_at<now()-interval '24 hours' then raise exception 'The safe rollback window has expired'; end if;
  if batch.operation='create' then
    select count(*) into changed from public.data_import_rows r left join public.action_tracker a on a.id=r.applied_record_id and a.company_id=batch.company_id where r.batch_id=batch.id and (a.id is null or a.import_batch_id is distinct from batch.id or a.updated_at>r.applied_at+interval '5 seconds' or exists(select 1 from public.integration_deliveries d where d.source_record_id=a.id) or exists(select 1 from public.notification_queue n where n.company_id=batch.company_id and n.related_id=a.id) or exists(select 1 from public.approval_requests q where q.company_id=batch.company_id and q.related_id=a.id) or exists(select 1 from public.map_activity_log m where m.company_id=batch.company_id and m.action_id=a.id));
    if changed>0 then raise exception 'Rollback blocked because an imported record changed or produced external evidence'; end if;
    delete from public.action_tracker a using public.data_import_rows r where r.batch_id=batch.id and a.id=r.applied_record_id and a.company_id=batch.company_id and a.import_batch_id=batch.id;
  elsif batch.operation='update' then
    for imported in select * from public.data_import_rows where batch_id=batch.id order by row_no for update loop
      select * into target from public.action_tracker where id=imported.target_record_id and company_id=batch.company_id for update;
      if target.id is null or target.updated_at>imported.applied_at+interval '5 seconds' or target.action_ref is distinct from imported.source_data->>'action_ref' or coalesce(target.title,'') is distinct from coalesce(imported.source_data->>'title','') or target.description is distinct from coalesce(nullif(imported.source_data->>'description',''),imported.before_data->>'description') or target.status is distinct from imported.source_data->>'status' or target.priority is distinct from imported.source_data->>'priority' or exists(select 1 from public.integration_deliveries d where d.source_record_id=target.id and d.created_at>=imported.applied_at) or exists(select 1 from public.notification_queue n where n.company_id=batch.company_id and n.related_id=target.id and n.created_at>=imported.applied_at) or exists(select 1 from public.approval_requests q where q.company_id=batch.company_id and q.related_id=target.id and q.created_at>=imported.applied_at) or exists(select 1 from public.map_activity_log m where m.company_id=batch.company_id and m.action_id=target.id and m.performed_at>=imported.applied_at) then raise exception 'Reconciliation rollback blocked because row % changed or produced new evidence',imported.row_no; end if;
      update public.action_tracker set title=imported.before_data->>'title',description=imported.before_data->>'description',status=imported.before_data->>'status',priority=imported.before_data->>'priority',target_date=nullif(imported.before_data->>'target_date','')::date,updated_at=now() where id=target.id and company_id=batch.company_id;
      update public.data_import_rows set reverted_at=now() where id=imported.id;
    end loop;
  else raise exception 'Unsupported rollback batch operation'; end if;
  update public.data_import_batches set status='rolled_back',rolled_back_at=now(),revision=revision+1,updated_at=now() where id=batch.id returning * into saved;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code)
  values(batch.company_id,actor.id,actor.full_name,actor.role,'data_batch_rolled_back','integrations','data_import_batches',batch.id,'Unchanged governed data effects rolled back safely',jsonb_build_object('operation',batch.operation,'row_count',batch.row_count,'completed_at',batch.completed_at),'integrations.batch_rolled_back');
  return next saved;
end;
$$;

revoke all on function public.stage_action_reconciliation(uuid,jsonb) from public,anon;
revoke all on function public.apply_governed_data_batch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.stage_action_reconciliation(uuid,jsonb) to authenticated;
grant execute on function public.apply_governed_data_batch(uuid,uuid) to service_role;

commit;
