const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

function runtime(){
  const context={console,Date,globalThis:null};context.globalThis=context;
  vm.runInNewContext(read('auris-module-registry.js'),context);
  vm.runInNewContext(read('auris-workflow-service.js'),context);
  vm.runInNewContext(read('auris-approval-centre.js'),context);
  return context;
}

test('workflow approval gates create an exact tenant-bound request',async()=>{
  const ctx=runtime(),workflow=ctx.AurisWorkflowService,approvals=ctx.AurisApprovalCentre;
  approvals.registerAdapter({key:'incident',table:'incidents',page:'events'});
  workflow.configure('co-1','events',{transitions:[['open','closed']],approvalTransitions:[['open','closed']]});
  const outcome=await workflow.transition('events',{id:'inc-1',company_id:'co-1',status:'open'},'closed',{context:{companyId:'co-1'}});
  assert.equal(outcome.status,'approval_required');
  assert.equal(outcome.request.source.recordId,'inc-1');
  assert.equal(outcome.request.companyId,'co-1');
  assert.equal(outcome.request.to,'closed');
});

test('approval decisions resume workflow only with approved evidence',async()=>{
  const ctx=runtime(),workflow=ctx.AurisWorkflowService,approvals=ctx.AurisApprovalCentre;
  approvals.registerAdapter({key:'incident',table:'incidents',page:'events'});
  workflow.configure('co-1','events',{transitions:[['open','closed']],approvalTransitions:[['open','closed']]});
  const pending=(await workflow.transition('events',{id:'inc-2',company_id:'co-1',status:'open'},'closed',{context:{companyId:'co-1'}})).request;
  let persisted='';
  const decided=await approvals.decide(pending.id,'approved',{context:{companyId:'co-1'},record:{id:'inc-2',status:'open'},persist:async to=>{persisted=to;return {id:'inc-2',status:to};}});
  assert.equal(decided.status,'approved');
  assert.equal(persisted,'closed');
});

test('cross-company queue records and missing exact ids are controlled failures',()=>{
  const approvals=runtime().AurisApprovalCentre;
  approvals.registerAdapter({key:'incident',table:'incidents',page:'events'});
  assert.throws(()=>approvals.assertSource({source:'incident',record_id:'inc-3',company_id:'co-2'},{companyId:'co-1'}),error=>error.code==='AURIS_APPROVAL_TENANT_MISMATCH');
  assert.throws(()=>approvals.assertSource({source:'incident',company_id:'co-1'},{companyId:'co-1'}),/no exact source record/);
});

test('deployment loads approval service before production core and retains existing adapters',()=>{
  const html=read('index.html'),core=read('auris-core.js'),manifest=read('sw-assets.js');
  assert.ok(html.indexOf('auris-approval-centre.js?v=20260901-9')<html.indexOf('auris-core.js'));
  assert.match(core,/AurisApprovalCentre\.registerAdapters\(APPROVAL_SOURCE_ADAPTERS\)/);
  assert.match(core,/AurisApprovalCentre\.assertSource/);
  assert.match(manifest,/auris-approval-centre\.js/);
});
