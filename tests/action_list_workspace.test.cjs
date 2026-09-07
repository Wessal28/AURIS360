const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const current={companyId:'co-a',userId:'user-a',name:'Reviewer',role:'manager'};
const rows=[
  {id:'a',company_id:'co-a',action_ref:'MAP-CA-2026-001',title:'Inspect guard',description:'Machine evidence',source_ref:'INC-1',source_type:'incident',priority:'high',status:'pending_verification',action_type:'corrective',assigned_to_name:'Reviewer',target_date:'2026-08-01',progress_pct:120,escalated:true},
  {id:'b',company_id:'co-a',title:'New training',priority:'low',status:'pending_closure',action_type:'preventive',assigned_to_id:'user-a',target_date:'2026-12-01'},
  {id:'c',company_id:'co-a',title:'Other work',priority:'medium',status:'closed',assigned_to_name:'Other'},
  {id:'secret',company_id:'co-b',title:'Secret'},{id:'missing',title:'Unscoped'}
];
function runtime(){
  const identity={company:{id:'co-a'},profile:{id:'user-a',full_name:'Reviewer'},role:'manager'};let mounted,allowed=true;
  const window={Date,AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>true,current:()=>identity},rbac:{requireAccess:()=>{if(!allowed)throw Error('Access denied');}}},
    AurisViewEngine:{mount:(host,data,options)=>{mounted={data,options};return mounted;}}};
  vm.runInNewContext(read('auris-action-list-workspace.js'),window);
  return {api:window.AurisActionListWorkspace,identity,mounted:()=>mounted,deny:()=>{allowed=false;}};
}
test('projection preserves source identity, semantic labels, dates, progress and attention without mutating records',()=>{
  const r=runtime(),before=JSON.stringify(rows),data=r.api.project(rows,current,{sources:{incident:{label:'Incident'}},statuses:{pending_verification:{label:'Pending Verification'}},reference:row=>row.action_ref||row.id},new Date('2026-09-08T12:00:00'));
  assert.equal(data.length,3);assert.equal(data[0].source_ref,'INC-1');assert.equal(data[0].id,'a');assert.equal(data[0].source,'Incident');
  assert.equal(data[0].status,'Pending Verification');assert.equal(data[0].progress,100);assert.match(data[0].attention,/overdue.*Escalated/);assert.equal(JSON.stringify(rows),before);
});
test('every existing scope and combinable filter still affects the shared rows',()=>{
  const r=runtime(),select=filters=>Array.from(r.api.project(rows,current,{filters},new Date('2026-09-08')),x=>x.id);
  assert.deepEqual(select({scope:'mine'}),['a','b']);assert.deepEqual(select({scope:'overdue'}),['a']);
  assert.deepEqual(select({scope:'verify'}),['a']);assert.deepEqual(select({scope:'closure'}),['b']);
  assert.deepEqual(select({search:'INC-1',source:'incident',priority:'high',status:'pending_verification',type:'corrective'}),['a']);
  assert.deepEqual(select({search:'machine evidence'}),['a']);assert.deepEqual(select({type:'preventive',priority:'high'}),[]);
});
test('missing user name never makes Assigned to Me match every action',()=>{
  const r=runtime(),data=r.api.project(rows,{...current,name:''},{filters:{scope:'mine'}});
  assert.deepEqual(Array.from(data,x=>x.id),['b']);
});
test('open actions and source links call only the explicit legacy bridges with exact identity',async()=>{
  const r=runtime(),calls=[];r.api.mount({},rows,{openRecord:(id,context)=>calls.push(['open',id,context.companyId]),openSource:(id,context)=>calls.push(['source',id,context.companyId])});
  const m=r.mounted();await m.options.onAction('open',m.data[0]);await m.options.onAction('source',m.data[0]);
  assert.deepEqual(calls,[['open','a','co-a'],['source','a','co-a']]);
  assert.equal(m.options.actions[1].when(m.data[1]),false);
  await assert.rejects(m.options.onAction('approve',m.data[0]),/unavailable/);
});
test('company, profile, role or permissions changed after mount block all callbacks',async()=>{
  for(const change of [r=>r.identity.company.id='co-b',r=>r.identity.profile.id='other',r=>r.identity.role='viewer',r=>r.deny()]){
    const r=runtime();let calls=0;r.api.mount({},rows,{openRecord:()=>calls++,onApplyFilters:()=>calls++});const m=r.mounted();change(r);
    await assert.rejects(m.options.onAction('open',m.data[0]),/changed|denied/);
    assert.throws(()=>m.options.onApplyFilters({}),/changed|denied/);assert.equal(calls,0);
  }
});
test('action loader ignores superseded or switched-company responses before metrics, cache or backfill',async()=>{
  const core=read('auris-core.js'),code=core.slice(core.indexOf('async function mapLoadList(){'),core.indexOf('function mapActionTypeCode('));
  let release,company='co-a',rendered=0,backfilled=0;
  const context={mapListLoadGeneration:0,mapAllData:[],ccid:()=>company,prof:{id:'user-a'},activeRole:()=> 'manager',canAccessPage:()=>true,
    document:{getElementById:()=>({innerHTML:'',style:{}})},cf:()=>'',api:()=>new Promise(resolve=>{release=resolve;}),mapRenderList:()=>rendered++,mapQueueRefBackfill:()=>backfilled++};
  vm.runInNewContext(code,context);
  const load=context.mapLoadList();company='co-b';release(rows);await load;assert.equal(rendered,0);assert.equal(backfilled,0);assert.deepEqual(context.mapAllData,[]);
  company='co-a';const load2=context.mapLoadList();release([]);await load2;assert.equal(rendered,1);assert.equal(backfilled,1);
});
test('load wiring, semantic record actions, shared scope navigation and release gates are present',()=>{
  const html=read('index.html'),core=read('auris-core.js');
  assert.ok(html.indexOf('src="auris-view-engine.js?')<html.indexOf('src="auris-action-list-workspace.js?'));
  assert.ok(html.indexOf('src="auris-action-list-workspace.js?')<html.indexOf('src="auris-core.js?'));
  assert.match(core,/AurisActionListWorkspace\.mount\(el,mapAllData/);
  assert.match(core,/openRecord:function\(id\)\{return mapOpenDetail\(id\);\}/);
  assert.match(core,/return mapOpenSourceRecord\(id,expected\)/);
  assert.match(core,/AurisModuleLayout\.setView\('actions',view\)/);
  assert.match(read('sw-assets.js'),/auris-action-list-workspace\.js/);
  assert.match(read('scripts/verify-production-smoke.cjs'),/auris-action-list-workspace\.js/);
  assert.doesNotThrow(()=>new vm.Script(read('scripts/release-readiness.cjs')));
  assert.doesNotMatch(read('auris-action-list-workspace.js'),/\bfetch\(|\bapi\.request\(|\bmapEdit\(|\bmapAllData\b/);
});
