const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const current={companyId:'co-a',userId:'user-a',name:'Reviewer',role:'manager'};
const rows=[
  {id:'con-1',company_id:'co-a',contractor_name:'Alpha Electrical',trading_name:'Alpha',registration_number:'BRN-1',category:'electrical',specialisation:'HV maintenance',contact_person:'Alice',contact_email:'alice@example.test',contact_phone:'555-0101',status:'approved',insurance_expiry:'2026-10-01',expiry_date:'2026-12-31',next_review_date:'2026-11-20',updated_at:'2026-09-10T10:00:00Z'},
  {id:'con-2',company_id:'co-a',contractor_name:'Beta Civil',category:'civil',specialisation:'Groundworks',contact_person:'Bob',status:'pending',insurance_expiry:null,expiry_date:'2026-08-01',next_review_date:'2026-08-15'},
  {id:'con-3',company_id:'co-a',contractor_name:'Gamma Mechanical',category:'mechanical',status:'suspended',insurance_expiry:'2026-12-01',expiry_date:'2026-12-01',next_review_date:'2027-01-01'},
  {id:'foreign',company_id:'co-b',contractor_name:'Secret contractor',status:'approved'},
  {id:'unscoped',contractor_name:'Unscoped contractor',status:'approved'}
];
function runtime(){
  const identity={company:{id:'co-a'},profile:{id:'user-a',full_name:'Reviewer'},role:'manager'};let mounted,allowed=true,authenticated=true;
  const window={Date,navigator:{onLine:true},AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>authenticated,current:()=>identity},rbac:{requireAccess:key=>{assert.equal(key,'contractor');if(!allowed)throw Error('Access denied');}}},AurisViewEngine:{mount:(host,data,options)=>{mounted={data,options};return mounted;}}};
  vm.runInNewContext(read('auris-contractor-list-workspace.js'),window);
  return {api:window.AurisContractorListWorkspace,identity,mounted:()=>mounted,deny:()=>{allowed=false;},signOut:()=>{authenticated=false;},window};
}
test('projection is tenant scoped and exposes contractor compliance fields',()=>{
  const r=runtime(),before=JSON.stringify(rows),data=r.api.project(rows,current,{},new Date('2026-09-15T12:00:00Z'));
  assert.deepEqual(data.map(x=>x.id),['con-1','con-2','con-3']);assert.equal(data[0].reference,'BRN-1');assert.equal(data[0].category,'Electrical');assert.equal(data[0].status,'Approved');assert.equal(data[0].attention,'Due soon');assert.equal(data[1].attention,'Expired');assert.equal(JSON.stringify(rows),before);
});
test('search, category, status and compliance filters combine safely',()=>{
  const r=runtime(),select=filters=>r.api.project(rows,current,{filters},new Date('2026-09-15T12:00:00Z')).map(x=>x.id);
  assert.deepEqual(select({category:'electrical'}),['con-1']);assert.deepEqual(select({status:'pending'}),['con-2']);assert.deepEqual(select({compliance:'expired'}),['con-2']);assert.deepEqual(select({compliance:'missing_insurance'}),['con-2']);assert.deepEqual(select({compliance:'review_due'}),['con-2']);assert.deepEqual(select({search:'HV',category:'electrical',status:'approved'}),['con-1']);
});
test('unknown category and status remain visible without unsafe relabelling',()=>{
  const r=runtime(),data=r.api.project([{id:'x',company_id:'co-a',contractor_name:'Unknown',category:'special_trade',status:'awaiting_board'}],current,{});assert.equal(data.length,1);assert.equal(data[0].category,'special trade');assert.equal(data[0].status,'awaiting board');
});
test('shared register limits actions to the current session and manager edit',async()=>{
  const r=runtime(),calls=[];r.api.mount({},rows,{canEdit:true,openRecord:(id,context)=>calls.push(['open',id,context.companyId]),editRecord:(id,context)=>calls.push(['edit',id,context.companyId])});const m=r.mounted();assert.equal(m.options.moduleKey,'contractor-management');assert.deepEqual(Array.from(m.options.actions,x=>x.key),['open','edit']);await m.options.onAction('open',m.data[0]);await m.options.onAction('edit',m.data[0]);assert.deepEqual(calls,[['open','con-1','co-a'],['edit','con-1','co-a']]);
  for(const change of [x=>x.identity.company.id='co-b',x=>x.identity.profile.id='other',x=>x.identity.role='viewer',x=>x.deny(),x=>x.signOut()]){const x=runtime();x.api.mount({},rows,{canEdit:true,openRecord:()=>assert.fail('stale action')});const view=x.mounted();change(x);await assert.rejects(view.options.onAction('open',view.data[0]),/changed|denied|Sign in/);}
});
test('non manager does not enable the edit action',async()=>{const r=runtime();r.identity.role='viewer';r.api.mount({},rows,{canEdit:false,editRecord:()=>assert.fail('edit should be hidden')});const m=r.mounted();assert.equal(m.options.actions.find(x=>x.key==='edit').when(),false);await assert.rejects(m.options.onAction('edit',m.data[0]),/unavailable/);});
test('release wiring publishes the contractor register before the core loader',()=>{
  const html=read('index.html'),core=read('auris-core.js');assert.ok(html.indexOf('auris-contractor-list-workspace.js?')<html.indexOf('auris-core.js?'));assert.match(core,/AurisContractorListWorkspace\.mount\(el,conAllData/);assert.match(read('sw-assets.js'),/auris-contractor-list-workspace\.js/);assert.match(read('scripts/verify-production-smoke.cjs'),/auris-contractor-list-workspace\.js/);assert.match(read('scripts/verify-staging-acceptance.cjs'),/auris-contractor-list-workspace\.js/);assert.doesNotMatch(read('auris-contractor-list-workspace.js'),/\bfetch\(|\bapi\.request\(|\bPOST|\bPATCH|\bDELETE/);
});
