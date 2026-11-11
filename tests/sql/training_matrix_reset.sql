-- Verify both resets with disposable data and the same grants used by PostgREST.
begin;
grant usage on schema public, auth to authenticated;
grant select on public.competency_matrix, public.competencies, public.people,
  public.training_followup, public.action_tracker to authenticated;
grant update on public.competency_matrix to authenticated;
alter table public.competency_matrix add column if not exists expiry_date date;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;

insert into auth.users (id) values
  ('d1200000-0000-4000-8000-000000000001'), ('d1200000-0000-4000-8000-000000000002'),
  ('d1200000-0000-4000-8000-000000000003'), ('d1200000-0000-4000-8000-000000000004');
insert into public.companies (id, name) values
  ('d1200000-0000-4000-8000-000000000010', 'Training matrix fixture A'),
  ('d1200000-0000-4000-8000-000000000020', 'Training matrix fixture B');
insert into public.profiles (id, company_id, role, status, permissions) values
  ('d1200000-0000-4000-8000-000000000001', 'd1200000-0000-4000-8000-000000000010', 'admin', 'active', '{}'),
  ('d1200000-0000-4000-8000-000000000002', 'd1200000-0000-4000-8000-000000000010', 'employee', 'active', '{}'),
  ('d1200000-0000-4000-8000-000000000003', 'd1200000-0000-4000-8000-000000000020', 'admin', 'active', '{}'),
  ('d1200000-0000-4000-8000-000000000004', 'd1200000-0000-4000-8000-000000000010', 'admin', 'active',
   '{"access_v1":{"training.competency":{"delete":false}}}');
insert into public.people (id, company_id, first_name, last_name, status) values
  ('d1200000-0000-4000-8000-000000000011', 'd1200000-0000-4000-8000-000000000010', 'Fictional', 'Worker', 'active'),
  ('d1200000-0000-4000-8000-000000000021', 'd1200000-0000-4000-8000-000000000020', 'Foreign', 'Worker', 'active');
insert into public.competencies (id, company_id, name) values
  ('d1200000-0000-4000-8000-000000000012', 'd1200000-0000-4000-8000-000000000010', 'Fictional skill A'),
  ('d1200000-0000-4000-8000-000000000013', 'd1200000-0000-4000-8000-000000000010', 'Fictional skill B'),
  ('d1200000-0000-4000-8000-000000000022', 'd1200000-0000-4000-8000-000000000020', 'Foreign skill');
insert into public.training_followup (id, company_id, person_id, training_topic, passed, certificate) values
  ('d1200000-0000-4000-8000-000000000014', 'd1200000-0000-4000-8000-000000000010',
   'd1200000-0000-4000-8000-000000000011', 'Fictional training', true, 'TEST-EVIDENCE');
select set_config('request.jwt.claim.sub', 'd1200000-0000-4000-8000-000000000001', true);
update public.training_followup set evidence_review_status = 'reviewed', evidence_reviewed_by = auth.uid(),
  evidence_review_note = 'Fictional evidence checked', evidence_reviewed_at = now()
where id = 'd1200000-0000-4000-8000-000000000014';
insert into public.competency_matrix (id, company_id, person_id, competency_id,
  current_level, required_level, notes, supporting_training_id) values
  ('d1200000-0000-4000-8000-000000000015', 'd1200000-0000-4000-8000-000000000010',
   'd1200000-0000-4000-8000-000000000011', 'd1200000-0000-4000-8000-000000000012', 1, 3,
   'Fictional assessment', 'd1200000-0000-4000-8000-000000000014'),
  ('d1200000-0000-4000-8000-000000000016', 'd1200000-0000-4000-8000-000000000010',
   'd1200000-0000-4000-8000-000000000011', 'd1200000-0000-4000-8000-000000000013', 2, 3, null, null),
  ('d1200000-0000-4000-8000-000000000023', 'd1200000-0000-4000-8000-000000000020',
   'd1200000-0000-4000-8000-000000000021', 'd1200000-0000-4000-8000-000000000022', 2, 4, null, null);
update public.competency_matrix set expiry_date = current_date - 1
where id = 'd1200000-0000-4000-8000-000000000015';
insert into public.competency_matrix (id, company_id, person_id, notes, expiry_date) values
  ('d1200000-0000-4000-8000-000000000018', 'd1200000-0000-4000-8000-000000000010',
   'd1200000-0000-4000-8000-000000000011', 'Fictional standalone assessment', current_date + 30);
insert into public.action_tracker (id, company_id, source_id, description) values
  ('d1200000-0000-4000-8000-000000000017', 'd1200000-0000-4000-8000-000000000010',
   'd1200000-0000-4000-8000-000000000015', 'Fictional gap follow-up');

set local role authenticated;
do $$
declare
  company constant uuid := 'd1200000-0000-4000-8000-000000000010';
  other_company constant uuid := 'd1200000-0000-4000-8000-000000000020';
  worker constant uuid := 'd1200000-0000-4000-8000-000000000011';
  skill_a constant uuid := 'd1200000-0000-4000-8000-000000000012';
  skill_b constant uuid := 'd1200000-0000-4000-8000-000000000013';
  cell_id constant uuid := 'd1200000-0000-4000-8000-000000000015';
  receipt jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'd1200000-0000-4000-8000-000000000002', true);
  begin
    perform public.reset_training_matrix(company, 'cells');
    raise exception 'Employee reset the matrix';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', 'd1200000-0000-4000-8000-000000000004', true);
  begin
    perform public.reset_training_matrix(company, 'cells');
    raise exception 'Admin without competency delete permission reset the matrix';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', 'd1200000-0000-4000-8000-000000000001', true);
  begin
    perform public.reset_training_matrix(other_company, 'full');
    raise exception 'Admin reset another company''s matrix';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_training_matrix_members(company, 'rows', array['d1200000-0000-4000-8000-000000000021'::uuid]);
    raise exception 'Admin added another company''s person';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.training_matrix_settings (company_id) values (company);
    raise exception 'Admin bypassed the layout RPC';
  exception when insufficient_privilege then null;
  end;

  perform public.set_training_matrix_members(company, 'rows', array[worker]);
  perform public.set_training_matrix_members(company, 'columns', array[skill_a]);
  perform public.set_training_matrix_members(company, 'columns', array[skill_a, skill_b], true);
  receipt := public.reset_training_matrix(company, 'cells');
  if receipt->>'cleared_cells' is distinct from '2'
    or receipt->'person_ids' is distinct from to_jsonb(array[worker])
    or receipt->'competency_ids' is distinct from to_jsonb(array[skill_a, skill_b]) then
    raise exception 'Cells-only reset changed the layout or returned the wrong count: %', receipt;
  end if;
  if not exists (select 1 from public.competency_matrix c where id = cell_id and c.person_id = worker
    and c.competency_id = skill_a and num_nonnulls(c.current_level, c.required_level, c.notes, c.supporting_training_id, c.expiry_date) = 0) then
    raise exception 'Cells-only reset removed identity or retained assessment data';
  end if;
  if public.reset_training_matrix(company, 'cells')->>'cleared_cells' is distinct from '0' then
    raise exception 'Retried cells-only reset modified an already empty cell';
  end if;

  update public.competency_matrix set current_level = 3, required_level = 2 where id = cell_id;
  receipt := public.reset_training_matrix(company, 'full');
  if receipt->>'cleared_cells' is distinct from '1'
    or receipt->'person_ids' is distinct from '[]'::jsonb or receipt->'competency_ids' is distinct from '[]'::jsonb
    or not exists (select 1 from public.training_matrix_settings s where company_id = company
      and s.person_ids = '{}'::uuid[] and s.competency_ids = '{}'::uuid[]) then
    raise exception 'Full reset did not persist an empty layout';
  end if;
  if not exists (select 1 from public.people where id = worker)
    or not exists (select 1 from public.competencies where id = skill_a)
    or not exists (select 1 from public.competency_matrix where id = 'd1200000-0000-4000-8000-000000000018'
      and notes = 'Fictional standalone assessment' and expiry_date = current_date + 30)
    or not exists (select 1 from public.training_followup where id = 'd1200000-0000-4000-8000-000000000014' and evidence_review_status = 'reviewed')
    or not exists (select 1 from public.action_tracker where id = 'd1200000-0000-4000-8000-000000000017' and source_id = cell_id) then
    raise exception 'Full reset changed related People, catalogue, training or action records';
  end if;
  perform public.set_training_matrix_members(company, 'columns', array[skill_b], true);
  if not exists (select 1 from public.training_matrix_settings s where company_id = company
    and s.person_ids = '{}'::uuid[] and s.competency_ids = array[skill_b]) then
    raise exception 'Adding a column to an empty layout restored unrelated members';
  end if;

  perform set_config('request.jwt.claim.sub', 'd1200000-0000-4000-8000-000000000003', true);
  if exists (select 1 from public.training_matrix_settings s where company_id = company)
    or not exists (select 1 from public.competency_matrix where company_id = other_company and current_level = 2 and required_level = 4) then
    raise exception 'Reset exposed the layout or modified another company''s cells';
  end if;
end;
$$;
reset role;
rollback;
