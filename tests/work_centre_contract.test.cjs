const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

function serviceContext(){
  const context={console,globalThis:null,window:null,navigator:{onLine:true},localStorage:{getItem(){return null},setItem(){}},document:{},crypto:{randomUUID:()=> 'idem-1'}};
  context.window=context;context.globalThis=context;
  context.AurisPlatformServices={auth:{current:()=>({profile:{id:'user-1',company_id:'company-1'},company:{id:'company-1'},role:'worker'})},api:{companyId:()=> 'company-1',request:async()=>[]}};
  vm.runInNewContext(read('auris-work-centre.js'),context);
  return context;
}

test('work centre aggregates authoritative tenant records without duplicates',()=>{
  const c=serviceContext();
  const actions=[{id:'a1',company_id:'company-1',assigned_to_id:'user-1',title:'Inspect guard',source_module:'inspection',source_id:'s1',source_ref:'INS-1'},{id:'a1',company_id:'company-1',assigned_to_id:'user-1'},{id:'a2',company_id:'company-2',assigned_to_id:'user-1'}];
  const approvals=[{id:'p1',company_id:'company-1',module_name:'documents',related_table:'documents',related_id:'d1',status:'pending'}];
  const notifications=[{id:'n1',company_id:'company-1',recipient_profile_id:'user-1',related_module:'events',related_table:'events',related_id:'e1'},{id:'n2',company_id:'company-1',recipient_profile_id:'someone-else'}];
  const rows=c.AurisWorkCentre._normalise(actions,approvals,notifications);
  assert.equal(rows.length,3);
  assert.deepEqual(Array.from(rows.map(x=>x.key).sort()),['action:a1','approval:p1','notification:n1']);
  assert.equal(rows.find(x=>x.key==='approval:p1').source.id,'d1');
});

test('work centre blocks governed mutations offline and requires exact sources',async()=>{
  const c=serviceContext();c.navigator.onLine=false;
  await assert.rejects(c.AurisWorkCentre.addActivity({module:'events',table:'events',id:'e1'},'comment','x'),/Reconnect/);
  await assert.rejects(c.AurisWorkCentre.delegate({module:'events',table:'events',id:'e1'},'user-2','cover'),/Reconnect/);
});

test('phase 11 is registered, cache-versioned, responsive and release-verifiable',()=>{
  const html=read('index.html'),registry=read('auris-module-registry.js'),css=read('auris-work-centre.css'),manifest=read('sw-assets.js');
  assert.match(registry,/key:'work'.*loader:'loadWorkCentre'/);
  assert.match(html,/id="page-work"/);assert.match(html,/auris-work-centre\.js\?v=20260901-11/);assert.match(html,/modular-foundation-(?:11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26)/);
  assert.match(css,/@media\(max-width:800px\)/);assert.match(css,/@media\(max-width:480px\)/);
  assert.match(manifest,/auris-work-centre\.js/);assert.match(manifest,/auris-work-centre\.css/);
});

test('phase 11 migration enforces append-only evidence, exact source and tenant isolation',()=>{
  const sql=read('supabase/migrations/20260901030000_modular_foundation_11_work_centre.sql');
  assert.match(sql,/create table if not exists public\.work_activities/i);
  assert.match(sql,/create table if not exists public\.work_item_delegations/i);
  assert.match(sql,/auris_can_access_company\(company_id\)/i);
  assert.match(sql,/No direct INSERT\/UPDATE\/DELETE policies/i);
  assert.match(sql,/create or replace function public\.add_work_activity/i);
  assert.match(sql,/create or replace function public\.delegate_work_item/i);
  assert.match(sql,/idempotency_key/i);assert.match(sql,/delegate is outside the company boundary/i);
});
