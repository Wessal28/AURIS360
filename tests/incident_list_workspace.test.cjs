const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const current={companyId:'co-a',userId:'user-a',name:'Reporter',role:'manager'};
const rows=[
  {id:'inc-1',company_id:'co-a',event_ref:'INC-2026-001',event_type:'injury',event_date:'2026-09-10',location:'Workshop',department:'Production',description:'Hand injury at press',severity:'high',potential_severity:'critical',status:'under_investigation',investigation_required:true,investigation_ref:'INV-1',reported_by_name:'Reporter',evidence_count:2},
  {id:'inc-2',company_id:'co-a',incident_number:'INC-2026-002',event_type:'near_miss',event_date:'2026-07-12',location:'Warehouse',business_unit:'Stores',description:'Forklift near miss',severity:'medium',status:'closed',reported_by_name:'Other'},
  {id:'inc-3',company_id:'co-a',event_type:'unrecognised',created_at:'2026-09-01T10:00:00Z',status:'submitted'},
  {id:'foreign',company_id:'co-b',event_type:'injury',description:'Secret'}
];
function runtime(){
  const identity={company:{id:'co-a'},profile:{id:'user-a',full_name:'Reporter'},role:'manager'};let mounted,allowed=true,authenticated=true;
  const window={Date,Number,navigator:{onLine:true},AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>authenticated,current:()=>identity},rbac:{requireAccess:key=>{assert.equal(key,'events');if(!allowed)throw Error('Access denied');}}},AurisViewEngine:{mount:(host,data,options)=>{mounted={data,options};return mounted;}}};
  vm.runInNewContext(read('auris-incident-list-workspace.js'),window);
  return {api:window.AurisIncidentListWorkspace,identity,mounted:()=>mounted,deny:()=>{allowed=false;},signOut:()=>{authenticated=false;},window};
}
test('projection is tenant scoped and preserves incident meaning',()=>{
  const r=runtime(),data=r.api.project(rows,current,{filters:{range:'all'}},new Date('2026-09-15T12:00:00Z'));
  assert.deepEqual(data.map(x=>x.id),['inc-1','inc-2','inc-3']);assert.equal(data[0].reference,'INC-2026-001');assert.equal(data[0].type,'Injury');assert.equal(data[0].actual_severity,'High');assert.equal(data[0].potential_severity,'Critical');assert.equal(data[0].investigation,'INV-1');assert.equal(data[0].attention,'High potential');assert.equal(data[0].evidence_count,2);
});
test('incident filters combine type severity status site department and date range',()=>{
  const r=runtime(),select=filters=>r.api.project(rows,current,{filters},new Date('2026-09-15T12:00:00Z')).map(x=>x.id);
  assert.deepEqual(select({range:'year'}),['inc-1','inc-2','inc-3']);assert.deepEqual(select({range:'month'}),['inc-1','inc-3']);assert.deepEqual(select({range:'30'}),['inc-1','inc-3']);assert.deepEqual(select({range:'all',type:'near_miss',severity:'medium',status:'closed',site:'Warehouse',department:'Stores'}),['inc-2']);assert.deepEqual(select({range:'all',search:'forklift'}),['inc-2']);
});
test('unknown incident values remain visible and are labelled safely',()=>{
  const r=runtime(),data=r.api.project(rows,current,{filters:{range:'all'}});assert.equal(data[2].type,'unrecognised');assert.equal(data[2].status,'Submitted');assert.equal(data[2].actual_severity,'Not assessed');
});
test('shared incident register exposes only exact read-only opening and protects sessions',async()=>{
  const r=runtime(),calls=[];r.api.mount({},rows,{filters:{range:'all'},openRecord:(id,context)=>calls.push([id,context.companyId])});const m=r.mounted();assert.equal(m.options.moduleKey,'incident-management');assert.deepEqual(Array.from(m.options.actions,x=>x.key),['open']);await m.options.onAction('open',m.data[0]);assert.deepEqual(calls,[['inc-1','co-a']]);
  for(const change of [x=>x.identity.company.id='co-b',x=>x.identity.profile.id='other',x=>x.identity.role='viewer',x=>x.deny(),x=>x.signOut()]){const x=runtime();x.api.mount({},rows,{openRecord:()=>assert.fail('stale action')});const view=x.mounted();change(x);await assert.rejects(view.options.onAction('open',view.data[0]),/changed|denied|Sign in/);}
});
test('release wiring publishes the incident register before the core loader',()=>{
  const html=read('index.html'),core=read('auris-core.js');assert.ok(html.indexOf('auris-incident-list-workspace.js?')<html.indexOf('auris-core.js?'));assert.match(core,/AurisIncidentListWorkspace\.mount\(el,imsAllData/);assert.match(read('sw-assets.js'),/auris-incident-list-workspace\.js/);assert.match(read('scripts/verify-production-smoke.cjs'),/auris-incident-list-workspace\.js/);assert.match(read('scripts/verify-staging-acceptance.cjs'),/auris-incident-list-workspace\.js/);assert.doesNotMatch(read('auris-incident-list-workspace.js'),/\bfetch\(|\bapi\.request\(|\bPOST|\bPATCH|\bDELETE/);
});
