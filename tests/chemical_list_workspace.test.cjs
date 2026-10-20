const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const current={companyId:'co-a',userId:'user-a',name:'Reviewer',role:'manager'};
const chemicals=[
  {id:'chem-1',company_id:'co-a',chemical_ref:'CH-001',product_name:'Solvent A',supplier:'SafeChem',manufacturer:'SafeChem Ltd',location:'Workshop',department:'Production',process_use:'Cleaning',signal_word:'Danger',hazard_identification:'Flammable liquid',hazard_statements:['H225','H319'],exposure_routes:['inhalation','skin'],persons_exposed:4,exposure_frequency:'daily',task_type:'open_handling',risk_score:18,risk_level:'critical',existing_controls:'',ppe_required:'',review_date:'2026-09-01',sds_revision_date:'2019-09-01',status:'active',updated_at:'2026-09-10T10:00:00Z'},
  {id:'chem-2',company_id:'co-a',chemical_ref:'CH-002',product_name:'Cleaner B',supplier:'CleanCo',location:'Warehouse',department:'Stores',process_use:'Washdown',persons_exposed:2,exposure_frequency:'weekly',task_type:'closed_handling',risk_score:6,risk_level:'medium',existing_controls:'Gloves and ventilation',review_date:'2026-10-01',status:'restricted'},
  {id:'chem-3',company_id:'co-a',chemical_ref:'CH-003',product_name:'Paint C',risk_level:'low',status:'active',review_date:'2027-01-01',sds_revision_date:'2026-01-01'},
  {id:'foreign',company_id:'co-b',product_name:'Other company chemical',risk_level:'critical',status:'active'},
  {id:'unknown',company_id:'co-a',product_name:'Unclassified',risk_level:'special',status:'awaiting_review'}
];
function runtime(){
  const identity={company:{id:'co-a'},profile:{id:'user-a',full_name:'Reviewer'},role:'manager'};let mounted,allowed=true,authenticated=true;
  const window={Date,navigator:{onLine:true},AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>authenticated,current:()=>identity},rbac:{requireAccess:key=>{assert.equal(key,'chemical');if(!allowed)throw Error('Access denied');}}},AurisViewEngine:{mount:(host,data,options)=>{mounted={data,options};return mounted;}}};
  vm.runInNewContext(read('auris-chemical-list-workspace.js'),window);
  return {api:window.AurisChemicalListWorkspace,identity,mounted:()=>mounted,deny:()=>{allowed=false;},signOut:()=>{authenticated=false;},window};
}
test('projection is tenant scoped and exposes COSHH risk, review and SDS attention',()=>{const r=runtime(),before=JSON.stringify(chemicals),data=r.api.project(chemicals,current,{},new Date('2026-09-16T12:00:00Z'));assert.deepEqual(Array.from(data,x=>x.id),['chem-1','chem-2','chem-3','unknown']);assert.equal(data[0].reference,'CH-001');assert.equal(data[0].risk_level,'Critical');assert.equal(data[0].review,'Overdue');assert.equal(data[0].sds,'Stale');assert.deepEqual(Array.from(data[0].attention_flags),['critical_risk','review_overdue','sds_stale','controls_missing']);assert.equal(data[0].persons_exposed,4);assert.equal(JSON.stringify(chemicals),before);});
test('chemical filters combine risk, status, attention and search',()=>{const r=runtime(),select=filters=>r.api.project(chemicals,current,{filters},new Date('2026-09-16T12:00:00Z')).map(x=>x.id);assert.deepEqual(select({risk:'critical'}),['chem-1']);assert.deepEqual(select({status:'restricted'}),['chem-2']);assert.deepEqual(select({attention:'sds_missing'}),['chem-2','unknown']);assert.deepEqual(select({search:'warehouse',status:'restricted'}),['chem-2']);});
test('unknown chemical values remain visible without unsafe relabelling',()=>{const r=runtime(),data=r.api.project([{id:'x',company_id:'co-a',product_name:'Unknown',risk_level:'special',status:'awaiting_review'}],current,{});assert.equal(data.length,1);assert.equal(data[0].risk_level,'special');assert.equal(data[0].status,'awaiting review');});
test('shared chemical register exposes guarded open and manager edit actions',async()=>{const r=runtime(),calls=[];r.api.mount({},chemicals,{canEdit:true,openRecord:(id,c)=>calls.push(['open',id,c.companyId]),editRecord:(id,c)=>calls.push(['edit',id,c.companyId])});const m=r.mounted();assert.equal(m.options.moduleKey,'chemical-control');assert.deepEqual(Array.from(m.options.actions,x=>x.key),['open','edit']);await m.options.onAction('open',m.data[0]);await m.options.onAction('edit',m.data[0]);assert.deepEqual(calls,[['open','chem-1','co-a'],['edit','chem-1','co-a']]);for(const change of [x=>x.identity.company.id='co-b',x=>x.identity.profile.id='other',x=>x.identity.role='viewer',x=>x.deny(),x=>x.signOut()]){const x=runtime();x.api.mount({},chemicals,{canEdit:true,openRecord:()=>assert.fail('stale action')});const view=x.mounted();change(x);await assert.rejects(view.options.onAction('open',view.data[0]),/changed|denied|Sign in/);}});

test('chemical action icons retain exact view/edit URLs, readable product links and edit visibility',()=>{
  for(const canEdit of [true,false]){
    const r=runtime();r.api.mount({},chemicals,{canEdit,recordHref:(id,mode)=>'https://fixture.invalid/chemical/'+id+'?mode='+mode});const mounted=r.mounted();vm.runInNewContext(read('auris-view-engine.js'),r.window);
    const host={classList:{add(){}},querySelector:()=>null,querySelectorAll:()=>[],innerHTML:''};r.window.AurisViewEngine.mount(host,mounted.data,mounted.options);
    for(const [key,label,icon,mode] of [['open','View chemical','ti-eye','view'],['edit','Edit chemical','ti-pencil','edit']]){
      const control=host.innerHTML.match(new RegExp('<a[^>]*class="ave-icon-action"[^>]*data-view-action="'+key+'"[^>]*data-view-row="chem-1"[^>]*>(.*?)</a>'));
      if(key==='edit'&&!canEdit){assert.equal(control,null);continue;}
      assert.ok(control);assert.ok(control[0].includes('aria-label="'+label+'"'));assert.ok(control[0].includes('title="'+label+'"'));assert.ok(control[0].includes('href="https://fixture.invalid/chemical/chem-1?mode='+mode+'"'));assert.equal(control[1],'<i class="ti '+icon+'" aria-hidden="true"></i>');
    }
    assert.match(host.innerHTML,/<a[^>]*class="ave-link"[^>]*>CH-001<\/a>/);assert.match(host.innerHTML,/<a[^>]*class="ave-link"[^>]*>Solvent A<\/a>/);
    if(!canEdit)assert.doesNotMatch(host.innerHTML,/data-view-action="edit"/);
  }
});
test('release wiring publishes the Chemical Control register before the core loader',()=>{const html=read('index.html'),core=read('auris-core.js');assert.ok(html.indexOf('auris-chemical-list-workspace.js?')<html.indexOf('auris-core.js?'));assert.match(core,/AurisChemicalListWorkspace\.mount\(el,chemData/);assert.match(read('sw-assets.js'),/auris-chemical-list-workspace\.js/);assert.match(read('scripts/verify-production-smoke.cjs'),/auris-chemical-list-workspace\.js/);assert.match(read('scripts/verify-staging-acceptance.cjs'),/auris-chemical-list-workspace\.js/);assert.doesNotMatch(read('auris-chemical-list-workspace.js'),/\bfetch\(|\bapi\.request\(|\bPOST|\bPATCH|\bDELETE/);});
