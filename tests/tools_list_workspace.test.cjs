const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const current={companyId:'co-a',userId:'user-a',name:'Reviewer',role:'manager'};
const rows=[
  {id:'eq-1',company_id:'co-a',ref_number:'EQ-001',name:'Press drill',category:'power_tool',brand:'Auris',model:'PD-1',serial_number:'SN-1',location:'Workshop',assigned_to_name:'General use',status:'active',inspection_frequency:'weekly',requires_statutory:false,updated_at:'2026-09-12T10:00:00Z'},
  {id:'eq-2',company_id:'co-a',ref_number:'EQ-002',name:'Access ladder',category:'equipment',location:'Warehouse',status:'out_of_service',inspection_frequency:'monthly',requires_statutory:true,next_statutory_date:'2026-09-20',updated_at:'2026-09-01T10:00:00Z'},
  {id:'eq-3',company_id:'co-a',ref_number:'EQ-003',name:'Portable generator',category:'electrical',location:'Site B',status:'active',inspection_frequency:'annual',requires_statutory:true,next_statutory_date:'2027-01-20'},
  {id:'foreign',company_id:'co-b',name:'Secret equipment',category:'hand_tool',status:'active'}
];
const inspections={'eq-1':{inspection_date:'2026-09-10',overall_result:'pass'},'eq-2':{inspection_date:'2026-07-01',overall_result:'fail'}};
function runtime(){
  const identity={company:{id:'co-a'},profile:{id:'user-a',full_name:'Reviewer'},role:'manager'};let mounted,allowed=true,authenticated=true;
  const window={Date,navigator:{onLine:true},AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>authenticated,current:()=>identity},rbac:{requireAccess:key=>{assert.equal(key,'tools');if(!allowed)throw Error('Access denied');}}},AurisViewEngine:{mount:(host,data,options)=>{mounted={data,options};return mounted;}}};
  vm.runInNewContext(read('auris-tools-list-workspace.js'),window);
  return {api:window.AurisToolsListWorkspace,identity,mounted:()=>mounted,deny:()=>{allowed=false;},signOut:()=>{authenticated=false;},window};
}
test('projection is tenant scoped and keeps equipment readiness meaning',()=>{
  const r=runtime(),data=r.api.project(rows,current,{filters:{inspection:''},inspections},new Date('2026-09-15T12:00:00Z'));
  assert.deepEqual(data.map(x=>x.id),['eq-1','eq-2','eq-3']);assert.equal(data[0].reference,'EQ-001');assert.equal(data[0].category,'Power tool');assert.equal(data[0].serial_model,'SN-1 / PD-1');assert.equal(data[0].inspection,'Due soon');assert.equal(data[1].inspection,'Overdue');assert.match(data[1].statutory,/Due by/);
});
test('equipment filters combine category, status, inspection state and text',()=>{
  const r=runtime(),select=filters=>r.api.project(rows,current,{filters,inspections},new Date('2026-09-15T12:00:00Z')).map(x=>x.id);
  assert.deepEqual(select({inspection:'overdue'}),['eq-2','eq-3']);assert.deepEqual(select({inspection:'never'}),['eq-3']);assert.deepEqual(select({category:'electrical',status:'active'}),['eq-3']);assert.deepEqual(select({search:'workshop'}),['eq-1']);assert.deepEqual(select({search:'ladder',status:'out_of_service'}),['eq-2']);assert.deepEqual(select({inspection:'statutory_due'}),['eq-2']);
});
test('unknown equipment values remain visible and are labelled safely',()=>{
  const r=runtime(),data=r.api.project([{id:'x',company_id:'co-a',category:'special_asset',status:'awaiting_release'}],current,{filters:{}},new Date('2026-09-15T12:00:00Z'));
  assert.equal(data.length,1);assert.equal(data[0].category,'special asset');assert.equal(data[0].status,'awaiting release');assert.equal(data[0].inspection,'Never inspected');
});
test('shared equipment register exposes exact actions and protects sessions',async()=>{
  const r=runtime(),calls=[];r.api.mount({},rows,{inspections,canEdit:true,openRecord:(id,c)=>calls.push(['open',id,c.companyId]),inspectRecord:(id,c)=>calls.push(['inspect',id,c.companyId]),editRecord:(id,c)=>calls.push(['edit',id,c.companyId])});const m=r.mounted();assert.equal(m.options.moduleKey,'tools-equipment');assert.deepEqual(Array.from(m.options.actions,x=>x.key),['open','inspect','edit']);await m.options.onAction('open',m.data[0]);await m.options.onAction('inspect',m.data[0]);await m.options.onAction('edit',m.data[0]);assert.deepEqual(calls,[['open','eq-1','co-a'],['inspect','eq-1','co-a'],['edit','eq-1','co-a']]);
  for(const change of [x=>x.identity.company.id='co-b',x=>x.identity.profile.id='other',x=>x.identity.role='viewer',x=>x.deny(),x=>x.signOut()]){const x=runtime();x.api.mount({},rows,{inspections,canEdit:true,openRecord:()=>assert.fail('stale action')});const view=x.mounted();change(x);await assert.rejects(view.options.onAction('open',view.data[0]),/changed|denied|Sign in/);}
});
test('release wiring publishes the equipment register before the core loader',()=>{
  const html=read('index.html'),core=read('auris-core.js');assert.ok(html.indexOf('auris-tools-list-workspace.js?')<html.indexOf('auris-core.js?'));assert.match(core,/AurisToolsListWorkspace\.mount\(el,toolsAllData/);assert.match(read('sw-assets.js'),/auris-tools-list-workspace\.js/);assert.match(read('scripts/verify-production-smoke.cjs'),/auris-tools-list-workspace\.js/);assert.match(read('scripts/verify-staging-acceptance.cjs'),/auris-tools-list-workspace\.js/);assert.doesNotMatch(read('auris-tools-list-workspace.js'),/\bfetch\(|\bapi\.request\(|\bPOST|\bPATCH|\bDELETE/);
});
