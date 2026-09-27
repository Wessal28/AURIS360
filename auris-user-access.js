(function(root){
'use strict';
var tables={people:'people',people_certifications:'people',profiles:'users',events:'events',incident_investigations:'events',observations:'observation',bbs_observations:'observation',inspections:'inspection',inspection_photos:'inspection',toolbox_talks:'meetings',hse_meetings:'meetings',meeting_actions:'meetings',work_schedule:'workschedule',work_schedule_links:'workschedule',permits:'permit',risk_assessments:'risk',risk_assessment_items:'risk',risk_assessment_operational_records:'risk',risk_assessment_relationships:'risk',actions:'actions',corrective_actions:'actions',tools_register:'tools',tool_inspections:'tools',ppe_catalogue:'ppe',ppe_inspections:'ppe',ppe_issuance:'ppe',ppe_replacements:'ppe',fleet_vehicles:'fleet',vehicle_inspections:'fleet',documents:'documents',training_records:'training',training_plans:'training',training_needs:'training',kpis:'kpi',kpis_v2:'kpi',kpi_indicators:'kpi',kpi_monthly_data:'kpi',company_settings:'settings.company',approval_workflows:'settings.workflows',approval_workflow_steps:'settings.workflows',notification_settings:'settings.notifications',notification_escalation_settings:'settings.notifications',notification_acknowledgement_settings:'settings.notifications'};
function allowed(profile,key,action){
  if(!profile)return false;
  if(profile.role==='sephs_admin')return true;
  var map=profile.permissions&&profile.permissions.access_v1;
  if(!map||typeof map!=='object')return true;
  var parent=key.indexOf('settings.')===0?map.settings:null;
  if(parent&&(parent.view===false||parent[action||'view']===false))return false;
  var rule=map[key];
  if(!rule)return true;
  return rule.view!==false&&rule[action||'view']!==false;
}
function validate(map,keys){
  if(!map||typeof map!=='object'||Array.isArray(map))throw new Error('Invalid access rules');
  var out={};
  Object.keys(map).forEach(function(key){
    if(keys.indexOf(key)===-1)throw new Error('Unknown module: '+key);
    var rule=map[key];if(!rule||typeof rule!=='object'||Array.isArray(rule))throw new Error('Invalid module rule');
    out[key]={};Object.keys(rule).forEach(function(action){if(['view','create','edit','delete'].indexOf(action)===-1||typeof rule[action]!=='boolean')throw new Error('Invalid access action');out[key][action]=rule[action];});
  });return out;
}
var groups={
events:['investigations','incident_evidence','incident_mgmt_records','incident_mgmt_config_records'],
observation:['bbs_observation_details','bbs_observation_responses','bbs_observation_barriers','bbs_programmes','bbs_feedback','bbs_quality_reviews','bbs_recognitions','bbs_themes'],
inspection:['inspection_items','inspection_actions','prestart_inspections','checklist_templates'],
actions:['action_tracker'],risk:['jsa_records'],
tools:['equipment_assurance_records','equipment_assurance_profiles','equipment_defects','equipment_movements','equipment_maintenance_events'],
fleet:['vehicles','vehicle_maintenance','vehicle_incidents','fuel_consumption'],
atex:['atex_areas'],fire:['fire_certificates','fire_equipment','fire_inspections','fire_inspection_findings','fire_layouts','fire_layout_symbols'],
chemical:['chemical_register','chemical_sds_versions','chemical_inventory_events','chemical_use_approvals'],
emergency:['emergency_equipment','emergency_drills','emergency_plans','emergency_activations','ert_members','muster_points','bcp_records'],
contractor:['contractors','contractor_documents','contractor_authorisations','contractor_evaluations','contractor_incidents','contractor_preassessments','contractor_assurance_profiles','contractor_mobilisation_gates','contractor_work_packages'],
documents:['document_control_records','document_control_revisions','document_control_files','document_control_config','doc_revisions','doc_controlled_copies','doc_acknowledgements'],
training:['induction_records','competencies','competency_matrix','training_matrix','training_needs_analysis','training_plan'],
noise:['noise_measurements','noise_surveys','noise_mgmt_assessment_profiles','noise_mgmt_control_plans','noise_mgmt_exposure_assessments','noise_mgmt_field_surveys','noise_mgmt_health_statuses','noise_mgmt_hearing_protectors','noise_mgmt_instruments','noise_mgmt_maps','noise_mgmt_measurement_plans','noise_mgmt_measurements','noise_mgmt_programmes','noise_mgmt_reports','noise_mgmt_segs','noise_mgmt_sources','noise_mgmt_tasks'],
'master-data':['master_data_records','master_data_revisions','master_data_dependencies','master_data_import_batches','master_data_import_rows'],
ohealth:['medical_surveillance','occupational_diseases','audiometry_records','exposure_monitoring'],
esg:['esg_targets','environmental_inspections','hazardous_waste','waste_records','water_usage'],
legal:['legal_register','legal_requirements','legal_changes','legislative_changes','legal_compliance_records','legal_compliance_relationships','compliance_assessments','compliance_audits','compliance_calendar','compliance_gaps'],
sop:['sop_records','sop_documents','sop_video_evidence','sop_video_projects','sop_video_relationships'],swms:['swms_records','swms_configuration_versions','swms_operational_records','swms_relationships'],moc:['moc_change_requests'],
kpi:['objectives','kpi_config_versions','kpi_config_audit','kpi_monthly_reviews'],
'settings.modules':['custom_fields','custom_field_values'],'settings.workflows':['workflow_definitions','workflow_definition_versions','automation_rules','workflow_policy_versions','workflow_policy_events'],
'settings.data':['person_identity_backfill_review','person_identity_decisions','location_identity_backfill_review'],
'settings.notifications':['whatsapp_channel_settings'],'integrations':['integrations','integration_sync_log']
};
Object.keys(groups).forEach(function(key){groups[key].forEach(function(table){tables[table]=key;});});
['elearning_courses','elearning_enrolments','elearning_quiz_attempts','learning_course_governance','learning_practical_assessments','training_sessions','training_requirements','training_followup'].forEach(function(t){tables[t]='training';});
tables.safety_observations='observation';tables.tool_checklist_templates='tools';
var policy={tables:tables,allowed:allowed,validate:validate};
if(typeof module!=='undefined'&&module.exports)module.exports=policy;
root.AurisUserAccess=policy;
if(!root.document)return;
policy.chooseContact=function(person){return new Promise(function(resolve){
  var dialog=document.createElement('dialog');dialog.className='user-onboarding-dialog';
  var title=document.createElement('h3');title.textContent='Onboard '+[person.first_name,person.last_name].filter(Boolean).join(' ');dialog.appendChild(title);
  var summary=document.createElement('p');summary.textContent='Use the contact details already saved in this person’s profile.';dialog.appendChild(summary);
  [['email','Send email invitation',person.email],['phone','Create phone login',person.phone]].forEach(function(choice){var button=document.createElement('button');button.type='button';button.className='btn';button.textContent=choice[1]+' · '+choice[2];button.addEventListener('click',function(){dialog.close();dialog.remove();resolve(choice[0]);});dialog.appendChild(button);});
  var cancel=document.createElement('button');cancel.type='button';cancel.className='btn';cancel.textContent='Cancel';cancel.addEventListener('click',function(){dialog.close();dialog.remove();resolve(null);});dialog.appendChild(cancel);
  var detail=document.createElement('p');detail.textContent='Phone login uses a temporary password that you share directly. No SMS is sent.';dialog.appendChild(detail);
  dialog.addEventListener('cancel',function(){dialog.remove();resolve(null);});document.body.appendChild(dialog);dialog.showModal();
});};
policy.requestIssue=function(profile,path,method){if(!profile)return '';var table=String(path).split('?')[0].replace(/^\//,''),key=tables[table];if(!key)return '';if(table==='profiles'&&method==='GET'&&String(path).includes('id=eq.'+profile.id))return '';var action={GET:'view',HEAD:'view',POST:'create',PATCH:'edit',PUT:'edit',DELETE:'delete'}[method]||'view';return allowed(profile,key,action)?'':'Your account cannot '+action+' records in '+key+'. Contact your administrator.';};
policy.mount=function(user){
  var host=document.getElementById('user-access-controls');if(!host)return;
  host.replaceChildren();
  if(!usersCanAdminUser(user))return;
  var title=document.createElement('h3');title.textContent='Module access';host.appendChild(title);
  var note=document.createElement('p');note.textContent='Restrictions apply within this user’s role and company access. Unchecked View hides a module. View only keeps its records read-only. These controls do not grant additional role privileges.';host.appendChild(note);
  var current=(user.permissions||{}).access_v1||{};
  var list=root.AurisModuleRegistry.list().filter(function(m){return !m.hidden;}).map(function(m){return {key:m.key,name:m.name};});
  ['company','workflows','notifications','modules','data','personal','support'].forEach(function(k){list.push({key:'settings.'+k,name:'Settings · '+{company:'Company',workflows:'Workflows & approvals',notifications:'Notifications',modules:'Module configuration',data:'Data administration',personal:'My profile & drafts',support:'Support'}[k]});});
  var grid=document.createElement('div');grid.className='user-access-grid';
  list.forEach(function(m){var row=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=m.name;row.appendChild(legend);['view','create','edit','delete'].forEach(function(action){var label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.dataset.accessKey=m.key;input.dataset.accessAction=action;input.checked=!(current[m.key]&&current[m.key][action]===false);label.append(input,document.createTextNode(' '+{view:'View',create:'Create',edit:'Edit',delete:'Delete'}[action]));row.appendChild(label);});
    var preset=document.createElement('select');preset.setAttribute('aria-label',m.name+' access preset');['Custom','Role default','Read only','Hidden'].forEach(function(text){var option=document.createElement('option');option.textContent=text;preset.appendChild(option);});preset.addEventListener('change',function(){if(preset.value==='Custom')return;row.querySelectorAll('input').forEach(function(input){input.checked=preset.value==='Role default'||preset.value==='Read only'&&input.dataset.accessAction==='view';});});row.appendChild(preset);grid.appendChild(row);
  });host.appendChild(grid);
  var save=document.createElement('button');save.type='button';save.className='btn btn-primary';save.textContent='Save access';save.addEventListener('click',async function(){
    save.disabled=true;
    try{var map=JSON.parse(JSON.stringify(current));grid.querySelectorAll('input').forEach(function(input){var key=input.dataset.accessKey;if(!map[key])map[key]={};map[key][input.dataset.accessAction]=input.checked;});
      var response=await fetch('/api/user-administration',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok},body:JSON.stringify({action:'set_access',user_id:user.id,access:map})});var result=await response.json();if(!response.ok)throw new Error(result.error||'Access was not saved');user.permissions=result.permissions;toast('User access saved. It applies on their next reload.');
    }catch(e){toast(e.message,false);}finally{save.disabled=false;}
  });host.appendChild(save);
};
})(typeof window!=='undefined'?window:globalThis);
