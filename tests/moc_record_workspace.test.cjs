const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const source={module:'moc',table:'moc_change_requests',id:'moc-1',company_id:'co-a'},current={companyId:'co-a',userId:'user-a',role:'manager'};
const record={id:'moc-1',company_id:'co-a',moc_ref:'MOC-001',title:'Replace solvent',change_type:'chemical',lifecycle_status:'pending_approval',owner_name:'Reviewer',priority:'high',reason:'Reduce exposure',impacted_areas:['Training','Risk assessment'],target_date:'2026-09-18'};
const legacy={id:'moc-1',company_id:'co-a',source_module:'moc',source_id:'moc-1',source_ref:'MOC-OLD-001',title:'Old change',status:'open',assigned_to_name:'Legacy owner',description:'Change type: Process change\nReason: Safer process\nCurrent situation: Old process\nProposed change: New process\nImpacted areas: Training, Equipment\nRisk review: Guarding\nPre-implementation actions: Train operators\nPost-change verification: Review effectiveness'};
function runtime(respond=()=>[]){
  const calls=[],identity={company:{id:'co-a'},profile:{id:'user-a'},role:'manager'},adapters={};let options,clipboard;
  const context={navigator:{onLine:true,clipboard:{writeText:async value=>{clipboard=value;}}},AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>true,current:()=>identity},rbac:{requireAccess:key=>assert.equal(key,'moc')},api:{request:async(...args)=>{assert.equal(args.length,1,'read-only API requests');calls.push(args[0]);return respond(args[0],identity);}}},AurisRecordWorkspace:{registerAdapter:value=>{adapters[value.key]=value;},open:async value=>{options=value;return value;}}};
  vm.runInNewContext(read('auris-moc-list-workspace.js'),context);vm.runInNewContext(read('auris-moc-record-workspace.js'),context);
  return {api:context.AurisMocRecordWorkspace,context,calls,identity,adapters,get options(){return options;},get clipboard(){return clipboard;}};
}
const withRecord=(handler=()=>[],row=record)=>(url,identity)=>/^\/(moc_change_requests|action_tracker)\?/.test(url)?[row]:handler(url,identity);
test('fresh exact company request precedes bounded history and presents canonical MOC detail fields',async()=>{
  const r=runtime(withRecord()),before=JSON.stringify(record),result=await r.api.load(source,current);
  assert.equal(r.calls[0],'/moc_change_requests?select=*&company_id=eq.co-a&id=eq.moc-1&limit=1');assert.equal(r.calls.length,3);
  for(const url of r.calls.slice(1)){assert.match(url,/company_id=eq.co-a/);assert.match(url,/moc_change_requests/);assert.match(url,/moc-1/);assert.match(url,/limit=101/);}
  assert.equal(result.record.lifecycle_label,'Pending approval');assert.equal(result.record.change_type_label,'Chemical / substance');assert.equal(result.record.reference_label,'MOC-001');assert.equal(result.record.owner_label,'Reviewer');assert.equal(result.record.priority_label,'High');
  assert.equal(result.record.lifecycle_status,'pending_approval');assert.equal(JSON.stringify(record),before);assert.equal(result.notices.length,0);
});
test('legacy definitions retain proposal metadata and do not take over action or My Work adapters',async()=>{
  const r=runtime(withRecord(()=>[],legacy));await r.api.open('moc-1',{table:'action_tracker'});const result=await r.api.load({...source,table:'action_tracker'},current);
  assert.equal(result.record.reason,'Safer process');assert.equal(result.record.pre_implementation_actions,'Train operators');assert.equal(result.record.post_change_verification,'Review effectiveness');assert.equal(result.record.lifecycle_label,'Screening');
  assert.equal(result.record.owner_label,'Legacy owner');assert.equal(result.record.reference_label,'MOC-OLD-001');assert.match(result.notices[0],/not treated as MOC approvals/);
  assert.ok(r.calls.some(url=>url.startsWith('/map_activity_log?')));assert.equal(Object.keys(r.adapters).length,2);
  for(const adapter of Object.values(r.adapters)){assert.equal(adapter.module,'moc');assert.equal(adapter.explicitOnly,true);assert.equal(adapter.canEdit(),false);}
});
test('missing, duplicate, wrong-company and wrong-ID records fail before history queries',async()=>{
  for(const payload of [null,{},[],[record,record],[{...record,id:'other'}],[{...record,company_id:'co-b'}]]){
    const r=runtime(()=>payload);await assert.rejects(r.api.load(source,current),/unavailable/);assert.equal(r.calls.length,1);
  }
});
test('legacy panels reject generated corrective actions, migrated rows and unrelated source modules',async()=>{
  for(const row of [{...legacy,source_table:'moc_change_requests'},{...legacy,source_id:'other'},{...legacy,source_module:'events'},{...legacy,source_table:'events'}]){
    const r=runtime(()=>[row]);await assert.rejects(r.api.load({...source,table:'action_tracker'},current),/no longer belongs/);assert.equal(r.calls.length,1);
  }
});
test('authentication, module access and malformed or mismatched source identity block before reads',async()=>{
  const r=runtime();await assert.rejects(r.api.open('moc-1&company_id=eq.other',{table:'moc_change_requests'}),/exact change request/);
  await assert.rejects(r.api.open('moc-1',{table:'events'}),/exact MOC storage/);await assert.rejects(r.api.load({...source,module:'actions'},current),/selected company/);await assert.rejects(r.api.load({...source,company_id:'co-b'},current),/selected company/);
  r.context.AurisPlatformServices.auth.isAuthenticated=()=>false;await assert.rejects(r.api.open('moc-1',{table:'moc_change_requests'}),/Sign in/);
  r.context.AurisPlatformServices.auth.isAuthenticated=()=>true;r.context.AurisPlatformServices.rbac.requireAccess=()=>{throw Error('Access denied');};await assert.rejects(r.api.load(source,current),/Access denied/);assert.equal(r.calls.length,0);
});
test('activity, attached evidence, approvals and decisions cannot cross company, module, table or ID boundaries',async()=>{
  const work={id:'w1',company_id:'co-a',source_module:'moc',source_table:source.table,source_record_id:source.id,activity_type:'comment',body:'Review <script>',evidence:[{label:'Report',url:'https://example.invalid/report'}]};
  const approval={id:'p1',company_id:'co-a',module_name:'moc',related_table:source.table,related_id:source.id,source_record_id:source.id,status:'pending',request_reason:'Review change'};
  const r=runtime(withRecord(url=>{
    if(url.startsWith('/work_activities?'))return [null,work,{...work,company_id:'co-b'},{...work,source_table:'action_tracker'},{...work,source_module:'actions'},{...work,related_id:'other'}];
    if(url.startsWith('/approval_requests?'))return [null,approval,{...approval,id:'other-record',related_id:'other'},{...approval,id:'other-module',module_name:'actions'},{...approval,id:'other-table',related_table:'action_tracker'},{...approval,id:'other-company',company_id:'co-b'}];
    if(url.startsWith('/approval_decisions?')){assert.match(url,/request_id=in.\(p1\)/);return [{id:'d1',request_id:'p1',decision:'approved'},{request_id:'other',decision:'rejected'},{request_id:'p1',company_id:'co-b'},{request_id:'p1',source_table:'action_tracker'}];}
    return [];
  }));
  const result=await r.api.load(source,current);assert.equal(result.approvals.length,1);assert.equal(result.activities.length,3);
  assert.equal(result.activities.filter(row=>row.activity_type==='evidence').length,1);assert.match(result.activities[1].body,/Report: https/);assert.equal(result.activities[2].body,'approved');
  for(const row of result.activities){assert.equal(row.company_id,'co-a');assert.equal(row.source_module,'moc');assert.equal(row.source_table,source.table);assert.equal(row.source_record_id,source.id);}
});
test('legacy activity must match the exact action while action approvals are not MOC approvals',async()=>{
  const r=runtime(withRecord(url=>{
    if(url.startsWith('/map_activity_log?'))return [null,{id:'l1',company_id:'co-a',action_id:'moc-1',notes:'Legacy review'},{company_id:'co-b',action_id:'moc-1'},{company_id:'co-a',action_id:'other'}];
    if(url.startsWith('/approval_requests?'))return [{id:'p1',company_id:'co-a',related_table:'action_tracker',module_name:'actions',related_id:'moc-1'}];
    return [];
  },legacy));
  const result=await r.api.load({...source,table:'action_tracker'},current);assert.equal(result.activities.length,1);assert.equal(result.approvals.length,0);assert.ok(!r.calls.some(url=>url.startsWith('/approval_decisions')));
});
test('unavailable or malformed optional sources and bounded history are explicitly disclosed',async()=>{
  const r=runtime(withRecord(url=>{
    if(url.startsWith('/work_activities?'))return Array.from({length:101},(_,i)=>({id:String(i),company_id:'co-a',source_module:'moc',source_table:source.table,source_record_id:source.id,body:'Review'}));
    throw Error('private schema details');
  }));
  const result=await r.api.load(source,current);assert.equal(result.activities.length,100);assert.equal(result.notices.length,2);assert.match(result.notices.join(' '),/latest 100.*older entries/);assert.match(result.notices.join(' '),/does not mean no history exists/);assert.doesNotMatch(result.notices.join(' '),/private schema/);
  const bad=runtime(withRecord(()=>({invalid:true})));assert.equal((await bad.api.load(source,current)).notices.length,2);
});
test('changed company, profile, role or revoked access during reads fails closed',async()=>{
  for(const endpoint of ['/moc_change_requests?','/work_activities?'])for(const change of [r=>r.identity.company.id='co-b',r=>r.identity.profile.id='other',r=>r.identity.role='viewer',r=>{r.context.AurisPlatformServices.rbac.requireAccess=()=>{throw Error('Access denied');};}]){
    let r;r=runtime((url)=>{if(url.startsWith(endpoint))change(r);return url.startsWith('/moc_change_requests?')?[record]:[];});await assert.rejects(r.api.load(source,current),/changed|denied/);
  }
});
test('read-only panel exposes only reference copying and explicit existing-form handoff',async()=>{
  const r=runtime();let handoff;await r.api.open('moc-1',{table:source.table,reference:'Old ref',openEditor:async(...args)=>{handoff=args;}});
  assert.equal(r.options.availableActions.join(','),'copy,open');assert.equal(r.options.actionLabels.copy,'Copy reference');assert.equal(r.options.actionLabels.open,'Open change form');assert.match(r.options.workflowHelp,/read-only.*Linked action approvals do not approve/);
  await r.options.onAction('copy',source,{...record,reference_label:'MOC-001'});assert.equal(r.clipboard,'MOC-001');
  const result=await r.options.onAction('open',source,record);assert.equal(handoff[0].id,'moc-1');assert.equal(handoff[1],source.table);assert.equal(handoff[2].companyId,'co-a');assert.equal(result.close,true);
  await assert.rejects(r.options.onAction('approve',source,record),/unavailable/);await assert.rejects(r.options.onAction('edit',source,record),/unavailable/);
});
test('editor failures, offline state and changed source/session retain the panel without a handoff',async()=>{
  const r=runtime();await r.api.open('moc-1',{table:source.table,openEditor:async()=>{throw Error('Editor failed');}});
  await assert.rejects(r.options.onAction('open',source,record),/Editor failed/);await assert.rejects(r.options.onAction('open',{...source,table:'action_tracker'},record),/identity changed/);
  await assert.rejects(r.options.onAction('open',source,{...record,company_id:'co-b'}),/unavailable/);
  r.context.navigator.onLine=false;await assert.rejects(r.options.onAction('open',source,record),/Reconnect/);r.identity.role='viewer';await assert.rejects(r.options.onAction('open',source,record),/changed/);
});
test('core bridge uses the fresh record and rejects a refreshed register, wrong store or company before editor mutation',async()=>{
  const core=read('auris-core.js'),code=core.slice(core.indexOf('function mocOpenOverview('),core.indexOf('function mocShowForm('));
  let options,opened=0;const context={mocData:[record],mocLegacyMode:false,mocListLoadGeneration:2,mocListContext:{...current,generation:2},ccid:()=>current.companyId,prof:{id:current.userId},activeRole:()=>current.role,canAccessPage:()=>true,mocRef:r=>r.moc_ref,navigator:{onLine:true},mocEdit:()=>opened++,window:{AurisMocRecordWorkspace:{open:async(id,value)=>{options=value;}}}};
  vm.runInNewContext(code,context);await context.mocOpenOverview('moc-1',source.table,current,2);
  options.openEditor({...record,title:'Fresh title'},source.table,current);assert.equal(context.mocData[0].title,'Fresh title');assert.equal(opened,1);
  assert.throws(()=>options.openEditor(record,'action_tracker',current),/identity changed/);assert.throws(()=>options.openEditor({...record,company_id:'co-b'},source.table,current),/identity changed/);assert.equal(opened,1);
  context.mocListLoadGeneration=3;assert.throws(()=>options.openEditor(record,source.table,current),/register changed/);assert.equal(opened,1);
});
test('panel adapter is explicit, release-required and does not implement business writes or workflow transitions',()=>{
  const html=read('index.html'),adapter=read('auris-moc-record-workspace.js'),core=read('auris-core.js');
  assert.ok(html.indexOf('src="auris-moc-list-workspace.js?')<html.indexOf('src="auris-moc-record-workspace.js?'));assert.ok(html.indexOf('src="auris-moc-record-workspace.js?')<html.indexOf('src="auris-core.js?'));
  assert.match(core,/return mocOpenOverview\(id,table,expected,listGeneration\)/);
  for(const file of ['sw-assets.js','scripts/verify-production-smoke.cjs','scripts/verify-staging-acceptance.cjs'])assert.match(read(file),/auris-moc-record-workspace\.js/);
  assert.doesNotMatch(adapter,/\bfetch\(|\bmocData\b|\bmocEdit\(|onTransition|m:['"](POST|PATCH|DELETE)/);
});
