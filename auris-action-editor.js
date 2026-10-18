/* Master Action Plan editing boundary. Public legacy handlers delegate here.
 * Uses the shared record edit session; source links and the register stay in core.
 * Drafts remain in this tab's memory, never localStorage. */
var mapEditorSession=null,mapEditorInitial=null,mapEditorBusy=false,mapEditorPeople=[],mapEditorOpening=0,mapEditorReference=null;
var MAP_EDITOR_FIELDS={
  'mf-title':'title','mf-desc':'description','mf-type':'action_type','af-priority':'priority','mf-rootcause':'root_cause',
  'mf-source-type':'source_type','mf-source-ref':'source_ref','mf-location':'location','mf-start-date':'start_date','mf-target-date':'target_date',
  'mf-completed-date':'completed_date','mf-ext-reason':'extension_reason','mf-est-cost':'estimated_cost','mf-act-cost':'actual_cost',
  'mf-dept':'department','mf-assigned-by':'assigned_by','mf-assigned-date':'assigned_date','mf-instructions':'instructions',
  'mf-esc-level':'escalation_level','mf-esc-reason':'escalation_reason','mf-progress':'progress_pct','mf-progress-notes':'progress_notes',
  'mf-evidence':'evidence','af-comments':'comments','mf-verif-method':'verification_method','mf-verif-notes':'verification_notes',
  'mf-closure-notes':'closure_notes','mf-closure-rejected':'closure_rejected_reason','mf-effectiveness':'effectiveness_rating','mf-recurrence':'recurrence_prevented',
  'mf-date-extended':'date_extended','mf-escalated':'escalated','mf-req-verif':'requires_verification','mf-req-closure-approval':'requires_closure_approval'
};
function mapEditorContext(){return {companyId:String(ccid()||''),userId:String(prof?.id||''),role:String(activeRole()),access:!!canAccessPage('actions')};}
function mapEditorApprover(role){return ['manager','hse_officer','hse_manager','site_manager','admin','sephs_admin'].includes(role);}
function mapEditorManager(role){return ['manager','hse_manager','admin','sephs_admin'].includes(role);}
function mapEditorForm(){
  var data={};Object.keys(MAP_EDITOR_FIELDS).concat(['mf-assigned-to','mf-escalated-to']).concat(mapClosureControlIds()).forEach(function(id){var el=document.getElementById(id);if(el)data[id]=el.type==='checkbox'?!!el.checked:String(el.value==null?'':el.value);});return data;
}
function mapEditorDirty(){return !!mapEditorInitial&&(JSON.stringify(mapEditorForm())!==JSON.stringify(mapEditorInitial)||mapEvidenceDraft());}
function mapEditorMessage(message,error){var el=document.getElementById('map-editor-feedback');if(el){el.textContent=message;el.classList.toggle('is-error',!!error);el.setAttribute('role',error?'alert':'status');}}
function mapEditorRefresh(){
  if(!mapEditorSession)return;
  var record=mapEditorSession.record(),status=record.status||'open',review=['pending_verification','pending_closure'].includes(status),terminal=['closed','cancelled'].includes(status),context=mapEditorContext();
  var contextValid=true;try{mapEditorSession.assertCurrent();}catch(_){contextValid=false;}
  document.querySelectorAll('#map-form3view input,#map-form3view select,#map-form3view textarea').forEach(function(el){
    var reviewField=status==='pending_verification'?['mf-verif-method','mf-verif-notes'].includes(el.id):['mf-closure-notes','mf-closure-rejected'].concat(mapClosureControlIds()).includes(el.id);
    el.disabled=mapEditorBusy||mapEvidenceBusy||!contextValid||terminal||(review&&(!reviewField||!mapEditorApprover(context.role)));
  });
  ['af-status','mf-verified-by','mf-verified-date','mf-verif-status','mf-closure-by','mf-closure-date','mf-completed-date'].forEach(function(id){var el=document.getElementById(id);if(el)el.disabled=true;});
  if(record.source_id||record.related_id){['mf-source-type','mf-source-ref'].forEach(function(id){document.getElementById(id).disabled=true;});}
  if(status!=='open')document.getElementById('mf-req-verif').disabled=true;
  document.querySelectorAll('#map-form3view button').forEach(function(el){
    if(el.id?.startsWith('map-ftab-'))return;
    var handler=el.getAttribute('data-auris-onclick'),action=el.getAttribute('data-auris-named-action');
    el.disabled=mapEditorBusy||mapEvidenceBusy;
    if(handler==='h0937'||handler==='h0936')el.disabled=mapEditorBusy||mapEvidenceBusy||!contextValid||terminal||(review&&!mapEditorApprover(context.role));
    if(['h0953','h0954','h0955','h0956'].includes(handler))el.disabled=mapEditorBusy||!contextValid||!mapEditorApprover(context.role)||(Number(handler.slice(1))<955?status!=='pending_verification':status!=='pending_closure');
    if(el.closest('#map-effectiveness-stars'))el.disabled=mapEditorBusy||!contextValid||terminal||review;
    if(handler==='h0946')el.disabled=mapEditorBusy||!contextValid||!['open','in_progress'].includes(status);
    if(action==='map-cancel'||handler==='h0935')el.disabled=mapEditorBusy||!contextValid||!mapEditorManager(context.role)||terminal;
  });
  var discard=document.getElementById('map-editor-discard');if(discard)discard.disabled=mapEditorBusy;
  var state=document.getElementById('map-editor-state');if(state)state.textContent=mapEditorBusy?'Saving…':!contextValid?'Session changed — reopen action':terminal?'Read only — '+status.replace(/_/g,' '):mapEditorDirty()?'Unsaved changes':record.id?'All changes saved':'New action — not saved';
  mapReadinessRender(record);
  var save=document.querySelector('#map-form3view [data-auris-onclick="h0937"]');if(save)save.setAttribute('aria-label','Save action');
}
function mapEditorBegin(record){
  mapEditorSession=AurisRecordEditSession.create({table:'action_tracker',record:record||{},context:mapEditorContext,request:api,online:function(){return navigator.onLine!==false;},uuid:function(){return crypto.randomUUID();},now:function(){return new Date().toISOString();}});
  mapEditorReference=record?.action_ref||null;
  mapClosureHydrate(record||{});mapEditorInitial=mapEditorForm();mapEditorBusy=false;
  var form=document.getElementById('map-form3view');
  if(!form.dataset.editorBound){
    form.dataset.editorBound='true';form.addEventListener('input',mapEditorRefresh);form.addEventListener('change',mapEditorRefresh);
    form.addEventListener('keydown',function(event){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();mapSave();}});
    document.getElementById('map-editor-discard').addEventListener('click',mapEditorDiscard);
    window.addEventListener('beforeunload',function(event){if(mapEditorDirty()||mapEditorBusy||mapEvidenceBusy){event.preventDefault();event.returnValue='';}});
    form.querySelectorAll('.form3group').forEach(function(group){var label=group.querySelector('label'),input=group.querySelector('input,select,textarea');if(label&&input?.id&&!label.htmlFor)label.htmlFor=input.id;});
  }
  mapEvidenceMount(record||{});mapEditorMessage('Use Save for your changes. Workflow buttons save the current tab before moving the action.');mapEditorRefresh();
}
async function mapEditorLeave(){
  if(mapEditorBusy||mapEvidenceBusy){toast('Wait for the action or evidence save to finish.',false);return false;}
  if(!mapEditorDirty())return true;
  var session=mapEditorSession;
  var discard=await appConfirmAction({title:'Unsaved action changes',message:'Discard your changes and leave this action?',detail:'Choose Keep editing to return to the draft and save it.',confirmText:'Discard changes',cancelText:'Keep editing'});
  if(session!==mapEditorSession)return false;
  if(discard){mapEditorInitial=null;mapEditorSession=null;}return !!discard;
}
async function mapEditorDiscard(){
  var id=mapEditingId;
  if(!(await mapEditorLeave()))return;
  mapEditorInitial=null;mapEditorSession=null;
  try{if(id)await mapEdit(id);else await mapNew();}catch(error){mapEditorMessage(error.message,true);}
}
function mapEditorFieldError(id,message){
  var el=document.getElementById(id);if(el){var panel=el.closest('[id^="map-fview-"]');if(panel){var tab=panel.id.replace('map-fview-','');mapFormTab(tab,document.getElementById('map-ftab-'+tab));}el.setAttribute('aria-invalid','true');el.focus();}
  throw new Error(message);
}
function mapEditorRead(command){
  var form=mapEditorForm(),record=mapEditorSession.record(),body={},numbers=['estimated_cost','actual_cost','escalation_level','progress_pct','effectiveness_rating'];
  document.querySelectorAll('#map-form3view [aria-invalid]').forEach(function(el){el.removeAttribute('aria-invalid');});
  Object.keys(MAP_EDITOR_FIELDS).forEach(function(id){
    var key=MAP_EDITOR_FIELDS[id],value=form[id];
    // Untouched legacy values (including unavailable people/source choices) are preserved.
    if(record.id&&value===mapEditorInitial[id]){if(Object.prototype.hasOwnProperty.call(record,key))body[key]=record[key];return;}
    if(numbers.includes(key)){value=value===''||value==null?null:Number(value);if(key==='effectiveness_rating'&&value===0)value=null;if(value!==null&&(!Number.isFinite(value)||value<0))mapEditorFieldError(id,'Enter a valid non-negative number.');}
    else if(key==='recurrence_prevented')value=value===''?null:value==='true';
    else if(typeof value==='string')value=value.trim()||null;
    body[key]=value;
  });
  if(record.id&&body.title==null&&form['mf-title']===mapEditorInitial['mf-title'])body.title=String(form['mf-title']||'').trim()||null;
  var returning=record.id&&['fail_verification','reject_closure','cancel'].includes(command);
  if(!returning&&!String(body.title||'').trim())mapEditorFieldError('mf-title','Enter an action title.');
  body.description=body.description||body.title;
  if(!returning&&!body.target_date)mapEditorFieldError('mf-target-date','Choose a target date.');
  if(!returning&&body.start_date&&body.target_date<body.start_date)mapEditorFieldError('mf-target-date','The target date must be on or after the start date.');
  if(!returning&&body.date_extended&&!body.extension_reason)mapEditorFieldError('mf-ext-reason','Explain why the target date was extended.');
  if(!returning&&(body.progress_pct<0||body.progress_pct>100))mapEditorFieldError('mf-progress','Progress must be between 0 and 100.');
  var assigned=form['mf-assigned-to'];
  if(!record.id||assigned!==mapEditorInitial['mf-assigned-to']){
    var person=mapEditorPeople.find(function(p){return p.id===assigned;});
    if(assigned&&!person)mapEditorFieldError('mf-assigned-to','Select a person from the current company.');
    body.assigned_to_id=person?.id||null;body.assigned_to_name=person?person.last_name+', '+person.first_name:null;body.responsible=body.assigned_to_name;
    body.assignee_organization_snapshot=person?.company_name||person?.department||null;body.assignee_role_snapshot=person?.job_title||null;
  }
  if(!record.id||form['mf-escalated-to']!==mapEditorInitial['mf-escalated-to']){var target=mapEditorPeople.find(function(p){return p.id===form['mf-escalated-to'];});body.escalated_to=target?target.last_name+', '+target.first_name:null;}
  var issuer=mapEditorPeople.find(function(p){return p.id===body.assigned_by;});if(issuer)body.assigned_by=issuer.last_name+', '+issuer.first_name;
  if(!record.id)body.source_module={incident:'event',audit:'inspection'}[body.source_type]||(['inspection','event','risk_assessment','investigation','meeting','permit','noise_survey','kpi'].includes(body.source_type)?body.source_type:'manual');
  if(!record.id||form['mf-location']!==mapEditorInitial['mf-location'])Object.assign(body,locationIdentityPayload(body.location,null));
  body.closure_checklist=mapClosureRead();
  body.status=record.status||'open';
  if(!record.id){body.verification_status=body.requires_verification?'pending':'not_required';mapEditorReference=mapEditorReference||('MAP-'+mapActionTypeCode(body.action_type)+'-'+new Date().getFullYear()+'-'+crypto.randomUUID().replace(/-/g,'').slice(0,12).toUpperCase());body.action_ref=mapEditorReference;}
  return body;
}
function mapEditorWorkflow(record,body,command,reason){
  var status=record.status||'open',role=mapEditorContext().role,today=new Date().toISOString().slice(0,10),actor=prof?.full_name||prof?.email||prof?.id;
  if(['closed','cancelled'].includes(status))throw new Error('Closed and cancelled actions are read only.');
  if(['pending_verification','pending_closure'].includes(status)&&!mapEditorApprover(role))throw new Error('A reviewer must update this action at its current stage.');
  if(command==='save')return body;
  if(!record.id)throw new Error('Save the action before changing its workflow stage.');
  var next={start:'in_progress',submit_verification:'pending_verification',submit_closure:'pending_closure',verify:'pending_closure',fail_verification:'in_progress',close:'closed',reject_closure:'in_progress',cancel:'cancelled'}[command];
  var expected={start:'open',submit_verification:'in_progress',submit_closure:'in_progress',verify:'pending_verification',fail_verification:'pending_verification',close:'pending_closure',reject_closure:'pending_closure'}[command];
  if(expected&&status!==expected)throw new Error('This workflow action is not available at the current stage.');
  if(['verify','fail_verification','close','reject_closure'].includes(command)&&!mapEditorApprover(role))throw new Error('Your role cannot approve or reject this action.');
  if(command==='cancel'&&!mapEditorManager(role))throw new Error('A manager must cancel this action.');
  if(command==='submit_closure'&&record.requires_verification!==false)throw new Error('Verification is required before this action can proceed to closure.');
  if(command==='submit_verification'||command==='submit_closure'){if(body.progress_pct!==100)mapEditorFieldError('mf-progress','Set progress to 100% before submitting completed work.');if(!body.evidence)mapEditorFieldError('mf-evidence','Add completion evidence before submitting this action.');}
  if(command==='submit_verification')Object.assign(body,{verification_status:'pending',verified_by:null,verified_date:null});
  if(command==='verify'){if(!body.verification_notes)mapEditorFieldError('mf-verif-notes','Add verification notes before approving.');Object.assign(body,{verification_status:'passed',verified_by:actor,verified_date:today});}
  if(command==='fail_verification')Object.assign(body,{verification_status:'failed',verification_notes:(body.verification_notes||'')+'\nFAILED: '+reason,verified_by:actor,verified_date:today});
  if(command==='close'){
    if(record.requires_verification!==false&&record.verification_status!=='passed')throw new Error('Complete the required verification before closing this action.');
    var missing=mapClosureIssues(Object.assign({},record,body));if(missing.length)mapEditorFieldError('mcc-'+missing[0].index,missing.map(function(item){return item.message;}).join(' '));
    if(!body.closure_notes)mapEditorFieldError('mf-closure-notes','Add a closure summary before approving.');
    Object.assign(body,{closure_approved_by:actor,closure_approved_date:today,completed_date:today,progress_pct:100});
  }
  if(command==='reject_closure')body.closure_rejected_reason=reason;
  if(command==='escalate'){
    if(!['open','in_progress'].includes(status))throw new Error('Escalation is only available for open work.');
    if(!body.escalated_to&&!record.escalated_to)mapEditorFieldError('mf-escalated-to','Select the person to escalate to.');
    if(!body.escalation_reason)mapEditorFieldError('mf-esc-reason','Enter an escalation reason.');
    Object.assign(body,{escalated:true,escalation_level:body.escalation_level||1,escalated_at:new Date().toISOString()});return body;
  }
  if(!next||!coreWorkflowRequireTransition('actions',status,next,'Action'))throw new Error('The company workflow does not allow this transition.');
  if(window.AurisWorkflowService){
    var decision=AurisWorkflowService.explain('actions',status,next,{companyId:ccid(),role:role,record:Object.assign({},record,body)});
    if(!decision.allowed&&decision.reason!=='approval_required')throw new Error(decision.reason==='required_fields_missing'?'Complete the workflow fields: '+decision.missingFields.join(', '):'The company workflow is unavailable or does not permit this transition.');
    // Dedicated MAP review is supported; a configured multi-stage route must not be bypassed.
    if(decision.reason==='approval_required'&&decision.approvalStages?.length)throw new Error('This company requires staged approval. Use its approval route before changing this action.');
  }
  body.status=next;if(command==='start'&&!body.start_date)body.start_date=today;
  return body;
}
async function mapEditorLoadWorkflow(session,command){
  if(command==='save')return;
  if(!window.AurisWorkflowService)throw new Error('The company workflow is unavailable. Reload and retry.');
  var context=mapEditorContext();
  await AurisWorkflowService.hydrate(context.companyId);
  session.assertCurrent();
  if(session!==mapEditorSession)throw new Error('The action editor changed. Reopen the action.');
}
async function mapEditorCommit(command){
  if(!mapEditorSession||mapEditorBusy||mapEvidenceBusy)return false;
  var session=mapEditorSession,before=session.record(),reason='';
  try{
    session.assertCurrent();if(!workflowCanMutate('actions','actions'))return false;
    mapEditorBusy=true;mapEditorRefresh();
    if(command==='fail_verification'||command==='reject_closure'){
      reason=command==='reject_closure'?document.getElementById('mf-closure-rejected').value.trim():'';
      if(!reason)reason=await appPrompt({title:'Return action for further work',message:'Explain what must be corrected.',placeholder:'Reason',multiline:true});
      if(!reason?.trim())return false;
    }
    if(command==='cancel'&&!(await appConfirmAction({title:'Cancel action',message:'Cancel this action and retain its history?',confirmText:'Cancel action',cancelText:'Keep action'})))return false;
    session.assertCurrent();if(session!==mapEditorSession)throw new Error('The action editor changed. Reopen the record.');
    await mapEditorLoadWorkflow(session,command);
    var body=mapEditorWorkflow(before,mapEditorRead(command),command,reason);
    mapEditorMessage('Saving action…');
    var result=await session.save(body);session.assertCurrent();
    if(session!==mapEditorSession)throw new Error('The action editor changed. Reopen the record to verify the save.');
    var saved=result.record;mapEditingId=saved.id;
    var index=mapAllData.findIndex(function(x){return x.id===saved.id;});if(index<0)mapAllData.unshift(saved);else mapAllData[index]=saved;
    Object.keys(MAP_EDITOR_FIELDS).forEach(function(id){
      var key=MAP_EDITOR_FIELDS[id],el=document.getElementById(id);if(!el||!Object.prototype.hasOwnProperty.call(saved,key))return;
      if(el.type==='checkbox')el.checked=!!saved[key];
      else el.value=key==='recurrence_prevented'?(saved[key]==null?'':String(saved[key])):key==='effectiveness_rating'?(saved[key]||0):(saved[key]??'');
    });
    mapEditorSetPersonValue('mf-assigned-to',saved.assigned_to_id,saved.assigned_to_name||saved.responsible);mapEditorSetPersonValue('mf-assigned-by',saved.assigned_by);
    mapEditorSetPersonValue('mf-escalated-to',saved.escalated_to);mapUpdateEffectivenessStars(saved.effectiveness_rating||0);
    [['af-status',saved.status],['mf-verif-status',saved.verification_status],['mf-verified-date',saved.verified_date],['mf-closure-date',saved.closure_approved_date],['mf-completed-date',saved.completed_date],['mf-progress',saved.progress_pct],['mf-verif-notes',saved.verification_notes],['mf-closure-rejected',saved.closure_rejected_reason]].forEach(function(pair){var el=document.getElementById(pair[0]);if(el)el.value=pair[1]??'';});
    document.getElementById('mf-escalated').checked=!!saved.escalated;
    mapEditorSetPersonValue('mf-verified-by',saved.verified_by);mapEditorSetPersonValue('mf-closure-by',saved.closure_approved_by);
    mapUpdateProgress(saved.progress_pct);mapClosureHydrate(saved);mapEditorInitial=mapEditorForm();
    mapRefreshMetrics();mapRenderList();mapEvidenceRecord=saved;
    document.getElementById('map-form3title').textContent=saved.title||saved.description;
    document.getElementById('map-form3ref').textContent=mapDisplayRef(saved);
    mapRenderWorkflowBar(saved);mapRenderActionButtons(saved);
    var warnings=[];
    if(result.created||result.recovered){try{connectedRecordsMount('map-connected-records',relationshipEndpoint('action','action_tracker',saved.id,mapDisplayRef(saved)),{allowCreate:true});}catch(_){warnings.push('Reopen the action to load connected records.');}}
    if(!result.unchanged){
      var logNotes=reason||null;
      try{if(command!=='close')await api('/map_activity_log',{m:'POST',p:'return=minimal',b:{company_id:saved.company_id,action_id:saved.id,activity_type:result.created?'Action created':'Action '+command.replace(/_/g,' '),performed_by:prof?.full_name||prof?.id,old_value:before.status||null,new_value:saved.status,notes:logNotes}});}catch(error){warnings.push('Activity history could not be updated.');}
      session.assertCurrent();
      try{await mapAudit(command==='close'?'complete':'update','Action '+command.replace(/_/g,' ')+': '+mapDisplayRef(saved),saved,{changed_fields:mapChangedFields(before,body),old_status:before.status,new_status:saved.status});}catch(error){warnings.push('Audit confirmation is unavailable.');}
      session.assertCurrent();
      if(command!=='save'||before.assigned_to_id!==saved.assigned_to_id)await mapQueueActionNotice(saved,command==='escalate'?'escalation':command==='save'?'assigned':'status',{personId:command==='escalate'?document.getElementById('mf-escalated-to').value:saved.assigned_to_id,name:command==='escalate'?saved.escalated_to:saved.assigned_to_name||saved.responsible,note:'Action '+command.replace(/_/g,' ')+'.'});
    }
    session.assertCurrent();mapEditorMessage((result.recovered?'Previous save confirmed. ':result.unchanged?'No changes to save. ':'Action saved. ')+warnings.join(' '),warnings.length>0);
    if(command==='verify')mapFormTab('closure',document.getElementById('map-ftab-closure'));
    mapLoadLog(saved.id);return true;
  }catch(error){
    var message=error.message||'The action could not be saved.';
    if(/timeout|timed out|network|fetch|connection|502|503|504/i.test(message)){
      try{session.assertCurrent();var persisted=before.id?await api('/action_tracker?select=id,status,progress_pct,verification_status&company_id=eq.'+encodeURIComponent(mapEditorContext().companyId)+'&id=eq.'+encodeURIComponent(before.id)+'&limit=1'):[];session.assertCurrent();if(session!==mapEditorSession)return false;var last=persisted&&persisted[0];message=last?'Save confirmation failed. Last recorded state: '+mapStatusLabel(last.status)+', '+Number(last.progress_pct||0)+'% complete, verification '+mapStatusLabel(last.verification_status)+'. Reopen the record to confirm before retrying.':'Save could not be confirmed. Reconnect and use Save to confirm the previous attempt before retrying a workflow decision.';}catch(_){message='Save could not be confirmed. Reconnect and reopen the action to check its recorded state before retrying.';}
    }
    mapEditorMessage(message+' Your entered changes remain in this editor.',true);return false;}
  finally{if(session===mapEditorSession){mapEditorBusy=false;mapEditorRefresh();}}
}

// Closure evidence is a persisted decision, never an inferred count of boxes.
var MAP_CLOSURE_ITEMS=['Action completed as described','Evidence reviewed and available','Required verification completed','Root cause addressed','Similar areas / tasks reviewed','Residual risk and follow-up reviewed'];
function mapClosureControlIds(){return MAP_CLOSURE_ITEMS.flatMap(function(_,i){return ['mcc-'+(i+1),'mcc-na-'+(i+1),'mcc-reason-'+(i+1)];});}
function mapClosureRead(){var result={};MAP_CLOSURE_ITEMS.forEach(function(_,i){var n=i+1;result[n]={confirmed:!!document.getElementById('mcc-'+n)?.checked,not_applicable:!!document.getElementById('mcc-na-'+n)?.checked,reason:String(document.getElementById('mcc-reason-'+n)?.value||'').trim()};});return result;}
function mapClosureHydrate(record){var checks=record.closure_checklist||{};MAP_CLOSURE_ITEMS.forEach(function(_,i){var n=i+1,item=checks[n]||{},yes=document.getElementById('mcc-'+n),na=document.getElementById('mcc-na-'+n),reason=document.getElementById('mcc-reason-'+n);if(yes)yes.checked=item.confirmed===true;if(na)na.checked=item.not_applicable===true;if(reason)reason.value=item.reason||'';});}
function mapClosureIssues(record){var issues=[],checks=record.closure_checklist||{};MAP_CLOSURE_ITEMS.forEach(function(label,i){var n=i+1,item=checks[n]||{},required=n<=2||(n===3&&record.requires_verification!==false),confirmed=item.confirmed===true,na=item.not_applicable===true;if(confirmed&&na||required&&!confirmed||!required&&!confirmed&&(!na||!String(item.reason||'').trim())||required&&na)issues.push({index:n,message:label+': '+(required?'confirmation is required.':'confirm or mark N/A with a reason.')});});return issues;}
function mapStatusLabel(value){return String(value||'not recorded').replace(/_/g,' ').replace(/^\w/,function(c){return c.toUpperCase();});}
function mapReadinessRender(record){
 var el=document.getElementById('map-readiness');if(!el)return;var form=mapEditorForm(),items=[],status=record.status||'open',heading='Submission readiness';
 if(['closed','cancelled'].includes(status)){el.textContent=mapStatusLabel(status)+' — retained for history.';return;}
 if(status==='open'){heading='Start readiness';items.push([!!String(form['mf-title']||'').trim(),'Action described']);items.push([!!form['mf-target-date'],'Target date entered']);}
 else{
  items.push([Number(form['mf-progress'])===100,'Progress is 100%']);items.push([!!String(form['mf-evidence']||'').trim(),'Completion evidence described / referenced']);
  if(status==='pending_verification'){heading='Verification readiness';items.push([!!String(form['mf-verif-notes']||'').trim(),'Verification notes entered']);}
  if(status==='pending_closure'){heading='Closure readiness';if(record.requires_verification!==false)items.push([record.verification_status==='passed','Verification passed']);var missing=mapClosureIssues(Object.assign({},record,{closure_checklist:mapClosureRead()}));items.push([!missing.length,'All applicable closure confirmations answered']);items.push([!!String(form['mf-closure-notes']||'').trim(),'Closure summary entered']);}
 }
 el.textContent=heading+': '+items.map(function(item){return (item[0]?'✓ ':'○ ')+item[1];}).join(' · ');
}

// The same exact-record work activity is displayed here and in Attached evidence.
var mapEvidenceRecord=null,mapEvidencePending=null,mapEvidenceBusy=false,mapEvidenceGeneration=0;
function mapEvidenceDraft(){return !!(document.getElementById('map-evidence-file')?.files?.length||document.getElementById('map-evidence-url')?.value||document.getElementById('map-evidence-caption')?.value||mapEvidencePending);}
function mapEvidenceMount(record){
  mapEvidenceRecord=record;mapEvidencePending=null;mapEvidenceBusy=false;
  var host=document.getElementById('map-evidence-panel');if(!host)return;
  host.innerHTML='<h3>Attached evidence</h3><p>Descriptions above do not upload files. Attach a PDF or image, or link a supporting document. Saved evidence is shared with the record viewer.</p><div id="map-evidence-list" aria-live="polite"></div><div id="map-evidence-compose"><label for="map-evidence-file">PDF or image (up to 12 MB)</label><input id="map-evidence-file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp"/><label for="map-evidence-url">Or document URL (HTTPS)</label><input id="map-evidence-url" type="url"/><label for="map-evidence-caption">Evidence caption</label><input id="map-evidence-caption" maxlength="1000"/><button type="button" id="map-evidence-add" class="btn">Save evidence</button></div><p id="map-evidence-feedback" role="status"></p>';
  document.getElementById('map-evidence-add').addEventListener('click',mapEvidenceSave);
  var terminal=['closed','cancelled'].includes(record.status);document.getElementById('map-evidence-compose').hidden=terminal;
  mapEvidenceLoad();
}
async function mapEvidenceLoad(){
  var record=mapEvidenceRecord,session=mapEditorSession,generation=++mapEvidenceGeneration,host=document.getElementById('map-evidence-list');if(!host)return;if(!record?.id){host.textContent='Save this action before attaching evidence.';return;}
  host.textContent='Loading attached evidence…';
  try{var rows=await api('/work_activities?select=*&company_id=eq.'+encodeURIComponent(record.company_id)+'&source_module=eq.actions&source_table=eq.action_tracker&source_record_id=eq.'+encodeURIComponent(record.id)+'&activity_type=eq.evidence&order=created_at.desc&limit=100');session.assertCurrent();if(session!==mapEditorSession||generation!==mapEvidenceGeneration)return;
    host.replaceChildren();var count=0;(rows||[]).filter(function(row){return row.company_id===record.company_id&&row.source_record_id===record.id&&row.source_table==='action_tracker'&&row.source_module==='actions';}).forEach(function(row){(Array.isArray(row.evidence)?row.evidence:[]).forEach(function(item){var paragraph=document.createElement('p'),button=document.createElement('button');paragraph.textContent=(item.label||row.body||'Supporting evidence')+' ';button.type='button';button.className='btn btn-sm';button.textContent='Preview evidence';button.addEventListener('click',function(){mapEvidencePreview(item,record,session);});paragraph.appendChild(button);host.appendChild(paragraph);count++;});});if(!count)host.textContent='No files or document links attached. Controlled-record references may be described above.';
  }catch(_){if(generation===mapEvidenceGeneration&&session===mapEditorSession)host.textContent='Evidence could not be loaded. Reopen this action to retry; this does not mean no evidence exists.';}
}
async function mapEvidencePreview(item,record,session){
  var popup=window.open('about:blank','_blank');if(popup)popup.opener=null;
  try{session.assertCurrent();if(session!==mapEditorSession)throw new Error('Reopen the action.');var url;
    if(item.bucket==='evidence'&&typeof item.path==='string'&&item.path.startsWith(record.company_id+'/actions/'+record.id+'/')){var response=await fetch(SB+'/storage/v1/object/sign/evidence/'+item.path.split('/').map(encodeURIComponent).join('/'),{method:'POST',headers:{Authorization:'Bearer '+tok,apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300})});if(!response.ok)throw new Error('Evidence preview is unavailable.');var signed=await response.json();if(typeof signed.signedURL!=='string'||!signed.signedURL.startsWith('/object/sign/evidence/'))throw new Error('Evidence preview could not be authorised.');url=new URL(SB+'/storage/v1'+signed.signedURL);if(url.origin!==new URL(SB).origin)throw new Error('Invalid evidence location.');}
    else{url=new URL(item.url);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Evidence requires a valid HTTPS document URL.');}
    session.assertCurrent();if(session!==mapEditorSession)throw new Error('Reopen the action.');if(!popup)throw new Error('Allow a new tab to preview evidence.');popup.location.replace(url.href);
  }catch(error){if(popup)popup.close();mapEditorMessage(error.message,true);}
}
async function mapEvidenceSave(){
  if(mapEvidenceBusy||mapEditorBusy)return;var session=mapEditorSession,record=mapEvidenceRecord,feedback=document.getElementById('map-evidence-feedback');
  try{session.assertCurrent();if(!record?.id)throw new Error('Save this action first.');if(['closed','cancelled'].includes(record.status))throw new Error('Closed actions are read only.');if(!workflowCanMutate('actions','actions'))return;
    var file=document.getElementById('map-evidence-file').files[0],raw=document.getElementById('map-evidence-url').value.trim(),caption=document.getElementById('map-evidence-caption').value.trim();if(!caption||(!file&&!raw)||file&&raw)throw new Error('Enter a caption and choose either a file or a document URL.');
    mapEvidenceBusy=true;mapEditorRefresh();document.getElementById('map-evidence-add').disabled=true;feedback.textContent='Saving evidence…';
    if(!mapEvidencePending){var item={label:caption};if(file){if(file.size>12*1024*1024||!['application/pdf','image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose a PDF or image up to 12 MB.');item.bucket='evidence';item.path=record.company_id+'/actions/'+record.id+'/'+crypto.randomUUID()+'_'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');var upload=await fetch(SB+'/storage/v1/object/evidence/'+item.path.split('/').map(encodeURIComponent).join('/'),{method:'POST',headers:{Authorization:'Bearer '+tok,apikey:KEY,'x-upsert':'false','Content-Type':file.type},body:file});if(!upload.ok)throw new Error('File upload failed. Your selection remains available.');}else{var link=new URL(raw);if(link.protocol!=='https:'||link.username||link.password)throw new Error('Enter a valid HTTPS document URL.');item.url=link.href;}session.assertCurrent();if(session!==mapEditorSession)throw new Error('The editor changed. Reopen the action.');mapEvidencePending={key:crypto.randomUUID(),item:item,caption:caption};}
    session.assertCurrent();if(session!==mapEditorSession)throw new Error('The editor changed. Reopen the action.');var pending=mapEvidencePending;
    await api('/rpc/add_work_activity',{m:'POST',b:{p_company_id:record.company_id,p_source_module:'actions',p_source_table:'action_tracker',p_source_record_id:record.id,p_source_ref:mapDisplayRef(record),p_activity_type:'evidence',p_body:pending.caption,p_evidence:[pending.item],p_idempotency_key:pending.key}});
    session.assertCurrent();if(session!==mapEditorSession)return;mapEvidencePending=null;['map-evidence-file','map-evidence-url','map-evidence-caption'].forEach(function(id){document.getElementById(id).value='';});feedback.textContent='Evidence saved separately. Use Save for any other action changes.';await mapEvidenceLoad();
  }catch(error){if(session===mapEditorSession)feedback.textContent=error.message+' Your evidence selection is retained; retry Save evidence to confirm the same attachment.';}
  finally{if(session===mapEditorSession){mapEvidenceBusy=false;}if(session===mapEditorSession){document.getElementById('map-evidence-add').disabled=false;mapEditorRefresh();}}
}
