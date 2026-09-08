(function(root){
'use strict';
var limit=100;
function copy(value){return JSON.parse(JSON.stringify(value));}
function text(value){return value==null||value===''?'Not recorded':typeof value==='object'?JSON.stringify(value):String(value);}
function identifier(value){value=String(value||'');if(!/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw new Error('An exact permit ID is required.');return value;}
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','api','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to review this permit.');
  services.rbac.requireAccess('permit');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to review this permit.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||'')};
}
function assertSession(expected,options){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account or company changed. Reopen the permit.');if(options&&typeof options.assertContext==='function')options.assertContext();return current;}
function assertSource(source,current){if(source.module!=='permit'||source.table!=='permits'||source.company_id!==current.companyId)throw new Error('The permit source does not match the selected company.');identifier(source.id);}
function assertRecord(row,source){if(!row||String(row.id)!==source.id||String(row.company_id||'')!==source.company_id)throw new Error('This permit is unavailable or outside your company access. Reopen the register.');}
function agrees(row,source){return [row.source_record_id,row.related_id,row.record_id,row.permit_id].every(function(v){return v==null||v===''||String(v)===source.id;})&&[row.source_table,row.related_table].every(function(v){return !v||v===source.table;})&&[row.source_module,row.module_name].every(function(v){return !v||v===source.module;});}
function matches(row,source,id){return !!row&&String(row.company_id||'')===source.company_id&&String(id||'')===source.id&&agrees(row,source);}
function activity(source,row,kind,body,date){return {id:row.id,company_id:source.company_id,source_module:source.module,source_table:source.table,source_record_id:source.id,activity_type:kind,body:body,created_at:date};}
function localTime(value){
  if(!value)return 'Not recorded';var raw=String(value);if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw+' (time not recorded)';
  var parsed=new Date(raw);return Number.isNaN(parsed.getTime())?raw:parsed.toLocaleString(undefined,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
}
function recordedList(value,format){if(!Array.isArray(value))return value==null?'Not recorded':'Unavailable: malformed recorded data. Open permit controls to inspect.';if(!value.length)return 'No entries recorded in this snapshot.';return value.map(function(item,index){return (index+1)+'. '+(item&&typeof item==='object'?format(item):text(item));}).join('\n\n');}
function project(record,current,options){
  if(!root.AurisPermitListWorkspace)throw new Error('The permit record definitions are unavailable. Reload the application.');
  var result=copy(record),display=root.AurisPermitListWorkspace.project([record],current,Object.assign({},options,{filters:{scope:'all'}}))[0];
  result.title=record.work_description||record.description||'Permit work';result.reference_label=display.reference;result.type_label=display.permit_type;result.status_label=display.status;result.risk_label=display.risk;
  result.location_label=display.location;result.issuer_label=display.issuer;result.receiver_label=display.receiver;result.start_label=localTime(record.planned_start);result.end_label=localTime(record.planned_end);
  result.blocks_label=recordedList(record.blocked_reasons,function(item){return text(item);});
  result.precautions_label=recordedList(record.precautions_checklist,function(item){return text(item.item)+' — '+(item.checked===true?'Recorded checked':item.checked===false?'Recorded unchecked':'Check not recorded');});
  result.gas_label=recordedList(record.gas_tests,function(item){return 'Date/time: '+localTime(item.datetime||item.date)+'\nO2 (%): '+text(item.o2)+'; LEL (%): '+text(item.lel)+'; H2S (ppm): '+text(item.h2s)+'; CO (ppm): '+text(item.co)+'\nRecorded result: '+text(item.result)+'; Tester: '+text(item.tester)+'\nEquipment: '+text(item.equipment)+'; Calibration: '+text(item.cal_date);});
  result.isolation_label=recordedList(record.isolations,function(item){return 'Tag: '+text(item.tag)+'; '+text(item.description)+'\nType: '+text(item.type)+'; Recorded status: '+text(item.status)+'\nIsolated by: '+text(item.by)+'; Verified by: '+text(item.verified_by);});
  result.approval_levels_label=text(record.approval_level_required);
  [1,2,3].forEach(function(level){var prefix='approval_l'+level;result[prefix+'_label']='Recorded status: '+text(record[prefix+'_status'])+'\nBy: '+text(record[prefix+'_by'])+'; At: '+localTime(record[prefix+'_at']);});
  result.contractor_label=record.contractor_name||record.contractor;result.team_label=record.team_members||record.work_team;result.ppe_label=record.ppe_required||record.ppe;
  result.ms_label=record.method_statement_ref||record.ms_ref;result.weather_label=record.requires_weather_check===true?'Required':record.requires_weather_check===false?'Not required in recorded definition':'Not recorded';
  result.suspension_label='Reason: '+text(record.suspension_reason)+'\nBy: '+text(record.suspended_by)+'; At: '+localTime(record.suspended_at);
  result.closure_label='By: '+text(record.closed_by)+'; At: '+localTime(record.closed_at)+'\nNotes: '+text(record.closure_notes);
  result.closure_checks_label=recordedList(record.closure_checklist,function(item){return text(item.item)+' — '+(item.checked===true?'Recorded checked':item.checked===false?'Recorded unchecked':'Check not recorded');});
  return result;
}
async function load(source,current,options){
  options=options||{};assertSession(current,options);assertSource(source,current);
  var api=root.AurisPlatformServices.api,q='company_id=eq.'+encodeURIComponent(current.companyId),id=encodeURIComponent(source.id);
  var rows=await api.request('/permits?select=*&'+q+'&id=eq.'+id+'&limit=1');assertSession(current,options);
  if(!Array.isArray(rows)||rows.length!==1)throw new Error('This permit is unavailable or outside your company access.');assertRecord(rows[0],source);
  var record=project(rows[0],current,options),activities=[],notices=['Read-only snapshot — not permission to start or resume work. Open permit controls to check current blocks, atmosphere, isolations, approvals and SIMOPS. Missing entries are not a safety clearance.','Permit level approvals are recorded in Overview. Workflow & approvals shows only shared requests linked to this exact permit; these do not replace the permit approval levels.'];
  async function history(path,label){try{var data=await api.request(path);assertSession(current,options);if(!Array.isArray(data))throw new Error('Malformed history');if(data.length>limit)notices.push(label+' is limited to the latest '+limit+' entries; older entries are not shown.');return data.slice(0,limit);}catch(error){assertSession(current,options);notices.push(label+' is unavailable. This does not mean no history exists. Reopen the overview to retry.');return [];}}
  var parts=await Promise.all([
    history('/permit_activity_log?select=*&'+q+'&permit_id=eq.'+id+'&order=performed_at.desc&limit=101','Permit activity log'),
    history('/work_activities?select=*&'+q+'&source_module=eq.permit&source_table=eq.permits&source_record_id=eq.'+id+'&order=created_at.desc&limit=101','Shared activity and evidence'),
    history('/approval_requests?select=*&'+q+'&module_name=eq.permit&related_table=eq.permits&or=(source_record_id.eq.'+id+',related_id.eq.'+id+')&order=created_at.desc&limit=101','Shared approval requests')
  ]);assertSession(current,options);
  parts[0].filter(function(row){return row&&matches(row,source,row.permit_id);}).forEach(function(row){activities.push(activity(source,row,row.action||'Permit activity',[row.performed_by,row.details,row.old_status&&'From: '+row.old_status,row.new_status&&'To: '+row.new_status].filter(Boolean).join(' · '),row.performed_at));});
  parts[1].filter(function(row){return row&&matches(row,source,row.source_record_id)&&row.source_table===source.table&&row.source_module===source.module;}).forEach(function(row){
    var evidence=Array.isArray(row.evidence)?row.evidence.filter(Boolean).map(function(item){return [item.label,item.url].filter(Boolean).join(': ');}).join('\n'):'';
    activities.push(activity(source,row,row.activity_type||'activity',[row.body,evidence].filter(Boolean).join('\n'),row.created_at));
    if(evidence&&row.activity_type!=='evidence')activities.push(activity(source,{id:'evidence-'+row.id},'evidence',evidence,row.created_at));
  });
  var approvals=parts[2].filter(function(row){return row&&matches(row,source,row.source_record_id||row.related_id)&&row.related_table===source.table&&row.module_name===source.module;}).map(function(row){return Object.assign({},row,{reason:row.request_reason||row.reason||row.decision_reason||''});});
  var ids=approvals.map(function(row){return String(row.id||'');}).filter(function(value){return /^[a-zA-Z0-9_-]{1,100}$/.test(value);});
  if(ids.length){var decisions=await history('/approval_decisions?select=*&request_id=in.('+ids.map(encodeURIComponent).join(',')+')&order=decided_at.desc&limit=101','Shared approval decisions');
    decisions.filter(function(row){return row&&ids.indexOf(String(row.request_id))!==-1&&(!row.company_id||String(row.company_id)===source.company_id)&&agrees(row,source);}).forEach(function(row){activities.push(activity(source,row,'decision',[row.decision,row.decided_by_name,row.comments].filter(Boolean).join(' · '),row.decided_at));});}
  assertSession(current,options);return {record:record,activities:activities,approvals:approvals,notices:notices};
}
function fields(){return [
  {key:'blocks_label',label:'Recorded work blocks',section:'Safety controls — snapshot only'},
  {key:'reference_label',label:'Permit number'},{key:'type_label',label:'Permit type'},{key:'status_label',label:'Lifecycle status'},{key:'risk_label',label:'Recorded risk'},
  {key:'location_label',label:'Work location'},{key:'department',label:'Department'},{key:'start_label',label:'Planned start (local time)'},{key:'end_label',label:'Planned end (local time)'},
  {key:'issuer_label',label:'Issuer',section:'Assignment'},{key:'receiver_label',label:'Receiver',section:'Assignment'},{key:'contractor_label',label:'Contractor',section:'Assignment'},{key:'team_label',label:'Work team',section:'Assignment'},
  {key:'ra_ref',label:'Risk Assessment reference',section:'References and precautions'},{key:'ms_label',label:'Method Statement reference',section:'References and precautions'},{key:'work_order_ref',label:'Work Order reference',section:'References and precautions'},
  {key:'ppe_label',label:'Recorded PPE',section:'References and precautions'},{key:'weather_label',label:'Weather check',section:'References and precautions'},{key:'precautions_label',label:'Recorded checklist',section:'References and precautions'},
  {key:'gas_label',label:'Recorded gas tests — no reclassification',section:'Gas tests'},{key:'isolation_label',label:'Recorded isolation points',section:'Isolations'},
  {key:'approval_levels_label',label:'Required levels recorded',section:'Permit level approvals'},
  {key:'approval_l1_label',label:'Level 1',section:'Permit level approvals'},{key:'approval_l2_label',label:'Level 2',section:'Permit level approvals'},{key:'approval_l3_label',label:'Level 3',section:'Permit level approvals'},
  {key:'suspension_label',label:'Suspension',section:'Suspension and closure'},{key:'closure_label',label:'Closure',section:'Suspension and closure'},{key:'closure_checks_label',label:'Recorded closure checklist',section:'Suspension and closure'}
];}
async function open(id,options){
  options=options||{};id=identifier(id);var current=session();assertSession(current,options);
  var workspace=root.AurisRecordWorkspace;if(!workspace)throw new Error('The shared record workspace is unavailable. Reload the application.');
  var source={module:'permit',table:'permits',id:id,company_id:current.companyId,ref:String(options.reference||'').slice(0,120)};
  workspace.registerAdapter({key:'permit-record',module:'permit',table:'permits',explicitOnly:true,titleField:'title',statusField:'status_label',canEdit:function(){return false;},load:function(exact,context){return load(exact,context,options);},fields:fields()});
  return workspace.open({source:source,adapterKey:'permit-record',context:current,availableActions:['copy','open'],actionLabels:{copy:'Copy permit reference',open:'Open permit controls'},
    workflowHelp:'This overview is read-only, not authorisation to work. The existing permit controls remain authoritative for gas tests, isolation, level approvals, activation, suspension, closure and SIMOPS. Opening controls rechecks the current record and your access.',
    onAction:async function(action,exact,record){
      assertSession(current,options);assertSource(exact,current);if(exact.id!==source.id)throw new Error('The permit identity changed. Reopen the register.');assertRecord(record,source);
      if(action==='copy'){if(!root.navigator||!root.navigator.clipboard)throw new Error('Copying is unavailable in this browser.');await root.navigator.clipboard.writeText(record.reference_label||id);assertSession(current,options);return {message:'Permit reference copied.'};}
      if(action!=='open')throw new Error('This action is unavailable in the read-only permit overview.');
      if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening permit controls.');
      if(typeof options.openControls!=='function')throw new Error('Permit controls are unavailable. Reload the application.');
      await options.openControls(current);assertSession(current,options);return {close:true};
    }
  });
}
root.AurisPermitRecordWorkspace=Object.freeze({version:'1.0.0',open:open,load:load});
})(typeof window!=='undefined'?window:globalThis);
