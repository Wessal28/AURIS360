(function(root){
'use strict';
var stylesheet='<link rel="stylesheet" href="/auris-print-incident.css?v=20261128-1">';
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function label(value){return String(value==null?'Not recorded':value).replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();});}
function present(value){return value!==null&&value!==undefined&&value!==''&&(!Array.isArray(value)||value.length>0);}
function date(value){if(!value)return 'Not recorded';var d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});}
function reference(row){return row.event_ref||row.incident_number||row.investigation_ref||row.inv_ref||'Reference not assigned';}
function content(value){
 if(!present(value))return '<span class="imx-detail-empty">Not recorded</span>';
 if(typeof value==='string'&&/^[\[{]/.test(value.trim())){try{return content(JSON.parse(value));}catch(_){}}
 if(Array.isArray(value))return '<ul class="imx-detail-list">'+value.map(function(item){return '<li>'+content(item)+'</li>';}).join('')+'</ul>';
 if(typeof value==='object')return '<dl class="imx-detail-object">'+Object.keys(value).map(function(key){return '<div><dt>'+esc(label(key))+'</dt><dd>'+content(value[key])+'</dd></div>';}).join('')+'</dl>';
 return '<span class="imx-detail-text">'+esc(typeof value==='boolean'?(value?'Yes':'No'):value)+'</span>';
}
function field(name,value,full,required){return !required&&!present(value)?'':'<div class="imx-detail-field'+(full?' full':'')+'"><dt>'+esc(name)+'</dt><dd>'+content(value)+'</dd></div>';}
function section(title,body){return body?'<section class="imx-detail-section"><h3>'+esc(title)+'</h3><dl class="imx-detail-grid">'+body+'</dl></section>':'';}
function fields(row,definitions){return definitions.map(function(def){var keys=Array.isArray(def[1])?def[1]:[def[1]],value;for(var key of keys){if(present(row[key])){value=row[key];break;}}return field(def[0],value,def[2],def[3]);}).join('');}
function documentHtml(title,ref,body,options){options=options||{};return stylesheet+'<article class="imx-record-document"><header class="imx-record-document-head"><div><p class="imx-record-kicker">'+esc(options.companyName||'AURIS360')+'</p><h1>'+esc(title)+'</h1><p>'+esc(ref)+'</p></div><span class="imx-record-state">'+esc(label(options.status))+'</span></header>'+body+'<footer class="imx-record-document-foot">Saved record snapshot · '+esc(options.confidentiality||'internal')+(options.loadedAt?' · Viewed '+esc(new Date(options.loadedAt).toLocaleString('en-GB')):'')+'</footer></article>';}
function incidentHtml(row,options){
 var summary=field('Reference',reference(row),false,true)+field('Event date',date(row.event_date),false,true)+fields(row,[['Event time','event_time'],['Site / location','location',false,true],['Department','department'],['Type','event_type',false,true],['Actual severity','severity'],['Potential severity','potential_severity'],['Status','status',false,true],['Work activity','work_activity']]);
 if(row.estimated_time)summary+=field('Time accuracy','Estimated');
 var reporting=fields(row,[['Assigned to',['assigned_to_name','assigned_to']],['Due date',['due_date','action_due_date']],['Investigation reference','investigation_ref'],['Investigation required','investigation_required']]);
 if(row.reporter_mode!=='anonymous')reporting=field('Reported by',row.reported_by_name||row.reported_by)+reporting;
 var body=section('Incident details',summary)+section('What happened',(row.title&&row.title!==row.description?field('Incident summary',row.title,true):'')+field('Description',row.description,true,true)+field('Immediate action',row.immediate_action,true)+field('Witnesses',row.witnesses,true));
 body+=section('People and injury',fields(row,[['Person involved',['injured_person','person_involved']],['Injury classification','injury_type'],['Body part','body_part'],['Treatment','treatment',true],['Lost-time days','lost_time_days'],['Restricted-work days','restricted_work_days']]));
 body+=section('Review and follow-up',reporting+fields(row,[['Root cause','root_cause',true],['Corrective action','corrective_action',true],['Regulatory decision','regulatory_required'],['Regulator notified','regulator_notified'],['Regulator reference','regulator_ref']]));
 return documentHtml('Incident report',reference(row),body,Object.assign({},options,{status:row.status,confidentiality:row.confidentiality}));
}
function investigationHtml(row,options){
 options=options||{};
 var body=section('Investigation details',field('Reference',reference(row),false,true)+field('Source incident',options.incidentReference||row.linked_event_ref)+fields(row,[['Status','status',false,true],['Method','investigation_method'],['Investigator / lead',['investigation_lead','investigator','investigated_by','reported_by']],['Team members','team_members'],['Site / location',['location','incident_location']],['Department','department']])+field('Incident date',date(row.incident_date))+field('Incident time',row.incident_time)+field('Target completion',date(row.target_completion||row.target_date||row.date_completion)));
 body+=section('Facts and immediate response',fields(row,[['What happened',['description','incident_description','what_happened'],true,true],['Person involved',['person_name','person_involved','persons_involved']],['Role / function','person_function'],['Witnesses','witnesses',true],['Immediate actions','immediate_actions',true],['First aid','first_aid_details',true]]));
 body+=section('Classification and investigation plan',fields(row,[['Investigation type',['investigation_type','inv_type']],['Actual severity','severity_actual'],['Potential severity','severity_potential'],['Health and safety classification','nature_hs'],['Environmental classification','nature_env'],['Site classification','nature_site'],['Health and safety consequences','consequences_hs',true],['Environmental consequences','consequences_env',true],['Site consequences','consequences_site',true],['Objective','objective',true],['Scope','scope',true],['Exclusions','exclusions',true],['Plan status','plan_status'],['Start date','start_date']]));
 body+=section('Recorded interviews and assessment',fields(row,[['Interviewer',['interviewer','ws2_interviewer']],['Interviewee',['interviewee','ws2_interviewee']],['Interview date',['interview_date','ws2_date']],['Interview questions','ws2_questions',true],['Procedures','ws2_procedures',true],['Management','ws2_management',true],['Skills and training','ws2_skills',true],['Attitude','ws2_attitude',true],['Workplace care','ws2_care',true],['Personal factors','ws2_personal',true],['Interview root-cause findings','ws2_root_causes',true],['Assessment completed by','ws3_completed_by'],['Assessment date','ws3_date'],['Assessment participants','ws3_participants',true],['Machine findings','ws3_machines_explain',true],['Material findings','ws3_materials_explain',true],['Environment findings','ws3_environment_explain',true]]));
 body+=section('Analysis',fields(row,[['Immediate causes','immediate_causes',true],['Five whys',['five_whys','ws3_five_why'],true],['Root causes','root_causes',true],['Contributing factors','contributing_factors',true],['Systemic factors','systemic_causes',true],['Fishbone analysis','fishbone_causes',true],['Timeline','timeline_events',true],['ICAM absent controls','icam_absence_controls',true],['ICAM individual factors','icam_individual_factors',true],['ICAM task conditions','icam_task_conditions',true],['ICAM organisational factors','icam_org_factors',true],['TapRooT analysis','taproot_root_causes',true]]));
 body+=section('Actions and learning',fields(row,[['Corrective actions',['corrective_actions','ws1_corrective_actions'],true],['Preventive actions','preventive_actions',true],['Lessons learned','lessons_learned',true],['Effectiveness review date','effectiveness_review_date'],['Effectiveness rating','effectiveness_rating']]));
 body+=section('Recorded review and sign-off',fields(row,[['Investigator',['sign_investigator','investigated_by']],['Investigator date',['sign_inv_date','investigated_date']],['Reviewer',['sign_reviewer','reviewed_by']],['Review date',['sign_rev_date','reviewed_date']],['Approver',['sign_approver','approved_by']],['Approval date',['sign_app_date','approved_date']],['Closed date','closed_date'],['Closed by','closed_by']]));
 return documentHtml('Investigation report',reference(row),body,Object.assign({},options,{status:row.status,confidentiality:row.confidentiality}));
}
function recordHtml(row,options){
 options=options||{};var payload=row.payload||{};
 var body=section('Record details',field('Source incident',options.incidentReference||payload.incident_ref)+field('Status',label(row.status),false,true)+field('Version',row.version_no||1)+field('Confidentiality',label(row.confidentiality||'internal'))+field('Owner',row.owner_name)+field('Due date',row.due_date?date(row.due_date):null));
 body+=section(row.record_type==='lesson'?'Learning and context':'Saved content',Object.keys(payload).map(function(key){return field(label(key),payload[key],true);}).join(''));
 return documentHtml(row.title||label(row.record_type),options.incidentReference||'',body,Object.assign({},options,{status:row.status,confidentiality:row.confidentiality}));
}
function communicationHtml(record){
 var p=record.payload||{},items=function(value){return (Array.isArray(value)?value:[value]).filter(present).map(function(x){return '<li>'+esc(x)+'</li>';}).join('');};
 return stylesheet+'<article class="imx-safety-comm"><header><div><b>Site SafetyCOMM</b><span>'+esc(p.incident_ref||'Safety alert')+'</span></div><h1>'+esc(p.headline||record.title)+'</h1></header><div class="imx-comm-meta"><b>Date:</b> '+esc(date(p.event_date))+' <b>Location:</b> '+esc(p.location||'Not recorded')+'</div><section><h3>What happened</h3><p>'+esc(p.what_happened||'Not recorded')+'</p></section><div class="imx-comm-cols"><section><h3>Immediate root causes</h3><p>'+esc(p.immediate_causes||'Not recorded')+'</p></section><section><h3>Actions taken</h3><ul>'+items(p.actions_taken||p.immediate_actions)+'</ul></section></div><section><h3>Shared learning</h3><p>'+esc(p.shared_learning||'Not recorded')+'</p></section><section><h3>Relevant group standards / required behaviours</h3><p>'+esc(p.relevant_standards||'Not recorded')+'</p></section><footer>Controlled AURIS360 Safety Communication · Contact: '+esc(p.contact||'Not recorded')+'</footer></article>';
}
function capture(services){
 if(!services||typeof services.api!=='function'||typeof services.session!=='function'||typeof services.canRead!=='function')throw Error('Reopen Incident Management to load record reports.');
 var current=services.session()||{},expected={companyId:String(current.companyId||''),userId:String(current.userId||''),role:String(current.role||'')};
 function assert(row,kind){var now=services.session()||{};if(!expected.companyId||!expected.userId||!expected.role||String(now.companyId||'')!==expected.companyId||String(now.userId||'')!==expected.userId||String(now.role||'')!==expected.role)throw Error('Your company, account or access changed. Reopen this record.');if(!services.canRead(kind,row))throw Error('This record is unavailable for your access.');return expected;}
 assert();return {expected:expected,assert:assert,request:async function(path){assert();try{return await services.api(path);}finally{assert();}}};
}
async function exact(ctx,table,id){
 var rows=await ctx.request('/'+table+'?select=*&company_id=eq.'+encodeURIComponent(ctx.expected.companyId)+'&id=eq.'+encodeURIComponent(id)+'&limit=2');
 if(!Array.isArray(rows)||rows.length!==1||String(rows[0].id)!==String(id)||String(rows[0].company_id)!==ctx.expected.companyId)throw Error('This saved record is unavailable in the selected company. Refresh its register.');return rows[0];
}
async function load(kind,id,services){
 if(!['incident','investigation','record','communication'].includes(kind)||!id)throw Error('Choose a saved incident record.');
 var ctx=capture(services),table=kind==='incident'?'events':kind==='investigation'?'investigations':'incident_mgmt_records',row=await exact(ctx,table,id);ctx.assert(row,kind);
 if(kind==='communication'&&row.record_type!=='safety_communication')throw Error('Select a saved Safety Communication.');
 var options={companyName:typeof services.companyName==='function'?services.companyName():'AURIS360',loadedAt:new Date().toISOString(),incidentReference:typeof services.incidentReference==='function'?services.incidentReference(row):''};
 if(kind==='investigation'&&(row.event_id||row.incident_id)){var incident=await exact(ctx,'events',row.event_id||row.incident_id);ctx.assert(incident,'incident');options.incidentReference=reference(incident);}
 ctx.assert(row,kind);
 var title=kind==='incident'?'Incident report · '+reference(row):kind==='investigation'?'Investigation · '+reference(row):row.title||label(row.record_type);
 var html=kind==='incident'?incidentHtml(row,options):kind==='investigation'?investigationHtml(row,options):kind==='communication'?communicationHtml(row):recordHtml(row,options);
 return {kind:kind,id:String(id),context:ctx.expected,record:row,title:title,html:html};
}
function sameReceipt(receipt,kind,id,ctx){return receipt&&receipt.kind===kind&&receipt.id===String(id)&&['companyId','userId','role'].every(function(key){return receipt.context[key]===ctx.expected[key];});}
async function print(kind,id,services,receipt){
 var ctx=capture(services),prepared=typeof services.preparePrint==='function'?services.preparePrint():undefined;
 if(prepared===null)throw Error('Allow popups to open the report print preview.');
 try{
  var result=sameReceipt(receipt,kind,id,ctx)?receipt:await load(kind,id,services);
  ctx.assert(result.record,kind);
  if(typeof services.print!=='function')throw Error('The report print preview is unavailable.');
  services.print(result.html,result.title,prepared);return result;
 }catch(error){if(prepared&&typeof prepared.close==='function')prepared.close();throw error;}
}
root.AurisIncidentReports=Object.freeze({load:load,print:print,incidentHtml:incidentHtml,investigationHtml:investigationHtml,recordHtml:recordHtml,communicationHtml:communicationHtml,content:content});
})(typeof window!=='undefined'?window:globalThis);
