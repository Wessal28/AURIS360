const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

function workflowRuntime(){
  const context={console,Date,globalThis:null};context.globalThis=context;
  vm.runInNewContext(read('auris-module-registry.js'),context);
  vm.runInNewContext(read('auris-workflow-service.js'),context);
  return context.AurisWorkflowService;
}

test('persistent workflow enforcement fails closed until the selected company is hydrated',async()=>{
  const service=workflowRuntime();
  service.configurePersistence({
    load:async companyId=>companyId==='co-1'?[{module_key:'events',version:4,policy:{transitions:[['open','under_investigation']]}}]:[],
    saveDraft:async()=>({}),publish:async()=>({}),rollback:async()=>({})
  });
  await assert.rejects(service.transition('events',{id:'e-1',status:'open'},'closed',{context:{companyId:'co-1'}}),error=>error.code==='AURIS_WORKFLOW_UNAVAILABLE');
  await service.hydrate('co-1');
  assert.equal(service.readiness('co-1').status,'ready');
  assert.equal(service.canTransition('events','open','closed',{companyId:'co-1'}),false);
  assert.equal(service.canTransition('events','open','under_investigation',{companyId:'co-1'}),true);
});

test('workflow persistence failures retain a controlled unavailable state',async()=>{
  const service=workflowRuntime();
  service.configurePersistence({load:async()=>{throw new Error('network unavailable');},saveDraft:async()=>({}),publish:async()=>({}),rollback:async()=>({})});
  await assert.rejects(service.hydrate('co-2'),/network unavailable/);
  assert.equal(service.readiness('co-2').status,'error');
  assert.equal(service.explain('events','open','closed',{companyId:'co-2'}).reason,'persistence_unavailable');
});

test('production governance adapter uses versioned policy and atomic approval RPCs',async()=>{
  const calls=[];
  const context={console,Date,globalThis:null};context.globalThis=context;
  vm.runInNewContext(read('auris-platform-services.js'),context);
  context.AurisPlatformServices.configure('api',{request:async(path,options)=>{
    calls.push({path,options});
    if(path.startsWith('/workflow_policy_versions'))return [{id:'p-1',company_id:'co-1',module_key:'events',version:2,status:'published',revision:3,policy:{transitions:[]}}];
    if(path==='/rpc/create_workflow_policy_draft')return [{id:'p-2',company_id:'co-1',module_key:'events',version:3,status:'draft',revision:1,policy:options.b.p_policy}];
    if(path==='/rpc/publish_workflow_policy'||path==='/rpc/rollback_workflow_policy')return [{id:'p-3',company_id:'co-1',module_key:'events',version:4,status:'published',revision:2,policy:{transitions:[]}}];
    if(path.startsWith('/approval_requests'))return [];
    if(path==='/rpc/request_workflow_approval')return [{id:'a-1',company_id:'co-1',module_name:'events',related_table:'events',source_record_id:'e-1',source_page:'events',from_state:'open',to_state:'closed',status:'pending',revision:1}];
    if(path==='/rpc/decide_workflow_approval')return [{id:'a-1',company_id:'co-1',module_name:'events',related_table:'events',source_record_id:'e-1',source_page:'events',from_state:'open',to_state:'closed',status:'approved',revision:2}];
    return [];
  }});
  vm.runInNewContext(read('auris-governance-persistence.js'),context);
  const persistence=context.AurisGovernancePersistence;
  assert.equal((await persistence.workflow.load('co-1'))[0].version,2);
  assert.equal((await persistence.workflow.saveDraft('co-1','events',{transitions:[]},{})).status,'draft');
  assert.equal((await persistence.workflow.publish('co-1','events','p-2',{expectedRevision:1})).status,'published');
  assert.equal((await persistence.workflow.rollback('co-1','events','p-1',{expectedRevision:2})).status,'published');
  const pending=await persistence.approvals.create({id:'local-a',companyId:'co-1',moduleKey:'events',from:'open',to:'closed',source:{table:'events',recordId:'e-1',page:'events',companyId:'co-1'}});
  assert.equal(pending.source.recordId,'e-1');
  assert.equal((await persistence.approvals.decide({...pending,status:'approved'})).status,'approved');
  for(const rpc of ['/rpc/create_workflow_policy_draft','/rpc/publish_workflow_policy','/rpc/rollback_workflow_policy','/rpc/request_workflow_approval','/rpc/decide_workflow_approval'])assert.ok(calls.some(call=>call.path===rpc),rpc);
});

test('database migration provides tenant RLS, versioning, idempotency and atomic locking',()=>{
  const sql=read('supabase/migrations/20260901010000_modular_foundation_9_governance_persistence.sql');
  assert.match(sql,/create table if not exists public\.workflow_policy_versions/i);
  assert.match(sql,/enable row level security/i);
  assert.match(sql,/ux_workflow_policy_one_published/i);
  assert.match(sql,/ux_approval_requests_idempotency/i);
  assert.match(sql,/pg_advisory_xact_lock/i);
  assert.match(sql,/AURIS_WORKFLOW_REVISION_CONFLICT/);
  assert.match(sql,/AURIS_APPROVAL_ALREADY_DECIDED/);
  assert.match(sql,/security definer set search_path=public,pg_temp/i);
});

test('production shell hydrates governance on sign-in and company switching',()=>{
  const html=read('index.html'),core=read('auris-core.js'),manifest=read('sw-assets.js');
  assert.ok(html.indexOf('auris-governance-persistence.js?v=20260901-9')<html.indexOf('auris-core.js'));
  assert.match(core,/AurisWorkflowService\.configurePersistence\(window\.AurisGovernancePersistence\.workflow\)/);
  assert.match(core,/AurisApprovalCentre\.configurePersistence\(window\.AurisGovernancePersistence\.approvals\)/);
  assert.match(core,/await workflowHydrateTenant\(ccid\(\)\)/);
  assert.match(core,/await workflowHydrateTenant\(companyId\)/);
  assert.match(manifest,/auris-governance-persistence\.js/);
});
