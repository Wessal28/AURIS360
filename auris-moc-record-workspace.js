(function(root){
'use strict';
var registered=false,limit=100;
function copy(value){return JSON.parse(JSON.stringify(value));}
function identifier(value){value=String(value||'');if(!/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw new Error('An exact change request ID is required.');return value;}
function tableName(value){if(value!=='moc_change_requests'&&value!=='action_tracker')throw new Error('An exact MOC storage table is required.');return value;}
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','api','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to review this change request.');
  services.rbac.requireAccess('moc');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to review this change request.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account or company changed. Reopen the change request.');return current;}
function request(path){return root.AurisPlatformServices.api.request(path);}
function matches(row,source,id){return !!row&&String(row.company_id||'')===source.company_id&&String(id||'')===source.id;}
function identityAgrees(row,source){
  return [row.source_record_id,row.related_id,row.record_id].every(function(value){return value==null||value===''||String(value)===source.id;})
    &&[row.source_table,row.related_table].every(function(value){return !value||value===source.table;})
    &&[row.source_module,row.module_name].every(function(value){return !value||value===source.module;});
}
function approvalMatches(row,source){return !!row&&matches(row,source,row.source_record_id||row.related_id)&&row.related_table===source.table&&row.module_name==='moc'&&identityAgrees(row,source);}
function workMatches(row,source){return !!row&&matches(row,source,row.source_record_id)&&row.source_table===source.table&&row.source_module==='moc'&&identityAgrees(row,source);}
function activity(source,row,type,body,date){return {id:row.id,company_id:source.company_id,source_module:'moc',source_table:source.table,source_record_id:source.id,activity_type:type,body:body,created_at:date};}
function meta(description,key){var match=String(description||'').match(new RegExp('^'+key+':\\s*(.*)$','mi'));return match?match[1].trim():'';}
function helpers(){if(!root.AurisMocListWorkspace)throw new Error('The MOC record definitions are unavailable. Reload the application.');return root.AurisMocListWorkspace;}
function assertRecord(record,source){
  if(!matches(record,source,record&&record.id)||source.table==='action_tracker'&&!helpers().legacyRecord(record))throw new Error('This change request is unavailable or no longer belongs to this MOC register. Reopen the register.');
}
function project(record,source,current){
  var value=copy(record),legacy=source.table==='action_tracker',display=helpers().project([record],current,{legacy:legacy})[0];
  value.title=display.title;value.reference_label=display.reference;value.lifecycle_label=display.status;value.change_type_label=display.change_type;value.owner_label=display.owner;value.priority_label=display.priority;value.storage_label=display.storage;
  if(legacy){
    [['reason','Reason'],['current_situation','Current situation'],['proposed_change','Proposed change'],['risk_review','Risk review'],['pre_implementation_actions','Pre-implementation actions'],['post_change_verification','Post-change verification']].forEach(function(pair){if(!value[pair[0]])value[pair[0]]=meta(value.description,pair[1]);});
    if(!value.impacted_areas)value.impacted_areas=meta(value.description,'Impacted areas');
  }
  value.linked_records_help='Open the change form to view linked records and manage corrective actions. Corrective-action status is separate from the change lifecycle.';
  return value;
}
async function load(source,current){
  assertSession(current);var table=tableName(source.table),id=identifier(source.id);
  if(source.module!=='moc'||source.company_id!==current.companyId)throw new Error('The MOC source does not match the selected company.');
  var q='company_id=eq.'+encodeURIComponent(current.companyId),encodedId=encodeURIComponent(id);
  var rows=await request('/'+table+'?select=*&'+q+'&id=eq.'+encodedId+'&limit=1');assertSession(current);
  if(!Array.isArray(rows)||rows.length!==1)throw new Error('This change request is unavailable or outside your company access.');
  assertRecord(rows[0],source);
  var record=project(rows[0],source,current),notices=[],activities=[];
  if(table==='action_tracker')notices.push('Legacy change request. Only history linked to this exact MOC record is shown. Master Action approvals are not treated as MOC approvals.');
  async function history(path,label){
    try{var data=await request(path);assertSession(current);if(!Array.isArray(data))throw new Error('Invalid history response.');
      if(data.length>limit)notices.push(label+' is limited to the latest '+limit+' entries; older entries are not shown here.');
      return data.slice(0,limit);
    }catch(error){assertSession(current);notices.push(label+': unavailable. This does not mean no history exists. Reopen the panel to retry.');return [];}
  }
  var parts=await Promise.all([
    history('/work_activities?select=*&'+q+'&source_module=eq.moc&source_table=eq.'+table+'&source_record_id=eq.'+encodedId+'&order=created_at.desc&limit=101','Shared activity and evidence'),
    history('/approval_requests?select=*&'+q+'&module_name=eq.moc&related_table=eq.'+table+'&or=(source_record_id.eq.'+encodedId+',related_id.eq.'+encodedId+')&order=created_at.desc&limit=101','MOC approval requests'),
    table==='action_tracker'?history('/map_activity_log?select=*&'+q+'&action_id=eq.'+encodedId+'&order=performed_at.desc&limit=101','Legacy change activity log'):Promise.resolve([])
  ]);
  assertSession(current);
  parts[0].filter(function(row){return workMatches(row,source);}).forEach(function(row){
    var evidence=Array.isArray(row.evidence)?row.evidence.filter(Boolean).map(function(item){return [item.label,item.url].filter(Boolean).join(': ');}).join('\n'):'';
    activities.push(activity(source,row,row.activity_type||'activity',[row.body,evidence].filter(Boolean).join('\n'),row.created_at));
    if(evidence&&row.activity_type!=='evidence')activities.push(activity(source,{id:'evidence-'+row.id},'evidence',evidence,row.created_at));
  });
  parts[2].filter(function(row){return row&&matches(row,source,row.action_id)&&identityAgrees(row,source);}).forEach(function(row){activities.push(activity(source,row,row.activity_type||'Legacy change updated',[row.performed_by,row.notes].filter(Boolean).join(' · '),row.performed_at));});
  var approvals=parts[1].filter(function(row){return approvalMatches(row,source);}).map(function(row){return Object.assign({},row,{reason:row.request_reason||row.reason||row.decision_reason||''});});
  var ids=approvals.map(function(row){return String(row.id||'');}).filter(function(value){return /^[a-zA-Z0-9_-]{1,100}$/.test(value);});
  if(ids.length){
    var decisions=await history('/approval_decisions?select=*&request_id=in.('+ids.map(encodeURIComponent).join(',')+')&order=decided_at.desc&limit=101','MOC approval decisions');
    decisions.filter(function(row){return row&&ids.indexOf(String(row.request_id))!==-1&&(!row.company_id||String(row.company_id)===source.company_id)&&identityAgrees(row,source);}).forEach(function(row){activities.push(activity(source,row,'decision',[row.decision,row.decided_by_name,row.comments].filter(Boolean).join(' · '),row.decided_at));});
  }
  assertSession(current);return {record:record,activities:activities,approvals:approvals,notices:notices};
}
function register(){
  if(registered)return;
  var workspace=root.AurisRecordWorkspace;if(!workspace)throw new Error('The shared record workspace is unavailable. Reload the application.');
  ['moc_change_requests','action_tracker'].forEach(function(table){workspace.registerAdapter({key:'moc-record-'+table,module:'moc',table:table,explicitOnly:true,titleField:'title',statusField:'lifecycle_label',canEdit:function(){return false;},load:load,fields:[
    {key:'reference_label',label:'Reference'},{key:'change_type_label',label:'Change type'},{key:'lifecycle_label',label:'Lifecycle stage'},{key:'priority_label',label:'Risk priority'},
    {key:'owner_label',label:'Owner',section:'Assignment'},{key:'location',label:'Location',section:'Assignment'},{key:'target_date',label:'Target date',section:'Assignment'},{key:'storage_label',label:'Record storage',section:'Assignment'},
    {key:'reason',label:'Reason for change',section:'Change proposal'},{key:'current_situation',label:'Current situation',section:'Change proposal'},{key:'proposed_change',label:'Proposed change',section:'Change proposal'},
    {key:'impacted_areas',label:'Impacted areas',section:'Impact and controls'},{key:'risk_review',label:'Risk review',section:'Impact and controls'},{key:'pre_implementation_actions',label:'Pre-implementation actions',section:'Impact and controls'},{key:'post_change_verification',label:'Post-change verification',section:'Impact and controls'},
    {key:'approver_name',label:'Recorded approver',section:'Recorded lifecycle details'},{key:'approved_at',label:'Recorded approval time',section:'Recorded lifecycle details'},{key:'verifier_name',label:'Recorded verifier',section:'Recorded lifecycle details'},{key:'verified_at',label:'Recorded verification time',section:'Recorded lifecycle details'},
    {key:'linked_records_help',label:'Linked records and corrective actions',section:'Related work'}
  ]});});registered=true;
}
async function open(id,options){
  options=options||{};id=identifier(id);var table=tableName(options.table),current=session();register();
  var source={module:'moc',table:table,id:id,company_id:current.companyId,ref:String(options.reference||'').slice(0,120)};
  return root.AurisRecordWorkspace.open({source:source,adapterKey:'moc-record-'+table,context:current,
    availableActions:['copy','open'],actionLabels:{copy:'Copy reference',open:'Open change form'},
    workflowHelp:'This panel is read-only. Open the change form to edit the request, manage its lifecycle and view linked corrective actions. Existing form validation and permission checks still apply. Linked action approvals do not approve the MOC request.',
    onAction:async function(action,exact,record){
      assertSession(current);
      if(exact.module!==source.module||exact.table!==source.table||exact.id!==source.id||exact.company_id!==source.company_id)throw new Error('The source identity changed. Reopen the change request.');
      assertRecord(record,source);
      if(action==='copy'){
        if(!root.navigator||!root.navigator.clipboard)throw new Error('Copying is unavailable in this browser.');
        await root.navigator.clipboard.writeText(record.reference_label||record.moc_ref||record.source_ref||record.action_ref||id);
        assertSession(current);return {message:'Change request reference copied.'};
      }
      if(action!=='open')throw new Error('This action is unavailable in the read-only MOC panel.');
      if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the change form.');
      if(typeof options.openEditor!=='function')throw new Error('The change form is unavailable. Reload the application.');
      await options.openEditor(copy(record),table,current);assertSession(current);return {close:true};
    }
  });
}
root.AurisMocRecordWorkspace=Object.freeze({version:'1.0.0',open:open,load:load});
})(typeof window!=='undefined'?window:globalThis);
