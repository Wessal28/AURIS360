const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const current={companyId:'co-a',userId:'user-a',name:'Reviewer',role:'manager'};
const rows=[
  {id:'ra-1',company_id:'co-a',ra_ref:'RA-2026-001',title:'Machine guarding',activity:'Press operation',location:'Workshop',department:'Production',assessed_by:'Reviewer',assessed_by_id:'user-a',ra_type_v2:'task',status:'active',review_date:'2026-09-01',overall_risk_level:'High',overall_risk_score:12,rows:[{rr:12,rl:'Very High',res_rr:4,res_rl:'Medium'}],permit_ref:'PTW-1'},
  {id:'ra-2',company_id:'co-a',ra_ref:'RA-2026-002',title:'Chemical storage',activity:'Solvent store',location:'Warehouse',department:'Stores',assessed_by:'Other assessor',ra_type:'baseline',status:'review',review_date:'2026-10-01',overall_risk_level:'Medium',overall_risk_score:6,rows:[{rr:6,rl:'High',res_rr:2,res_rl:'Low'}]},
  {id:'ra-3',company_id:'co-a',title:'Archived task',ra_type_v2:'task',status:'archived',review_date:'2026-01-01',overall_risk_level:'Critical',overall_risk_score:20},
  {id:'foreign',company_id:'co-b',title:'Secret',status:'active'},
  {id:'unscoped',title:'Unscoped',status:'active'}
];
function runtime(){
  const identity={company:{id:'co-a'},profile:{id:'user-a',full_name:'Reviewer'},role:'manager'};let mounted,allowed=true,authenticated=true;
  const window={Date,navigator:{onLine:true},AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>authenticated,current:()=>identity},rbac:{requireAccess:key=>{assert.equal(key,'risk');if(!allowed)throw Error('Access denied');}}},AurisViewEngine:{mount:(host,data,options)=>{mounted={data,options};return mounted;}}};
  vm.runInNewContext(read('auris-risk-list-workspace.js'),window);
  return {api:window.AurisRiskListWorkspace,identity,mounted:()=>mounted,deny:()=>{allowed=false;},signOut:()=>{authenticated=false;},window};
}
test('projection is tenant-scoped and keeps risk, review and linked-record meaning',()=>{
  const r=runtime(),before=JSON.stringify(rows),data=r.api.project(rows,current,{filters:{scope:'all'}},new Date('2026-09-15T12:00:00Z'));
  assert.deepEqual(data.map(x=>x.id),['ra-1','ra-2','ra-3']);assert.equal(data[0].reference,'RA-2026-001');assert.equal(data[0].type,'Task-based');
  assert.equal(data[0].initial_risk,'High');assert.equal(data[0].residual_risk,'Medium');assert.equal(data[0].attention,'Overdue');assert.match(data[0].linked_records,/PTW-1/);assert.equal(data[1].attention,'Due soon');assert.equal(JSON.stringify(rows),before);
});
test('scope and combinable filters cover personal work, due reviews, high risk and text',()=>{
  const r=runtime(),select=filters=>r.api.project(rows,current,{filters},new Date('2026-09-15T12:00:00Z')).map(x=>x.id);
  assert.deepEqual(select({scope:'mine'}),['ra-1']);assert.deepEqual(select({scope:'due'}),['ra-1','ra-2']);assert.deepEqual(select({scope:'high'}),['ra-1','ra-3']);
  assert.deepEqual(select({search:'solvent',type:'baseline',status:'review',risk:'Medium'}),['ra-2']);assert.deepEqual(select({type:'task',status:'active'}),['ra-1']);
});
test('unknown statuses and types remain visible without unsafe relabelling',()=>{
  const r=runtime(),data=r.api.project([{id:'x',company_id:'co-a',ra_type_v2:'unrecognised',status:'unrecognised'}],current,{filters:{scope:'all'}});
  assert.equal(data.length,1);assert.equal(data[0].type,'unrecognised');assert.equal(data[0].status,'unrecognised');assert.equal(data[0].initial_risk,'Not recorded');
});
test('shared register exposes only the exact open action and protects session changes',async()=>{
  const r=runtime(),calls=[];r.api.mount({},rows,{filters:{scope:'all'},openRecord:(id,context)=>calls.push([id,context.companyId])});const m=r.mounted();assert.equal(m.options.moduleKey,'risk-assessment');assert.deepEqual(Array.from(m.options.actions,x=>x.key),['open']);await m.options.onAction('open',m.data[0]);assert.deepEqual(calls,[['ra-1','co-a']]);
  for(const change of [x=>x.identity.company.id='co-b',x=>x.identity.profile.id='other',x=>x.identity.role='viewer',x=>x.deny(),x=>x.signOut()]){const x=runtime();x.api.mount({},rows,{openRecord:()=>assert.fail('stale action')});const view=x.mounted();change(x);await assert.rejects(view.options.onAction('open',view.data[0]),/changed|denied|Sign in/);}
});
test('release wiring publishes the risk register before the core loader',()=>{
  const html=read('index.html'),core=read('auris-core.js'),upgrade=read('risk-assessment-upgrade.js');assert.ok(html.indexOf('auris-risk-list-workspace.js?')<html.indexOf('auris-core.js?'));assert.match(core,/AurisRiskListWorkspace\.mount\(el,raAllData/);assert.match(upgrade,/AurisRiskListWorkspace\.mount\(el,data\(\)/);assert.match(upgrade,/scope:\['mine','due','high'\]/);assert.match(read('sw-assets.js'),/auris-risk-list-workspace\.js/);assert.match(read('scripts/verify-production-smoke.cjs'),/auris-risk-list-workspace\.js/);assert.match(read('scripts/verify-staging-acceptance.cjs'),/auris-risk-list-workspace\.js/);assert.doesNotMatch(read('auris-risk-list-workspace.js'),/\bfetch\(|\bapi\.request\(|\bPOST|\bPATCH|\bDELETE/);
});
