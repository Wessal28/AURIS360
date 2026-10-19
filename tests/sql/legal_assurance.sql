-- Disposable fixtures; no official content, real approval or delivery is created.
begin;
set local row_security=on;
insert into auth.users(id) values('ae190000-0000-4000-8000-000000000001'),('ae190000-0000-4000-8000-000000000002');
insert into public.companies(id,name) values('ae190000-0000-4000-8000-000000000010','Legal fixture A'),('ae190000-0000-4000-8000-000000000020','Legal fixture B');
insert into public.profiles(id,company_id,full_name,role,status) values('ae190000-0000-4000-8000-000000000001','ae190000-0000-4000-8000-000000000010','Fictional legal reviewer','admin','active'),('ae190000-0000-4000-8000-000000000002','ae190000-0000-4000-8000-000000000020','Foreign reviewer','admin','active');
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
select set_config('request.jwt.claim.sub','ae190000-0000-4000-8000-000000000001',true);
grant usage on schema public,auth to authenticated;
grant select on public.profiles,public.legal_requirements,public.compliance_assessments,public.compliance_gaps,public.action_tracker,public.legal_compliance_records,public.legal_changes to authenticated;
create function public.legal_fixture_fail_action() returns trigger language plpgsql as $$begin if current_setting('legal.fixture_fail_action',true)='yes' and new.source_module='legal' then raise exception 'Synthetic remediation failure';end if;return new;end $$;
create trigger legal_fixture_fail_action before insert on public.action_tracker for each row execute function public.legal_fixture_fail_action();
set local role authenticated;
do $$declare company uuid:='ae190000-0000-4000-8000-000000000010';r jsonb;a jsonb;draft jsonb;rows jsonb;e jsonb;chg jsonb;v jsonb;actions integer;old_wording text;begin
 r:=public.save_legal_requirement(null,null,jsonb_build_object('company_id',company,'legislation','Fictional internal policy','legislation_type','internal_policy','requirement','Fictional duty','title','Fictional requirement'),'{"source_classification":"official","applicability_decision":"applicable"}');
 if r->>'source_verification_status'<>'unverified' or r->>'status'<>'not_assessed' or r->>'applicable'<>'true' then raise exception 'New requirement asserted an unrecorded assessment or source decision';end if;
 begin perform public.verify_legal_source((r->>'id')::uuid,(r->>'updated_at')::timestamptz,'Reviewed reference');raise exception 'Missing source reference verified';exception when raise_exception then if sqlerrm not like 'A source reference%' then raise;end if;end;
 r:=public.save_legal_requirement((r->>'id')::uuid,(r->>'updated_at')::timestamptz,jsonb_build_object('company_id',company,'legislation','Fictional internal policy'),'{"source_classification":"internal","official_source_url":"Controlled fictional policy POL-TEST","applicability_decision":"applicable"}');
 r:=public.verify_legal_source((r->>'id')::uuid,(r->>'updated_at')::timestamptz,'Fictional controlled source reviewed');
 if r->>'source_verified_by'<>'ae190000-0000-4000-8000-000000000001' or r->>'source_verified_at' is null then raise exception 'Source decision lacks authenticated provenance';end if;
 rows:=jsonb_build_array(jsonb_build_object('requirement_id',r->>'id','baseline_updated_at',r->>'updated_at','status','not_assessed','controls','Fictional controls'));
 draft:=jsonb_build_object('company_id',company,'title','Fictional assessment','assessment_date','2026-10-19','assessor','Fictional assessor','status','draft');
 a:=public.save_legal_assessment(null,null,draft,rows);
 if (select status from public.legal_requirements where id=(r->>'id')::uuid)<>'not_assessed' or exists(select 1 from public.compliance_gaps where company_id=company) then raise exception 'Draft published provisional findings';end if;
 begin perform public.save_legal_assessment((a->'assessment'->>'id')::uuid,1,draft||'{"status":"submitted"}',rows);raise exception 'Unanswered worksheet submitted';exception when raise_exception then if sqlerrm not like 'Deliberately assess%' then raise;end if;end;
 rows:=jsonb_set(rows,'{0,status}','"partial"');rows:=jsonb_set(rows,'{0,recommendation}','"Fictional remediation"');
 a:=public.save_legal_assessment((a->'assessment'->>'id')::uuid,1,draft,rows);
 if (select status from public.legal_requirements where id=(r->>'id')::uuid)<>'not_assessed' or exists(select 1 from public.action_tracker where company_id=company) then raise exception 'Draft partial result created live actions';end if;
 begin perform public.save_legal_assessment((a->'assessment'->>'id')::uuid,2,draft||'{"status":"approved"}',rows);raise exception 'Status dropdown bypassed approval';exception when raise_exception then if sqlerrm not like 'Use the explicit%' then raise;end if;end;
 a:=public.save_legal_assessment((a->'assessment'->>'id')::uuid,2,draft||'{"status":"submitted"}',rows);
 begin perform public.save_legal_assessment((a->'assessment'->>'id')::uuid,3,draft,rows,'approve',null);raise exception 'Approval note omitted';exception when raise_exception then if sqlerrm not like 'Submit the saved worksheet%' then raise;end if;end;
 perform set_config('legal.fixture_fail_action','yes',true);
 begin perform public.save_legal_assessment((a->'assessment'->>'id')::uuid,3,jsonb_build_object('company_id',company),rows,'approve','Fictional failed transaction');raise exception 'Partial remediation commit accepted';exception when raise_exception then if sqlerrm<>'Synthetic remediation failure' then raise;end if;end;
 if (select status from public.compliance_assessments where id=(a->'assessment'->>'id')::uuid)<>'submitted' or (select status from public.legal_requirements where id=(r->>'id')::uuid)<>'not_assessed' or exists(select 1 from public.compliance_gaps where company_id=company) then raise exception 'Failed approval left partial published results';end if;
 perform set_config('legal.fixture_fail_action','no',true);
 a:=public.save_legal_assessment((a->'assessment'->>'id')::uuid,3,jsonb_build_object('company_id',company),rows,'approve','Fictional review of the recorded worksheet');
 if a->'assessment'->>'approved_by_id'<>'ae190000-0000-4000-8000-000000000001' or a->'assessment'->>'approved_at' is null or a->'assessment'->>'approved_by'<>'Fictional legal reviewer' then raise exception 'Approval actor or timestamp missing';end if;
 if jsonb_array_length(a->'remediation')<>1 or (select status from public.legal_requirements where id=(r->>'id')::uuid)<>'partial' then raise exception 'Approval did not publish exactly one remediation';end if;
 if not exists(select 1 from public.compliance_gaps g join public.action_tracker x on x.id=g.action_id where g.requirement_id=(r->>'id')::uuid and x.source_module='legal' and x.source_type='legal' and x.source_id=g.requirement_id and x.company_id=company) then raise exception 'Gap lacks exact Master Action relationship';end if;
 begin perform public.save_legal_assessment((a->'assessment'->>'id')::uuid,4,draft,rows);raise exception 'Approved assessment overwritten';exception when raise_exception then if sqlerrm not like 'Approved assessments%' then raise;end if;end;
 begin update public.compliance_assessments set status='approved' where id=(a->'assessment'->>'id')::uuid;raise exception 'Direct status write accepted';exception when insufficient_privilege then null;end;
 -- Authoritative applicability is one persisted decision, not two independent flags.
 select to_jsonb(q) into r from public.legal_requirements q where id=(r->>'id')::uuid;
 r:=public.save_legal_requirement((r->>'id')::uuid,(r->>'updated_at')::timestamptz,jsonb_build_object('company_id',company,'legislation','Fictional internal policy'),'{"source_classification":"internal","official_source_url":"Controlled fictional policy POL-TEST","applicability_decision":"not_applicable","applicability_rationale":"Fictional activity outside scope"}');
 if r->>'applicable'<>'false' or r->>'status'<>'not_applicable' then raise exception 'Applicability views disagree';end if;
 begin perform public.save_legal_assessment(null,null,draft||'{"status":"approved"}',rows,null);raise exception 'Null command bypassed approval';exception when raise_exception then if sqlerrm not like 'Unsupported assessment command%' then raise;end if;end;
 -- Evidence review records an actual decision; document notes alone are not attachments.
 begin perform public.save_legal_evidence('ae190000-0000-4000-8000-000000000071',null,jsonb_build_object('company_id',company,'requirement_id',r->>'id','record_type','evidence','title','Foreign evidence link','status','submitted','payload','{"attachments":[{"bucket":"evidence","path":"foreign/legal/file.pdf"}]}'::jsonb));raise exception 'Foreign storage evidence accepted';exception when raise_exception then if sqlerrm not like 'Invalid evidence document%' then raise;end if;end;
 e:=public.save_legal_evidence('ae190000-0000-4000-8000-000000000070',null,jsonb_build_object('company_id',company,'requirement_id',r->>'id','record_type','evidence','title','Fictional evidence','status','submitted','source_id','Controlled fixture record','payload','{"notes":"Fictional notes","attachments":[]}'::jsonb));
 e:=public.save_legal_evidence(e->>'id',1,jsonb_build_object('company_id',company),'verify','Fictional evidence review');
 if e->>'status'<>'verified' or e->'payload'->>'reviewed_by'<>'ae190000-0000-4000-8000-000000000001' then raise exception 'Evidence verification provenance missing';end if;
 begin perform public.save_legal_evidence(e->>'id',2,jsonb_build_object('company_id',company,'status','verified'));raise exception 'Evidence status bypassed review';exception when raise_exception then if sqlerrm not like 'Use Verify%' then raise;end if;end;
 -- A regulatory proposal is inert until explicitly reviewed and applied.
 chg:=public.save_legal_change(null,null,jsonb_build_object('company_id',company,'requirement_id',r->>'id','legislation','Fictional internal policy','source','Fictional controlled change','previous_wording','Fictional duty','new_wording','Revised fictional duty'));
 if (select requirement from public.legal_requirements where id=(r->>'id')::uuid)<>'Fictional duty' then raise exception 'Draft proposal changed wording';end if;
 chg:=public.save_legal_change((chg->>'id')::uuid,1,jsonb_build_object('company_id',company),'apply','Fictional review of the proposed wording');
 select to_jsonb(q) into v from public.legal_requirements q where id=(r->>'id')::uuid;
 if v->>'requirement'<>'Revised fictional duty' or v->>'source_verification_status'<>'unverified' or chg->>'reviewed_by'<>'ae190000-0000-4000-8000-000000000001' then raise exception 'Applied change not versioned or source invalidation missing';end if;
 if (select count(*) from public.legal_assurance_history where company_id=company)<8 then raise exception 'Decision history not retained';end if;
 -- Wrong-company RPC requests fail even though their IDs are known.
 begin perform public.save_legal_assessment((a->'assessment'->>'id')::uuid,4,jsonb_build_object('company_id','ae190000-0000-4000-8000-000000000020'),rows);raise exception 'Foreign company write accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
