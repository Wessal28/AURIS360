const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

function runtime(){
  const context={console,globalThis:null};context.globalThis=context;
  vm.runInNewContext(read('auris-module-registry.js'),context);
  vm.runInNewContext(read('auris-workflow-service.js'),context);
  return context.AurisWorkflowService;
}

test('tenant policies may narrow incident transitions without inventing states',()=>{
  const service=runtime();
  assert.equal(service.canTransition('events','open','closed',{companyId:'one'}),true);
  service.configure('one','events',{version:'client-2',transitions:[['open','under_investigation'],['under_investigation','closed']]});
  assert.equal(service.canTransition('events','open','closed',{companyId:'one'}),false);
  assert.equal(service.canTransition('events','open','closed',{companyId:'two'}),true);
  assert.throws(()=>service.configure('one','events',{transitions:[['open','invented']]}),/undeclared state/);
});

test('approval gates and blocked transitions return controlled evidence',()=>{
  const service=runtime();
  service.configure('one','events',{transitions:[['open','closed']],approvalTransitions:[['open','closed']]});
  assert.equal(service.requiresApproval('events','open','closed',{companyId:'one'}),true);
  assert.equal(service.explain('events','open','closed',{companyId:'one'}).reason,'approval_required');
  assert.throws(()=>service.requireTransition('events','open','closed',{companyId:'one'}),error=>error.code==='AURIS_APPROVAL_REQUIRED');
});

test('deployment loads workflow enforcement before production core',()=>{
  const html=read('index.html'),manifest=read('sw-assets.js'),core=read('auris-core.js');
  assert.ok(html.indexOf('auris-workflow-service.js?v=20260901-10')<html.indexOf('auris-core.js'));
  assert.match(manifest,/auris-workflow-service\.js/);
  assert.match(core,/AurisWorkflowService\.canTransition/);
  assert.match(core,/function workflowConfigureTenant/);
});
