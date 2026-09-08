const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8'),core=read('auris-core.js');
const source={module:'permit',table:'permits',id:'permit-1',company_id:'co-a'},current={companyId:'co-a',userId:'user-a',role:'manager'};
const record={id:'permit-1',company_id:'co-a',permit_number:'PTW-001',work_description:'Controlled work',status:'suspended',permit_type_v2:'confined_space',planned_start:'2026-09-08T08:30:00+04:00',planned_end:'2026-09-08T12:45:00+04:00',permit_issuer_name:'Issuer',permit_receiver_name:'Receiver',blocked_reasons:['Failed gas test — STOP'],precautions_checklist:[{item:'Isolation',checked:false}],gas_tests:[{o2:0,lel:0,h2s:0,co:0,result:'fail',tester:'Tester',equipment:'Meter-1',cal_date:'2026-09-01',datetime:'2026-09-08T08:40:00+04:00'}],isolations:[{tag:'LOTO-1',description:'Supply',type:'electrical',status:'pending',by:'Operator'}],approval_level_required:2,approval_l1_status:'approved',approval_l1_by:'Supervisor',approval_l1_at:'2026-09-08T08:00:00+04:00',closure_checklist:[{item:'Restore area',checked:false}]};
const catalogues={types:{confined_space:{label:'Confined Space'}},statuses:{suspended:['','','Suspended']}};
function runtime(respond=()=>[]){
  const identity={company:{id:'co-a'},profile:{id:'user-a'},role:'manager'},calls=[],adapters={};let options,clipboard;
  const context={navigator:{onLine:true,clipboard:{writeText:async value=>clipboard=value}},AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>true,current:()=>identity},rbac:{requireAccess:key=>assert.equal(key,'permit')},api:{request:async(...args)=>{assert.equal(args.length,1,'reads only');calls.push(args[0]);return respond(args[0]);}}},AurisRecordWorkspace:{registerAdapter:value=>adapters[value.key]=value,open:async value=>{options=value;return value;}}};
  vm.runInNewContext(read('auris-permit-list-workspace.js'),context);vm.runInNewContext(read('auris-permit-record-workspace.js'),context);
  return {api:context.AurisPermitRecordWorkspace,context,identity,calls,adapters,get options(){return options;},get clipboard(){return clipboard;}};
}
const withRecord=(handler=()=>[],row=record)=>url=>url.startsWith('/permits?')?[row]:handler(url);
test('permit overview fetches exact current record before strictly scoped bounded history',async()=>{
  const r=runtime(withRecord()),before=JSON.stringify(record),result=await r.api.load(source,current,catalogues);
  assert.equal(r.calls[0],'/permits?select=*&company_id=eq.co-a&id=eq.permit-1&limit=1');assert.equal(r.calls.length,4);
  for(const url of r.calls.slice(1)){assert.match(url,/company_id=eq.co-a/);assert.match(url,/permit-1/);assert.match(url,/limit=101/);}
  assert.equal(result.record.type_label,'Confined Space');assert.equal(result.record.status_label,'Suspended');assert.equal(result.record.reference_label,'PTW-001');assert.equal(JSON.stringify(record),before);
});
test('control summaries preserve zero readings, failed results, unchecked items and missing verification',async()=>{
  const r=runtime(withRecord()),result=await r.api.load(source,current,catalogues),value=result.record;
  assert.match(value.blocks_label,/STOP/);assert.match(value.gas_label,/O2 \(%\): 0; LEL \(%\): 0; H2S \(ppm\): 0; CO \(ppm\): 0/);assert.match(value.gas_label,/result: fail; Tester: Tester/);assert.match(value.gas_label,/Meter-1.*2026-09-01/);
  assert.match(value.precautions_label,/Recorded unchecked/);assert.match(value.isolation_label,/LOTO-1.*Supply/);assert.match(value.isolation_label,/Recorded status: pending/);assert.match(value.isolation_label,/Verified by: Not recorded/);assert.match(value.closure_checks_label,/Recorded unchecked/);
  assert.match(result.notices.join(' '),/not permission to start or resume work/);assert.match(result.notices.join(' '),/Missing entries are not a safety clearance/);
});
test('missing or malformed control fields never default to pass, approval or a different permit type',async()=>{
  const row={id:record.id,company_id:record.company_id,permit_type:'unrecognised_type',status:'unrecognised_status',gas_tests:{broken:true},isolations:null,precautions_checklist:[]};
  const value=(await runtime(withRecord(()=>[],row)).api.load(source,current,catalogues)).record;
  assert.equal(value.type_label,'unrecognised_type');assert.equal(value.status_label,'unrecognised_status');assert.match(value.gas_label,/malformed/);assert.equal(value.isolation_label,'Not recorded');assert.match(value.precautions_label,/No entries recorded/);
  assert.equal(value.approval_levels_label,'Not recorded');assert.match(value.approval_l1_label,/Recorded status: Not recorded/);assert.doesNotMatch(value.approval_l1_label,/approved|pending/);
});
test('recorded level approvals stay separate from linked shared requests and preserve time',async()=>{
  const result=await runtime(withRecord()).api.load(source,current,catalogues);
  assert.equal(result.record.approval_levels_label,'2');assert.match(result.record.approval_l1_label,/approved.*\nBy: Supervisor; At:/);assert.match(result.record.approval_l3_label,/Not recorded/);
  assert.match(result.notices.join(' '),/do not replace the permit approval levels/);assert.equal(result.approvals.length,0);
  assert.match(result.record.start_label,/\d{2}:\d{2}/);const date=(await runtime(withRecord(()=>[],{...record,planned_start:'2026-09-08'})).api.load(source,current)).record;assert.equal(date.start_label,'2026-09-08 (time not recorded)');
});
test('missing duplicate malformed foreign and wrong-ID permit payloads fail before history',async()=>{
  for(const payload of [null,{},[],[null],[record,record],[{...record,id:'other'}],[{...record,company_id:'co-b'}]]){
    const r=runtime(()=>payload);await assert.rejects(r.api.load(source,current),/unavailable|outside/);assert.equal(r.calls.length,1);
  }
});
test('invalid source, unauthenticated session and denied access fail before requests',async()=>{
  const r=runtime();for(const change of [{module:'actions'},{table:'action_tracker'},{company_id:'co-b'},{id:'a&company_id=eq.other'}])await assert.rejects(r.api.load({...source,...change},current),/source|exact permit/);
  await assert.rejects(r.api.open('a&company_id=eq.other'),/exact permit/);r.context.AurisPlatformServices.auth.isAuthenticated=()=>false;await assert.rejects(r.api.open('permit-1'),/Sign in/);
  r.context.AurisPlatformServices.auth.isAuthenticated=()=>true;r.context.AurisPlatformServices.rbac.requireAccess=()=>{throw Error('Denied');};await assert.rejects(r.api.load(source,current),/Denied/);assert.equal(r.calls.length,0);
});
test('permit log, evidence, approval requests and decisions reject contradictory source identities',async()=>{
  const log={id:'l1',company_id:'co-a',permit_id:'permit-1',action:'Suspended',details:'Failed gas',new_status:'suspended'};
  const work={id:'w1',company_id:'co-a',source_module:'permit',source_table:'permits',source_record_id:'permit-1',activity_type:'comment',body:'Review',evidence:[{label:'Document',url:'https://example.invalid/doc'}]};
  const approval={id:'p1',company_id:'co-a',module_name:'permit',related_table:'permits',related_id:'permit-1',source_record_id:'permit-1',request_reason:'Shared request'};
  const r=runtime(withRecord(url=>{
    if(url.startsWith('/permit_activity_log?'))return [null,log,{...log,company_id:'co-b'},{...log,permit_id:'other'},{...log,source_module:'actions'}];
    if(url.startsWith('/work_activities?'))return [null,work,{...work,company_id:'co-b'},{...work,source_table:'events'},{...work,related_id:'other'}];
    if(url.startsWith('/approval_requests?'))return [null,approval,{...approval,id:'foreign',company_id:'co-b'},{...approval,id:'wrong-module',module_name:'actions'},{...approval,id:'wrong-table',related_table:'events'},{...approval,id:'wrong-record',related_id:'other'}];
    if(url.startsWith('/approval_decisions?')){assert.match(url,/request_id=in.\(p1\)/);return [{id:'d1',request_id:'p1',decision:'approved'},{id:'d2',request_id:'wrong',decision:'rejected'},{request_id:'p1',company_id:'co-b'},{request_id:'p1',source_table:'events'}];}return [];
  }));
  const result=await r.api.load(source,current);assert.equal(result.approvals.length,1);assert.equal(result.activities.length,4);assert.match(result.activities[0].body,/Failed gas.*suspended/);assert.equal(result.activities[2].activity_type,'evidence');assert.equal(result.activities[3].body,'approved');
  for(const row of result.activities){assert.equal(row.company_id,'co-a');assert.equal(row.source_module,'permit');assert.equal(row.source_table,'permits');assert.equal(row.source_record_id,'permit-1');}
});
test('unavailable malformed and truncated history is disclosed without exposing raw server errors',async()=>{
  const r=runtime(withRecord(url=>{if(url.startsWith('/permit_activity_log?'))return Array.from({length:101},(_,i)=>({id:String(i),company_id:'co-a',permit_id:'permit-1',action:'Review'}));if(url.startsWith('/work_activities?'))return {bad:true};throw Error('secret server details');}));
  const result=await r.api.load(source,current);assert.equal(result.activities.length,100);assert.match(result.notices.join(' '),/latest 100.*older entries/);assert.match(result.notices.join(' '),/Shared activity and evidence is unavailable/);assert.match(result.notices.join(' '),/Shared approval requests is unavailable/);assert.doesNotMatch(result.notices.join(' '),/secret server/);
});
test('company, profile, role, module access and register changes invalidate in-flight loads',async()=>{
  for(const endpoint of ['/permits?','/work_activities?'])for(const change of [r=>r.identity.company.id='co-b',r=>r.identity.profile.id='other',r=>r.identity.role='viewer',r=>{r.context.AurisPlatformServices.rbac.requireAccess=()=>{throw Error('Denied');};}]){
    let r;r=runtime(url=>{if(url.startsWith(endpoint))change(r);return url.startsWith('/permits?')?[record]:[];});await assert.rejects(r.api.load(source,current),/changed|Denied/);
  }
  const r=runtime(withRecord());let valid=true;r.context.AurisPlatformServices.api.request=async url=>{valid=false;return [record];};await assert.rejects(r.api.load(source,current,{assertContext:()=>{if(!valid)throw Error('Register changed');}}),/Register changed/);
});
test('adapter is explicit-only and exposes reference copying and guarded controls only',async()=>{
  const r=runtime();let opened=0;await r.api.open('permit-1',{...catalogues,openControls:async value=>{assert.equal(value.companyId,'co-a');opened++;}});
  assert.equal(r.adapters['permit-record'].explicitOnly,true);assert.equal(r.adapters['permit-record'].canEdit(),false);assert.equal(r.options.availableActions.join(','),'copy,open');assert.match(r.options.workflowHelp,/read-only, not authorisation/);
  await r.options.onAction('copy',source,{...record,reference_label:'PTW-001'});assert.equal(r.clipboard,'PTW-001');assert.equal(opened,0);
  assert.equal((await r.options.onAction('open',source,record)).close,true);assert.equal(opened,1);
  for(const key of ['approve','edit','activate','close'])await assert.rejects(r.options.onAction(key,source,record),/unavailable/);
});
test('failed offline foreign-record and changed-session controls handoffs keep overview open',async()=>{
  const r=runtime();await r.api.open('permit-1',{openControls:async()=>{throw Error('Controls failed');}});
  await assert.rejects(r.options.onAction('open',source,record),/Controls failed/);await assert.rejects(r.options.onAction('open',{...source,id:'other'},record),/identity changed/);await assert.rejects(r.options.onAction('open',source,{...record,company_id:'co-b'}),/unavailable/);
  r.context.navigator.onLine=false;await assert.rejects(r.options.onAction('open',source,record),/Reconnect/);r.context.navigator.onLine=true;r.identity.role='viewer';await assert.rejects(r.options.onAction('open',source,record),/changed/);
});
test('core opens overview without mutating the cached permit and refetches on controls handoff',async()=>{
  let options,opened=0;const calls=[],context={ptwAllData:[{...record}],ptwListContext:{...current,generation:2},ptwListLoadGeneration:2,ptwListViewGeneration:3,ccid:()=>current.companyId,prof:{id:current.userId},activeRole:()=>current.role,canAccessPage:()=>true,navigator:{onLine:true},PTW_TYPE_CFG:catalogues.types,PTW_STATUS_CFG:catalogues.statuses,api:async url=>{calls.push(url);return [{...record,status:'cancelled'}];},ptwShowDetail:()=>{opened++;},window:{AurisPermitRecordWorkspace:{open:async(id,value)=>{assert.equal(id,'permit-1');options=value;}}}};
  vm.runInNewContext(core.slice(core.indexOf('async function ptwOpenFromRegister('),core.indexOf('// -- DETAIL VIEW',core.indexOf('async function ptwOpenFromRegister('))),context);
  await context.ptwOpenFromRegister('permit-1',current,2,3);assert.equal(calls.length,0);assert.equal(opened,0);assert.equal(context.ptwAllData[0].status,'suspended');
  await options.openControls();assert.equal(calls.length,1);assert.match(calls[0],/company_id=eq.co-a&id=eq.permit-1&limit=1/);assert.equal(opened,1);assert.equal(context.ptwAllData[0].status,'cancelled');
  context.ptwListViewGeneration++;assert.throws(()=>options.assertContext(),/register changed/);await assert.rejects(options.openControls(),/register changed/);assert.equal(opened,1);
});
test('new record adapter is release-required, escaped by shared rendering and contains no business writes',async()=>{
  const html=read('index.html'),adapter=read('auris-permit-record-workspace.js');assert.ok(html.indexOf('src="auris-permit-list-workspace.js?')<html.indexOf('src="auris-permit-record-workspace.js?'));assert.ok(html.indexOf('src="auris-permit-record-workspace.js?')<html.indexOf('src="auris-core.js?'));
  for(const file of ['sw-assets.js','scripts/verify-production-smoke.cjs','scripts/verify-staging-acceptance.cjs'])assert.match(read(file),/auris-permit-record-workspace\.js/);
  assert.doesNotMatch(adapter,/\bfetch\(|\bptwAllData\b|\bptwShowDetail\(|onTransition|m:['"](POST|PATCH|DELETE)/);
  assert.match(read('auris-record-workspace.js'),/esc\(field\.value\)/);assert.match(read('auris-record-workspace.css'),/\.arw-section dd\{white-space:pre-line\}/);
  assert.match(read('auris-record-workspace.css'),/dl>div:only-child\{grid-column:1\/-1\}/);
});
