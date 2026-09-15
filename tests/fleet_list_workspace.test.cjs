const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const current={companyId:'co-a',userId:'user-a',name:'Reviewer',role:'manager'};
const vehicles=[
  {id:'veh-1',company_id:'co-a',registration_number:'DXB-001',ref_number:'FLEET-1',name:'Site pickup',brand:'Toyota',model:'Hilux',vehicle_type:'Light vehicle',assigned_to_name:'Alice',location:'Main site',status:'active',updated_at:'2026-09-10T10:00:00Z'},
  {id:'veh-2',company_id:'co-a',registration_number:'DXB-002',name:'Delivery van',brand:'Ford',model:'Transit',vehicle_type:'Van',location:'Warehouse',status:'maintenance'},
  {id:'veh-3',company_id:'co-a',registration_number:'DXB-003',name:'Mobile crane',vehicle_type:'Plant',status:'out_of_service'},
  {id:'foreign',company_id:'co-b',registration_number:'SECRET',name:'Other company vehicle',status:'active'},
  {id:'unscoped',registration_number:'NONE',name:'Unscoped vehicle',status:'active'}
];
const inspections=[{tool_id:'veh-1',inspection_date:'2026-08-01',overall_result:'pass'},{tool_id:'veh-2',inspection_date:'2026-08-20',overall_result:'pass'}];
const fuel=[{vehicle_equipment:'DXB-001',quantity:40},{vehicle_equipment:'DXB-001',quantity:12.5},{vehicle_equipment:'DXB-002',quantity:8}];
const incidents=[{event_type:'vehicle_incident',vehicle_reg:'DXB-001',description:'Mirror damaged'},{event_type:'general_observation',description:'DXB-002 mentioned'}];
function runtime(){
  const identity={company:{id:'co-a'},profile:{id:'user-a',full_name:'Reviewer'},role:'manager'};let mounted,allowed=true,authenticated=true;
  const window={Date,navigator:{onLine:true},AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>authenticated,current:()=>identity},rbac:{requireAccess:key=>{assert.equal(key,'fleet');if(!allowed)throw Error('Access denied');}}},AurisViewEngine:{mount:(host,data,options)=>{mounted={data,options};return mounted;}}};
  vm.runInNewContext(read('auris-fleet-list-workspace.js'),window);
  return {api:window.AurisFleetListWorkspace,identity,mounted:()=>mounted,deny:()=>{allowed=false;},signOut:()=>{authenticated=false;},window};
}
test('projection is tenant scoped and preserves vehicle, check, fuel and incident meaning',()=>{
  const r=runtime(),before=JSON.stringify(vehicles),data=r.api.project(vehicles,current,{inspections,fuel,incidents},new Date('2026-09-15T12:00:00Z'));
  assert.deepEqual(data.map(x=>x.id),['veh-1','veh-2','veh-3']);assert.equal(data[0].reference,'DXB-001');assert.equal(data[0].check,'Overdue');assert.equal(data[0].fuel_total,52.5);assert.equal(data[0].fuel_entries,2);assert.equal(data[0].incidents,1);assert.equal(data[1].check,'Due soon');assert.equal(data[2].check,'Never checked');assert.equal(JSON.stringify(vehicles),before);
});
test('fleet filters combine search, status and check state',()=>{
  const r=runtime(),select=filters=>r.api.project(vehicles,current,{filters,inspections,fuel,incidents},new Date('2026-09-15T12:00:00Z')).map(x=>x.id);
  assert.deepEqual(select({status:'maintenance'}),['veh-2']);assert.deepEqual(select({check:'overdue'}),['veh-1','veh-3']);assert.deepEqual(select({check:'due_soon'}),['veh-2']);assert.deepEqual(select({check:'with_incidents'}),['veh-1']);assert.deepEqual(select({search:'hilux',status:'active'}),['veh-1']);
});
test('unknown vehicle status remains visible without unsafe relabelling',()=>{const r=runtime(),data=r.api.project([{id:'x',company_id:'co-a',registration_number:'X',status:'awaiting_service'}],current,{});assert.equal(data.length,1);assert.equal(data[0].status,'awaiting service');});
test('shared fleet register exposes guarded open, check and edit actions',async()=>{
  const r=runtime(),calls=[];r.api.mount({},vehicles,{inspections,fuel,incidents,canEdit:true,openRecord:(id,c)=>calls.push(['open',id,c.companyId]),checkRecord:(id,c)=>calls.push(['check',id,c.companyId]),editRecord:(id,c)=>calls.push(['edit',id,c.companyId])});const m=r.mounted();assert.equal(m.options.moduleKey,'fleet-management');assert.deepEqual(Array.from(m.options.actions,x=>x.key),['open','check','edit']);await m.options.onAction('open',m.data[0]);await m.options.onAction('check',m.data[0]);await m.options.onAction('edit',m.data[0]);assert.deepEqual(calls,[['open','veh-1','co-a'],['check','veh-1','co-a'],['edit','veh-1','co-a']]);
  for(const change of [x=>x.identity.company.id='co-b',x=>x.identity.profile.id='other',x=>x.identity.role='viewer',x=>x.deny(),x=>x.signOut()]){const x=runtime();x.api.mount({},vehicles,{inspections,fuel,incidents,canEdit:true,openRecord:()=>assert.fail('stale action')});const view=x.mounted();change(x);await assert.rejects(view.options.onAction('open',view.data[0]),/changed|denied|Sign in/);}
});
test('release wiring publishes the fleet register before the core loader',()=>{const html=read('index.html'),core=read('auris-core.js');assert.ok(html.indexOf('auris-fleet-list-workspace.js?')<html.indexOf('auris-core.js?'));assert.match(core,/AurisFleetListWorkspace\.mount\(el,fleetVehicles/);assert.match(read('sw-assets.js'),/auris-fleet-list-workspace\.js/);assert.match(read('scripts/verify-production-smoke.cjs'),/auris-fleet-list-workspace\.js/);assert.match(read('scripts/verify-staging-acceptance.cjs'),/auris-fleet-list-workspace\.js/);assert.doesNotMatch(read('auris-fleet-list-workspace.js'),/\bfetch\(|\bapi\.request\(|\bPOST|\bPATCH|\bDELETE/);});
