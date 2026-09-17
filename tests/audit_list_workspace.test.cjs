const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const current={companyId:'co-a',userId:'user-a',name:'Reviewer',role:'manager'};
const rows=[
  {id:'in-1',company_id:'co-a',reference_no:'WI-2026-001',inspection_type:'workplace',site:'Workshop',department:'Production',inspection_date:'2026-09-10',planned_date:'2026-09-20',inspector:'Reviewer',score_good:8,score_insuf:2,status:'open',items:[{result:'good'},{result:'insufficient'}],updated_at:'2026-09-12T10:00:00Z'},
  {id:'in-2',company_id:'co-a',reference_no:'ISO-2026-002',inspection_type:'iso_audit',site:'Warehouse',audit_standard:'ISO 45001',inspection_date:'2026-08-01',planned_date:'2026-09-01',inspector:'Other auditor',score_good:4,score_insuf:6,status:'in_progress',items:[{result:'insufficient'},{result:'insufficient'}]},
  {id:'in-3',company_id:'co-a',reference_no:'EQ-2026-003',inspection_type:'equipment',site:'Site B',inspection_date:'2026-09-01',inspector:'Reviewer',status:'completed',items:[]},
  {id:'foreign',company_id:'co-b',inspection_type:'workplace',site:'Secret',status:'open'},
  {id:'unscoped',inspection_type:'workplace',site:'Unscoped',status:'open'}
];
function runtime(){
  const identity={company:{id:'co-a'},profile:{id:'user-a',full_name:'Reviewer'},role:'manager'};let mounted,allowed=true,authenticated=true;
  const window={Date,Number,navigator:{onLine:true},AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>authenticated,current:()=>identity},rbac:{requireAccess:key=>{assert.equal(key,'inspection');if(!allowed)throw Error('Access denied');}}},AurisViewEngine:{mount:(host,data,options)=>{mounted={data,options};return mounted;}}};
  vm.runInNewContext(read('auris-audit-list-workspace.js'),window);
  return {api:window.AurisAuditListWorkspace,identity,mounted:()=>mounted,deny:()=>{allowed=false;},signOut:()=>{authenticated=false;},window};
}
test('projection is tenant scoped and preserves inspection, score and attention meaning',()=>{
  const r=runtime(),data=r.api.project(rows,current,{tab:'all',filters:{}},new Date('2026-09-15T12:00:00Z'));
  assert.deepEqual(data.map(x=>x.id),['in-1','in-2','in-3']);assert.equal(data[0].reference,'WI-2026-001');assert.equal(data[0].type,'Workplace inspection');assert.equal(data[0].score,80);assert.equal(data[0].score_detail,'8 good / 2 insufficient');assert.equal(data[0].attention,'Due soon');assert.equal(data[1].attention,'Overdue');assert.equal(data[1].findings,2);assert.equal(JSON.stringify(rows),JSON.stringify(rows));
});
test('tab, status, score, attention and text filters combine safely',()=>{
  const r=runtime(),select=(filters,tab='all')=>r.api.project(rows,current,{tab,filters},new Date('2026-09-15T12:00:00Z')).map(x=>x.id);
  assert.deepEqual(select({},'audit'),['in-2']);assert.deepEqual(select({},'workplace'),['in-1']);assert.deepEqual(select({status:'in_progress'}),['in-2']);assert.deepEqual(select({attention:'overdue'}),['in-2']);assert.deepEqual(select({score:'attention'}),['in-2']);assert.deepEqual(select({score:'unscored'}),['in-3']);assert.deepEqual(select({search:'iso 45001'}),['in-2']);
});
test('unknown inspection values remain visible without unsafe relabelling',()=>{
  const r=runtime(),data=r.api.project([{id:'x',company_id:'co-a',inspection_type:'special_review',status:'awaiting_signoff',site:'Plant'}],current,{filters:{}});
  assert.equal(data.length,1);assert.equal(data[0].type,'special review');assert.equal(data[0].status,'awaiting signoff');assert.equal(data[0].score,null);
});
test('shared audit register exposes report and manager edit actions and protects sessions',async()=>{
  const r=runtime(),calls=[];r.api.mount({},rows,{canEdit:true,openRecord:(id,c)=>calls.push(['open',id,c.companyId]),editRecord:(id,c)=>calls.push(['edit',id,c.companyId])});const m=r.mounted();assert.equal(m.options.moduleKey,'audits-inspections');assert.deepEqual(Array.from(m.options.actions,x=>x.key),['open','edit']);await m.options.onAction('open',m.data[0]);await m.options.onAction('edit',m.data[0]);assert.deepEqual(calls,[['open','in-1','co-a'],['edit','in-1','co-a']]);
  for(const change of [x=>x.identity.company.id='co-b',x=>x.identity.profile.id='other',x=>x.identity.role='viewer',x=>x.deny(),x=>x.signOut()]){const x=runtime();x.api.mount({},rows,{canEdit:true,openRecord:()=>assert.fail('stale action')});const view=x.mounted();change(x);await assert.rejects(view.options.onAction('open',view.data[0]),/changed|denied|Sign in/);}
});
test('release wiring publishes the audit register before the core loader',()=>{
  const html=read('index.html'),core=read('auris-core.js');assert.ok(html.indexOf('auris-audit-list-workspace.js?')<html.indexOf('auris-core.js?'));assert.match(core,/AurisAuditListWorkspace\.mount\(el,auditAllData/);for(const file of ['sw-assets.js','scripts/verify-production-smoke.cjs','scripts/verify-staging-acceptance.cjs'])assert.match(read(file),/auris-audit-list-workspace\.js/);assert.doesNotMatch(read('auris-audit-list-workspace.js'),/\bfetch\(|\bapi\.request\(|\bPOST|\bPATCH|\bDELETE/);
});
