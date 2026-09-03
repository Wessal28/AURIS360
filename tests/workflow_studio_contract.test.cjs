const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

function runtime(){
  const context={console,Date,Blob:function(){},URL:{createObjectURL(){return'';},revokeObjectURL(){}},globalThis:null};context.globalThis=context;
  vm.runInNewContext(read('auris-module-registry.js'),context);
  vm.runInNewContext(read('auris-workflow-service.js'),context);
  vm.runInNewContext(read('auris-workflow-studio.js'),context);
  return context;
}

test('reviewed Studio templates cover the five governed module workflows',()=>{
  const context=runtime();
  for(const key of ['events','permit','risk','documents','moc']){
    const policy=context.AurisWorkflowStudio.template(key);
    const review=context.AurisWorkflowService.review(key,policy);
    assert.equal(review.valid,true,`${key}: ${review.errors.join(', ')}`);
    assert.ok(policy.transitions.length);
    assert.equal(policy.rules.length,policy.transitions.length);
  }
});

test('service enforces transition roles required fields and ordered approval stages',()=>{
  const {AurisWorkflowService:service}=runtime();
  const policy={transitions:[['open','closed']],rules:[{from:'open',to:'closed',roles:['hse_manager'],requiredFields:['closure_reason'],approvalStages:[{role:'admin',label:'Final approval'}]}]};
  service.configure('co-1','events',policy);
  assert.equal(service.explain('events','open','closed',{companyId:'co-1',role:'employee',record:{closure_reason:'done'}}).reason,'role_not_allowed');
  assert.equal(service.explain('events','open','closed',{companyId:'co-1',role:'hse_manager',record:{}}).reason,'required_fields_missing');
  const result=service.explain('events','open','closed',{companyId:'co-1',role:'hse_manager',record:{closure_reason:'done'}});
  assert.equal(result.reason,'approval_required');
  assert.equal(result.approvalStages[0].role,'admin');
});

test('invalid graphs and executable configuration are rejected before publication',async()=>{
  const {AurisWorkflowService:service}=runtime();
  assert.equal(service.review('events',{transitions:[['submitted','closed']]}).valid,false);
  assert.match(service.review('events',{transitions:[['draft','submitted']],expression:'user.isAdmin()'}).errors[0],/Unsafe executable/);
  const invalid={id:'draft-1',policy:{transitions:[['submitted','closed']]}};
  service.configurePersistence({load:async()=>[],history:async()=>[invalid],saveDraft:async()=>invalid,publish:async()=>invalid,rollback:async()=>invalid});
  await assert.rejects(service.publish('co-1','events','draft-1',{}),error=>error.code==='AURIS_WORKFLOW_INVALID_POLICY');
});

test('simulation and impact explain policy effects without changing runtime policy',()=>{
  const context=runtime(),service=context.AurisWorkflowService,template=context.AurisWorkflowStudio.template('events'),candidate=JSON.parse(JSON.stringify(template));
  candidate.transitions=candidate.transitions.filter(pair=>!(pair[0]==='open'&&pair[1]==='closed'));
  candidate.rules=candidate.rules.filter(rule=>!(rule.from==='open'&&rule.to==='closed'));
  const before=service.canTransition('events','open','closed',{companyId:'co-1'});
  const impact=service.impact('events',template,candidate,[{status:'open'},{status:'open'},{status:'closed'}]);
  assert.equal(impact.potentiallyAffected,2);
  assert.equal(service.canTransition('events','open','closed',{companyId:'co-1'}),before);
  assert.equal(service.simulate('events',candidate,{from:'open',to:'closed',role:'admin',record:{}}).reason,'transition_not_allowed');
});

test('production shell exposes the admin-only Studio and governed version operations',()=>{
  const html=read('index.html'),core=read('auris-core.js'),studio=read('auris-workflow-studio.js'),manifest=read('sw-assets.js');
  assert.ok(html.indexOf('auris-workflow-service.js?v=20260903-28')<html.indexOf('auris-workflow-studio.js?v=20260901-10'));
  assert.ok(html.indexOf('auris-workflow-studio.js?v=20260901-10')<html.indexOf('auris-core.js'));
  assert.match(html,/id="settings-workflow-studio-card"/);
  assert.match(core,/studioAllowed=isAdm\(\)\|\|activeRole\(\)==='hse_manager'/);
  for(const marker of ['Save draft','Publish','Simulate transition','Export reviewed JSON','Import reviewed JSON','service.saveDraft','service.publish','service.rollback','service.versions'])assert.match(studio,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(manifest,/auris-workflow-studio\.js/);
  assert.match(manifest,/auris-workflow-studio\.css/);
});
