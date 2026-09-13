const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
function runtime(role='admin'){
  const fields={};const scope={window:{},ccid:()=> 'company-a',prof:{id:'user-a',full_name:'Actual Reviewer'},activeRole:()=>role,canAccessPage:()=>true,coreWorkflowRequireTransition:()=>true,document:{getElementById:id=>fields[id]||(fields[id]={checked:true,focus(){},setAttribute(){},closest(){return null;}})}};
  vm.runInNewContext(read('auris-action-editor.js'),scope);return {scope,fields,run:(record,body,command,reason)=>scope.mapEditorWorkflow(record,body,command,reason)};
}
const row={id:'record-a',status:'in_progress',requires_verification:true},completed={progress_pct:100,evidence:'Inspection photo available',requires_verification:true};
test('verification-required actions cannot skip verification by changing draft checkbox',()=>{
  const r=runtime();assert.throws(()=>r.run(row,{...completed,requires_verification:false},'submit_closure'),/Verification is required/);
  assert.equal(r.run({...row,requires_verification:false},{...completed},'submit_closure').status,'pending_closure');
});
test('submission requires completion and evidence; save keeps the workflow unchanged',()=>{
  const r=runtime();assert.throws(()=>r.run(row,{...completed,progress_pct:50},'submit_verification'),/100%/);
  assert.throws(()=>r.run(row,{progress_pct:100},'submit_verification'),/evidence/);
  assert.equal(r.run(row,{...completed,status:'in_progress'},'save').status,'in_progress');
});
test('resubmission resets the previous verification result without erasing its history',()=>{
  const r=runtime();const submitted=r.run({...row,verification_status:'failed',verified_by:'Previous reviewer'},{...completed,verification_status:'failed',verified_by:'Previous reviewer'},'submit_verification');
  assert.equal(submitted.verification_status,'pending');assert.equal(submitted.verified_by,null);assert.equal(submitted.verified_date,null);
});
test('review commands require both the correct status and an eligible role',()=>{
  for(const command of ['verify','fail_verification','close','reject_closure']){
    const state=command.includes('closure')||command==='close'?'pending_closure':'pending_verification';
    assert.throws(()=>runtime('employee').run({...row,status:state},{...completed},command,'Reason'),/reviewer|role/);
    assert.throws(()=>runtime().run(row,{...completed},command,'Reason'),/current stage/);
  }
});
test('approvals record the acting user and require notes; closure also checks verified state',()=>{
  const r=runtime();assert.throws(()=>r.run({...row,status:'pending_verification'},{...completed},'verify'),/notes/);
  const verified=r.run({...row,status:'pending_verification'},{...completed,verification_notes:'Checked',verified_by:'Spoofed'},'verify');assert.equal(verified.verified_by,'Actual Reviewer');assert.equal(verified.status,'pending_closure');
  assert.throws(()=>r.run({...row,status:'pending_closure'},{...completed,closure_notes:'Done'},'close'),/required verification/);
  const closed=r.run({...row,status:'pending_closure',verification_status:'passed'},{...completed,closure_notes:'Done',closure_approved_by:'Spoofed'},'close');assert.equal(closed.closure_approved_by,'Actual Reviewer');assert.equal(closed.status,'closed');
});
test('closed and cancelled records are read only; only managers cancel',()=>{
  for(const status of ['closed','cancelled'])assert.throws(()=>runtime().run({...row,status},{},'save'),/read only/);
  assert.throws(()=>runtime('hse_officer').run(row,{},'cancel'),/manager/);
});
test('company policy roles, required fields and staged approvals cannot be bypassed',()=>{
  const r=runtime();for(const decision of [{allowed:false,reason:'role_not_allowed'},{allowed:false,reason:'persistence_unavailable'},{allowed:false,reason:'approval_required',approvalStages:[{role:'hse_manager'}]}]){
    r.scope.window.AurisWorkflowService=r.scope.AurisWorkflowService={explain:()=>decision};
    assert.throws(()=>r.run({...row,status:'pending_verification'},{...completed,verification_notes:'Verified'},'verify'),/workflow|staged approval/);
  }
});
test('legacy entry points delegate all editor writes to the same persistence boundary',()=>{
  const core=read('auris-core.js');
  for(const name of ['mapSave','mapChangeStatus','mapApproveVerification','mapFailVerification','mapApproveClosure','mapRejectClosure','mapTriggerEscalation','mapDelete'])assert.match(core,new RegExp('async function '+name+'\\([^]*?return mapEditorCommit\\('));
  assert.match(core,/async function cycleAction\(id\)\{return mapOpenDetail\(id\);\}/);
  const html=read('index.html');assert.ok(html.indexOf('src="auris-record-edit-session.js')<html.indexOf('src="auris-action-editor.js'));assert.match(html,/id="map-editor-feedback"/);
});
test('a restored session hydrates workflow before decisions and rechecks the editor after loading',async()=>{
  const r=runtime();let hydrated=0,checked=0;const session={assertCurrent(){checked++;}};r.scope.mapEditorSession=session;
  r.scope.window.AurisWorkflowService=r.scope.AurisWorkflowService={hydrate:async company=>{assert.equal(company,'company-a');hydrated++;}};
  await r.scope.mapEditorLoadWorkflow(session,'start');assert.equal(hydrated,1);assert.equal(checked,1);
  r.scope.AurisWorkflowService.hydrate=async()=>{r.scope.mapEditorSession={};};
  await assert.rejects(r.scope.mapEditorLoadWorkflow(session,'verify'),/editor changed/);
});
