-- AURIS360 Modular Foundation Phase 21: governed import execution and rollback.
begin;

create table if not exists public.data_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  module_key text not null default 'actions' check(module_key='actions'),
  status text not null default 'staged' check(status in ('staged','pending_review','approved','processing','completed','failed','rejected','rolled_back')),
  row_count integer not null check(row_count between 1 and 500),
  rejected_count integer not null default 0 check(rejected_count=0),
  payload_fingerprint text not null check(char_length(payload_fingerprint)=32),
  requested_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  lease_token uuid,
  locked_at timestamptz,
  error_code text,
  revision integer not null default 1 check(revision>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  rolled_back_at timestamptz,
  unique(company_id,payload_fingerprint)
);
create index if not exists data_import_batches_company_idx on public.data_import_batches(company_id,created_at desc);
create index if not exists data_import_batches_due_idx on public.data_import_batches(status,approved_at) where status='approved';

create table if not exists public.data_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.data_import_batches(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  row_no integer not null check(row_no between 1 and 500),
  source_data jsonb not null,
  row_fingerprint text not null check(char_length(row_fingerprint)=32),
  applied_record_id uuid,
  applied_at timestamptz,
  unique(batch_id,row_no)
);
create index if not exists data_import_rows_batch_idx on public.data_import_rows(batch_id,row_no);

alter table public.action_tracker add column if not exists import_batch_id uuid references public.data_import_batches(id) on delete restrict;
create index if not exists action_tracker_import_batch_idx on public.action_tracker(import_batch_id) where import_batch_id is not null;

alter table public.data_import_batches enable row level security;
alter table public.data_import_rows enable row level security;
drop policy if exists data_import_batches_company_admin on public.data_import_batches;
create policy data_import_batches_company_admin on public.data_import_batches for select using (
  exists(select 1 from public.profiles actor where actor.id=auth.uid() and (actor.role='sephs_admin' or (actor.company_id=data_import_batches.company_id and actor.role in ('admin','company_admin','hse_manager'))))
);
drop policy if exists data_import_rows_company_admin on public.data_import_rows;
create policy data_import_rows_company_admin on public.data_import_rows for select using (
  exists(select 1 from public.profiles actor where actor.id=auth.uid() and (actor.role='sephs_admin' or (actor.company_id=data_import_rows.company_id and actor.role in ('admin','company_admin','hse_manager'))))
);
revoke all on public.data_import_batches,public.data_import_rows from public,anon;
grant select on public.data_import_batches,public.data_import_rows to authenticated;

create or replace function public.stage_action_import(p_company_id uuid,p_rows jsonb)
returns setof public.data_import_batches language plpgsql security definer set search_path=public as $$
declare actor public.profiles; saved public.data_import_batches; item jsonb; clean jsonb; row_number integer:=0; ref text; seen_refs text[]:=array[]::text[]; fingerprint text;
begin
  actor:=public.integration_require_admin(p_company_id);
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 or octet_length(p_rows::text)>1048576 then raise exception 'Import staging requires 1 to 500 reviewed rows within 1 MiB'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    row_number:=row_number+1; ref:=left(trim(coalesce(item->>'action_ref','')),160);
    if ref='' or lower(ref)=any(seen_refs) or exists(select 1 from public.action_tracker where company_id=p_company_id and lower(action_ref)=lower(ref)) then raise exception 'Import contains a missing, duplicate or existing action reference at row %',row_number; end if;
    if coalesce(item->>'status','open') not in ('open','in_progress','overdue','closed') or coalesce(item->>'priority','medium') not in ('low','medium','high','critical') then raise exception 'Import contains an invalid controlled value at row %',row_number; end if;
    if coalesce(item->>'target_date','')<>'' and (item->>'target_date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Import contains an invalid target date at row %',row_number; end if;
    seen_refs:=array_append(seen_refs,lower(ref));
  end loop;
  fingerprint:=md5(p_rows::text);
  insert into public.data_import_batches(company_id,row_count,payload_fingerprint,requested_by) values(p_company_id,row_number,fingerprint,actor.id) returning * into saved;
  row_number:=0;
  for item in select value from jsonb_array_elements(p_rows) loop
    row_number:=row_number+1;
    clean:=jsonb_build_object('action_ref',left(trim(item->>'action_ref'),160),'title',left(trim(coalesce(item->>'title','')),500),'description',left(trim(coalesce(item->>'description','')),2000),'status',coalesce(item->>'status','open'),'priority',coalesce(item->>'priority','medium'),'target_date',nullif(item->>'target_date',''));
    insert into public.data_import_rows(batch_id,company_id,row_no,source_data,row_fingerprint) values(saved.id,p_company_id,row_number,clean,md5(clean::text));
  end loop;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code)
  values(p_company_id,actor.id,actor.full_name,actor.role,'data_import_staged','integrations','data_import_batches',saved.id,'Action import staged without source mutation',jsonb_build_object('row_count',saved.row_count,'fingerprint',saved.payload_fingerprint),'integrations.import_staged');
  return next saved;
exception when unique_violation then raise exception 'An identical import batch already exists for this company';
end;
$$;

create or replace function public.set_data_import_status(p_batch_id uuid,p_company_id uuid,p_status text,p_expected_revision integer)
returns setof public.data_import_batches language plpgsql security definer set search_path=public as $$
declare actor public.profiles; current_row public.data_import_batches; saved public.data_import_batches;
begin
  actor:=public.integration_require_admin(p_company_id);
  select * into current_row from public.data_import_batches where id=p_batch_id and company_id=p_company_id and revision=p_expected_revision for update;
  if current_row.id is null then raise exception 'Import changed or belongs to another company'; end if;
  if p_status='pending_review' and current_row.status<>'staged' then raise exception 'Only staged imports may request review'; end if;
  if p_status in ('approved','rejected') and current_row.status<>'pending_review' then raise exception 'Only pending imports may be decided'; end if;
  if p_status not in ('pending_review','approved','rejected') then raise exception 'Unsupported import governance status'; end if;
  if p_status in ('approved','rejected') and current_row.requested_by=actor.id then raise exception 'The import requester cannot approve or reject the same batch'; end if;
  update public.data_import_batches set status=p_status,approved_by=case when p_status in ('approved','rejected') then actor.id else approved_by end,approved_at=case when p_status='approved' then now() else approved_at end,revision=revision+1,updated_at=now()
  where id=current_row.id returning * into saved;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code,outcome)
  values(p_company_id,actor.id,actor.full_name,actor.role,'data_import_'||p_status,'integrations','data_import_batches',saved.id,'Import governance status changed to '||p_status,jsonb_build_object('row_count',saved.row_count,'revision',saved.revision),'integrations.import_'||p_status,case when p_status='rejected' then 'denied' else 'success' end);
  return next saved;
end;
$$;

create or replace function public.claim_data_import_batches(p_limit integer default 5,p_worker_id text default null)
returns table(id uuid,company_id uuid,lease_token uuid,row_count integer) language plpgsql security definer set search_path=public as $$
begin
  return query with candidates as (
    select b.id from public.data_import_batches b where b.status='approved' or (b.status='processing' and b.locked_at<now()-interval '15 minutes') order by b.approved_at,b.created_at for update of b skip locked limit greatest(1,least(coalesce(p_limit,5),10))
  ), claimed as (
    update public.data_import_batches b set status='processing',lease_token=gen_random_uuid(),locked_at=now(),revision=revision+1,updated_at=now() from candidates x where b.id=x.id returning b.*
  ) select c.id,c.company_id,c.lease_token,c.row_count from claimed c;
end;
$$;

create or replace function public.apply_action_import_batch(p_batch_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare batch public.data_import_batches; imported public.data_import_rows; action_id uuid; applied integer:=0;
begin
  select * into batch from public.data_import_batches where id=p_batch_id and lease_token=p_lease_token and status='processing' for update;
  if batch.id is null then raise exception 'Import execution lease is invalid or expired'; end if;
  for imported in select * from public.data_import_rows where batch_id=batch.id and company_id=batch.company_id order by row_no for update loop
    if exists(select 1 from public.action_tracker where company_id=batch.company_id and lower(action_ref)=lower(imported.source_data->>'action_ref')) then raise exception 'An action reference now conflicts with staged row %',imported.row_no; end if;
    insert into public.action_tracker(company_id,action_ref,title,description,status,priority,target_date,source_module,source_type,action_type,created_by,import_batch_id)
    values(batch.company_id,imported.source_data->>'action_ref',nullif(imported.source_data->>'title',''),coalesce(nullif(imported.source_data->>'description',''),nullif(imported.source_data->>'title',''),imported.source_data->>'action_ref'),imported.source_data->>'status',imported.source_data->>'priority',nullif(imported.source_data->>'target_date','')::date,'manual','manual','corrective',batch.requested_by,batch.id) returning id into action_id;
    update public.data_import_rows set applied_record_id=action_id,applied_at=now() where id=imported.id; applied:=applied+1;
  end loop;
  update public.data_import_batches set status='completed',lease_token=null,locked_at=null,completed_at=now(),revision=revision+1,updated_at=now() where id=batch.id;
  insert into public.audit_events(company_id,actor_user_id,action,module_name,related_table,related_id,summary,details,event_code)
  values(batch.company_id,batch.approved_by,'data_import_completed','integrations','data_import_batches',batch.id,'Approved action import completed atomically',jsonb_build_object('row_count',applied,'requested_by',batch.requested_by,'approved_by',batch.approved_by),'integrations.import_completed');
  return jsonb_build_object('id',batch.id,'status','completed','applied',applied);
end;
$$;

create or replace function public.fail_data_import_batch(p_batch_id uuid,p_lease_token uuid,p_error_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare batch public.data_import_batches;
begin
  update public.data_import_batches set status='failed',error_code=left(coalesce(p_error_code,'controlled_failure'),80),lease_token=null,locked_at=null,revision=revision+1,updated_at=now() where id=p_batch_id and lease_token=p_lease_token and status='processing' returning * into batch;
  if batch.id is null then raise exception 'Import failure lease is invalid or expired'; end if;
  insert into public.audit_events(company_id,action,module_name,related_table,related_id,summary,details,event_code,outcome) values(batch.company_id,'data_import_failed','integrations','data_import_batches',batch.id,'Import execution failed without partial source mutation',jsonb_build_object('error_code',batch.error_code),'integrations.import_failed','failed');
  return jsonb_build_object('id',batch.id,'status','failed');
end;
$$;

create or replace function public.rollback_action_import_batch(p_batch_id uuid,p_company_id uuid,p_expected_revision integer)
returns setof public.data_import_batches language plpgsql security definer set search_path=public as $$
declare actor public.profiles; batch public.data_import_batches; changed integer; saved public.data_import_batches;
begin
  actor:=public.integration_require_admin(p_company_id);
  select * into batch from public.data_import_batches where id=p_batch_id and company_id=p_company_id and revision=p_expected_revision for update;
  if batch.id is null or batch.status<>'completed' then raise exception 'Only a completed company import may be rolled back'; end if;
  if batch.completed_at<now()-interval '24 hours' then raise exception 'The safe rollback window has expired'; end if;
  select count(*) into changed from public.data_import_rows r left join public.action_tracker a on a.id=r.applied_record_id and a.company_id=batch.company_id where r.batch_id=batch.id and (a.id is null or a.import_batch_id is distinct from batch.id or a.updated_at>r.applied_at+interval '5 seconds' or a.action_ref is distinct from r.source_data->>'action_ref' or coalesce(a.title,'') is distinct from coalesce(r.source_data->>'title','') or a.description is distinct from coalesce(nullif(r.source_data->>'description',''),nullif(r.source_data->>'title',''),r.source_data->>'action_ref') or a.status is distinct from r.source_data->>'status' or a.priority is distinct from r.source_data->>'priority' or exists(select 1 from public.integration_deliveries d where d.source_record_id=a.id) or exists(select 1 from public.notification_queue n where n.company_id=batch.company_id and n.related_id=a.id) or exists(select 1 from public.approval_requests q where q.company_id=batch.company_id and q.related_id=a.id) or exists(select 1 from public.action_notification_escalation_state s where s.company_id=batch.company_id and s.action_id=a.id) or exists(select 1 from public.map_activity_log m where m.company_id=batch.company_id and m.action_id=a.id));
  if changed>0 then raise exception 'Rollback blocked because one or more imported records changed or produced external evidence'; end if;
  delete from public.action_tracker a using public.data_import_rows r where r.batch_id=batch.id and a.id=r.applied_record_id and a.company_id=batch.company_id and a.import_batch_id=batch.id;
  update public.data_import_batches set status='rolled_back',rolled_back_at=now(),revision=revision+1,updated_at=now() where id=batch.id returning * into saved;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code)
  values(batch.company_id,actor.id,actor.full_name,actor.role,'data_import_rolled_back','integrations','data_import_batches',batch.id,'Unchanged imported actions rolled back safely',jsonb_build_object('row_count',batch.row_count,'completed_at',batch.completed_at),'integrations.import_rolled_back');
  return next saved;
end;
$$;

revoke all on function public.stage_action_import(uuid,jsonb) from public,anon;
revoke all on function public.set_data_import_status(uuid,uuid,text,integer) from public,anon;
revoke all on function public.claim_data_import_batches(integer,text) from public,anon,authenticated;
revoke all on function public.apply_action_import_batch(uuid,uuid) from public,anon,authenticated;
revoke all on function public.fail_data_import_batch(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.rollback_action_import_batch(uuid,uuid,integer) from public,anon;
grant execute on function public.stage_action_import(uuid,jsonb) to authenticated;
grant execute on function public.set_data_import_status(uuid,uuid,text,integer) to authenticated;
grant execute on function public.rollback_action_import_batch(uuid,uuid,integer) to authenticated;
grant execute on function public.claim_data_import_batches(integer,text) to service_role;
grant execute on function public.apply_action_import_batch(uuid,uuid) to service_role;
grant execute on function public.fail_data_import_batch(uuid,uuid,text) to service_role;

commit;
