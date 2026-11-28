-- Fictional generated-key, tenant/source and legacy-scope checks; all rows roll back.
begin;

insert into public.companies(id,name) values
  ('f1280000-0000-4000-8000-000000000010','Investigation identity fixture A'),
  ('f1280000-0000-4000-8000-000000000020','Investigation identity fixture B');

do $test$
declare company_a constant uuid:='f1280000-0000-4000-8000-000000000010';
  company_b constant uuid:='f1280000-0000-4000-8000-000000000020';
  source_a constant uuid:='f1280000-0000-4000-8000-000000000100';
  source_b constant uuid:='f1280000-0000-4000-8000-000000000101';
  key_a constant text:='ca-f1280000-0000-4000-8000-000000000201';
  key_b constant text:='action-f1280000-0000-4000-8000-000000000202';
  blocked boolean:=false; index_name text; original_id uuid;
begin
  insert into public.action_tracker(company_id,source_module,source_id,action_no,description,status,evidence)
    values(company_a,'investigation',source_a,key_a,'Original exact action','open','Retained evidence') returning id into original_id;
  begin
    insert into public.action_tracker(company_id,source_module,source_id,action_no,description,status)
      values(company_a,'investigation',source_a,key_a,'Concurrent duplicate','open');
  exception when unique_violation then
    get stacked diagnostics index_name=constraint_name;
    blocked:=index_name='investigation_generated_action_identity';
  end;
  if not blocked or (select count(*) from public.action_tracker where company_id=company_a and source_id=source_a and action_no=key_a)<>1
    or not exists(select 1 from public.action_tracker where id=original_id and description='Original exact action' and evidence='Retained evidence') then
    raise exception 'A repeated generated action key did not retain exactly one original action and evidence';
  end if;
  insert into public.action_tracker(company_id,source_module,source_id,action_no,description,status) values
    (company_a,'investigation',source_b,key_a,'Another source','open'),
    (company_b,'investigation',source_a,key_a,'Another company','open'),
    (company_a,'meeting',source_a,key_a,'Another module one','open'),
    (company_a,'meeting',source_a,key_a,'Another module two','open'),
    (company_a,'investigation',source_a,'INV-LEGACY-001','Legacy number one','open'),
    (company_a,'investigation',source_a,'INV-LEGACY-001','Legacy number two','open'),
    (company_a,'investigation',source_a,key_b,'Exact ID fallback key','open');
  blocked:=false;
  begin
    insert into public.action_tracker(company_id,source_module,source_id,action_no,description,status)
      values(company_a,'investigation',source_a,key_b,'Fallback duplicate','open');
  exception when unique_violation then blocked:=true;end;
  if not blocked then raise exception 'The generated action-ID fallback was not unique within its source';end if;
  blocked:=false;
  begin
    update public.action_tracker set action_no=key_b where id=original_id;
  exception when unique_violation then blocked:=true;end;
  if not blocked or not exists(select 1 from public.action_tracker where id=original_id and action_no=key_a and evidence='Retained evidence') then
    raise exception 'A conflicting identity update changed an existing action or evidence';
  end if;
end;
$test$;

rollback;
