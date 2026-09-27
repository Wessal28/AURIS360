begin;
-- Section restrictions supplement existing role, tenant and module controls.
create or replace function public.user_access_allowed(module_key text, access_action text default 'view') returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare actor public.profiles; rules jsonb; rule jsonb;
begin
  select * into actor from public.profiles where id=auth.uid();
  if not found or actor.status is distinct from 'active' then return false; end if;
  if actor.role='sephs_admin' then return true; end if;
  rules:=actor.permissions->'access_v1';
  if rules is null then return true; end if;
  if position('.' in module_key)>0 and (rules->split_part(module_key,'.',1)->>'view'='false' or rules->split_part(module_key,'.',1)->>access_action='false') then return false; end if;
  rule:=rules->module_key;
  return coalesce(rule->>'view','true')<>'false' and coalesce(rule->>access_action,'true')<>'false';
end $$;
revoke all on function public.user_access_allowed(text,text) from public;
grant execute on function public.user_access_allowed(text,text) to authenticated;

do $section$ begin if to_regclass('public.ppe_issuance') is not null then
 execute $stmt$drop policy if exists user_section_access on public.ppe_issuance$stmt$;
 execute $stmt$create policy user_section_access on public.ppe_issuance as restrictive for all to authenticated using (public.user_access_allowed('ppe.issuance','view')) with check (public.user_access_allowed('ppe.issuance','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.ppe_issuance$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.ppe_issuance for each row execute function public.guard_module_user_access('ppe.issuance')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.ppe_inspections') is not null then
 execute $stmt$drop policy if exists user_section_access on public.ppe_inspections$stmt$;
 execute $stmt$create policy user_section_access on public.ppe_inspections as restrictive for all to authenticated using (public.user_access_allowed('ppe.inspections','view')) with check (public.user_access_allowed('ppe.inspections','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.ppe_inspections$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.ppe_inspections for each row execute function public.guard_module_user_access('ppe.inspections')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.ppe_replacements') is not null then
 execute $stmt$drop policy if exists user_section_access on public.ppe_replacements$stmt$;
 execute $stmt$create policy user_section_access on public.ppe_replacements as restrictive for all to authenticated using (public.user_access_allowed('ppe.replacements','view')) with check (public.user_access_allowed('ppe.replacements','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.ppe_replacements$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.ppe_replacements for each row execute function public.guard_module_user_access('ppe.replacements')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.fire_certificates') is not null then
 execute $stmt$drop policy if exists user_section_access on public.fire_certificates$stmt$;
 execute $stmt$create policy user_section_access on public.fire_certificates as restrictive for all to authenticated using (public.user_access_allowed('fire.certs','view')) with check (public.user_access_allowed('fire.certs','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.fire_certificates$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.fire_certificates for each row execute function public.guard_module_user_access('fire.certs')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.fire_equipment') is not null then
 execute $stmt$drop policy if exists user_section_access on public.fire_equipment$stmt$;
 execute $stmt$create policy user_section_access on public.fire_equipment as restrictive for all to authenticated using (public.user_access_allowed('fire.equipment','view')) with check (public.user_access_allowed('fire.equipment','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.fire_equipment$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.fire_equipment for each row execute function public.guard_module_user_access('fire.equipment')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.fire_inspections') is not null then
 execute $stmt$drop policy if exists user_section_access on public.fire_inspections$stmt$;
 execute $stmt$create policy user_section_access on public.fire_inspections as restrictive for all to authenticated using (public.user_access_allowed('fire.inspections','view')) with check (public.user_access_allowed('fire.inspections','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.fire_inspections$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.fire_inspections for each row execute function public.guard_module_user_access('fire.inspections')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.fire_inspection_findings') is not null then
 execute $stmt$drop policy if exists user_section_access on public.fire_inspection_findings$stmt$;
 execute $stmt$create policy user_section_access on public.fire_inspection_findings as restrictive for all to authenticated using (public.user_access_allowed('fire.inspections','view')) with check (public.user_access_allowed('fire.inspections','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.fire_inspection_findings$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.fire_inspection_findings for each row execute function public.guard_module_user_access('fire.inspections')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.fire_layouts') is not null then
 execute $stmt$drop policy if exists user_section_access on public.fire_layouts$stmt$;
 execute $stmt$create policy user_section_access on public.fire_layouts as restrictive for all to authenticated using (public.user_access_allowed('fire.layout','view')) with check (public.user_access_allowed('fire.layout','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.fire_layouts$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.fire_layouts for each row execute function public.guard_module_user_access('fire.layout')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.fire_layout_symbols') is not null then
 execute $stmt$drop policy if exists user_section_access on public.fire_layout_symbols$stmt$;
 execute $stmt$create policy user_section_access on public.fire_layout_symbols as restrictive for all to authenticated using (public.user_access_allowed('fire.layout','view')) with check (public.user_access_allowed('fire.layout','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.fire_layout_symbols$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.fire_layout_symbols for each row execute function public.guard_module_user_access('fire.layout')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.toolbox_talks') is not null then
 execute $stmt$drop policy if exists user_section_access on public.toolbox_talks$stmt$;
 execute $stmt$create policy user_section_access on public.toolbox_talks as restrictive for all to authenticated using (public.user_access_allowed('meetings.tbt','view')) with check (public.user_access_allowed('meetings.tbt','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.toolbox_talks$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.toolbox_talks for each row execute function public.guard_module_user_access('meetings.tbt')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.hse_meetings') is not null then
 execute $stmt$drop policy if exists user_section_access on public.hse_meetings$stmt$;
 execute $stmt$create policy user_section_access on public.hse_meetings as restrictive for all to authenticated using (public.user_access_allowed('meetings.schedule','view')) with check (public.user_access_allowed('meetings.schedule','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.hse_meetings$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.hse_meetings for each row execute function public.guard_module_user_access('meetings.schedule')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.meeting_actions') is not null then
 execute $stmt$drop policy if exists user_section_access on public.meeting_actions$stmt$;
 execute $stmt$create policy user_section_access on public.meeting_actions as restrictive for all to authenticated using (public.user_access_allowed('meetings.minutes','view')) with check (public.user_access_allowed('meetings.minutes','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.meeting_actions$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.meeting_actions for each row execute function public.guard_module_user_access('meetings.minutes')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.training_plan') is not null then
 execute $stmt$drop policy if exists user_section_access on public.training_plan$stmt$;
 execute $stmt$create policy user_section_access on public.training_plan as restrictive for all to authenticated using (public.user_access_allowed('training.plan','view')) with check (public.user_access_allowed('training.plan','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.training_plan$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.training_plan for each row execute function public.guard_module_user_access('training.plan')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.training_plans') is not null then
 execute $stmt$drop policy if exists user_section_access on public.training_plans$stmt$;
 execute $stmt$create policy user_section_access on public.training_plans as restrictive for all to authenticated using (public.user_access_allowed('training.plan','view')) with check (public.user_access_allowed('training.plan','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.training_plans$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.training_plans for each row execute function public.guard_module_user_access('training.plan')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.training_followup') is not null then
 execute $stmt$drop policy if exists user_section_access on public.training_followup$stmt$;
 execute $stmt$create policy user_section_access on public.training_followup as restrictive for all to authenticated using (public.user_access_allowed('training.followup','view')) with check (public.user_access_allowed('training.followup','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.training_followup$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.training_followup for each row execute function public.guard_module_user_access('training.followup')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.training_records') is not null then
 execute $stmt$drop policy if exists user_section_access on public.training_records$stmt$;
 execute $stmt$create policy user_section_access on public.training_records as restrictive for all to authenticated using (public.user_access_allowed('training.followup','view')) with check (public.user_access_allowed('training.followup','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.training_records$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.training_records for each row execute function public.guard_module_user_access('training.followup')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.induction_records') is not null then
 execute $stmt$drop policy if exists user_section_access on public.induction_records$stmt$;
 execute $stmt$create policy user_section_access on public.induction_records as restrictive for all to authenticated using (public.user_access_allowed('training.induction','view')) with check (public.user_access_allowed('training.induction','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.induction_records$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.induction_records for each row execute function public.guard_module_user_access('training.induction')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.competencies') is not null then
 execute $stmt$drop policy if exists user_section_access on public.competencies$stmt$;
 execute $stmt$create policy user_section_access on public.competencies as restrictive for all to authenticated using (public.user_access_allowed('training.competency','view')) with check (public.user_access_allowed('training.competency','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.competencies$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.competencies for each row execute function public.guard_module_user_access('training.competency')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.competency_matrix') is not null then
 execute $stmt$drop policy if exists user_section_access on public.competency_matrix$stmt$;
 execute $stmt$create policy user_section_access on public.competency_matrix as restrictive for all to authenticated using (public.user_access_allowed('training.competency','view')) with check (public.user_access_allowed('training.competency','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.competency_matrix$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.competency_matrix for each row execute function public.guard_module_user_access('training.competency')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.training_matrix') is not null then
 execute $stmt$drop policy if exists user_section_access on public.training_matrix$stmt$;
 execute $stmt$create policy user_section_access on public.training_matrix as restrictive for all to authenticated using (public.user_access_allowed('training.matrix','view')) with check (public.user_access_allowed('training.matrix','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.training_matrix$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.training_matrix for each row execute function public.guard_module_user_access('training.matrix')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.training_needs_analysis') is not null then
 execute $stmt$drop policy if exists user_section_access on public.training_needs_analysis$stmt$;
 execute $stmt$create policy user_section_access on public.training_needs_analysis as restrictive for all to authenticated using (public.user_access_allowed('training.tna','view')) with check (public.user_access_allowed('training.tna','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.training_needs_analysis$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.training_needs_analysis for each row execute function public.guard_module_user_access('training.tna')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.training_needs') is not null then
 execute $stmt$drop policy if exists user_section_access on public.training_needs$stmt$;
 execute $stmt$create policy user_section_access on public.training_needs as restrictive for all to authenticated using (public.user_access_allowed('training.tna','view')) with check (public.user_access_allowed('training.tna','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.training_needs$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.training_needs for each row execute function public.guard_module_user_access('training.tna')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.elearning_courses') is not null then
 execute $stmt$drop policy if exists user_section_access on public.elearning_courses$stmt$;
 execute $stmt$create policy user_section_access on public.elearning_courses as restrictive for all to authenticated using (public.user_access_allowed('training.elearning','view')) with check (public.user_access_allowed('training.elearning','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.elearning_courses$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.elearning_courses for each row execute function public.guard_module_user_access('training.elearning')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.elearning_enrolments') is not null then
 execute $stmt$drop policy if exists user_section_access on public.elearning_enrolments$stmt$;
 execute $stmt$create policy user_section_access on public.elearning_enrolments as restrictive for all to authenticated using (public.user_access_allowed('training.elearning','view')) with check (public.user_access_allowed('training.elearning','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.elearning_enrolments$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.elearning_enrolments for each row execute function public.guard_module_user_access('training.elearning')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.elearning_quiz_attempts') is not null then
 execute $stmt$drop policy if exists user_section_access on public.elearning_quiz_attempts$stmt$;
 execute $stmt$create policy user_section_access on public.elearning_quiz_attempts as restrictive for all to authenticated using (public.user_access_allowed('training.elearning','view')) with check (public.user_access_allowed('training.elearning','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.elearning_quiz_attempts$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.elearning_quiz_attempts for each row execute function public.guard_module_user_access('training.elearning')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.learning_course_governance') is not null then
 execute $stmt$drop policy if exists user_section_access on public.learning_course_governance$stmt$;
 execute $stmt$create policy user_section_access on public.learning_course_governance as restrictive for all to authenticated using (public.user_access_allowed('training.elearning','view')) with check (public.user_access_allowed('training.elearning','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.learning_course_governance$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.learning_course_governance for each row execute function public.guard_module_user_access('training.elearning')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.learning_practical_assessments') is not null then
 execute $stmt$drop policy if exists user_section_access on public.learning_practical_assessments$stmt$;
 execute $stmt$create policy user_section_access on public.learning_practical_assessments as restrictive for all to authenticated using (public.user_access_allowed('training.elearning','view')) with check (public.user_access_allowed('training.elearning','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.learning_practical_assessments$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.learning_practical_assessments for each row execute function public.guard_module_user_access('training.elearning')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.medical_surveillance') is not null then
 execute $stmt$drop policy if exists user_section_access on public.medical_surveillance$stmt$;
 execute $stmt$create policy user_section_access on public.medical_surveillance as restrictive for all to authenticated using (public.user_access_allowed('ohealth.surveillance','view')) with check (public.user_access_allowed('ohealth.surveillance','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.medical_surveillance$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.medical_surveillance for each row execute function public.guard_module_user_access('ohealth.surveillance')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.audiometry_records') is not null then
 execute $stmt$drop policy if exists user_section_access on public.audiometry_records$stmt$;
 execute $stmt$create policy user_section_access on public.audiometry_records as restrictive for all to authenticated using (public.user_access_allowed('ohealth.audiometry','view')) with check (public.user_access_allowed('ohealth.audiometry','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.audiometry_records$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.audiometry_records for each row execute function public.guard_module_user_access('ohealth.audiometry')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.occupational_diseases') is not null then
 execute $stmt$drop policy if exists user_section_access on public.occupational_diseases$stmt$;
 execute $stmt$create policy user_section_access on public.occupational_diseases as restrictive for all to authenticated using (public.user_access_allowed('ohealth.disease','view')) with check (public.user_access_allowed('ohealth.disease','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.occupational_diseases$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.occupational_diseases for each row execute function public.guard_module_user_access('ohealth.disease')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.exposure_monitoring') is not null then
 execute $stmt$drop policy if exists user_section_access on public.exposure_monitoring$stmt$;
 execute $stmt$create policy user_section_access on public.exposure_monitoring as restrictive for all to authenticated using (public.user_access_allowed('ohealth.exposure','view')) with check (public.user_access_allowed('ohealth.exposure','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.exposure_monitoring$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.exposure_monitoring for each row execute function public.guard_module_user_access('ohealth.exposure')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.waste_records') is not null then
 execute $stmt$drop policy if exists user_section_access on public.waste_records$stmt$;
 execute $stmt$create policy user_section_access on public.waste_records as restrictive for all to authenticated using (public.user_access_allowed('esg.waste','view')) with check (public.user_access_allowed('esg.waste','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.waste_records$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.waste_records for each row execute function public.guard_module_user_access('esg.waste')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.hazardous_waste') is not null then
 execute $stmt$drop policy if exists user_section_access on public.hazardous_waste$stmt$;
 execute $stmt$create policy user_section_access on public.hazardous_waste as restrictive for all to authenticated using (public.user_access_allowed('esg.hazwaste','view')) with check (public.user_access_allowed('esg.hazwaste','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.hazardous_waste$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.hazardous_waste for each row execute function public.guard_module_user_access('esg.hazwaste')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.water_usage') is not null then
 execute $stmt$drop policy if exists user_section_access on public.water_usage$stmt$;
 execute $stmt$create policy user_section_access on public.water_usage as restrictive for all to authenticated using (public.user_access_allowed('esg.water','view')) with check (public.user_access_allowed('esg.water','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.water_usage$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.water_usage for each row execute function public.guard_module_user_access('esg.water')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.environmental_inspections') is not null then
 execute $stmt$drop policy if exists user_section_access on public.environmental_inspections$stmt$;
 execute $stmt$create policy user_section_access on public.environmental_inspections as restrictive for all to authenticated using (public.user_access_allowed('esg.inspections','view')) with check (public.user_access_allowed('esg.inspections','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.environmental_inspections$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.environmental_inspections for each row execute function public.guard_module_user_access('esg.inspections')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.contractor_preassessments') is not null then
 execute $stmt$drop policy if exists user_section_access on public.contractor_preassessments$stmt$;
 execute $stmt$create policy user_section_access on public.contractor_preassessments as restrictive for all to authenticated using (public.user_access_allowed('contractor.preassess','view')) with check (public.user_access_allowed('contractor.preassess','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.contractor_preassessments$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.contractor_preassessments for each row execute function public.guard_module_user_access('contractor.preassess')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.contractor_evaluations') is not null then
 execute $stmt$drop policy if exists user_section_access on public.contractor_evaluations$stmt$;
 execute $stmt$create policy user_section_access on public.contractor_evaluations as restrictive for all to authenticated using (public.user_access_allowed('contractor.eval','view')) with check (public.user_access_allowed('contractor.eval','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.contractor_evaluations$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.contractor_evaluations for each row execute function public.guard_module_user_access('contractor.eval')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.contractor_authorisations') is not null then
 execute $stmt$drop policy if exists user_section_access on public.contractor_authorisations$stmt$;
 execute $stmt$create policy user_section_access on public.contractor_authorisations as restrictive for all to authenticated using (public.user_access_allowed('contractor.atw','view')) with check (public.user_access_allowed('contractor.atw','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.contractor_authorisations$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.contractor_authorisations for each row execute function public.guard_module_user_access('contractor.atw')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.contractor_incidents') is not null then
 execute $stmt$drop policy if exists user_section_access on public.contractor_incidents$stmt$;
 execute $stmt$create policy user_section_access on public.contractor_incidents as restrictive for all to authenticated using (public.user_access_allowed('contractor.incidents','view')) with check (public.user_access_allowed('contractor.incidents','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.contractor_incidents$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.contractor_incidents for each row execute function public.guard_module_user_access('contractor.incidents')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.legal_register') is not null then
 execute $stmt$drop policy if exists user_section_access on public.legal_register$stmt$;
 execute $stmt$create policy user_section_access on public.legal_register as restrictive for all to authenticated using (public.user_access_allowed('legal.register','view')) with check (public.user_access_allowed('legal.register','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.legal_register$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.legal_register for each row execute function public.guard_module_user_access('legal.register')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.legal_changes') is not null then
 execute $stmt$drop policy if exists user_section_access on public.legal_changes$stmt$;
 execute $stmt$create policy user_section_access on public.legal_changes as restrictive for all to authenticated using (public.user_access_allowed('legal.changes','view')) with check (public.user_access_allowed('legal.changes','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.legal_changes$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.legal_changes for each row execute function public.guard_module_user_access('legal.changes')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.legislative_changes') is not null then
 execute $stmt$drop policy if exists user_section_access on public.legislative_changes$stmt$;
 execute $stmt$create policy user_section_access on public.legislative_changes as restrictive for all to authenticated using (public.user_access_allowed('legal.changes','view')) with check (public.user_access_allowed('legal.changes','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.legislative_changes$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.legislative_changes for each row execute function public.guard_module_user_access('legal.changes')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.compliance_assessments') is not null then
 execute $stmt$drop policy if exists user_section_access on public.compliance_assessments$stmt$;
 execute $stmt$create policy user_section_access on public.compliance_assessments as restrictive for all to authenticated using (public.user_access_allowed('legal.assessments','view')) with check (public.user_access_allowed('legal.assessments','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.compliance_assessments$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.compliance_assessments for each row execute function public.guard_module_user_access('legal.assessments')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.compliance_calendar') is not null then
 execute $stmt$drop policy if exists user_section_access on public.compliance_calendar$stmt$;
 execute $stmt$create policy user_section_access on public.compliance_calendar as restrictive for all to authenticated using (public.user_access_allowed('legal.calendar','view')) with check (public.user_access_allowed('legal.calendar','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.compliance_calendar$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.compliance_calendar for each row execute function public.guard_module_user_access('legal.calendar')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.compliance_gaps') is not null then
 execute $stmt$drop policy if exists user_section_access on public.compliance_gaps$stmt$;
 execute $stmt$create policy user_section_access on public.compliance_gaps as restrictive for all to authenticated using (public.user_access_allowed('legal.gaps','view')) with check (public.user_access_allowed('legal.gaps','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.compliance_gaps$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.compliance_gaps for each row execute function public.guard_module_user_access('legal.gaps')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.doc_controlled_copies') is not null then
 execute $stmt$drop policy if exists user_section_access on public.doc_controlled_copies$stmt$;
 execute $stmt$create policy user_section_access on public.doc_controlled_copies as restrictive for all to authenticated using (public.user_access_allowed('documents.copies','view')) with check (public.user_access_allowed('documents.copies','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.doc_controlled_copies$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.doc_controlled_copies for each row execute function public.guard_module_user_access('documents.copies')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.doc_acknowledgements') is not null then
 execute $stmt$drop policy if exists user_section_access on public.doc_acknowledgements$stmt$;
 execute $stmt$create policy user_section_access on public.doc_acknowledgements as restrictive for all to authenticated using (public.user_access_allowed('documents.ack','view')) with check (public.user_access_allowed('documents.ack','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.doc_acknowledgements$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.doc_acknowledgements for each row execute function public.guard_module_user_access('documents.ack')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.kpi_monthly_data') is not null then
 execute $stmt$drop policy if exists user_section_access on public.kpi_monthly_data$stmt$;
 execute $stmt$create policy user_section_access on public.kpi_monthly_data as restrictive for all to authenticated using (public.user_access_allowed('kpi.monthly','view')) with check (public.user_access_allowed('kpi.monthly','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.kpi_monthly_data$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.kpi_monthly_data for each row execute function public.guard_module_user_access('kpi.monthly')$stmt$;
end if;end $section$;
do $section$ begin if to_regclass('public.kpi_monthly_reviews') is not null then
 execute $stmt$drop policy if exists user_section_access on public.kpi_monthly_reviews$stmt$;
 execute $stmt$create policy user_section_access on public.kpi_monthly_reviews as restrictive for all to authenticated using (public.user_access_allowed('kpi.monthly','view')) with check (public.user_access_allowed('kpi.monthly','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.kpi_monthly_reviews$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.kpi_monthly_reviews for each row execute function public.guard_module_user_access('kpi.monthly')$stmt$;
end if;end $section$;
create or replace function public.user_access_preflight() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare request_path text; rpc_name text; routine_source text; entry record; denied_tables jsonb; actor public.profiles;
begin
  if auth.uid() is null then return; end if;
  select * into actor from public.profiles where id=auth.uid();
  if actor.role='sephs_admin' or actor.permissions->'access_v1' is null then return; end if;
  request_path:=current_setting('request.path',true);
  if request_path not like '/rpc/%' then return; end if;
  rpc_name:=split_part(substring(request_path from 6),'?',1);
  denied_tables:='{"people":"people","people_certifications":"people","events":"events","inspections":"inspection","toolbox_talks":"meetings.tbt","hse_meetings":"meetings.schedule","meeting_actions":"meetings.minutes","work_schedule":"workschedule","work_schedule_links":"workschedule","permits":"permit","risk_assessments":"risk","risk_assessment_items":"risk","risk_assessment_operational_records":"risk","risk_assessment_relationships":"risk","tools_register":"tools","tool_inspections":"tools","ppe_catalogue":"ppe","ppe_inspections":"ppe.inspections","ppe_issuance":"ppe.issuance","ppe_replacements":"ppe.replacements","documents":"documents","training_needs":"training.tna","kpis":"kpi","kpis_v2":"kpi","kpi_indicators":"kpi","kpi_monthly_data":"kpi.monthly","company_settings":"settings.company","approval_workflows":"settings.workflows","approval_workflow_steps":"settings.workflows","notification_settings":"settings.notifications","notification_escalation_settings":"settings.notifications","notification_acknowledgement_settings":"settings.notifications","investigations":"events","incident_evidence":"events","incident_mgmt_records":"events","incident_mgmt_config_records":"events","bbs_observation_details":"observation","bbs_observation_responses":"observation","bbs_observation_barriers":"observation","bbs_programmes":"observation","bbs_feedback":"observation","bbs_quality_reviews":"observation","bbs_recognitions":"observation","bbs_themes":"observation","inspection_items":"inspection","inspection_actions":"inspection","prestart_inspections":"inspection","checklist_templates":"inspection","action_tracker":"actions","jsa_records":"risk","equipment_assurance_records":"tools","equipment_assurance_profiles":"tools","equipment_defects":"tools","equipment_movements":"tools","equipment_maintenance_events":"tools","fuel_consumption":"fleet","atex_areas":"atex","fire_certificates":"fire.certs","fire_equipment":"fire.equipment","fire_inspections":"fire.inspections","fire_inspection_findings":"fire.inspections","fire_layouts":"fire.layout","fire_layout_symbols":"fire.layout","chemical_register":"chemical","chemical_sds_versions":"chemical","chemical_inventory_events":"chemical.inventory","chemical_use_approvals":"chemical.approvals","emergency_equipment":"emergency.equipment","emergency_drills":"emergency.drills","emergency_plans":"emergency.plans","emergency_activations":"emergency.activations","ert_members":"emergency.ert","muster_points":"emergency.muster","bcp_records":"emergency.bcp","contractors":"contractor","contractor_documents":"contractor","contractor_authorisations":"contractor.atw","contractor_evaluations":"contractor.eval","contractor_incidents":"contractor.incidents","contractor_preassessments":"contractor.preassess","contractor_assurance_profiles":"contractor","contractor_mobilisation_gates":"contractor","contractor_work_packages":"contractor","document_control_records":"documents","document_control_revisions":"documents","document_control_files":"documents","document_control_config":"documents","doc_revisions":"documents","doc_controlled_copies":"documents.copies","doc_acknowledgements":"documents.ack","induction_records":"training.induction","competencies":"training.competency","competency_matrix":"training.competency","training_plan":"training.plan","noise_measurements":"noise","noise_surveys":"noise","noise_mgmt_assessment_profiles":"noise","noise_mgmt_control_plans":"noise","noise_mgmt_exposure_assessments":"noise","noise_mgmt_field_surveys":"noise","noise_mgmt_health_statuses":"noise","noise_mgmt_hearing_protectors":"noise","noise_mgmt_instruments":"noise","noise_mgmt_maps":"noise","noise_mgmt_measurement_plans":"noise","noise_mgmt_measurements":"noise","noise_mgmt_programmes":"noise","noise_mgmt_reports":"noise","noise_mgmt_segs":"noise","noise_mgmt_sources":"noise","noise_mgmt_tasks":"noise","master_data_records":"master-data","master_data_revisions":"master-data","master_data_dependencies":"master-data","master_data_import_batches":"master-data","master_data_import_rows":"master-data","medical_surveillance":"ohealth.surveillance","occupational_diseases":"ohealth.disease","audiometry_records":"ohealth.audiometry","exposure_monitoring":"ohealth.exposure","esg_targets":"esg","environmental_inspections":"esg.inspections","hazardous_waste":"esg.hazwaste","waste_records":"esg.waste","water_usage":"esg.water","legal_register":"legal.register","legal_requirements":"legal","legal_changes":"legal.changes","legislative_changes":"legal.changes","legal_compliance_records":"legal","legal_compliance_relationships":"legal","compliance_assessments":"legal.assessments","compliance_audits":"legal","compliance_calendar":"legal.calendar","compliance_gaps":"legal.gaps","sop_documents":"sop","sop_video_evidence":"sop","sop_video_projects":"sop","sop_video_relationships":"sop","swms_configuration_versions":"swms","swms_operational_records":"swms","swms_relationships":"swms","moc_change_requests":"moc","objectives":"kpi","kpi_config_versions":"kpi","kpi_config_audit":"kpi","kpi_monthly_reviews":"kpi.monthly","custom_fields":"settings.modules","custom_field_values":"settings.modules","automation_rules":"settings.workflows","workflow_policy_versions":"settings.workflows","workflow_policy_events":"settings.workflows","person_identity_backfill_review":"settings.data","person_identity_decisions":"settings.data","location_identity_backfill_review":"settings.data","whatsapp_channel_settings":"settings.notifications","integrations":"integrations","integration_sync_log":"integrations","elearning_courses":"training.elearning","elearning_enrolments":"training.elearning","elearning_quiz_attempts":"training.elearning","learning_course_governance":"training.elearning","learning_practical_assessments":"training.elearning","training_sessions":"training","training_requirements":"training","training_followup":"training.followup","safety_observations":"observation","tool_checklist_templates":"tools","training_plans":"training.plan","training_records":"training.followup","training_matrix":"training.matrix","training_needs_analysis":"training.tna"}'::jsonb;
  for entry in
    with recursive called(oid,src,visited) as (
      select p.oid,p.prosrc,array[p.oid] from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=rpc_name
      union all
      select p.oid,p.prosrc,c.visited||p.oid from called c join pg_proc p on c.src ~ ('\m'||p.proname||'\M[[:space:]]*\(') join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and not p.oid=any(c.visited) and cardinality(c.visited)<12
    ) select distinct src from called
  loop
    for routine_source,rpc_name in select key,value from jsonb_each_text(denied_tables) loop
      if entry.src ~ ('\m'||routine_source||'\M') and not public.user_access_allowed(rpc_name,'view') then
        raise exception 'This RPC accesses a module unavailable to your account' using errcode='42501';
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.user_access_preflight() from public;
grant execute on function public.user_access_preflight() to authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname='authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request = ''public.user_access_preflight''';
  end if;
end $$;


-- Mixed inspection registers filter each record by its actual inspection section.
create or replace function public.guard_inspection_section_access() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare record_type text;
begin
 if auth.uid() is null then if tg_op='DELETE' then return old;else return new;end if;end if;
 if tg_op in ('UPDATE','DELETE') and not public.user_access_allowed('inspection.'||coalesce(old.inspection_type,'workplace'),'view') then raise exception 'Inspection section unavailable' using errcode='42501';end if;
 if tg_op in ('INSERT','UPDATE') and not public.user_access_allowed('inspection.'||coalesce(new.inspection_type,'workplace'),'view') then raise exception 'Inspection section unavailable' using errcode='42501';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
drop policy if exists user_inspection_section_access on public.inspections;
create policy user_inspection_section_access on public.inspections as restrictive for all to authenticated
 using (public.user_access_allowed('inspection.'||coalesce(inspection_type,'workplace'),'view'))
 with check (public.user_access_allowed('inspection.'||coalesce(inspection_type,'workplace'),'view'));
drop trigger if exists inspection_section_user_access_guard on public.inspections;
create trigger inspection_section_user_access_guard before insert or update or delete on public.inspections for each row execute function public.guard_inspection_section_access();

do $section$ begin if to_regclass('public.chemical_use_approvals') is not null then
 execute $stmt$drop policy if exists user_section_access on public.chemical_use_approvals$stmt$;
 execute $stmt$create policy user_section_access on public.chemical_use_approvals as restrictive for all to authenticated using (public.user_access_allowed('chemical.approvals','view')) with check (public.user_access_allowed('chemical.approvals','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.chemical_use_approvals$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.chemical_use_approvals for each row execute function public.guard_module_user_access('chemical.approvals')$stmt$;
 end if;end $section$;
do $section$ begin if to_regclass('public.chemical_inventory_events') is not null then
 execute $stmt$drop policy if exists user_section_access on public.chemical_inventory_events$stmt$;
 execute $stmt$create policy user_section_access on public.chemical_inventory_events as restrictive for all to authenticated using (public.user_access_allowed('chemical.inventory','view')) with check (public.user_access_allowed('chemical.inventory','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.chemical_inventory_events$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.chemical_inventory_events for each row execute function public.guard_module_user_access('chemical.inventory')$stmt$;
 end if;end $section$;
do $section$ begin if to_regclass('public.emergency_plans') is not null then
 execute $stmt$drop policy if exists user_section_access on public.emergency_plans$stmt$;
 execute $stmt$create policy user_section_access on public.emergency_plans as restrictive for all to authenticated using (public.user_access_allowed('emergency.plans','view')) with check (public.user_access_allowed('emergency.plans','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.emergency_plans$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.emergency_plans for each row execute function public.guard_module_user_access('emergency.plans')$stmt$;
 end if;end $section$;
do $section$ begin if to_regclass('public.ert_members') is not null then
 execute $stmt$drop policy if exists user_section_access on public.ert_members$stmt$;
 execute $stmt$create policy user_section_access on public.ert_members as restrictive for all to authenticated using (public.user_access_allowed('emergency.ert','view')) with check (public.user_access_allowed('emergency.ert','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.ert_members$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.ert_members for each row execute function public.guard_module_user_access('emergency.ert')$stmt$;
 end if;end $section$;
do $section$ begin if to_regclass('public.muster_points') is not null then
 execute $stmt$drop policy if exists user_section_access on public.muster_points$stmt$;
 execute $stmt$create policy user_section_access on public.muster_points as restrictive for all to authenticated using (public.user_access_allowed('emergency.muster','view')) with check (public.user_access_allowed('emergency.muster','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.muster_points$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.muster_points for each row execute function public.guard_module_user_access('emergency.muster')$stmt$;
 end if;end $section$;
do $section$ begin if to_regclass('public.emergency_drills') is not null then
 execute $stmt$drop policy if exists user_section_access on public.emergency_drills$stmt$;
 execute $stmt$create policy user_section_access on public.emergency_drills as restrictive for all to authenticated using (public.user_access_allowed('emergency.drills','view')) with check (public.user_access_allowed('emergency.drills','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.emergency_drills$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.emergency_drills for each row execute function public.guard_module_user_access('emergency.drills')$stmt$;
 end if;end $section$;
do $section$ begin if to_regclass('public.emergency_activations') is not null then
 execute $stmt$drop policy if exists user_section_access on public.emergency_activations$stmt$;
 execute $stmt$create policy user_section_access on public.emergency_activations as restrictive for all to authenticated using (public.user_access_allowed('emergency.activations','view')) with check (public.user_access_allowed('emergency.activations','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.emergency_activations$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.emergency_activations for each row execute function public.guard_module_user_access('emergency.activations')$stmt$;
 end if;end $section$;
do $section$ begin if to_regclass('public.bcp_records') is not null then
 execute $stmt$drop policy if exists user_section_access on public.bcp_records$stmt$;
 execute $stmt$create policy user_section_access on public.bcp_records as restrictive for all to authenticated using (public.user_access_allowed('emergency.bcp','view')) with check (public.user_access_allowed('emergency.bcp','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.bcp_records$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.bcp_records for each row execute function public.guard_module_user_access('emergency.bcp')$stmt$;
 end if;end $section$;
do $section$ begin if to_regclass('public.emergency_equipment') is not null then
 execute $stmt$drop policy if exists user_section_access on public.emergency_equipment$stmt$;
 execute $stmt$create policy user_section_access on public.emergency_equipment as restrictive for all to authenticated using (public.user_access_allowed('emergency.equipment','view')) with check (public.user_access_allowed('emergency.equipment','view'))$stmt$;
 execute $stmt$drop trigger if exists section_user_access_guard on public.emergency_equipment$stmt$;
 execute $stmt$create trigger section_user_access_guard before insert or update or delete on public.emergency_equipment for each row execute function public.guard_module_user_access('emergency.equipment')$stmt$;
 end if;end $section$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
