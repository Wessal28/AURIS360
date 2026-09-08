const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8'),core=read('auris-core.js');
const current={companyId:'co-a',userId:'user-a',role:'manager'};
const config=vm.runInNewContext(core.slice(core.indexOf('const PTW_TYPE_CFG='),core.indexOf('// -- ENTRY POINT',core.indexOf('const PTW_TYPE_CFG=')))+';({types:PTW_TYPE_CFG,statuses:PTW_STATUS_CFG})');
const rows=[
  {id:'a',company_id:'co-a',permit_number:'PTW-2026-001',work_description:'Weld pipe',permit_type_v2:'hot_work',status:'active',work_location:'Factory',permit_issuer_name:'Issuer A',permit_receiver_name:'Receiver A',planned_start:'2026-09-08T08:30:00+04:00',planned_end:'2026-09-08T12:45:00+04:00',risk_level:'high'},
  {id:'b',company_id:'co-a',permit_number:'PTW-2026-002',work_description:'Inspect vessel',permit_type:'confined_space',status:'suspended',location:'Tank',issued_by:'Old issuer',permit_receiver:'Old receiver',planned_end:'2026-09-07T10:00:00Z',priority:'critical'},
  {id:'c',company_id:'co-a',permit_ref:'OLD-REF',work_description:'Finished work',permit_type:'hot_work',status:'completed',planned_end:'2026-08-01T08:00:00Z'},
  {id:'foreign',company_id:'co-b',work_description:'Secret'},{id:'unscoped',work_description:'Unscoped'}
];
function runtime(){
  const identity={company:{id:'co-a'},profile:{id:'user-a'},role:'manager'};let mounted,allowed=true,authenticated=true;
  const window={navigator:{onLine:true},AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>authenticated,current:()=>identity},rbac:{requireAccess:key=>{assert.equal(key,'permit');if(!allowed)throw Error('Access denied');}}},AurisViewEngine:{mount:(host,data,options)=>{mounted={data,options};return mounted;}}};
  vm.runInNewContext(read('auris-permit-list-workspace.js'),window);
  return {api:window.AurisPermitListWorkspace,identity,window,mounted:()=>mounted,deny:()=>{allowed=false;},signOut:()=>{authenticated=false;}};
}
test('projection retains exact permit identity, owner, location, time and risk without writing data',()=>{
  const r=runtime(),before=JSON.stringify(rows),data=r.api.project(rows,current,{...config,filters:{scope:'all'}},new Date('2026-09-08T14:00:00Z'));
  assert.equal(data.length,3);assert.equal(data[0].source_table,'permits');assert.equal(data[0].permit_type,'Hot Work');assert.equal(data[0].status,'Active');assert.equal(data[0].risk,'High');
  assert.equal(data[0].planned_start,rows[0].planned_start);assert.equal(data[0].planned_end,rows[0].planned_end);assert.equal(data[0].attention,'Overdue');
  assert.equal(data[1].issuer,'Old issuer');assert.equal(data[1].receiver,'Old receiver');assert.equal(data[1].location,'Tank');assert.equal(data[1].attention,'—');assert.equal(data[2].reference,'OLD-REF');assert.equal(data[2].attention,'—');assert.equal(JSON.stringify(rows),before);
});
test('active/all, both stored type fields and combined search/status filters are preserved',()=>{
  const r=runtime(),select=filters=>Array.from(r.api.project(rows,current,{...config,filters}),x=>x.id);
  assert.deepEqual(select({}),['a','b']);assert.deepEqual(select({scope:'all',type:'hot_work'}),['a','c']);assert.deepEqual(select({scope:'all',search:'Hot Work',status:'active'}),['a']);
  assert.deepEqual(select({scope:'all',search:'Tank',type:'confined_space',status:'suspended'}),['b']);assert.deepEqual(select({scope:'active',status:'completed'}),[]);assert.deepEqual(select({scope:'all',search:'Old issuer'}),['b']);
  assert.equal(r.api.filters({scope:'invalid',search:'a'.repeat(400),type:'a'.repeat(90)}).scope,'active');assert.equal(r.api.filters({search:'a'.repeat(400)}).search.length,300);assert.equal(r.api.filters({type:'a'.repeat(90)}).type.length,80);
});
test('all eight permit states remain distinct; unknown type/status are not relabelled as safe defaults',()=>{
  const r=runtime(),states=Object.keys(config.statuses),data=r.api.project(states.map((status,i)=>({id:String(i),company_id:'co-a',status})),current,{...config,filters:{scope:'all'}});
  assert.equal(data.length,8);assert.equal(new Set(data.map(x=>x.status)).size,8);
  const unknown=r.api.project([{id:'x',company_id:'co-a',permit_type:'unrecognised',status:'unrecognised'},{id:'y',company_id:'co-a'}],current,{...config,filters:{scope:'all'}});
  assert.equal(unknown[0].permit_type,'unrecognised');assert.equal(unknown[0].status,'unrecognised');assert.equal(unknown[1].risk,'Not recorded');assert.equal(unknown[1].status,'Not recorded');
  assert.equal(r.api.project(rows,{companyId:''},{filters:{scope:'all'}}).length,0);
});
test('shared board is read-only with required permit identity columns and datetime fields',()=>{
  const r=runtime();r.api.mount({},rows,config);const options=r.mounted().options,def=r.api.definition();
  assert.deepEqual(Array.from(options.actions,x=>x.key),['open']);assert.deepEqual(Array.from(def.views),['list','card','board']);assert.equal(options.moduleKey,'permit-to-work');
  assert.deepEqual(Array.from(def.fields.filter(x=>x.required),x=>x.key),['reference','title']);assert.equal(def.fields.find(x=>x.key==='planned_end').type,'datetime');
});
test('open uses only exact projected identity; unavailable, arbitrary and forged actions fail visibly',async()=>{
  const r=runtime(),calls=[];r.api.mount({},rows,{...config,openRecord:(...args)=>calls.push(args)});const m=r.mounted();
  await m.options.onAction('open',m.data[0]);assert.equal(calls[0][0],'a');assert.equal(calls[0][1].companyId,'co-a');
  for(const [key,row] of [['approve',m.data[0]],['open',{...m.data[0],source_table:'risk_assessments'}],['open',{...m.data[0],company_id:'co-b'}],['open',{...m.data[0],id:'foreign'}]])await assert.rejects(m.options.onAction(key,row),/outside/);
  r.api.mount({},rows,{...config,openRecord:()=>{throw Error('Could not open');}});await assert.rejects(r.mounted().options.onAction('open',r.mounted().data[0]),/Could not open/);assert.equal(calls.length,1);
});
test('company, user, role, authentication, access and offline changes prevent opening stale controls',async()=>{
  for(const change of [r=>r.identity.company.id='co-b',r=>r.identity.profile.id='other',r=>r.identity.role='viewer',r=>r.deny(),r=>r.signOut()]){
    const r=runtime();let calls=0;r.api.mount({},rows,{...config,openRecord:()=>calls++,onApplyFilters:()=>calls++});const m=r.mounted();change(r);
    await assert.rejects(m.options.onAction('open',m.data[0]),/changed|denied|Sign in/);assert.throws(()=>m.options.onApplyFilters({}),/changed|denied|Sign in/);assert.equal(calls,0);
  }
  const r=runtime();r.api.mount({},rows,{...config,openRecord:()=>assert.fail('offline')});r.window.navigator.onLine=false;await assert.rejects(r.mounted().options.onAction('open',r.mounted().data[0]),/Reconnect/);
});
function loader(){
  const elements=new Map(),pending=[];let company='co-a',role='manager',allowed=true,rendered=0,simops=0;
  const context={ptwAllData:[],ptwListLoadGeneration:0,ptwListContext:null,ccid:()=>company,prof:{id:'user-a'},activeRole:()=>role,canAccessPage:()=>allowed,
    document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{style:{}});return elements.get(id);}},api:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject})),ptwRenderList:()=>rendered++,ptwCheckSimops:()=>simops++,registerErrorHtml:(_,message)=>message,console:{error:()=>{}}};
  vm.runInNewContext(core.slice(core.indexOf('async function ptwLoadList(){'),core.indexOf('function ptwRenderList(){')),context);
  return {context,elements,pending,rendered:()=>rendered,simops:()=>simops,switchCompany:()=>company='co-b',changeRole:()=>role='viewer',deny:()=>allowed=false};
}
test('loader scopes records before metrics and SIMOPS, clears stale cache and explicitly scopes request',async()=>{
  const r=loader(),p=r.context.ptwLoadList();assert.match(r.pending[0].url,/company_id=eq.co-a/);r.pending[0].resolve(rows);await p;
  assert.equal(r.context.ptwAllData.length,3);assert.equal(r.elements.get('ptw-m3total').textContent,3);assert.equal(r.elements.get('ptw-m3active').textContent,1);assert.equal(r.simops(),1);assert.equal(r.rendered(),1);
  const next=r.context.ptwLoadList();assert.equal(r.context.ptwAllData.length,0);assert.equal(r.context.ptwListContext,null);assert.equal(r.elements.get('ptw-m3total').textContent,'0');assert.equal(r.elements.get('ptw-simops-banner').style.display,'none');r.pending[1].resolve([]);await next;
});
test('permission, network, missing-table and malformed responses leave visible errors, never stale rows',async()=>{
  for(const value of [Error('permission denied'),Error('Failed to fetch'),Error('relation permits does not exist'),{error:'bad'},null]){
    const r=loader(),p=r.context.ptwLoadList();if(value instanceof Error)r.pending[0].reject(value);else r.pending[0].resolve(value);await p;
    assert.equal(r.pending.length,1);assert.equal(r.context.ptwAllData.length,0);assert.equal(r.context.ptwListContext,null);assert.equal(r.rendered(),0);assert.equal(r.simops(),0);assert.match(r.elements.get('ptw-list').innerHTML,/denied|fetch|does not exist|invalid response/);
  }
  const r=loader();r.deny();await r.context.ptwLoadList();assert.equal(r.pending.length,0);
});
test('obsolete loads and changed account/company/role/access cannot update metrics, cache or SIMOPS',async()=>{
  for(const change of [r=>r.switchCompany(),r=>r.changeRole(),r=>r.context.prof.id='other',r=>r.deny()]){
    const r=loader(),p=r.context.ptwLoadList();change(r);r.pending[0].resolve(rows);await p;assert.equal(r.context.ptwAllData.length,0);assert.equal(r.rendered(),0);assert.equal(r.simops(),0);
  }
  const r=loader(),old=r.context.ptwLoadList(),latest=r.context.ptwLoadList();r.pending[1].resolve([rows[1]]);await latest;r.pending[0].reject(Error('Old failure'));await old;
  assert.equal(r.context.ptwAllData[0].id,'b');assert.equal(r.rendered(),1);assert.equal(r.simops(),1);
});
function handoff(){
  const pending=[];let company='co-a',allowed=true,opened;
  const context={ptwAllData:[{...rows[0]}],ptwListContext:{...current,generation:1},ptwListLoadGeneration:1,ptwListViewGeneration:1,ccid:()=>company,prof:{id:'user-a'},activeRole:()=>current.role,canAccessPage:()=>allowed,navigator:{onLine:true},api:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject})),ptwShowDetail:id=>{opened={id,record:context.ptwAllData.find(x=>x.id===id)};}};
  vm.runInNewContext(core.slice(core.indexOf('async function ptwOpenFromRegister('),core.indexOf('// -- DETAIL VIEW',core.indexOf('async function ptwOpenFromRegister('))),context);
  return {context,pending,opened:()=>opened,switchCompany:()=>company='co-b',deny:()=>allowed=false,open:()=>context.ptwOpenFromRegister('a',current,1,1)};
}
test('register handoff refreshes the exact company permit before opening existing specialist controls',async()=>{
  const r=handoff(),p=r.open();assert.match(r.pending[0].url,/company_id=eq.co-a&id=eq.a&limit=1/);r.pending[0].resolve([{...rows[0],status:'suspended'}]);await p;
  assert.equal(r.opened().id,'a');assert.equal(r.opened().record.status,'suspended');
});
test('missing, duplicate, foreign and malformed fresh records cannot open controls',async()=>{
  for(const value of [[],[rows[0],rows[0]],[{...rows[0],company_id:'co-b'}],[{...rows[0],id:'b'}],[null],{}]){
    const r=handoff(),p=r.open();r.pending[0].resolve(value);await assert.rejects(p,/unavailable|outside/);assert.equal(r.opened(),undefined);
  }
  const r=handoff();await assert.rejects(r.context.ptwOpenFromRegister('a&company_id=eq.other',current,1,1),/outside/);assert.equal(r.pending.length,0);
});
test('in-flight handoff is invalidated by new views, loads, sessions, permissions and offline state',async()=>{
  for(const change of [r=>r.context.ptwListViewGeneration++,r=>r.context.ptwListLoadGeneration++,r=>r.switchCompany(),r=>r.context.prof.id='other',r=>r.deny(),r=>r.context.navigator.onLine=false]){
    const r=handoff(),p=r.open();change(r);r.pending[0].resolve([rows[0]]);await assert.rejects(p,/changed|Reconnect/);assert.equal(r.opened(),undefined);
  }
});
test('restored saved filters update all controls and both active-scope navigation surfaces',()=>{
  const elements={},views=[];let mounted,handoffArgs;
  const context={ptwAllData:rows,ptwListContext:{...current,generation:3},ptwListLoadGeneration:3,ptwListViewGeneration:0,ptwActiveFilter:'active',ccid:()=>current.companyId,prof:{id:current.userId},activeRole:()=>current.role,canAccessPage:()=>true,PTW_TYPE_CFG:config.types,PTW_STATUS_CFG:config.statuses,
    document:{getElementById:id=>elements[id]||(elements[id]={value:'',style:{}}),querySelectorAll:()=>[]},window:{AurisModuleLayout:{setView:(...args)=>views.push(args)},AurisPermitListWorkspace:{mount:(_,data,options)=>mounted=options}},ptwOpenFromRegister:(...args)=>handoffArgs=args};
  vm.runInNewContext(core.slice(core.indexOf('function ptwFilterSet('),core.indexOf('async function ptwLoadList('))+core.slice(core.indexOf('function ptwRenderList(){'),core.indexOf('async function ptwOpenFromRegister(')),context);
  context.ptwRenderList();mounted.onApplyFilters({scope:'all',search:'tank',type:'confined_space',status:'rejected'});
  assert.equal(context.ptwActiveFilter,'all');assert.equal(elements['ptw-search'].value,'tank');assert.equal(elements['ptw-filter-type'].value,'confined_space');assert.equal(elements['ptw-filter-status'].value,'rejected');assert.equal(views.at(-1)[1],'all');
  mounted.openRecord('a',current);assert.equal(handoffArgs[2],3);assert.equal(handoffArgs[3],2);
});
test('release wiring requires the adapter and preserves established permit controls',()=>{
  const html=read('index.html');assert.ok(html.indexOf('src="auris-permit-list-workspace.js?')<html.indexOf('src="auris-core.js?'));
  const section=html.slice(html.indexOf('id="ptw-filter-status"'),html.indexOf('<!-- SIMOPS Alert banner -->'));assert.match(section,/<option value="rejected">Rejected/);
  for(const file of ['sw-assets.js','scripts/verify-staging-acceptance.cjs','scripts/verify-production-smoke.cjs'])assert.match(read(file),/auris-permit-list-workspace\.js/);
  assert.doesNotMatch(read('auris-permit-list-workspace.js'),/\bfetch\(|\bapi\.request\(|\bptwAllData\b|m:'(?:POST|PATCH|DELETE)'/);
  for(const fn of ['ptwCheckSimops','ptwRenderActionButtons','ptwRenderGasHistory','ptwRenderIsolationList','ptwRenderApprovalStatus'])assert.ok(core.includes('function '+fn+'('));
  const print=core.slice(core.indexOf('function printRegisterView('),core.indexOf('function chemPrintRegister('));assert.ok(print.indexOf('AurisViewEngine.preparePrint(clone)')<print.indexOf("clone.querySelectorAll('button"));
});
