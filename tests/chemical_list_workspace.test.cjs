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

function engineHost(){
  const host={classList:{add(){}},controls:[],notice:{hidden:true,textContent:'',setAttribute(){}},querySelector:selector=>selector==='[data-view-feedback]'?host.notice:null,querySelectorAll:selector=>selector==='[data-view-action]'?host.controls:[]};
  Object.defineProperty(host,'innerHTML',{get(){return this.html||'';},set(value){this.html=value;this.controls=[...value.matchAll(/<(button|a)\b([^>]*\bdata-view-action="[^"]*"[^>]*)>([\s\S]*?)<\/(?:button|a)>/g)].map(match=>{const attributes=Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute=>[attribute[1],attribute[2]]));return {tagName:match[1].toUpperCase(),attributes,body:match[3],events:{},getAttribute:name=>attributes[name]||null,addEventListener(name,handler){this.events[name]=handler;}};});}});
  return host;
}
function renderEngine(r,options){vm.runInNewContext(read('auris-view-engine.js'),r.window);const host=engineHost();r.api.mount(host,chemicals,options);return host;}
async function click(control){assert.ok(control);const event={prevented:false,preventDefault(){this.prevented=true;}};await control.events.click(event);return event;}

test('chemical icons and product/reference links open in the current app even when a legacy URL factory is supplied',async()=>{
  for(const canEdit of [true,false]){
    const r=runtime(),calls=[];r.window.open=()=>assert.fail('Chemical actions must stay in this app');
    const host=renderEngine(r,{canEdit,recordHref:()=>assert.fail('Legacy record URLs must not be consulted for in-app actions'),openRecord:(id,current)=>calls.push(['open',id,current.companyId]),editRecord:(id,current)=>calls.push(['edit',id,current.companyId])});
    assert.ok(host.controls.every(control=>control.tagName==='BUTTON'&&!control.attributes.href&&!control.attributes.target));assert.doesNotMatch(host.innerHTML,/target="_blank"/);
    for(const [key,label,icon] of [['open','View chemical','ti-eye'],['edit','Edit chemical','ti-pencil']]){
      const control=host.controls.find(node=>node.attributes.class==='ave-icon-action'&&node.attributes['data-view-action']===key&&node.attributes['data-view-row']==='chem-1');
      if(key==='edit'&&!canEdit){assert.equal(control,undefined);continue;}
      assert.ok(control);assert.equal(control.attributes['aria-label'],label);assert.equal(control.attributes.title,label);assert.equal(control.body,'<i class="ti '+icon+'" aria-hidden="true"></i>');await click(control);
    }
    for(const label of ['CH-001','Solvent A'])await click(host.controls.find(node=>node.attributes.class==='ave-link'&&node.body===label));
    assert.deepEqual(calls,canEdit?[['open','chem-1','co-a'],['edit','chem-1','co-a'],['open','chem-1','co-a'],['open','chem-1','co-a']]:[['open','chem-1','co-a'],['open','chem-1','co-a'],['open','chem-1','co-a']]);
    if(!canEdit)assert.doesNotMatch(host.innerHTML,/data-view-action="edit"/);
  }
});

test('actual chemical engine click handlers reject changed sessions, denied access and offline opening for View and Edit',async()=>{
  for(const key of ['open','edit'])for(const change of [r=>r.identity.company.id='co-b',r=>r.identity.profile.id='other',r=>r.identity.role='viewer',r=>r.deny(),r=>r.signOut(),r=>r.window.navigator.onLine=false]){
    const r=runtime(),host=renderEngine(r,{canEdit:true,openRecord:()=>assert.fail('No stale or offline View'),editRecord:()=>assert.fail('No stale or offline Edit')});
    const control=host.controls.find(node=>node.attributes.class==='ave-icon-action'&&node.attributes['data-view-action']===key);change(r);const event=await click(control);
    assert.equal(event.prevented,true);assert.match(host.notice.textContent,/changed|denied|Sign in|Reconnect/);assert.ok(host.controls.every(node=>!node.disabled));
  }
});
test('release wiring publishes the Chemical Control register before the core loader',()=>{const html=read('index.html'),core=read('auris-core.js');assert.ok(html.indexOf('auris-chemical-list-workspace.js?')<html.indexOf('auris-core.js?'));assert.match(core,/AurisChemicalListWorkspace\.mount\(el,chemData/);assert.match(read('sw-assets.js'),/auris-chemical-list-workspace\.js/);assert.match(read('scripts/verify-production-smoke.cjs'),/auris-chemical-list-workspace\.js/);assert.match(read('scripts/verify-staging-acceptance.cjs'),/auris-chemical-list-workspace\.js/);assert.doesNotMatch(read('auris-chemical-list-workspace.js'),/\bfetch\(|\bapi\.request\(|\bPOST|\bPATCH|\bDELETE/);});
