const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const current={companyId:'co-a',userId:'user-a',role:'manager'};
const rows=[
  {id:'a',company_id:'co-a',moc_ref:'MOC-2026-001',title:'Replace solvent',change_type:'chemical',owner_name:'Reviewer',priority:'high',lifecycle_status:'pending_approval',target_date:'2026-08-01',location:'Factory',impacted_areas:['Training','Chemical / SDS']},
  {id:'b',company_id:'co-a',moc_ref:'MOC-2026-002',title:'New machine',change_type:'equipment',priority:'medium',lifecycle_status:'closed',target_date:'2026-08-01'},
  {id:'legacy',company_id:'co-a',source_ref:'MOC-OLD',source_module:'moc',source_id:'legacy',title:'Old process',status:'open',description:'Change type: Process change\nReason: Safer handling',assigned_to_name:'Old owner'},
  {id:'action',company_id:'co-a',source_module:'moc',source_table:'moc_change_requests',source_id:'a',title:'Linked corrective action'},
  {id:'migrated',company_id:'co-a',source_module:'moc',source_id:'b',title:'Migrated retained action'},
  {id:'secret',company_id:'co-b',title:'Secret'},{id:'missing',title:'Unscoped'}
];
function runtime(){
  const identity={company:{id:'co-a'},profile:{id:'user-a'},role:'manager'};let mounted,allowed=true,authenticated=true;
  const window={navigator:{onLine:true},AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>authenticated,current:()=>identity},rbac:{requireAccess:module=>{assert.equal(module,'moc');if(!allowed)throw Error('Access denied');}}},AurisViewEngine:{mount:(host,data,options)=>{mounted={data,options};return mounted;}}};
  vm.runInNewContext(read('auris-moc-list-workspace.js'),window);
  return {api:window.AurisMocListWorkspace,identity,window,mounted:()=>mounted,deny:()=>{allowed=false;},signOut:()=>{authenticated=false;}};
}
test('dedicated MOC projection preserves identity, target, owner, lifecycle and risk without changing data',()=>{
  const r=runtime(),before=JSON.stringify(rows),data=r.api.project(rows.slice(0,2),current,{},new Date('2026-09-08'));
  assert.equal(data[0].source_table,'moc_change_requests');assert.equal(data[0].reference,'MOC-2026-001');assert.equal(data[0].change_type,'Chemical / substance');assert.equal(data[0].status,'Pending approval');
  assert.equal(data[0].attention,'Overdue');assert.equal(data[1].attention,'—');assert.equal(data[0].impacted_areas,'Training, Chemical / SDS');assert.equal(JSON.stringify(rows),before);
});
test('legacy MOC requests never include generated or migrated linked corrective actions',()=>{
  const r=runtime(),data=r.api.project(rows,current,{legacy:true});
  assert.deepEqual(Array.from(data,x=>x.id),['legacy']);assert.equal(data[0].source_table,'action_tracker');assert.equal(data[0].status,'Screening');assert.equal(data[0].change_type,'Process change');assert.equal(data[0].owner,'Old owner');
});
test('tenant, combined search and lifecycle filters remain effective and restored filters are bounded',()=>{
  const r=runtime(),select=filters=>Array.from(r.api.project(rows,current,{filters}),x=>x.id);
  assert.deepEqual(select({search:'Factory',status:'pending_approval'}),['a']);assert.deepEqual(select({search:'safer handling',status:'screening'}),['legacy']);assert.deepEqual(select({search:'Factory',status:'closed'}),[]);
  assert.ok(!select({}).includes('secret'));assert.ok(!select({}).includes('missing'));assert.equal(r.api.project(rows,{companyId:''},{}).length,0);
  assert.equal(r.api.filters({status:'__proto__',search:'a'.repeat(400)}).status,'');assert.equal(r.api.filters({search:'a'.repeat(400)}).search.length,300);
});
test('all canonical lifecycle stages remain distinct, boards do not add approval or drag-write actions',()=>{
  const r=runtime(),stages=['draft','screening','impact_assessment','pending_approval','approved','implementation','verification','closed','rejected','cancelled'];
  const data=r.api.project(stages.map((stage,i)=>({id:String(i),company_id:'co-a',lifecycle_status:stage})),current,{});
  assert.equal(new Set(data.map(x=>x.status)).size,10);r.api.mount({},rows,{});
  assert.deepEqual(Array.from(r.mounted().options.actions,x=>x.key),['open']);assert.deepEqual(Array.from(r.api.definition().views),['list','card','board']);
});
test('explicit open bridge receives correct dedicated or legacy table; arbitrary actions and identities fail',async()=>{
  for(const legacy of [false,true]){
    const r=runtime(),calls=[];r.api.mount({},legacy?rows:rows.slice(0,2),{legacy,openRecord:(...args)=>calls.push(args)});const m=r.mounted();
    await m.options.onAction('open',m.data[0]);assert.equal(calls[0][1],legacy?'action_tracker':'moc_change_requests');assert.equal(calls[0][2].companyId,'co-a');
    await assert.rejects(m.options.onAction('approve',m.data[0]),/outside/);await assert.rejects(m.options.onAction('open',{...m.data[0],source_table:'wrong'}),/outside/);assert.equal(calls.length,1);
  }
});
test('company, account, role, access and sign-in changes prevent callbacks; offline form opening is blocked',async()=>{
  for(const change of [r=>r.identity.company.id='co-b',r=>r.identity.profile.id='other',r=>r.identity.role='viewer',r=>r.deny(),r=>r.signOut()]){
    const r=runtime();let calls=0;r.api.mount({},rows,{openRecord:()=>calls++,onApplyFilters:()=>calls++});const m=r.mounted();change(r);
    await assert.rejects(m.options.onAction('open',m.data[0]),/changed|denied|Sign in/);assert.throws(()=>m.options.onApplyFilters({}),/changed|denied|Sign in/);assert.equal(calls,0);
  }
  const r=runtime();r.api.mount({},rows,{openRecord:()=>assert.fail('No offline editor')});r.window.navigator.onLine=false;await assert.rejects(r.mounted().options.onAction('open',r.mounted().data[0]),/Reconnect/);
});
function loader(){
  const core=read('auris-core.js'),elements=new Map();let company='co-a',role='manager',allowed=true,rendered=0;const pending=[];
  const context={mocData:[],mocListLoadGeneration:0,mocListContext:null,mocLegacyMode:false,ccid:()=>company,prof:{id:'user-a'},activeRole:()=>role,canAccessPage:()=>allowed,cf:()=> '&company_id=eq.'+company,
    document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}},api:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject})),mocRender:()=>rendered++,setupFriendlyMessage:(_,message)=>message};
  vm.runInNewContext(core.slice(core.indexOf('async function loadMOC(){'),core.indexOf('function mocRender(){')),context);
  return {context,pending,elements,rendered:()=>rendered,switchCompany:()=>{company='co-b';},changeRole:()=>{role='viewer';},deny:()=>{allowed=false;}};
}
test('dedicated loader scopes records before metrics/cache; missing table alone selects safe legacy requests',async()=>{
  const r=loader(),p=r.context.loadMOC();r.pending[0].resolve(rows);await p;assert.equal(r.rendered(),1);assert.equal(r.context.mocData.length,5);assert.equal(r.context.mocLegacyMode,false);
  const q=r.context.loadMOC();r.pending[1].reject(Error("Could not find the table 'public.moc_change_requests' in the schema cache"));await new Promise(setImmediate);assert.match(r.pending[2].url,/source_module=eq.moc/);r.pending[2].resolve(rows);await q;
  assert.equal(r.context.mocLegacyMode,true);assert.deepEqual(Array.from(r.context.mocData,x=>x.id),['legacy']);
});
test('permission, network, malformed responses and column errors do not fall back to the legacy store',async()=>{
  for(const message of ['permission denied for table moc_change_requests','Failed to fetch',"Could not find the 'owner_id' column of 'moc_change_requests' in the schema cache",'401 Unauthorized']){
    const r=loader(),p=r.context.loadMOC();r.pending[0].reject(Error(message));await p;assert.equal(r.pending.length,1);assert.equal(r.rendered(),0);assert.equal(r.context.mocListContext,null);assert.equal(r.elements.get('moc-list').innerHTML,message);
  }
  const r=loader(),p=r.context.loadMOC();r.pending[0].resolve({error:'bad'});await p;assert.match(r.elements.get('moc-list').innerHTML,/invalid response/);
});
test('superseded, switched-company or revoked-session responses cannot update cache, mode or view',async()=>{
  for(const change of [r=>r.switchCompany(),r=>r.changeRole(),r=>r.context.prof.id='other',r=>r.deny()]){
    const r=loader(),p=r.context.loadMOC();change(r);r.pending[0].resolve(rows);await p;assert.equal(r.rendered(),0);assert.equal(r.context.mocData.length,0);
  }
  const r=loader(),old=r.context.loadMOC(),latest=r.context.loadMOC();r.pending[1].resolve([rows[1]]);await latest;r.pending[0].reject(Error('relation "public.moc_change_requests" does not exist'));await old;
  assert.equal(r.pending.length,2);assert.deepEqual(Array.from(r.context.mocData,x=>x.id),['b']);assert.equal(r.rendered(),1);assert.equal(r.context.mocLegacyMode,false);
});
test('editor handoff rejects stale load generations and wrong storage identity',()=>{
  const core=read('auris-core.js'),elements={};let options,opened;
  const context={mocData:[rows[0]],mocLegacyMode:false,mocListLoadGeneration:1,mocListContext:{...current,generation:1},ccid:()=>current.companyId,prof:{id:current.userId},activeRole:()=>current.role,canAccessPage:()=>true,mocCanonicalStatus:x=>x||'draft',mocRef:x=>x.moc_ref,mocOpenOverview:id=>{opened=id;},document:{getElementById:id=>elements[id]||(elements[id]={value:''})},window:{AurisMocListWorkspace:{mount:(_,data,value)=>{options=value;}}}};
  vm.runInNewContext(core.slice(core.indexOf('function mocRender(){'),core.indexOf('function mocOpenOverview(')),context);context.mocRender();
  options.openRecord('a','moc_change_requests',current);assert.equal(opened,'a');assert.throws(()=>options.openRecord('a','action_tracker',current),/changed/);
  context.mocListLoadGeneration=2;assert.throws(()=>options.openRecord('a','moc_change_requests',current),/changed/);
});
test('new register is wired before core and required by both release gates without new database writes',()=>{
  const html=read('index.html');assert.ok(html.indexOf('src="auris-moc-list-workspace.js?')<html.indexOf('src="auris-core.js?'));assert.match(html,/id="moc-register-notice"/);
  for(const file of ['sw-assets.js','scripts/verify-staging-acceptance.cjs','scripts/verify-production-smoke.cjs'])assert.match(read(file),/auris-moc-list-workspace\.js/);
  assert.doesNotMatch(read('auris-moc-list-workspace.js'),/\bfetch\(|\bapi\.request\(|\bmocEdit\(|\bmocData\b/);
});
