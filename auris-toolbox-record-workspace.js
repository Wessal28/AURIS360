(function(root){
'use strict';
var limit=100;
function copy(value){return JSON.parse(JSON.stringify(value));}
function text(value){return value==null||value===''?'Not recorded':typeof value==='object'?JSON.stringify(value):String(value);}
function identifier(value){value=String(value||'');if(!/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw new Error('An exact toolbox talk ID is required.');return value;}
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','api','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to review this toolbox talk.');
  services.rbac.requireAccess('meetings');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to review this toolbox talk.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||'')};
}
function assertSession(expected,options){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account or company changed. Reopen the toolbox talk.');if(options&&typeof options.assertContext==='function')options.assertContext();return current;}
function assertSource(source,current){if(source.module!=='meetings'||source.table!=='toolbox_talks'||source.company_id!==current.companyId)throw new Error('The toolbox talk source does not match the selected company.');identifier(source.id);}
function assertRecord(row,source){if(!row||String(row.id)!==source.id||String(row.company_id||'')!==source.company_id)throw new Error('This toolbox talk is unavailable or outside your company access. Reopen the register.');}
function agrees(row,source){return [row.source_record_id,row.related_id,row.record_id].every(function(v){return v==null||v===''||String(v)===source.id;})&&[row.source_table,row.related_table].every(function(v){return !v||v===source.table;})&&[row.source_module,row.module_name].every(function(v){return !v||v===source.module;});}
function matches(row,source,id){return !!row&&String(row.company_id||'')===source.company_id&&String(id||'')===source.id&&agrees(row,source);}
function activity(source,row,kind,body,date){return {id:row.id,company_id:source.company_id,source_module:source.module,source_table:source.table,source_record_id:source.id,activity_type:kind,body:body,created_at:date};}
function localTime(value){if(!value)return 'Not recorded';var raw=String(value);if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw+' (time not recorded)';var date=new Date(raw);return Number.isNaN(date.getTime())?'Invalid recorded time: '+raw:date.toLocaleString(undefined,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});}
function recordedList(value,format){if(!Array.isArray(value))return value==null?'Not recorded':'Unavailable: malformed recorded data.';if(!value.length)return 'No entries recorded in this snapshot.';return value.map(function(item,index){return (index+1)+'. '+(item&&typeof item==='object'&&!Array.isArray(item)?format(item):'Malformed entry; details unavailable.');}).join('\n\n');}
function linkedWork(record){
  var notes=String(record.notes||''),match=notes.match(/\[AURIS360_LINKED_WORK:({[\s\S]*?})\]/),value=record.work_order_id?'Work ID: '+text(record.work_order_id):'Not recorded';
  if(match){try{var work=JSON.parse(match[1]);identifier(work.id);value='Work ID: '+text(work.id)+'\nReference: '+text(work.ref)+'\nTitle: '+text(work.title);if(record.work_order_id&&String(record.work_order_id)!==String(work.id))return {notes:notes,value:'Conflicting recorded work IDs. Review the original notes and talk form.'};notes=notes.replace(match[0],'').trim();}catch(error){value='Unavailable: malformed linked-work marker. Original notes retained.';}}
  return {notes:notes,value:value};
}
function project(record,current,options){
  if(!root.AurisToolboxListWorkspace)throw new Error('The toolbox talk record definitions are unavailable. Reload the application.');
  var result=copy(record),display=root.AurisToolboxListWorkspace.project([record],current,{topics:options&&options.topics})[0],work=linkedWork(record);
  result.title=record.title||'Untitled toolbox talk';result.reference_label=record.tbt_ref||'Not recorded';result.status_label=display.status;result.topic_label=display.topic;
  result.date_label=text(record.talk_date);result.duration_label=display.duration;result.presenter_label=text(record.presenter);result.attendance_label=display.attendees;
  result.attendees_label=recordedList(record.attendees,function(item){return 'Name: '+text(item.name||item.full_name||item.person_name)+'\nDepartment: '+text(item.dept||item.department)+'; Organisation: '+text(item.organization_snapshot)+'; Role: '+text(item.role_snapshot)+'\nConfirmation time: '+localTime(item.confirmed_at)+'\nRecorded method: '+text(item.confirmation_method);});
  result.actions_label=recordedList(record.actions_raised,function(item){return text(item.description)+'\nAssigned to: '+text(item.assigned_to)+'; Due: '+text(item.due_date);});
  result.work_label=work.value;result.notes_label=text(work.notes);result.created_label=localTime(record.created_at);result.updated_label=localTime(record.updated_at);
  return result;
}
async function load(source,current,options){
  options=options||{};assertSession(current,options);assertSource(source,current);
  var api=root.AurisPlatformServices.api,q='company_id=eq.'+encodeURIComponent(current.companyId),id=encodeURIComponent(source.id);
  var rows=await api.request('/toolbox_talks?select=*&'+q+'&id=eq.'+id+'&limit=1');assertSession(current,options);
  if(!Array.isArray(rows)||rows.length!==1)throw new Error('This toolbox talk is unavailable or outside your company access.');assertRecord(rows[0],source);
  var record=project(rows[0],current,options),activities=[],notices=['Recorded snapshot: an attendee name or count is not confirmation. Check the recorded confirmation time and method.','Linked work/actions are snapshots, not live status or proof of Master Action creation. History includes only entries linked to this exact talk; it may be incomplete.'];
  async function history(path,label){try{var data=await api.request(path);assertSession(current,options);if(!Array.isArray(data))throw new Error('Malformed history');if(data.length>limit)notices.push(label+' is limited to the latest '+limit+' entries; older entries are not shown.');return data.slice(0,limit);}catch(error){assertSession(current,options);notices.push(label+' is unavailable. This does not mean no history exists. Reopen the overview to retry.');return [];}}
  var parts=await Promise.all([
    history('/work_activities?select=*&'+q+'&source_module=eq.meetings&source_table=eq.toolbox_talks&source_record_id=eq.'+id+'&order=created_at.desc&limit=101','Shared activity and evidence'),
    history('/approval_requests?select=*&'+q+'&module_name=eq.meetings&related_table=eq.toolbox_talks&or=(source_record_id.eq.'+id+',related_id.eq.'+id+')&order=created_at.desc&limit=101','Shared approval requests')
  ]);assertSession(current,options);
  parts[0].filter(function(row){return row&&matches(row,source,row.source_record_id)&&row.source_table===source.table&&row.source_module===source.module;}).forEach(function(row){
    var evidence=Array.isArray(row.evidence)?row.evidence.filter(function(item){return item&&typeof item==='object';}).map(function(item){return [item.label,item.url].filter(Boolean).join(': ');}).join('\n'):'';
    activities.push(activity(source,row,row.activity_type||'activity',[row.body,evidence].filter(Boolean).join('\n'),row.created_at));
    if(evidence&&row.activity_type!=='evidence')activities.push(activity(source,{id:'evidence-'+row.id},'evidence',evidence,row.created_at));
  });
  var approvals=parts[1].filter(function(row){return row&&matches(row,source,row.source_record_id||row.related_id)&&row.related_table===source.table&&row.module_name===source.module;}).map(function(row){return Object.assign({},row,{reason:row.request_reason||row.reason||row.decision_reason||''});});
  var ids=approvals.map(function(row){return String(row.id||'');}).filter(function(value){return /^[a-zA-Z0-9_-]{1,100}$/.test(value);});
  if(ids.length){var decisions=await history('/approval_decisions?select=*&request_id=in.('+ids.map(encodeURIComponent).join(',')+')&order=decided_at.desc&limit=101','Shared approval decisions');
    decisions.filter(function(row){return row&&ids.indexOf(String(row.request_id))!==-1&&(!row.company_id||String(row.company_id)===source.company_id)&&agrees(row,source);}).forEach(function(row){activities.push(activity(source,row,'decision',[row.decision,row.decided_by_name,row.comments].filter(Boolean).join(' · '),row.decided_at));});}
  assertSession(current,options);return {record:record,activities:activities,approvals:approvals,notices:notices};
}
function fields(){return [
  {key:'reference_label',label:'Reference'},{key:'status_label',label:'Recorded status'},{key:'topic_label',label:'Topic'},{key:'date_label',label:'Talk date'},
  {key:'presenter_label',label:'Presenter'},{key:'location',label:'Location'},{key:'department',label:'Department'},{key:'duration_label',label:'Duration (minutes)'},
  {key:'key_points',label:'Key points',section:'Talk content'},{key:'hazards_discussed',label:'Hazards discussed',section:'Talk content'},{key:'incidents_referenced',label:'Incidents referenced',section:'Talk content'},{key:'notes_label',label:'Notes',section:'Talk content'},
  {key:'attendance_label',label:'Recorded attendance count',section:'Attendance snapshot'},{key:'attendees_label',label:'Attendees and recorded confirmations',section:'Attendance snapshot'},
  {key:'work_label',label:'Recorded linked work — not live status',section:'Linked work snapshot'},{key:'actions_label',label:'Recorded action items — not live progress',section:'Action snapshot'},
  {key:'created_label',label:'Created (local time)',section:'Record timestamps'},{key:'updated_label',label:'Updated (local time)',section:'Record timestamps'}
];}
async function open(id,options){
  options=options||{};id=identifier(id);var current=session();assertSession(current,options);
  var workspace=root.AurisRecordWorkspace;if(!workspace)throw new Error('The shared record workspace is unavailable. Reload the application.');
  var source={module:'meetings',table:'toolbox_talks',id:id,company_id:current.companyId,ref:String(options.reference||'').slice(0,120)};
  workspace.registerAdapter({key:'toolbox-record',module:'meetings',table:'toolbox_talks',explicitOnly:true,titleField:'title',statusField:'status_label',canEdit:function(){return false;},load:function(exact,context){return load(exact,context,options);},fields:fields()});
  return workspace.open({source:source,adapterKey:'toolbox-record',context:current,availableActions:['copy','open'],actionLabels:{copy:'Copy talk reference',open:'Open talk form'},
    workflowHelp:'This overview is read-only. Open the existing talk form to edit, confirm attendance or print. Its permission checks and save handlers remain authoritative. Shared approval evidence does not confirm attendance or change the talk status here.',
    onAction:async function(action,exact,record){
      assertSession(current,options);assertSource(exact,current);if(exact.id!==source.id)throw new Error('The toolbox talk identity changed. Reopen the register.');assertRecord(record,source);
      if(action==='copy'){if(!root.navigator||!root.navigator.clipboard)throw new Error('Copying is unavailable in this browser.');await root.navigator.clipboard.writeText(record.tbt_ref||id);assertSession(current,options);return {message:'Toolbox talk reference copied.'};}
      if(action!=='open')throw new Error('This action is unavailable in the read-only toolbox talk overview.');
      if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the toolbox talk form.');
      if(typeof options.openEditor!=='function')throw new Error('The toolbox talk form is unavailable. Reload the application.');
      await options.openEditor(current);
      // A successful form handoff intentionally changes the register view generation.
      // Recheck identity/access, not the now-obsolete list view, before closing.
      assertSession(current);return {close:true};
    }
  });
}
root.AurisToolboxRecordWorkspace=Object.freeze({version:'1.0.0',open:open,load:load});
})(typeof window!=='undefined'?window:globalThis);
