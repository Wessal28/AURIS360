const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const migration=read('supabase/migrations/20261014040000_fire_certificate_followup.sql');
const core=read('auris-core.js');
const records=read('auris-fire-records.js');
const workflow=read('auris-fire-workflow.js');
const handler=require('../api/process-fire-reminders.js');

test('new fire inspections remain unassessed and linked findings carry owners and deadlines',()=>{
  assert.match(core,/getElementById\('fi-result'\)\.value = 'pending'/);
  assert.match(core,/Select an inspection result before closing/);
  assert.match(core,/responsible_person:owner\|\|null,due_date:due\|\|null/);
  assert.match(migration,/alter column overall_result set default 'pending'/);
  assert.match(migration,/fire_inspection_closed_result_check/);
  assert.match(migration,/source_module,source_type,source_id,source_ref/);
  assert.match(workflow,/Progress: /);
});

test('renewals retain predecessors and equipment services retain event history',()=>{
  assert.match(migration,/supersedes_certificate_id uuid references public\.fire_certificates/);
  assert.match(migration,/create table public\.fire_equipment_services/);
  assert.match(migration,/where id=p_equipment_id and company_id=p_company_id for update/);
  assert.match(migration,/update public\.fire_equipment set last_service_date=p_service_date,next_service_date=p_next_due_date/);
  assert.match(core,/supersedes_certificate_id: document\.getElementById\('fc-predecessor'\)/);
  assert.match(workflow,/Start renewal|Record replacement certificate/);
  assert.match(records,/Replacement certificates/);
});

test('fire records and image failure have direct, recoverable routes',()=>{
  assert.match(core,/await fireEnsureRecords\(\);opened=await fireOpenLinkedRecord\(req\)/);
  assert.match(core,/data-fire-inspection-view/);
  assert.match(core,/data-fire-equipment-view/);
  assert.match(workflow,/fire_inspection_findings'\)\{/);
  assert.match(workflow,/Markers are hidden until the background is restored/);
  assert.match(records,/data-fire-related/);
});

test('fire reminder endpoint requires cron authentication and invokes the service RPC',async()=>{
  const old={secret:process.env.CRON_SECRET,url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_KEY,fetch:global.fetch};
  process.env.CRON_SECRET='test-secret';process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_KEY='test-key';
  const calls=[];global.fetch=async(url,options)=>{calls.push([url,options]);return {ok:true,json:async()=>({notifications_queued:1})};};
  const reply=()=>({code:200,status(value){this.code=value;return this;},json(value){this.body=value;return this;}});
  try{
    const denied=reply();await handler({method:'GET',headers:{}},denied);assert.equal(denied.code,401);assert.equal(calls.length,0);
    const allowed=reply();await handler({method:'GET',headers:{authorization:'Bearer test-secret'}},allowed);
    assert.equal(allowed.code,200);assert.equal(calls[0][0],'https://example.supabase.co/rest/v1/rpc/process_fire_due_reminders');
    assert.equal(calls[0][1].headers.Authorization,'Bearer test-key');
    assert.match(migration,/auth\.role\(\) is distinct from 'service_role'/);
    assert.match(migration,/fire_certificate_expiry|fire_equipment_service|fire_finding_followup/);
    assert.ok(JSON.parse(read('vercel.json')).crons.some(item=>item.path==='/api/process-fire-reminders'));
  }finally{
    for(const [key,value] of [['CRON_SECRET',old.secret],['SUPABASE_URL',old.url],['SUPABASE_SERVICE_KEY',old.key]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    global.fetch=old.fetch;
  }
});
