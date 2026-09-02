-- AURIS360 Modular Foundation Phase 23: governed reusable import mapping profiles.
begin;

create table if not exists public.import_mapping_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check(char_length(trim(name)) between 3 and 100),
  module_key text not null default 'actions' check(module_key='actions'),
  operation text not null check(operation in ('create','update')),
  field_map jsonb not null check(jsonb_typeof(field_map)='object'),
  value_map jsonb not null default '{}'::jsonb check(jsonb_typeof(value_map)='object'),
  mapping_fingerprint text not null check(char_length(mapping_fingerprint)=32),
  status text not null default 'draft' check(status in ('draft','pending_review','active','paused','rejected')),
  revision integer not null default 1 check(revision>0),
  created_by uuid not null references public.profiles(id),
  review_requested_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists import_mapping_profiles_company_name_idx on public.import_mapping_profiles(company_id,lower(name));
create index if not exists import_mapping_profiles_company_status_idx on public.import_mapping_profiles(company_id,status,updated_at desc);

alter table public.data_import_batches add column if not exists mapping_profile_id uuid references public.import_mapping_profiles(id) on delete restrict;
alter table public.data_import_batches add column if not exists mapping_revision integer;
alter table public.data_import_batches add column if not exists mapping_fingerprint text;
alter table public.data_import_batches add constraint data_import_batches_mapping_identity_check check(
  (mapping_profile_id is null and mapping_revision is null and mapping_fingerprint is null) or
  (mapping_profile_id is not null and mapping_revision>0 and char_length(mapping_fingerprint)=32)
);
create index if not exists data_import_batches_mapping_idx on public.data_import_batches(company_id,mapping_profile_id,created_at desc) where mapping_profile_id is not null;

alter table public.import_mapping_profiles enable row level security;
drop policy if exists import_mapping_profiles_company_admin on public.import_mapping_profiles;
create policy import_mapping_profiles_company_admin on public.import_mapping_profiles for select using (
  exists(select 1 from public.profiles actor where actor.id=auth.uid() and (actor.role='sephs_admin' or (actor.company_id=import_mapping_profiles.company_id and actor.role in ('admin','company_admin','hse_manager'))))
);
revoke all on public.import_mapping_profiles from public,anon;
grant select on public.import_mapping_profiles to authenticated;

create or replace function public.save_import_mapping_profile(p_profile_id uuid,p_company_id uuid,p_name text,p_operation text,p_field_map jsonb,p_value_map jsonb,p_expected_revision integer)
returns setof public.import_mapping_profiles language plpgsql security definer set search_path=public as $$
declare actor public.profiles; saved public.import_mapping_profiles; current_row public.import_mapping_profiles; source_name text; target_name text; alias_field text; alias_object jsonb; alias_source text; alias_target text; allowed_targets text[]; required_targets text[]; fingerprint text;
begin
  actor:=public.integration_require_admin(p_company_id);
  if p_operation not in ('create','update') then raise exception 'Mapping operation must be create or update'; end if;
  if char_length(trim(coalesce(p_name,''))) not between 3 and 100 then raise exception 'Mapping profile name must contain 3 to 100 characters'; end if;
  if jsonb_typeof(p_field_map)<>'object' or (select count(*) from jsonb_object_keys(p_field_map)) not between 1 and 20 or jsonb_typeof(coalesce(p_value_map,'{}'::jsonb))<>'object' or octet_length((p_field_map||coalesce(p_value_map,'{}'::jsonb))::text)>16384 then raise exception 'Mapping profile must contain bounded reviewed objects'; end if;
  allowed_targets:=case when p_operation='update' then array['record_id','action_ref','expected_updated_at','title','description','status','priority','target_date'] else array['action_ref','title','description','status','priority','target_date'] end;
  required_targets:=case when p_operation='update' then array['record_id','action_ref','expected_updated_at'] else array['action_ref'] end;
  for source_name,target_name in select key,value from jsonb_each_text(p_field_map) loop
    if source_name !~ '^[A-Za-z][A-Za-z0-9 _.-]{0,79}$' or target_name<>all(allowed_targets) then raise exception 'Mapping contains an unsafe source or unsupported AURIS target'; end if;
  end loop;
  if (select count(*) from jsonb_each_text(p_field_map))<>(select count(distinct value) from jsonb_each_text(p_field_map)) then raise exception 'Each AURIS field may be mapped only once'; end if;
  if exists(select 1 from unnest(required_targets) required where not exists(select 1 from jsonb_each_text(p_field_map) mapped where mapped.value=required)) then raise exception 'Mapping is missing a required AURIS identity field'; end if;
  for alias_field,alias_object in select key,value from jsonb_each(coalesce(p_value_map,'{}'::jsonb)) loop
    if alias_field not in ('status','priority') or not exists(select 1 from jsonb_each_text(p_field_map) mapped where mapped.value=alias_field) or jsonb_typeof(alias_object)<>'object' or (select count(*) from jsonb_object_keys(alias_object))>30 then raise exception 'Value aliases are limited to mapped status and priority fields'; end if;
    for alias_source,alias_target in select key,value from jsonb_each_text(alias_object) loop
      if char_length(trim(alias_source)) not between 1 and 80 or (alias_field='status' and alias_target not in ('open','in_progress','overdue','closed')) or (alias_field='priority' and alias_target not in ('low','medium','high','critical')) then raise exception 'Value alias contains an unsupported controlled value'; end if;
    end loop;
  end loop;
  fingerprint:=md5(jsonb_build_object('operation',p_operation,'field_map',p_field_map,'value_map',coalesce(p_value_map,'{}'::jsonb))::text);
  if p_profile_id is null then
    insert into public.import_mapping_profiles(company_id,name,operation,field_map,value_map,mapping_fingerprint,created_by,updated_by) values(p_company_id,trim(p_name),p_operation,p_field_map,coalesce(p_value_map,'{}'::jsonb),fingerprint,actor.id,actor.id) returning * into saved;
  else
    select * into current_row from public.import_mapping_profiles where id=p_profile_id and company_id=p_company_id and revision=p_expected_revision for update;
    if current_row.id is null then raise exception 'Mapping profile changed or belongs to another company'; end if;
    if current_row.status='pending_review' then raise exception 'A mapping pending review cannot be edited'; end if;
    if exists(select 1 from public.data_import_batches b where b.mapping_profile_id=current_row.id and b.status in ('pending_review','approved','processing')) then raise exception 'Mapping cannot change while a governed batch is awaiting or executing approval'; end if;
    update public.import_mapping_profiles set name=trim(p_name),operation=p_operation,field_map=p_field_map,value_map=coalesce(p_value_map,'{}'::jsonb),mapping_fingerprint=fingerprint,status='draft',review_requested_by=null,approved_by=null,approved_at=null,revision=revision+1,updated_by=actor.id,updated_at=now() where id=current_row.id returning * into saved;
  end if;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code)
  values(p_company_id,actor.id,actor.full_name,actor.role,'import_mapping_saved','integrations','import_mapping_profiles',saved.id,'Governed import mapping saved as a non-executable draft',jsonb_build_object('operation',saved.operation,'revision',saved.revision,'fingerprint',saved.mapping_fingerprint),'integrations.mapping_saved');
  return next saved;
exception when unique_violation then raise exception 'A mapping profile with this name already exists for the company';
end;
$$;

create or replace function public.set_import_mapping_status(p_profile_id uuid,p_company_id uuid,p_status text,p_expected_revision integer)
returns setof public.import_mapping_profiles language plpgsql security definer set search_path=public as $$
declare actor public.profiles; current_row public.import_mapping_profiles; saved public.import_mapping_profiles;
begin
  actor:=public.integration_require_admin(p_company_id);
  select * into current_row from public.import_mapping_profiles where id=p_profile_id and company_id=p_company_id and revision=p_expected_revision for update;
  if current_row.id is null then raise exception 'Mapping profile changed or belongs to another company'; end if;
  if p_status='pending_review' and current_row.status not in ('draft','paused','rejected') then raise exception 'Only a controlled mapping draft may request review'; end if;
  if p_status in ('active','rejected') and current_row.status<>'pending_review' then raise exception 'Only a pending mapping may be decided'; end if;
  if p_status='paused' and current_row.status<>'active' then raise exception 'Only an active mapping may be paused'; end if;
  if p_status not in ('pending_review','active','rejected','paused') then raise exception 'Unsupported mapping governance status'; end if;
  if p_status in ('active','rejected') and current_row.review_requested_by=actor.id then raise exception 'The mapping requester cannot decide the same profile'; end if;
  if p_status='paused' and exists(select 1 from public.data_import_batches b where b.mapping_profile_id=current_row.id and b.status in ('pending_review','approved','processing')) then raise exception 'Mapping cannot pause while a governed batch is awaiting or executing approval'; end if;
  update public.import_mapping_profiles set status=p_status,review_requested_by=case when p_status='pending_review' then actor.id else review_requested_by end,approved_by=case when p_status in ('active','rejected') then actor.id else approved_by end,approved_at=case when p_status='active' then now() else approved_at end,revision=revision+1,updated_by=actor.id,updated_at=now() where id=current_row.id returning * into saved;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code,outcome)
  values(p_company_id,actor.id,actor.full_name,actor.role,'import_mapping_'||p_status,'integrations','import_mapping_profiles',saved.id,'Import mapping status changed to '||p_status,jsonb_build_object('operation',saved.operation,'revision',saved.revision,'fingerprint',saved.mapping_fingerprint),'integrations.mapping_'||p_status,case when p_status='rejected' then 'denied' else 'success' end);
  return next saved;
end;
$$;

create or replace function public.stage_mapped_action_batch(p_profile_id uuid,p_company_id uuid,p_expected_revision integer,p_rows jsonb)
returns setof public.data_import_batches language plpgsql security definer set search_path=public as $$
declare profile public.import_mapping_profiles; saved public.data_import_batches; item jsonb; field_name text; allowed_fields text[];
begin
  perform public.integration_require_admin(p_company_id);
  select * into profile from public.import_mapping_profiles where id=p_profile_id and company_id=p_company_id and revision=p_expected_revision and status='active' for share;
  if profile.id is null then raise exception 'Only an exact approved active mapping revision may stage a batch'; end if;
  allowed_fields:=case when profile.operation='update' then array['record_id','action_ref','expected_updated_at','title','description','status','priority','target_date'] else array['action_ref','title','description','status','priority','target_date'] end;
  if jsonb_typeof(p_rows)<>'array' then raise exception 'Mapped rows must be a reviewed array'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(item)<>'object' then raise exception 'Mapped rows must contain reviewed objects'; end if;
    for field_name in select value from jsonb_object_keys(item) as fields(value) loop if field_name<>all(allowed_fields) then raise exception 'Mapped row contains an unsupported field'; end if; end loop;
  end loop;
  if profile.operation='update' then select * into saved from public.stage_action_reconciliation(p_company_id,p_rows); else select * into saved from public.stage_action_import(p_company_id,p_rows); end if;
  update public.data_import_batches set mapping_profile_id=profile.id,mapping_revision=profile.revision,mapping_fingerprint=profile.mapping_fingerprint,updated_at=now() where id=saved.id and company_id=p_company_id returning * into saved;
  insert into public.audit_events(company_id,actor_user_id,action,module_name,related_table,related_id,summary,details,event_code)
  values(p_company_id,auth.uid(),'mapped_data_batch_staged','integrations','data_import_batches',saved.id,'Approved mapping revision attached to staged governed batch',jsonb_build_object('mapping_profile_id',profile.id,'mapping_revision',profile.revision,'mapping_fingerprint',profile.mapping_fingerprint,'operation',profile.operation),'integrations.mapped_batch_staged');
  return next saved;
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
  if current_row.mapping_profile_id is not null and not exists(select 1 from public.import_mapping_profiles m where m.id=current_row.mapping_profile_id and m.company_id=p_company_id and m.status='active' and m.revision=current_row.mapping_revision and m.mapping_fingerprint=current_row.mapping_fingerprint) then raise exception 'Mapped import profile is no longer the exact approved active revision'; end if;
  update public.data_import_batches set status=p_status,approved_by=case when p_status in ('approved','rejected') then actor.id else approved_by end,approved_at=case when p_status='approved' then now() else approved_at end,revision=revision+1,updated_at=now() where id=current_row.id returning * into saved;
  insert into public.audit_events(company_id,actor_user_id,actor_name,actor_role,action,module_name,related_table,related_id,summary,details,event_code,outcome)
  values(p_company_id,actor.id,actor.full_name,actor.role,'data_import_'||p_status,'integrations','data_import_batches',saved.id,'Import governance status changed to '||p_status,jsonb_build_object('row_count',saved.row_count,'revision',saved.revision,'mapping_profile_id',saved.mapping_profile_id,'mapping_revision',saved.mapping_revision),'integrations.import_'||p_status,case when p_status='rejected' then 'denied' else 'success' end);
  return next saved;
end;
$$;

revoke all on function public.save_import_mapping_profile(uuid,uuid,text,text,jsonb,jsonb,integer) from public,anon;
revoke all on function public.set_import_mapping_status(uuid,uuid,text,integer) from public,anon;
revoke all on function public.stage_mapped_action_batch(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.save_import_mapping_profile(uuid,uuid,text,text,jsonb,jsonb,integer) to authenticated;
grant execute on function public.set_import_mapping_status(uuid,uuid,text,integer) to authenticated;
grant execute on function public.stage_mapped_action_batch(uuid,uuid,integer,jsonb) to authenticated;

commit;
