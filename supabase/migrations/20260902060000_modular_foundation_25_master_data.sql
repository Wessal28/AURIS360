-- AURIS360 Modular Foundation Phase 25: shared governed master data.
begin;

create table if not exists public.master_data_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  domain text not null check(domain in ('location','department','organisation','person_role','asset','risk_classification','action_classification','document_category')),
  code text not null check(code ~ '^[A-Z0-9][A-Z0-9_.\/-]{0,79}$'),
  name text not null check(char_length(trim(name)) between 2 and 160),
  description text not null default '' check(char_length(description)<=1000),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=8192),
  status text not null default 'draft' check(status in ('draft','pending_review','active','inactive','archived','merged')),
  effective_from date, effective_to date, merged_into_id uuid references public.master_data_records(id) on delete restrict,
  revision integer not null default 1 check(revision>0),
  created_by uuid not null references public.profiles(id), review_requested_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id), approved_at timestamptz, updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(effective_to is null or effective_from is null or effective_to>=effective_from),
  check((status='merged')=(merged_into_id is not null)), check(merged_into_id is null or merged_into_id<>id)
);
create unique index if not exists master_data_records_company_code_idx on public.master_data_records(company_id,domain,lower(code));
create index if not exists master_data_records_company_domain_idx on public.master_data_records(company_id,domain,status,name);

create table if not exists public.master_data_revisions (
  id bigserial primary key, company_id uuid not null references public.companies(id) on delete cascade,
  record_id uuid not null references public.master_data_records(id) on delete restrict, revision integer not null,
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'), changed_by uuid references public.profiles(id),
  change_reason text not null default 'saved', changed_at timestamptz not null default now(), unique(record_id,revision)
);
create index if not exists master_data_revisions_company_idx on public.master_data_revisions(company_id,record_id,revision desc);

create table if not exists public.master_data_dependencies (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  master_record_id uuid not null references public.master_data_records(id) on delete restrict,
  source_table text not null check(source_table ~ '^[a-z][a-z0-9_]{1,79}$'), source_record_id uuid not null,
  source_field text not null check(source_field ~ '^[a-z][a-z0-9_]{1,79}$'), source_ref text not null check(char_length(source_ref) between 1 and 160),
  active boolean not null default true, registered_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,master_record_id,source_table,source_record_id,source_field)
);
create index if not exists master_data_dependencies_record_idx on public.master_data_dependencies(company_id,master_record_id,active);

create table if not exists public.master_data_import_batches (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  domain text not null check(domain in ('location','department','organisation','person_role','asset','risk_classification','action_classification','document_category')),
  field_map jsonb not null check(jsonb_typeof(field_map)='object'), mapping_fingerprint text not null check(char_length(mapping_fingerprint)=32),
  row_count integer not null check(row_count between 1 and 500), status text not null default 'staged' check(status in ('staged','pending_review','approved','rejected','failed')),
  revision integer not null default 1 check(revision>0), requested_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id), approved_at timestamptz, error_code text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists master_data_import_batches_company_idx on public.master_data_import_batches(company_id,created_at desc);

create table if not exists public.master_data_import_rows (
  id bigserial primary key, batch_id uuid not null references public.master_data_import_batches(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade, row_no integer not null check(row_no between 1 and 500),
  source_data jsonb not null check(jsonb_typeof(source_data)='object' and octet_length(source_data::text)<=16384),
  row_fingerprint text not null check(char_length(row_fingerprint)=32), created_record_id uuid references public.master_data_records(id) on delete restrict,
  unique(batch_id,row_no), unique(batch_id,row_fingerprint)
);

alter table public.master_data_records enable row level security;
alter table public.master_data_revisions enable row level security;
alter table public.master_data_dependencies enable row level security;
alter table public.master_data_import_batches enable row level security;
alter table public.master_data_import_rows enable row level security;
create policy master_data_records_company_admin on public.master_data_records for select using (exists(select 1 from public.profiles actor where actor.id=auth.uid() and (actor.role='sephs_admin' or (actor.company_id=master_data_records.company_id and actor.role in ('admin','company_admin','hse_manager')))));
create policy master_data_revisions_company_admin on public.master_data_revisions for select using (exists(select 1 from public.profiles actor where actor.id=auth.uid() and (actor.role='sephs_admin' or (actor.company_id=master_data_revisions.company_id and actor.role in ('admin','company_admin','hse_manager')))));
create policy master_data_dependencies_company_admin on public.master_data_dependencies for select using (exists(select 1 from public.profiles actor where actor.id=auth.uid() and (actor.role='sephs_admin' or (actor.company_id=master_data_dependencies.company_id and actor.role in ('admin','company_admin','hse_manager')))));
create policy master_data_import_batches_company_admin on public.master_data_import_batches for select using (exists(select 1 from public.profiles actor where actor.id=auth.uid() and (actor.role='sephs_admin' or (actor.company_id=master_data_import_batches.company_id and actor.role in ('admin','company_admin','hse_manager')))));
create policy master_data_import_rows_company_admin on public.master_data_import_rows for select using (exists(select 1 from public.profiles actor where actor.id=auth.uid() and (actor.role='sephs_admin' or (actor.company_id=master_data_import_rows.company_id and actor.role in ('admin','company_admin','hse_manager')))));
revoke all on public.master_data_records,public.master_data_revisions,public.master_data_dependencies,public.master_data_import_batches,public.master_data_import_rows from public,anon;
grant select on public.master_data_records,public.master_data_revisions,public.master_data_dependencies,public.master_data_import_batches,public.master_data_import_rows to authenticated;

create or replace function public.capture_master_data_revision()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.master_data_revisions(company_id,record_id,revision,snapshot,changed_by,change_reason)
  values(new.company_id,new.id,new.revision,to_jsonb(new)-'metadata'||jsonb_build_object('metadata',new.metadata),new.updated_by,case when tg_op='INSERT' then 'created' else lower(new.status) end);
  return new;
end;
$$;
drop trigger if exists capture_master_data_revision on public.master_data_records;
create trigger capture_master_data_revision after insert or update on public.master_data_records for each row execute function public.capture_master_data_revision();

create or replace function public.save_master_data_record(p_record_id uuid,p_company_id uuid,p_domain text,p_code text,p_name text,p_description text,p_effective_from date,p_effective_to date,p_expected_revision integer)
returns setof public.master_data_records language plpgsql security definer set search_path=public as $$
declare actor public.profiles; current_row public.master_data_records; saved public.master_data_records;
begin
  actor:=public.integration_require_admin(p_company_id);
  if p_domain not in ('location','department','organisation','person_role','asset','risk_classification','action_classification','document_category') or upper(trim(coalesce(p_code,''))) !~ '^[A-Z0-9][A-Z0-9_.\/-]{0,79}$' or char_length(trim(coalesce(p_name,''))) not between 2 and 160 or char_length(coalesce(p_description,''))>1000 or (p_effective_from is not null and p_effective_to<p_effective_from) then raise exception 'Master-data definition is invalid'; end if;
  if p_record_id is null then
    insert into public.master_data_records(company_id,domain,code,name,description,effective_from,effective_to,created_by,updated_by) values(p_company_id,p_domain,upper(trim(p_code)),trim(p_name),coalesce(p_description,''),p_effective_from,p_effective_to,actor.id,actor.id) returning * into saved;
  else
    select * into current_row from public.master_data_records where id=p_record_id and company_id=p_company_id and revision=p_expected_revision for update;
    if current_row.id is null then raise exception 'Master-data record changed or belongs to another company'; end if;
    if current_row.status in ('pending_review','merged','archived') then raise exception 'This master-data state cannot be edited'; end if;
    update public.master_data_records set domain=p_domain,code=upper(trim(p_code)),name=trim(p_name),description=coalesce(p_description,''),effective_from=p_effective_from,effective_to=p_effective_to,status='draft',review_requested_by=null,approved_by=null,approved_at=null,revision=revision+1,updated_by=actor.id,updated_at=now() where id=current_row.id returning * into saved;
  end if;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code) values(p_company_id,actor.id,actor.full_name,actor.role,'master_data_saved','master-data','master_data_records',saved.id,'Canonical master-data value saved as draft',jsonb_build_object('domain',saved.domain,'code',saved.code,'revision',saved.revision),'master_data.saved');
  return next saved;
exception when unique_violation then raise exception 'This master-data code already exists in the selected company and domain';
end;
$$;

create or replace function public.set_master_data_record_status(p_record_id uuid,p_company_id uuid,p_status text,p_expected_revision integer)
returns setof public.master_data_records language plpgsql security definer set search_path=public as $$
declare actor public.profiles; current_row public.master_data_records; saved public.master_data_records;
begin
  actor:=public.integration_require_admin(p_company_id);
  select * into current_row from public.master_data_records where id=p_record_id and company_id=p_company_id and revision=p_expected_revision for update;
  if current_row.id is null then raise exception 'Master-data record changed or belongs to another company'; end if;
  if p_status='pending_review' and current_row.status not in ('draft','inactive') then raise exception 'Only a draft or inactive value may request review'; end if;
  if p_status='active' and current_row.status<>'pending_review' then raise exception 'Only a pending value may be approved'; end if;
  if p_status='inactive' and current_row.status not in ('active','pending_review') then raise exception 'Only an active or pending value may become inactive'; end if;
  if p_status='archived' and current_row.status<>'inactive' then raise exception 'Only an inactive value may be archived'; end if;
  if p_status not in ('pending_review','active','inactive','archived') then raise exception 'Unsupported master-data governance status'; end if;
  if p_status in ('active','inactive') and current_row.status='pending_review' and current_row.review_requested_by=actor.id then raise exception 'The requester cannot decide the same master-data value'; end if;
  if p_status in ('inactive','archived') and exists(select 1 from public.master_data_dependencies d where d.master_record_id=current_row.id and d.company_id=p_company_id and d.active) then raise exception 'Master-data value is still referenced by active company records'; end if;
  update public.master_data_records set status=p_status,review_requested_by=case when p_status='pending_review' then actor.id else review_requested_by end,approved_by=case when p_status='active' then actor.id else approved_by end,approved_at=case when p_status='active' then now() else approved_at end,revision=revision+1,updated_by=actor.id,updated_at=now() where id=current_row.id returning * into saved;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code,outcome) values(p_company_id,actor.id,actor.full_name,actor.role,'master_data_'||p_status,'master-data','master_data_records',saved.id,'Canonical master-data value changed to '||p_status,jsonb_build_object('domain',saved.domain,'code',saved.code,'revision',saved.revision),'master_data.'||p_status,case when p_status='inactive' and current_row.status='pending_review' then 'denied' else 'success' end);
  return next saved;
end;
$$;

create or replace function public.set_master_data_dependency(p_company_id uuid,p_master_record_id uuid,p_source_table text,p_source_record_id uuid,p_source_field text,p_source_ref text,p_active boolean)
returns setof public.master_data_dependencies language plpgsql security definer set search_path=public as $$
declare actor public.profiles; saved public.master_data_dependencies;
begin
  actor:=public.integration_require_admin(p_company_id);
  if p_source_table !~ '^[a-z][a-z0-9_]{1,79}$' or p_source_field !~ '^[a-z][a-z0-9_]{1,79}$' or char_length(trim(coalesce(p_source_ref,''))) not between 1 and 160 or not exists(select 1 from public.master_data_records r where r.id=p_master_record_id and r.company_id=p_company_id and r.status<>'merged') then raise exception 'Master-data dependency is invalid'; end if;
  insert into public.master_data_dependencies(company_id,master_record_id,source_table,source_record_id,source_field,source_ref,active,registered_by) values(p_company_id,p_master_record_id,p_source_table,p_source_record_id,p_source_field,trim(p_source_ref),p_active,actor.id)
  on conflict(company_id,master_record_id,source_table,source_record_id,source_field) do update set source_ref=excluded.source_ref,active=excluded.active,registered_by=excluded.registered_by,updated_at=now() returning * into saved;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code) values(p_company_id,actor.id,actor.full_name,actor.role,case when saved.active then 'master_data_dependency_registered' else 'master_data_dependency_released' end,'master-data',saved.source_table,saved.source_record_id,case when saved.active then 'Canonical master-data dependency registered' else 'Canonical master-data dependency released' end,jsonb_build_object('master_record_id',saved.master_record_id,'source_field',saved.source_field,'source_ref',saved.source_ref),'master_data.dependency_changed');
  return next saved;
end;
$$;

create or replace function public.merge_master_data_records(p_source_id uuid,p_target_id uuid,p_company_id uuid,p_source_revision integer,p_target_revision integer)
returns setof public.master_data_records language plpgsql security definer set search_path=public as $$
declare actor public.profiles; source public.master_data_records; target public.master_data_records; saved public.master_data_records;
begin
  actor:=public.integration_require_admin(p_company_id);
  if p_source_id=p_target_id then raise exception 'A master-data value cannot merge into itself'; end if;
  select * into source from public.master_data_records where id=p_source_id and company_id=p_company_id and revision=p_source_revision for update;
  select * into target from public.master_data_records where id=p_target_id and company_id=p_company_id and revision=p_target_revision for update;
  if source.id is null or target.id is null or source.domain<>target.domain or source.status not in ('draft','inactive') or target.status<>'active' then raise exception 'Merge requires an exact draft/inactive duplicate and active target in the same company domain'; end if;
  insert into public.master_data_dependencies(company_id,master_record_id,source_table,source_record_id,source_field,source_ref,active,registered_by,created_at,updated_at)
  select company_id,target.id,source_table,source_record_id,source_field,source_ref,active,actor.id,created_at,now() from public.master_data_dependencies where master_record_id=source.id
  on conflict(company_id,master_record_id,source_table,source_record_id,source_field) do update set active=excluded.active,source_ref=excluded.source_ref,registered_by=excluded.registered_by,updated_at=now();
  delete from public.master_data_dependencies where master_record_id=source.id;
  update public.master_data_records set status='merged',merged_into_id=target.id,revision=revision+1,updated_by=actor.id,updated_at=now() where id=source.id returning * into saved;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code) values(p_company_id,actor.id,actor.full_name,actor.role,'master_data_merged','master-data','master_data_records',saved.id,'Duplicate master-data value merged into canonical target',jsonb_build_object('source_id',source.id,'target_id',target.id,'domain',source.domain),'master_data.merged');
  return next saved;
end;
$$;

create or replace function public.stage_master_data_import(p_company_id uuid,p_domain text,p_field_map jsonb,p_rows jsonb)
returns setof public.master_data_import_batches language plpgsql security definer set search_path=public as $$
declare actor public.profiles; saved public.master_data_import_batches; item jsonb; field_name text; row_number integer:=0; clean jsonb; code text; seen text[]:=array[]::text[]; fingerprint text;
begin
  actor:=public.integration_require_admin(p_company_id);
  if p_domain not in ('location','department','organisation','person_role','asset','risk_classification','action_classification','document_category') or jsonb_typeof(p_field_map)<>'object' or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 or octet_length(p_rows::text)>1048576 then raise exception 'Master-data import must be a bounded reviewed domain, mapping and row array'; end if;
  if not exists(select 1 from jsonb_each_text(p_field_map) where value='code') or not exists(select 1 from jsonb_each_text(p_field_map) where value='name') or exists(select 1 from jsonb_each_text(p_field_map) where value not in ('code','name','description','effective_from','effective_to')) or (select count(*) from jsonb_each_text(p_field_map))<>(select count(distinct value) from jsonb_each_text(p_field_map)) then raise exception 'Master-data mapping requires unique code and name targets and permits only reviewed fields'; end if;
  fingerprint:=md5(p_field_map::text);
  insert into public.master_data_import_batches(company_id,domain,field_map,mapping_fingerprint,row_count,requested_by) values(p_company_id,p_domain,p_field_map,fingerprint,jsonb_array_length(p_rows),actor.id) returning * into saved;
  for item in select value from jsonb_array_elements(p_rows) loop
    row_number:=row_number+1;
    if jsonb_typeof(item)<>'object' then raise exception 'Master-data import row % must be an object',row_number; end if;
    for field_name in select value from jsonb_object_keys(item) fields(value) loop if field_name not in ('code','name','description','effective_from','effective_to') then raise exception 'Master-data import row % contains unsupported field',row_number; end if; end loop;
    code:=upper(trim(coalesce(item->>'code','')));
    if code !~ '^[A-Z0-9][A-Z0-9_.\/-]{0,79}$' or char_length(trim(coalesce(item->>'name',''))) not between 2 and 160 or lower(code)=any(seen) then raise exception 'Master-data import row % has invalid or duplicate identity',row_number; end if;
    if coalesce(item->>'effective_from','')<>'' and item->>'effective_from' !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(item->>'effective_to','')<>'' and item->>'effective_to' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Master-data import row % has invalid effective date',row_number; end if;
    clean:=jsonb_build_object('code',code,'name',left(trim(item->>'name'),160),'description',left(coalesce(item->>'description',''),1000),'effective_from',nullif(item->>'effective_from',''),'effective_to',nullif(item->>'effective_to',''));
    insert into public.master_data_import_rows(batch_id,company_id,row_no,source_data,row_fingerprint) values(saved.id,p_company_id,row_number,clean,md5(clean::text));seen:=array_append(seen,lower(code));
  end loop;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code) values(p_company_id,actor.id,actor.full_name,actor.role,'master_data_import_staged','master-data','master_data_import_batches',saved.id,'Mapped master-data import staged for independent review',jsonb_build_object('domain',p_domain,'row_count',saved.row_count,'mapping_fingerprint',fingerprint),'master_data.import_staged');
  return next saved;
end;
$$;

create or replace function public.set_master_data_import_status(p_batch_id uuid,p_company_id uuid,p_status text,p_expected_revision integer)
returns setof public.master_data_import_batches language plpgsql security definer set search_path=public as $$
declare actor public.profiles; current_row public.master_data_import_batches; saved public.master_data_import_batches; item public.master_data_import_rows; created public.master_data_records;
begin
  actor:=public.integration_require_admin(p_company_id);
  select * into current_row from public.master_data_import_batches where id=p_batch_id and company_id=p_company_id and revision=p_expected_revision for update;
  if current_row.id is null then raise exception 'Master-data import changed or belongs to another company'; end if;
  if p_status='pending_review' and current_row.status<>'staged' then raise exception 'Only a staged master-data import may request review'; end if;
  if p_status in ('approved','rejected') and current_row.status<>'pending_review' then raise exception 'Only a pending master-data import may be decided'; end if;
  if p_status not in ('pending_review','approved','rejected') then raise exception 'Unsupported master-data import status'; end if;
  if p_status in ('approved','rejected') and current_row.requested_by=actor.id then raise exception 'The requester cannot decide the same master-data import'; end if;
  if p_status='approved' then
    for item in select * from public.master_data_import_rows where batch_id=current_row.id order by row_no for update loop
      insert into public.master_data_records(company_id,domain,code,name,description,effective_from,effective_to,status,created_by,review_requested_by,approved_by,approved_at,updated_by)
      values(p_company_id,current_row.domain,item.source_data->>'code',item.source_data->>'name',coalesce(item.source_data->>'description',''),nullif(item.source_data->>'effective_from','')::date,nullif(item.source_data->>'effective_to','')::date,'active',current_row.requested_by,current_row.requested_by,actor.id,now(),actor.id) returning * into created;
      update public.master_data_import_rows set created_record_id=created.id where id=item.id;
    end loop;
  end if;
  update public.master_data_import_batches set status=p_status,approved_by=case when p_status in ('approved','rejected') then actor.id else approved_by end,approved_at=case when p_status='approved' then now() else approved_at end,revision=revision+1,updated_at=now() where id=current_row.id returning * into saved;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code,outcome) values(p_company_id,actor.id,actor.full_name,actor.role,'master_data_import_'||p_status,'master-data','master_data_import_batches',saved.id,'Master-data import changed to '||p_status,jsonb_build_object('domain',saved.domain,'row_count',saved.row_count,'mapping_fingerprint',saved.mapping_fingerprint),'master_data.import_'||p_status,case when p_status='rejected' then 'denied' else 'success' end);
  return next saved;
exception when unique_violation then raise exception 'Approved import conflicts with an existing company master-data code';
end;
$$;

revoke all on function public.capture_master_data_revision() from public,anon,authenticated;
revoke all on function public.save_master_data_record(uuid,uuid,text,text,text,text,date,date,integer) from public,anon;
revoke all on function public.set_master_data_record_status(uuid,uuid,text,integer) from public,anon;
revoke all on function public.set_master_data_dependency(uuid,uuid,text,uuid,text,text,boolean) from public,anon;
revoke all on function public.merge_master_data_records(uuid,uuid,uuid,integer,integer) from public,anon;
revoke all on function public.stage_master_data_import(uuid,text,jsonb,jsonb) from public,anon;
revoke all on function public.set_master_data_import_status(uuid,uuid,text,integer) from public,anon;
grant execute on function public.save_master_data_record(uuid,uuid,text,text,text,text,date,date,integer) to authenticated;
grant execute on function public.set_master_data_record_status(uuid,uuid,text,integer) to authenticated;
grant execute on function public.set_master_data_dependency(uuid,uuid,text,uuid,text,text,boolean) to authenticated;
grant execute on function public.merge_master_data_records(uuid,uuid,uuid,integer,integer) to authenticated;
grant execute on function public.stage_master_data_import(uuid,text,jsonb,jsonb) to authenticated;
grant execute on function public.set_master_data_import_status(uuid,uuid,text,integer) to authenticated;

commit;
