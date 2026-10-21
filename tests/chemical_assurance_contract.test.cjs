const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('optional chemical use links keep text fields and open exact company-scoped records',()=>{
  const ui=read('chemical-control-upgrade.js');
  const core=read('auris-core.js');
  const sql=read('supabase/migrations/20261014050000_chemical_control_assurance.sql');
  for(const [column,table] of [['owner_person_id','people'],['site_id','sites'],['ppe_item_id','ppe_catalogue'],['risk_assessment_id','risk_assessments']]){
    assert.match(sql,new RegExp('add column if not exists '+column+' uuid references public\\.'+table+'\\(id\\)'));
    assert.match(sql,new RegExp('new\\.'+column+' is not null and not exists'));
    assert.match(ui,new RegExp("id:'"+column+"'"));
  }
  assert.match(ui,/body\[link\.id\]=selected\.value\|\|null/);
  assert.match(ui,/target='_blank'|anchor\.target='_blank'/);
  assert.match(ui,/ccu-use-owner/);
  assert.match(ui,/ccu-use-location/);
  assert.match(core,/page==='people'&&req\.table==='people'/);
  assert.match(core,/page==='sitemap'&&req\.table==='sites'/);
});

function riskHarness(){
  const source=read('auris-core.js');
  const start=source.indexOf('function chemRiskFromForm(){');
  const end=source.indexOf('function chemExposureBackupPayload(',start);
  assert.ok(start>0&&end>start);
  const values={};
  const context={document:{getElementById:id=>({value:values[id]||'',innerHTML:''})},CHEM_RISK_CFG:{medium:{label:'Medium',bg:'#fff',tc:'#333'}},escH:String};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  return {values,context};
}
test('new chemical risk remains unassessed until hazards and exposure inputs are supplied',()=>{
  const {values,context}=riskHarness();
  const empty=context.chemRiskFromForm();
  assert.equal(empty.level,'unassessed');assert.equal(empty.score,null);
  assert.ok(empty.missing.includes('hazards or consequences'));
  Object.assign(values,{'chem3hazards':'Flammable liquid H225','chem3location':'Workshop','chem3use':'Cleaning','chem3persons':'2','chem3frequency':'daily','chem3duration':'short','chem3task':'open_handling','chem3controls':'Local exhaust ventilation'});
  const assessed=context.chemRiskFromForm();
  assert.ok(assessed.score>0);assert.notEqual(assessed.level,'unassessed');
  delete values.chem3controls;assert.equal(context.chemRiskFromForm().level,'unassessed');
});

test('register separates SDS file, age and competent validation',()=>{
  const context={Date};vm.createContext(context);vm.runInContext(read('auris-chemical-list-workspace.js'),context);
  const rows=[{id:'chem-1',company_id:'co-a',product_name:'Cleaner',sds_file_name:'cleaner.pdf',sds_revision_date:'2018-01-01',risk_score:null,risk_level:'unassessed',status:'active'}];
  const current={companyId:'co-a'};
  const missing=context.AurisChemicalListWorkspace.project(rows,current,{sdsSnapshot:{loaded:true,rows:[]}},new Date('2026-10-14'))[0];
  assert.equal(missing.sds_document,'Reference only');assert.equal(missing.sds,'Stale');assert.equal(missing.sds_validation,'No validation record');assert.equal(missing.risk_level,'Unassessed');assert.equal(missing.risk_score,'');
  const reviewed=context.AurisChemicalListWorkspace.project(rows,current,{sdsSnapshot:{loaded:true,rows:[{chemical_id:'chem-1',validation_status:'current'}]}},new Date('2026-10-14'))[0];
  assert.equal(reviewed.sds_validation,'Current validated');
});

test('emergency cards are deliberately selected and retain draft and source warnings',()=>{
  const source=read('chemical-control-upgrade.js').replace(/\}\)\(\);\s*$/,'window.__test={C,emergencyCard,ccuEmergencySummary};})();');
  const context={URL,window:{loadChemical:()=>{},chemNew:()=>{},chemEdit:()=>{},chemBack:()=>{}}};
  vm.createContext(context);vm.runInContext(source,context);
  const product={id:'chem-1',product_name:'Cleaner',first_aid:'Rinse with water. Seek medical advice if symptoms continue.',sds_file_url:'https://example.com/sds.pdf'};
  const card=context.window.__test.emergencyCard(product);
  assert.match(card,/class="ccu-emergency-select"/);assert.doesNotMatch(card,/class="ccu-emergency-select"[^>]*checked/);
  assert.match(card,/draft card/i);assert.match(card,/Open original SDS/);assert.match(card,/noopener noreferrer/);
  context.window.__test.C.sds=[{chemical_id:'chem-1',validation_status:'current',emergency_summary_reviewed_at:'2026-10-14',emergency_summary:{hazards:'Irritant',first_aid:'Rinse eyes',ppe:'Wear gloves',storage:'Keep closed'}}];
  assert.match(context.window.__test.emergencyCard(product),/reviewed card/i);
});

test('database protects use approval, review history and change impact',()=>{
  const sql=read('supabase/migrations/20261014050000_chemical_control_assurance.sql');
  assert.match(sql,/chemical_use_assurance_guard[\s\S]*validation_status='current'/);
  assert.match(sql,/sds_review_required=true/);
  assert.match(sql,/emergency_summary_reviewed_at/);
  assert.match(sql,/chemical_sds_review_action[\s\S]*action_tracker/);
  assert.match(sql,/process_chemical_due_reminders[\s\S]*service_role/);
});

test('chemical reminder endpoint requires cron secret and invokes service RPC',async()=>{
  const handler=require('../api/process-chemical-reminders.js');
  const old={...process.env};process.env.CRON_SECRET='test-secret';process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_KEY='service-key';
  const response=()=>({status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
  try{assert.equal((await handler({method:'GET',headers:{}},response())).code,401);let called='';const saved=global.fetch;global.fetch=async url=>{called=url;return {ok:true,json:async()=>({notifications_queued:1})};};try{const res=response();await handler({method:'GET',headers:{authorization:'Bearer test-secret'}},res);assert.equal(res.code,200);assert.match(called,/rpc\/process_chemical_due_reminders/);}finally{global.fetch=saved;}}finally{process.env=old;}
});
