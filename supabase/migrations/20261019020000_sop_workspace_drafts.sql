-- Incomplete workspace drafts are not generated, approved or published SOPs.
begin;
create function public.save_sop_workspace(p_id text,p_expected timestamptz,p_body jsonb,p_evidence boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare prior public.sop_video_projects;r public.sop_video_projects;actor uuid:=auth.uid();company uuid:=(p_body->>'company_id')::uuid;
 workspace jsonb:=p_body->'workspace';frames jsonb;f jsonb;role_name text;is_new boolean:=false;i integer:=0;
begin
 select role into role_name from public.profiles where id=actor;
 if actor is null or company is null or not coalesce(public.auris_can_access_company(company),false)
 or not coalesce(public.user_access_allowed('sop','edit'),false)
 or role_name is null or role_name not in ('sephs_admin','admin','hse_manager','hse_officer','manager','site_manager','supervisor','document_controller')
 then raise exception 'SOP workspace editing access is required' using errcode='42501';end if;
 if p_id is null or p_id !~ '^[a-fA-F0-9-]{36}$' or p_evidence is null then raise exception 'A stable workspace ID and save mode are required';end if;
 if jsonb_typeof(workspace) is distinct from 'object' or octet_length(workspace::text)>4194304 then raise exception 'Workspace must be an object of at most 4 MB';end if;
 frames:=coalesce(workspace->'frames','[]');
 if jsonb_typeof(frames) is distinct from 'array' or jsonb_array_length(frames)>100 then raise exception 'Save at most 100 evidence steps';end if;
 if p_evidence and jsonb_array_length(frames)=0 then raise exception 'Add an evidence step before saving evidence';end if;
 for f in select * from jsonb_array_elements(frames) loop
  if jsonb_typeof(f) is distinct from 'object' or length(coalesce(f->>'narration',''))>10000
   or coalesce(f->>'source_type','reviewer_added') not in ('observed','spoken','template_required','policy_legal','ai_inferred','reviewer_added')
   or coalesce(f->>'review_state','pending') not in ('pending','accepted','amended','rejected','not_required')
  then raise exception 'Invalid evidence step';end if;
  if nullif(f->>'dataUrl','') is not null then
   if not coalesce((p_body->>'consent_confirmed')::boolean,false) then raise exception 'Confirm recording authorisation before saving captured images';end if;
   if f->>'dataUrl' !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then raise exception 'Evidence images must be JPEG, PNG or WebP captures';end if;
  end if;
 end loop;
 select * into prior from public.sop_video_projects where id=p_id and company_id=company for update;
 if found then
  if p_expected is null or prior.updated_at is distinct from p_expected then raise exception 'Workspace changed or a previous save completed. Reopen it before saving.';end if;
  if prior.processing_status not in ('draft','uploaded','processing_failed','ready_for_review','changes_requested') then raise exception 'This workspace is in review or already approved. Its controlled version cannot be overwritten.';end if;
 else
  if p_expected is not null then raise exception 'Workspace unavailable in this company';end if;
  is_new:=true;prior.id:=p_id;prior.company_id:=company;prior.reference:='SOPV-'||extract(year from current_date)||'-'||upper(substr(replace(p_id,'-',''),1,12));prior.created_by:=actor;prior.created_at:=clock_timestamp();
 end if;
 r:=prior;r.title:=coalesce(nullif(btrim(workspace->'task'->>'title'),''),'Untitled SOP draft');
 r.site_name:=workspace->'task'->>'department';r.language_code:=coalesce(p_body->>'language_code','en');
 r.template_code:=coalesce(p_body->>'template_code','standard');r.privacy_level:=coalesce(p_body->>'privacy_level','internal');
 if r.language_code not in ('en','fr','ar','other') or r.template_code not in ('standard','critical','quality') or r.privacy_level not in ('internal','restricted') then raise exception 'Invalid workspace settings';end if;
 r.consent_confirmed:=coalesce((p_body->>'consent_confirmed')::boolean,false);
 r.source_file_name:=p_body->>'source_file_name';r.source_media_type:=p_body->>'source_media_type';r.source_size_bytes:=nullif(p_body->>'source_size_bytes','')::bigint;
 -- Selecting a browser file is not a server upload and must never assert Uploaded.
 r.processing_status:=case when p_evidence then 'ready_for_review' else 'draft' end;
 r.processing_stage:=case when p_evidence then 'evidence_review' else 'capture' end;
 r.processing_detail:=coalesce(prior.processing_detail,'{}')||jsonb_build_object('workspace',workspace,'source_availability',case when prior.source_storage_path is null then 'reselect_local_video' else 'stored' end);
 r.owner_id:=coalesce(prior.owner_id,actor);select full_name into r.owner_name from public.profiles where id=r.owner_id;r.updated_at:=clock_timestamp();
 if is_new then insert into public.sop_video_projects select (r).* returning * into r;
 else update public.sop_video_projects set title=r.title,site_name=r.site_name,language_code=r.language_code,template_code=r.template_code,privacy_level=r.privacy_level,consent_confirmed=r.consent_confirmed,source_file_name=r.source_file_name,source_media_type=r.source_media_type,source_size_bytes=r.source_size_bytes,processing_status=r.processing_status,processing_stage=r.processing_stage,processing_detail=r.processing_detail,updated_at=r.updated_at where id=r.id returning * into r;end if;
 if p_evidence then
  delete from public.sop_video_evidence where project_id=r.id and company_id=company;
  for f in select * from jsonb_array_elements(frames) loop
   i:=i+1;
   insert into public.sop_video_evidence(company_id,project_id,sequence_no,evidence_type,source_label,source_start_seconds,confidence,instruction_text,safety_notes,image_reference,safety_critical,quality_notes,reviewer_disposition,reviewed_by,reviewed_at,created_by)
   values(company,r.id,i,'procedure_step',coalesce(f->>'source_type','reviewer_added'),nullif(f->>'time','')::numeric,nullif(f->>'confidence','')::numeric,f->>'narration',f->>'hazard',f->>'dataUrl',coalesce((f->>'safetyCritical')::boolean,false),case when (f->>'qualityCheck')::boolean then 'Quality verification required' end,coalesce(f->>'review_state','pending'),case when f->>'review_state' in ('accepted','amended','rejected') then actor end,case when f->>'review_state' in ('accepted','amended','rejected') then clock_timestamp() end,actor);
  end loop;
 end if;
 return to_jsonb(r);
end $$;
revoke all on function public.save_sop_workspace(text,timestamptz,jsonb,boolean) from public,anon;
grant execute on function public.save_sop_workspace(text,timestamptz,jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
