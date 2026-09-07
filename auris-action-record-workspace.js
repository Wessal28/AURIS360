(function(root){
'use strict';

var adapterKey='master-action-record',limit=100,registered=false;
function copy(value){return JSON.parse(JSON.stringify(value));}
function identifier(value){value=String(value||'');if(!/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw new Error('An exact action record ID is required.');return value;}
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','api','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to review this action.');
  services.rbac.requireAccess('actions');
  var current=services.auth.current(),company=current.company&&current.company.id||current.profile&&current.profile.company_id,user=current.profile&&current.profile.id;
  if(!company||!user)throw new Error('Sign in and select a company to review this action.');
  return {companyId:String(company),userId:String(user),role:String(current.role||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account or company changed. Reopen the action.');return current;}
function request(path){return root.AurisPlatformServices.api.request(path);}
function matches(row,source,id){return row&&String(row.company_id)===source.company_id&&String(id)===source.id;}
function approvalMatches(row,source){
  var ids=[row.source_record_id,row.related_id].filter(function(id){return id!=null&&id!=='';});
  return matches(row,source,ids[0])&&ids.every(function(id){return String(id)===source.id;})&&row.related_table==='action_tracker'&&['actions','action'].indexOf(row.module_name)!==-1;
}
function workMatches(row,source){return matches(row,source,row.source_record_id)&&row.source_table===source.table&&row.source_module===source.module;}
function text(value){return value==null?'':String(value);}
function activity(source,row,type,body,date){return {id:row.id,company_id:source.company_id,source_module:source.module,source_table:source.table,source_record_id:source.id,activity_type:type,body:body,created_at:date};}
async function load(source,current){
  assertSession(current);
  if(source.module!=='actions'||source.table!=='action_tracker'||source.company_id!==current.companyId)throw new Error('Action source does not match the selected company.');
  var id=identifier(source.id),q='company_id=eq.'+encodeURIComponent(current.companyId),rows=await request('/action_tracker?select=*&'+q+'&id=eq.'+encodeURIComponent(id)+'&limit=1');
  assertSession(current);
  if(!Array.isArray(rows)||rows.length!==1||!matches(rows[0],source,rows[0].id))throw new Error('This action is unavailable, has been removed, or is outside your company access.');
  var record=copy(rows[0]),notices=[],activities=[];
  async function history(path,label){
    try{
      var data=await request(path);assertSession(current);
      if(!Array.isArray(data))throw new Error('Invalid history response.');
      if(data.length>limit)notices.push(label+' is limited to the latest '+limit+' entries; older entries are not shown here.');
      return data.slice(0,limit);
    }catch(error){assertSession(current);notices.push(label+': unavailable. This does not mean no history exists. Reopen the panel to retry.');return [];}
  }
  var parts=await Promise.all([
    history('/map_activity_log?select=*&'+q+'&action_id=eq.'+encodeURIComponent(id)+'&order=performed_at.desc&limit=101','Action activity log'),
    history('/work_activities?select=*&'+q+'&source_module=eq.actions&source_table=eq.action_tracker&source_record_id=eq.'+encodeURIComponent(id)+'&order=created_at.desc&limit=101','Shared activity and evidence'),
    history('/approval_requests?select=*&'+q+'&related_table=eq.action_tracker&or=(source_record_id.eq.'+encodeURIComponent(id)+',related_id.eq.'+encodeURIComponent(id)+')&order=created_at.desc&limit=101','Approval requests')
  ]);
  assertSession(current);
  parts[0].filter(function(row){return matches(row,source,row.action_id);}).forEach(function(row){
    activities.push(activity(source,row,row.activity_type||'Action updated',[row.performed_by,row.notes,row.old_value||row.new_value?text(row.old_value)+' → '+text(row.new_value):''].filter(Boolean).join(' · '),row.performed_at));
  });
  parts[1].filter(function(row){return workMatches(row,source);}).forEach(function(row){
    var evidence=Array.isArray(row.evidence)?row.evidence.map(function(item){return [item.label,item.url].filter(Boolean).join(': ');}).join('\n'):'';
    activities.push(activity(source,row,row.activity_type||'activity',[row.body,evidence].filter(Boolean).join('\n'),row.created_at));
  });
  var approvals=parts[2].filter(function(row){return approvalMatches(row,source);}).map(function(row){return Object.assign({},row,{module_name:'actions',reason:row.request_reason||row.reason||row.decision_reason||''});});
  var ids=approvals.map(function(row){return String(row.id||'');}).filter(function(id){return /^[a-zA-Z0-9_-]{1,100}$/.test(id);});
  if(ids.length){
    var decisions=await history('/approval_decisions?select=*&request_id=in.('+ids.map(encodeURIComponent).join(',')+')&order=decided_at.desc&limit=101','Approval decisions');
    decisions.filter(function(row){return ids.indexOf(String(row.request_id))!==-1;}).forEach(function(row){activities.push(activity(source,row,'decision',[row.decision,row.decided_by_name,row.comments].filter(Boolean).join(' · '),row.decided_at));});
  }
  if(record.evidence)activities.push(activity(source,{id:'action-evidence-'+id},'evidence',text(record.evidence),record.updated_at||record.created_at));
  record.title=record.title||record.description||record.action_ref||'Action';
  record.responsible=record.assigned_to_name||record.responsible||'Unassigned';
  record.progress_label=Math.max(0,Math.min(100,parseInt(record.progress_pct,10)||0))+'%';
  assertSession(current);
  return {record:record,activities:activities,approvals:approvals,notices:notices};
}
function register(){
  if(registered)return;
  var workspace=root.AurisRecordWorkspace;if(!workspace)throw new Error('The shared record workspace is unavailable. Reload the application.');
  workspace.registerAdapter({key:adapterKey,module:'actions',table:'action_tracker',explicitOnly:true,titleField:'title',statusField:'status',load:load,canEdit:function(){return true;},fields:[
    {key:'action_ref',label:'Reference'},{key:'description',label:'Action description'},{key:'action_type',label:'Action type'},{key:'priority',label:'Priority'},
    {key:'responsible',label:'Responsible',section:'Assignment'},{key:'department',label:'Department',section:'Assignment'},{key:'location',label:'Location',section:'Assignment'},{key:'target_date',label:'Due date',section:'Assignment'},
    {key:'progress_label',label:'Progress',section:'Progress'},{key:'progress_notes',label:'Progress notes',section:'Progress'},{key:'source_ref',label:'Originating record',section:'Progress'},
    {key:'verification_status',label:'Verification status',section:'Verification and closure'},{key:'verified_by',label:'Verified by',section:'Verification and closure'},{key:'verification_notes',label:'Verification notes',section:'Verification and closure'},
    {key:'closure_approved_by',label:'Closure approved by',section:'Verification and closure'},{key:'closure_notes',label:'Closure notes',section:'Verification and closure'}
  ]});registered=true;
}
async function open(id,options){
  options=options||{};id=identifier(id);var current=session();register();
  var source={module:'actions',table:'action_tracker',id:id,company_id:current.companyId,ref:String(options.reference||'').slice(0,120)};
  return root.AurisRecordWorkspace.open({source:source,adapterKey:adapterKey,context:current,
    availableActions:['copy','edit','open'],actionLabels:{edit:'Edit action',open:'Manage action'},
    workflowHelp:'Use Manage action to update progress, verify or close this action. Existing validation and approval rules still apply.',
    onAction:async function(action,exact,record){
      assertSession(current);
      if(!matches(record,source,record.id))throw new Error('The action identity changed. Reopen the record.');
      if(action==='copy'){
        if(!root.navigator||!root.navigator.clipboard)throw new Error('Copying links is unavailable in this browser.');
        var url=new URL('https://auris360.app/');url.searchParams.set('goto','actions');url.searchParams.set('record',id);url.searchParams.set('table','action_tracker');url.searchParams.set('company',current.companyId);
        await root.navigator.clipboard.writeText(url.href);return {message:'Exact action link copied.'};
      }
      if(action!=='edit'&&action!=='open')throw new Error('This action is not available in the record overview.');
      if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the action editor.');
      if(typeof options.openEditor!=='function')throw new Error('The action editor is unavailable. Reload the application.');
      var tab=action==='edit'?'details':record.status==='pending_verification'?'verification':record.status==='pending_closure'?'closure':'progress';
      // The established editor owns changes, verification, closure and their audit trail.
      // Keep errors in the panel until the editor is ready. The engine closes
      // only this active workspace after a successful handoff, never a newer one.
      await options.openEditor(copy(record),tab,current);assertSession(current);
      return {close:true};
    }
  });
}
root.AurisActionRecordWorkspace=Object.freeze({version:'1.0.0',open:open,load:load});
})(typeof window!=='undefined'?window:globalThis);
