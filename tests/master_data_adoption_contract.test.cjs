const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
function runtime(){const window={console,Date,URL,Promise,Set};window.globalThis=window;vm.runInNewContext(read('auris-integration-engine.js'),window);vm.runInNewContext(read('auris-master-data-service.js'),window);vm.runInNewContext(read('auris-master-data-adoption.js'),window);return window;}
const options={context:()=>({companyId:'co-a',userId:'user-a',role:'company_admin'})};
const master=[
  {id:'loc-1',company_id:'co-a',domain:'location',code:'SITE-01',name:'Main Factory',status:'active'},
  {id:'loc-2',company_id:'co-a',domain:'location',code:'MAIN',name:'Main Factory',status:'active'},
  {id:'dep-1',company_id:'co-a',domain:'department',code:'OPS',name:'Operations',status:'active'},
  {id:'loc-x',company_id:'co-b',domain:'location',code:'SITE-01',name:'Main Factory',status:'active'}
];

test('six operational modules expose only approved master-data fields',()=>{
  const api=runtime().AurisMasterDataAdoption;
  assert.deepEqual(Object.keys(api.modules),['incident','risk','permit','audit','action','document']);
  assert.equal(api.modules.permit.fields.contractor_name,'organisation');
  assert.equal(api.modules.document.fields.category,'document_category');
  assert.throws(()=>api.inventory('unknown',[],master,[],options),/Unsupported/);
});

test('inventory is tenant scoped and never auto-confirms ambiguous or missing values',()=>{
  const api=runtime().AurisMasterDataAdoption,rows=[
    {id:'risk-1',company_id:'co-a',ra_ref:'RA-001',location:'Main Factory',department:'Operations'},
    {id:'risk-x',company_id:'co-b',ra_ref:'RA-X',location:'Main Factory',department:'Operations'}
  ],items=api.inventory('risk',rows,master,[],options),location=items.find(row=>row.sourceField==='location'),department=items.find(row=>row.sourceField==='department');
  assert.equal(items.length,2);
  assert.equal(location.state,'ambiguous');
  assert.equal(location.candidates.length,2);
  assert.equal(department.state,'suggested');
});

test('confirmed bindings require an active same-company canonical record and retain legacy evidence',()=>{
  const api=runtime().AurisMasterDataAdoption,value=api.binding({module:'risk',sourceRecordId:'risk-1',sourceField:'department',sourceRef:'RA-001',legacyValue:'Old Operations wording',masterRecordId:'dep-1'},master,options);
  assert.equal(value.masterRecordId,'dep-1');
  assert.equal(value.legacySnapshot,'Old Operations wording');
  assert.throws(()=>api.binding({module:'risk',sourceRecordId:'risk-1',sourceField:'department',sourceRef:'RA-001',legacyValue:'Operations',masterRecordId:'loc-1'},master,options),/not active/);
  assert.throws(()=>api.binding({module:'risk',sourceRecordId:'risk-1',sourceField:'unsafe',sourceRef:'RA-001',legacyValue:'Operations',masterRecordId:'dep-1'},master,options),/not approved/);
});

test('database adoption is revision checked, non-destructive, tenant safe and audited',()=>{
  const sql=read('supabase/migrations/20260903060000_modular_foundation_26_master_data_adoption.sql');
  for(const marker of ['master_data_source_bindings','legacy_snapshot','set_master_data_source_binding','integration_require_admin','source_exists','status=\'active\'','master_data_dependencies','master_data.binding_changed','p_expected_revision','security_invoker','enable row level security'])assert.match(sql,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
  assert.doesNotMatch(sql,/update\s+public\.(events|risk_assessments|permits|inspections|action_tracker|documents)\s+set/i);
  assert.doesNotMatch(sql,/grant\s+(insert|update|delete)\s+on\s+public\.master_data_source_bindings/i);
});

test('adoption centre exposes controlled diagnostics and deliberate confirmation',()=>{
  const centre=read('auris-master-data-adoption-centre.js'),css=read('auris-master-data-adoption.css'),html=read('index.html'),manifest=read('sw-assets.js');
  for(const marker of ['non-destructive adoption','Confirmed references','Exact suggestions','Ambiguous','Unresolved','Controlled failures','Select an active canonical value','set_master_data_source_binding','without rewriting the source record'])assert.match(centre,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/focus-visible/);
  assert.match(html,/modular-foundation-29/);
  assert.match(html,/id="master-data-adoption-body"/);
  assert.match(manifest,/auris-master-data-adoption\.js/);
});
