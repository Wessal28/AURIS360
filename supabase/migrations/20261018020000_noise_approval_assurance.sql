-- Preserve existing records. Validate new approvals at the database boundary.
alter table public.noise_mgmt_exposure_assessments add column change_reason text;
alter table public.noise_mgmt_reports add column report_snapshot jsonb not null default '{}';
alter table public.noise_mgmt_reports add column generated_at timestamptz;
alter table public.noise_mgmt_measurements add column source_id text;
alter table public.noise_mgmt_control_plans add column assessment_id text;

create function public.noise_assessment_evidence(p_company uuid,p_profile text,p_sources jsonb,p_date date,
  p_subject_type text,p_subject_id text,p_subject_name text) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare pr public.noise_mgmt_assessment_profiles; m public.noise_mgmt_measurements;
  inst public.noise_mgmt_instruments; src jsonb; band jsonb; refs jsonb:='[]'; total_hours numeric:=0;
  energy double precision:=0; peak numeric; result numeric; level numeric; classification text;
begin
  select * into pr from public.noise_mgmt_assessment_profiles where id=p_profile and company_id=p_company for share;
  if not found or pr.status<>'published' then raise exception 'Select a published assessment profile'; end if;
  if p_date is null or pr.effective_from>p_date or (pr.effective_to is not null and pr.effective_to<p_date) then
    raise exception 'The assessment profile is not effective on the assessment date'; end if;
  if pr.reference_duration_hours is null or pr.reference_duration_hours<=0 or pr.reference_duration_hours::text in ('NaN','Infinity','-Infinity') then raise exception 'Profile reference duration must be positive'; end if;
  if jsonb_typeof(p_sources)<>'array' or jsonb_array_length(p_sources)=0 then raise exception 'Link at least one accepted LAeq measurement version'; end if;
  if exists(select 1 from jsonb_array_elements(p_sources) s group by s->>'id' having count(*)>1) then raise exception 'A measurement cannot be counted twice'; end if;
  for src in select * from jsonb_array_elements(p_sources) loop
    select * into m from public.noise_mgmt_measurements where id=src->>'id' and company_id=p_company for share;
    if not found or m.version_no::text is distinct from src->>'version_no' or m.status not in ('accepted','approved') then raise exception 'A linked measurement is unavailable, unaccepted or has a different version'; end if;
    if exists(select 1 from public.noise_mgmt_measurements n where n.company_id=p_company and n.code=m.code and n.version_no>m.version_no and n.status in ('accepted','approved')) then raise exception 'A linked measurement has a newer accepted version'; end if;
    if m.measurement_date::date>p_date then raise exception 'A measurement occurs after the assessment date'; end if;
    if m.measurement_type not in ('area_task','personal','personal_dosimetry') or upper(replace(coalesce(m.descriptor,''),' ','')) not in ('LAEQ','LAEQ,T') or upper(replace(coalesce(m.unit,''),' ','')) not in ('DBA','DB(A)') then raise exception 'Use occupational A-weighted LAeq measurements; environmental, normalised LEX, peak and octave values cannot be normalised again'; end if;
    if m.raw_value is null or m.raw_value::text in ('NaN','Infinity','-Infinity') or m.raw_value not between -100 and 250
      or m.valid_duration_minutes is null or m.valid_duration_minutes<=0 or m.valid_duration_minutes::text in ('NaN','Infinity','-Infinity') then raise exception 'Each source needs a finite level and positive valid duration'; end if;
    if m.data_quality_status not in ('acceptable','accepted','limited') or m.data_quality_status is null
      or (m.data_quality_status='limited' and nullif(btrim(m.limitations),'') is null) then raise exception 'Confirm source quality and explain limited measurements'; end if;
    if p_subject_id is not null and p_subject_id<>'' then
      if m.subject_id is distinct from p_subject_id or m.subject_type is distinct from p_subject_type then raise exception 'Source measurements must match the selected subject'; end if;
    elsif lower(btrim(coalesce(m.subject_name,''))) is distinct from lower(btrim(coalesce(p_subject_name,''))) or nullif(btrim(p_subject_name),'') is null then raise exception 'Source measurements must match the assessment subject'; end if;
    select * into inst from public.noise_mgmt_instruments where id=m.instrument_id and company_id=p_company for share;
    if not found or inst.calibration_date is null or inst.calibration_due_date is null
      or inst.calibration_date>m.measurement_date::date or inst.calibration_due_date<m.measurement_date::date
      or nullif(btrim(inst.calibration_certificate),'') is null or inst.last_field_check_status='failed' then raise exception 'Link an instrument with calibration evidence valid on the measurement date'; end if;
    total_hours:=total_hours+m.valid_duration_minutes/60;
    refs:=refs||jsonb_build_array(jsonb_build_object('id',m.id,'version_no',m.version_no,'code',m.code,
      'level',m.raw_value,'duration_minutes',m.valid_duration_minutes,'instrument_id',inst.id,'instrument_code',inst.asset_code,
      'calibration_certificate',inst.calibration_certificate,'calibration_date',inst.calibration_date,'calibration_due_date',inst.calibration_due_date));
    peak:=greatest(peak,m.raw_value);
  end loop;
  for src in select * from jsonb_array_elements(refs) loop
    energy:=energy+(src->>'duration_minutes')::numeric/60*power(10::double precision,((src->>'level')::numeric-peak)/10);
  end loop;
  level:=peak+10*log((energy/total_hours)::numeric);
  result:=peak+10*log((energy/pr.reference_duration_hours)::numeric);
  for band in select * from jsonb_array_elements(pr.bands_json) loop
    if (band->>'min' is null or result>=(band->>'min')::numeric) and (band->>'max' is null or result<(band->>'max')::numeric) then classification:=band->>'code';exit;end if;
  end loop;
  if classification is null or classification not in ('below_action','above_action','above_limit') then raise exception 'The published profile has no valid classification band for this result'; end if;
  return jsonb_build_object('source_level',round(level,6),'duration_hours',total_hours,'result_value',round(result,2),
    'classification',classification,'profile_name',pr.code||' / v'||pr.version_no,'result_unit','dB(A)',
    'calculation_method','NOISE_ENERGY_SUM','source_measurement_versions',refs,
    'calculation_snapshot',jsonb_build_object('formula','10 log10(sum(Ti × 10^(Li/10)) / Tref)',
      'reference_duration_hours',pr.reference_duration_hours,'profile_id',pr.id,'profile_version',pr.version_no,
      'profile_bands',pr.bands_json,'sources',refs,'assumptions','Linked durations represent non-overlapping exposure components.'));
end $$;

create function public.noise_governance_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare result jsonb; parent public.noise_mgmt_exposure_assessments; band jsonb; prev numeric; low numeric; high numeric;
  first_band boolean:=true; source jsonb; record_json jsonb; summary jsonb; snapshots jsonb:='[]'; target text;
begin
  if tg_op<>'DELETE' and new.status in ('approved','published','accepted','issued') and auth.role() is distinct from 'service_role'
    and not exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active'
      and (p.role='sephs_admin' or (p.company_id=new.company_id and p.role in ('admin','company_admin','hse_manager','hse_officer','occupational_hygienist')))) then
    raise exception 'An authorised Noise Management reviewer must record this decision';end if;
  if tg_op<>'INSERT' then
    if old.status in ('approved','issued','published','superseded') or (tg_table_name='noise_mgmt_measurements' and old.status='accepted') then
      if tg_table_name='noise_mgmt_reports' and tg_op='UPDATE' and old.status='approved' and new.status='issued'
        and (to_jsonb(new)-array['status','issued_at','updated_at'])=(to_jsonb(old)-array['status','issued_at','updated_at']) then new.issued_at:=now();return new;end if;
      raise exception 'This approved or accepted version is immutable. Create a new revision instead';
    end if;
    if tg_op='DELETE' then return old;end if;
    if new.company_id is distinct from old.company_id then raise exception 'A noise record cannot move between companies';end if;
  end if;
  if tg_table_name in ('noise_mgmt_measurements','noise_mgmt_exposure_assessments') then
    if new.subject_id is not null then
      target:=case new.subject_type when 'employee' then 'people' when 'seg' then 'noise_mgmt_segs' when 'task' then 'noise_mgmt_tasks' when 'area' then 'noise_mgmt_sources' end;
      if target is null then raise exception 'Select a supported subject type';end if;
      execute format('select to_jsonb(r) from public.%I r where id::text=$1 and company_id=$2',target) into record_json using new.subject_id,new.company_id;
      if record_json is null then raise exception 'The linked subject is outside the selected company';end if;
    end if;
  end if;
  if tg_table_name='noise_mgmt_assessment_profiles' and new.status='published' then
    if new.reference_duration_hours is null or new.reference_duration_hours<=0 or new.reference_duration_hours::text in ('NaN','Infinity','-Infinity')
      or jsonb_typeof(new.bands_json)<>'array' or jsonb_array_length(new.bands_json)=0 then raise exception 'A published profile needs a positive reference duration and classification bands';end if;
    for band in select * from jsonb_array_elements(new.bands_json) loop
      low:=coalesce((band->>'min')::numeric,'-Infinity'::numeric); high:=coalesce((band->>'max')::numeric,'Infinity'::numeric);
      if coalesce(band->>'code','') not in ('below_action','above_action','above_limit') or low>=high or low::text='NaN' or high::text='NaN'
        or (first_band and low<>'-Infinity'::numeric) or (not first_band and low is distinct from prev) then raise exception 'Classification bands must be ordered, continuous and non-overlapping';end if;
      first_band:=false;prev:=high;
    end loop;
    if prev<>'Infinity'::numeric then raise exception 'Classification bands must cover all result values';end if;
    if new.effective_from is null or new.effective_to<new.effective_from then raise exception 'Confirm the effective profile dates';end if;
    new.published_by:=auth.uid();new.published_at:=now();
  elsif tg_table_name='noise_mgmt_exposure_assessments' then
    if new.supersedes_id is not null then
      select * into parent from public.noise_mgmt_exposure_assessments where id=new.supersedes_id and company_id=new.company_id;
      if not found or parent.status<>'approved' or parent.code<>new.code or new.version_no<=parent.version_no or nullif(btrim(new.change_reason),'') is null then raise exception 'A revision needs its approved predecessor, a higher version and a change reason';end if;
    end if;
    if new.status='approved' then
      if new.data_quality_status not in ('acceptable','limited') or new.data_quality_status is null then raise exception 'Confirm assessment quality before approval';end if;
      if new.data_quality_status='limited' and nullif(btrim(new.limitations),'') is null then raise exception 'Explain the limitations before approval';end if;
      if new.duration_confirmed is not true then raise exception 'Confirm that linked durations represent non-overlapping exposure components';end if;
      result:=public.noise_assessment_evidence(new.company_id,new.profile_id,new.source_measurement_versions,new.assessment_date,new.subject_type,new.subject_id,new.subject_name);
      new:=jsonb_populate_record(new,result);new.approved_at:=now();new.reviewer_id:=auth.uid();
    else new.approved_at:=null;new.reviewer_id:=null;end if;
  elsif tg_table_name='noise_mgmt_measurements' then
    if new.instrument_id is not null and not exists(select 1 from public.noise_mgmt_instruments where id=new.instrument_id and company_id=new.company_id) then raise exception 'Instrument is outside the selected company';end if;
    if new.source_id is not null and not exists(select 1 from public.noise_mgmt_sources where id=new.source_id and company_id=new.company_id) then raise exception 'Noise source is outside the selected company';end if;
    if new.survey_id is not null and not exists(select 1 from public.noise_mgmt_field_surveys where id=new.survey_id and company_id=new.company_id) then raise exception 'Survey is outside the selected company';end if;
  elsif tg_table_name='noise_mgmt_control_plans' then
    if new.assessment_id is not null and not exists(select 1 from public.noise_mgmt_exposure_assessments where id=new.assessment_id and company_id=new.company_id and status='approved') then raise exception 'Select an approved assessment in this company';end if;
  elsif tg_table_name='noise_mgmt_reports' then
    if new.status in ('approved','issued') or (new.generated_at is not null and (tg_op='INSERT' or new.generated_at is distinct from old.generated_at)) then
      if new.data_as_of is null or jsonb_typeof(new.source_versions)<>'array' or jsonb_array_length(new.source_versions)=0 then raise exception 'Select source versions and a data-as-of date, then generate the report';end if;
      for source in select * from jsonb_array_elements(new.source_versions) loop
        target:=source->>'table';
        if target not in ('noise_mgmt_exposure_assessments','noise_mgmt_measurements','noise_mgmt_field_surveys','noise_mgmt_maps','noise_mgmt_control_plans','noise_mgmt_hearing_protectors','noise_mgmt_instruments') then raise exception 'Unsupported report source';end if;
        execute format('select to_jsonb(r) from public.%I r where id=$1 and company_id=$2 for share',target) into record_json using source->>'id',new.company_id;
        if record_json is null or record_json->>'version_no' is distinct from source->>'version_no' then raise exception 'Report source is unavailable or its version changed';end if;
        if not case target
          when 'noise_mgmt_exposure_assessments' then record_json->>'status'='approved'
          when 'noise_mgmt_measurements' then record_json->>'status' in ('accepted','approved')
          when 'noise_mgmt_field_surveys' then record_json->>'status' in ('accepted','approved')
          when 'noise_mgmt_maps' then record_json->>'status'='published'
          when 'noise_mgmt_control_plans' then record_json->>'status' in ('approved','verified','closed')
          when 'noise_mgmt_hearing_protectors' then record_json->>'status'='approved'
          when 'noise_mgmt_instruments' then record_json->>'status' in ('available','assigned') else false end then raise exception 'Reports require accepted or approved source records';end if;
        if coalesce(record_json->>'assessment_date',record_json->>'measurement_date',record_json->>'survey_date','')<>''
          and left(coalesce(record_json->>'assessment_date',record_json->>'measurement_date',record_json->>'survey_date'),10)::date>new.data_as_of then raise exception 'A report source is after the data-as-of date';end if;
        if target='noise_mgmt_exposure_assessments' then
          if record_json->>'status'<>'approved' then raise exception 'The assessment must be approved before reporting';end if;
          if record_json->>'classification'='profile_pending' or record_json->>'calculation_method' is distinct from 'NOISE_ENERGY_SUM'
            or record_json->'calculation_snapshot'->>'profile_version' is null then raise exception 'The historical assessment needs a reviewed revision before reporting';end if;
          if exists(select 1 from public.noise_mgmt_exposure_assessments where company_id=new.company_id and code=record_json->>'code' and version_no>(record_json->>'version_no')::int and status='approved') then raise exception 'Use the latest approved assessment revision';end if;
        end if;
        select coalesce(jsonb_object_agg(key,value),'{}') into summary from jsonb_each(record_json) where key=any(array['code','name','asset_code','subject_name','site','scope','assessment_date','measurement_date','survey_date','descriptor','raw_value','unit','source_level','duration_hours','result_value','result_unit','classification','profile_name','limitations','baseline_result','selected_control','verification_criteria','effectiveness_status','calibration_due_date']);
        if target='noise_mgmt_exposure_assessments' then summary:=summary||jsonb_build_object('formula',record_json->'calculation_snapshot'->>'formula','reference_duration_hours',record_json->'calculation_snapshot'->'reference_duration_hours');end if;
        snapshots:=snapshots||jsonb_build_array(jsonb_build_object('table',target,'reference',coalesce(record_json->>'code',record_json->>'asset_code'),'version_no',record_json->'version_no','summary',summary));
      end loop;
      new.report_snapshot:=jsonb_build_object('data_as_of',new.data_as_of,'sources',snapshots);new.generated_at:=now();
      if new.status='issued' then raise exception 'Approve the generated report before issuing it';end if;
      if new.status='approved' and (new.approver_id is null or new.approver_id is distinct from auth.uid()) then raise exception 'The current authorised reviewer must confirm report approval';end if;
    elsif tg_op='INSERT' or new.source_versions is distinct from old.source_versions or new.data_as_of is distinct from old.data_as_of or new.report_type is distinct from old.report_type then
      new.report_snapshot:='{}';new.generated_at:=null;
    else new.report_snapshot:=old.report_snapshot;end if;
  end if;
  return new;
end $$;

alter table public.noise_mgmt_exposure_assessments add column duration_confirmed boolean not null default false;
create trigger noise_governance_guard before insert or update or delete on public.noise_mgmt_exposure_assessments for each row execute function public.noise_governance_guard();
create trigger noise_governance_guard before insert or update or delete on public.noise_mgmt_assessment_profiles for each row execute function public.noise_governance_guard();
create trigger noise_governance_guard before insert or update or delete on public.noise_mgmt_measurements for each row execute function public.noise_governance_guard();
create trigger noise_governance_guard before insert or update or delete on public.noise_mgmt_reports for each row execute function public.noise_governance_guard();
create trigger noise_governance_guard before insert or update or delete on public.noise_mgmt_control_plans for each row execute function public.noise_governance_guard();

create function public.noise_audit_governed() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.noise_mgmt_audit_events(company_id,entity_type,entity_id,action,before_json,after_json,reason,performed_by)
    values(case when tg_op='DELETE' then old.company_id else new.company_id end,tg_table_name,case when tg_op='DELETE' then old.id else new.id end,
      lower(tg_op),case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end,
      case when tg_table_name='noise_mgmt_exposure_assessments' and tg_op<>'DELETE' then to_jsonb(new)->>'change_reason' end,auth.uid());
  return null;
end $$;
revoke all on function public.noise_audit_governed() from public,anon,authenticated;
create trigger noise_audit_governed after insert or update or delete on public.noise_mgmt_exposure_assessments for each row execute function public.noise_audit_governed();
create trigger noise_audit_governed after insert or update or delete on public.noise_mgmt_reports for each row execute function public.noise_audit_governed();
create trigger noise_audit_governed after insert or update or delete on public.noise_mgmt_measurements for each row execute function public.noise_audit_governed();
create trigger noise_audit_governed after insert or update or delete on public.noise_mgmt_assessment_profiles for each row execute function public.noise_audit_governed();

create function public.noise_create_assessment_revision(p_id text,p_reason text) returns public.noise_mgmt_exposure_assessments
language plpgsql set search_path=public,pg_temp as $$
declare old_row public.noise_mgmt_exposure_assessments; draft public.noise_mgmt_exposure_assessments; next_version int;
begin
  select * into old_row from public.noise_mgmt_exposure_assessments where id=p_id for update;
  if not found or old_row.status<>'approved' then raise exception 'Select an approved assessment to revise';end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'Enter the correction or revision reason';end if;
  if exists(select 1 from public.noise_mgmt_exposure_assessments where company_id=old_row.company_id and code=old_row.code and version_no>old_row.version_no and status='approved') then raise exception 'Revise the latest approved version';end if;
  select * into draft from public.noise_mgmt_exposure_assessments where company_id=old_row.company_id and supersedes_id=p_id and status in ('draft','calculated','review') order by version_no desc limit 1;
  if found then return draft;end if;
  select coalesce(max(version_no),0)+1 into next_version from public.noise_mgmt_exposure_assessments where company_id=old_row.company_id and code=old_row.code;
  draft:=old_row;draft.id:=gen_random_uuid()::text;draft.version_no:=next_version;draft.supersedes_id:=p_id;
  draft.status:='draft';draft.change_reason:=btrim(p_reason);draft.approved_at:=null;draft.reviewer_id:=null;
  draft.classification:='profile_pending';draft.result_value:=null;draft.calculation_snapshot:='{}';draft.duration_confirmed:=false;
  draft.created_by:=auth.uid();draft.created_at:=now();draft.updated_at:=now();
  insert into public.noise_mgmt_exposure_assessments select draft.* returning * into draft;return draft;
end $$;
revoke all on function public.noise_create_assessment_revision(text,text) from public,anon;
grant execute on function public.noise_create_assessment_revision(text,text) to authenticated,service_role;
revoke all on function public.noise_assessment_evidence(uuid,text,jsonb,date,text,text,text) from public,anon;
grant execute on function public.noise_assessment_evidence(uuid,text,jsonb,date,text,text,text) to authenticated,service_role;
