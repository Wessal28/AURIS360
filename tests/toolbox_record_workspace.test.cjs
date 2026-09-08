const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8'),core=read('auris-core.js');
const source={module:'meetings',table:'toolbox_talks',id:'talk-1',company_id:'co-a'},current={companyId:'co-a',userId:'user-a',role:'manager'};
const record={id:'talk-1',company_id:'co-a',tbt_ref:'TBT-001',title:'Safe handling',status:'draft',topic_category:'chemical',talk_date:'2026-09-08',duration_mins:0,presenter:'Presenter',key_points:'Check labels\nWear gloves',hazards_discussed:'Chemical splash',incidents_referenced:'EV-001',attendees:[{name:'Person One',dept:'Ops',organization_snapshot:'Company A',role_snapshot:'Operator',confirmed_at:'2026-09-08T08:30:00+04:00',confirmation_method:'employee_code',pin:'never-display-this'},{full_name:'Person Two',confirmed_at:null}],attendance_count:10,actions_raised:[{description:'Check gloves',assigned_to:'Supervisor',due_date:'2026-09-09'}],notes:'Retained notes\n\n[AURIS360_LINKED_WORK:{"id":"work-1","ref":"WS-001","title":"Chemical handling"}]'};
function runtime(respond=()=>[]){
  const identity={company:{id:'co-a'},profile:{id:'user-a'},role:'manager'},calls=[],adapters={};let options,clipboard;
  const context={navigator:{onLine:true,clipboard:{writeText:async value=>clipboard=value}},AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>true,current:()=>identity},rbac:{requireAccess:key=>assert.equal(key,'meetings')},api:{request:async(...args)=>{assert.equal(args.length,1,'reads only');calls.push(args[0]);return respond(args[0]);}}},AurisRecordWorkspace:{registerAdapter:value=>adapters[value.key]=value,open:async value=>{options=value;return value;}}};
  vm.runInNewContext(read('auris-toolbox-list-workspace.js'),context);vm.runInNewContext(read('auris-toolbox-record-workspace.js'),context);
  return {api:context.AurisToolboxRecordWorkspace,context,identity,calls,adapters,get options(){return options;},get clipboard(){return clipboard;}};
}
const withRecord=(handler=()=>[],row=record)=>url=>url.startsWith('/toolbox_talks?')?[row]:handler(url);
test('toolbox overview reads exact company/record before bounded shared history',async()=>{
  const r=runtime(withRecord()),before=JSON.stringify(record),result=await r.api.load(source,current,{topics:{chemical:{label:'Chemical / COSHH'}}});
  assert.equal(r.calls[0],'/toolbox_talks?select=*&company_id=eq.co-a&id=eq.talk-1&limit=1');assert.equal(r.calls.length,3);
  for(const url of r.calls.slice(1)){assert.match(url,/company_id=eq.co-a/);assert.match(url,/meetings/);assert.match(url,/toolbox_talks/);assert.match(url,/talk-1/);assert.match(url,/limit=101/);}
  assert.equal(result.record.topic_label,'Chemical / COSHH');assert.equal(result.record.status_label,'Draft');assert.equal(result.record.duration_label,0);assert.equal(result.record.date_label,'2026-09-08');assert.equal(JSON.stringify(record),before);
});
test('attendance preserves names, snapshots, times, methods and missing confirmation without exposing PINs',async()=>{
  const value=(await runtime(withRecord()).api.load(source,current)).record;
  assert.equal(value.attendance_label,2);assert.match(value.attendees_label,/Person One.*\nDepartment: Ops; Organisation: Company A; Role: Operator/);assert.match(value.attendees_label,/Recorded method: employee_code/);assert.match(value.attendees_label,/Person Two.*\n.*\nConfirmation time: Not recorded/);assert.doesNotMatch(value.attendees_label,/never-display-this|Confirmed|Approved/);
});
test('linked work, content and action snapshots retain facts without implying live state',async()=>{
  const value=await runtime(withRecord()).api.load(source,current);
  assert.equal(value.record.notes_label,'Retained notes');assert.match(value.record.work_label,/Work ID: work-1\nReference: WS-001\nTitle: Chemical handling/);
  assert.equal(value.record.key_points,'Check labels\nWear gloves');assert.match(value.record.actions_label,/Check gloves\nAssigned to: Supervisor; Due: 2026-09-09/);assert.match(value.notices.join(' '),/snapshots, not live status or proof/);
});
test('missing malformed and conflicting snapshots are disclosed, never guessed or silently removed',async()=>{
  const row={id:'talk-1',company_id:'co-a',status:'legacy-status',attendees:{broken:true},actions_raised:[null],notes:'Original [AURIS360_LINKED_WORK:{bad}]'};
  const value=(await runtime(withRecord(()=>[],row)).api.load(source,current)).record;
  assert.equal(value.status_label,'legacy-status');assert.equal(value.duration_label,'Not recorded');assert.equal(value.attendance_label,'Not recorded');assert.match(value.attendees_label,/malformed/);assert.match(value.actions_label,/Malformed/);assert.match(value.work_label,/malformed/);assert.equal(value.notes_label,row.notes);
  const conflict=(await runtime(withRecord(()=>[],{...record,work_order_id:'other'})).api.load(source,current)).record;assert.match(conflict.work_label,/Conflicting/);assert.equal(conflict.notes_label,record.notes);
  const legacy=(await runtime(withRecord(()=>[],{id:'talk-1',company_id:'co-a',attendance_count:0,attendees:[],actions_raised:[]})).api.load(source,current)).record;assert.equal(legacy.attendance_label,0);assert.match(legacy.attendees_label,/No entries recorded/);assert.equal(legacy.status_label,'Not recorded');
});
test('missing duplicate malformed foreign and wrong-ID talk responses fail before history',async()=>{
  for(const payload of [null,{},[],[null],[record,record],[{...record,id:'other'}],[{...record,company_id:'co-b'}]]){const r=runtime(()=>payload);await assert.rejects(r.api.load(source,current),/unavailable|outside/);assert.equal(r.calls.length,1);}
});
test('invalid source, unauthenticated and denied access fail before requests',async()=>{
  const r=runtime();for(const change of [{module:'meeting'},{table:'meetings'},{company_id:'co-b'},{id:'a&company_id=eq.other'}])await assert.rejects(r.api.load({...source,...change},current),/source|exact toolbox/);
  await assert.rejects(r.api.open('a&company_id=eq.other'),/exact toolbox/);r.context.AurisPlatformServices.auth.isAuthenticated=()=>false;await assert.rejects(r.api.open('talk-1'),/Sign in/);
  r.context.AurisPlatformServices.auth.isAuthenticated=()=>true;r.context.AurisPlatformServices.rbac.requireAccess=()=>{throw Error('Denied');};await assert.rejects(r.api.load(source,current),/Denied/);assert.equal(r.calls.length,0);
});
test('shared activities, evidence, requests and decisions reject contradictory identities',async()=>{
  const work={id:'w1',company_id:'co-a',source_module:'meetings',source_table:'toolbox_talks',source_record_id:'talk-1',activity_type:'comment',body:'Review',evidence:[{label:'Report',url:'https://example.invalid/report'}]};
  const approval={id:'p1',company_id:'co-a',module_name:'meetings',related_table:'toolbox_talks',related_id:'talk-1',source_record_id:'talk-1',request_reason:'Review only'};
  const r=runtime(withRecord(url=>{
    if(url.startsWith('/work_activities?'))return [null,work,{...work,company_id:'co-b'},{...work,source_module:'meeting'},{...work,source_table:'meetings'},{...work,related_id:'other'}];
    if(url.startsWith('/approval_requests?'))return [null,approval,{...approval,id:'bad',company_id:'co-b'},{...approval,id:'bad2',related_id:'other'},{...approval,id:'bad3',module_name:'meeting'}];
    if(url.startsWith('/approval_decisions?')){assert.match(url,/request_id=in.\(p1\)/);return [{id:'d1',request_id:'p1',decision:'approved'},{id:'d2',request_id:'bad',decision:'rejected'},{request_id:'p1',company_id:'co-b'},{request_id:'p1',source_table:'events'}];}return [];
  }));
  const result=await r.api.load(source,current);assert.equal(result.approvals.length,1);assert.equal(result.activities.length,3);assert.equal(result.activities[1].activity_type,'evidence');assert.equal(result.activities[2].body,'approved');
  for(const item of result.activities){assert.equal(item.company_id,'co-a');assert.equal(item.source_module,'meetings');assert.equal(item.source_table,'toolbox_talks');assert.equal(item.source_record_id,'talk-1');}
});
test('unavailable and truncated history is disclosed without raw server errors',async()=>{
  const r=runtime(withRecord(url=>{if(url.startsWith('/work_activities?'))return Array.from({length:101},(_,i)=>({id:String(i),company_id:'co-a',source_module:'meetings',source_table:'toolbox_talks',source_record_id:'talk-1',activity_type:'comment'}));throw Error('secret server details');}));
  const result=await r.api.load(source,current);assert.equal(result.activities.length,100);assert.match(result.notices.join(' '),/latest 100/);assert.match(result.notices.join(' '),/Shared approval requests is unavailable/);assert.doesNotMatch(result.notices.join(' '),/secret/);
  const malformed=await runtime(withRecord(()=>({bad:true}))).api.load(source,current);assert.match(malformed.notices.join(' '),/Shared activity and evidence is unavailable/);
});
test('session and register changes during record/history loads invalidate the result',async()=>{
  const r=runtime(url=>{r.identity.company.id='co-b';return [record];});await assert.rejects(r.api.load(source,current),/changed/);
  let valid=true;const history=runtime(withRecord(()=>{valid=false;return [];}));await assert.rejects(history.api.load(source,current,{assertContext:()=>{if(!valid)throw Error('Register changed');}}),/Register changed/);
});
test('explicit read-only adapter permits only copy and successful editor handoff with intentional view change',async()=>{
  const r=runtime();let valid=true,opened=0;await r.api.open('talk-1',{assertContext:()=>{if(!valid)throw Error('Register changed');},openEditor:async value=>{assert.equal(value.companyId,'co-a');opened++;valid=false;}});
  assert.equal(r.adapters['toolbox-record'].explicitOnly,true);assert.equal(r.adapters['toolbox-record'].canEdit(),false);assert.equal(r.options.availableActions.join(','),'copy,open');
  await r.options.onAction('copy',source,record);assert.equal(r.clipboard,'TBT-001');
  for(const key of ['approve','edit','delete','confirm'])await assert.rejects(r.options.onAction(key,source,record),/unavailable/);
  assert.equal((await r.options.onAction('open',source,record)).close,true);assert.equal(opened,1);
});
test('failed offline foreign and changed-session editor actions do not close the overview',async()=>{
  const r=runtime();await r.api.open('talk-1',{openEditor:async()=>{throw Error('Form failed');}});
  await assert.rejects(r.options.onAction('open',source,record),/Form failed/);await assert.rejects(r.options.onAction('open',{...source,id:'other'},record),/identity changed/);await assert.rejects(r.options.onAction('open',source,{...record,company_id:'co-b'}),/unavailable/);
  r.context.navigator.onLine=false;await assert.rejects(r.options.onAction('open',source,record),/Reconnect/);r.context.navigator.onLine=true;r.identity.role='viewer';await assert.rejects(r.options.onAction('open',source,record),/changed/);
});
test('core opens overview without changing cached talk then re-fetches exact current record for the form',async()=>{
  let options,opened=0;const calls=[],context={tbtAllData:[{...record}],tbtListContext:{...current,generation:2},tbtListLoadGeneration:2,tbtListViewGeneration:3,ccid:()=>current.companyId,prof:{id:current.userId},activeRole:()=>current.role,canAccessPage:()=>true,navigator:{onLine:true},TBT_TOPIC_CFG:{},api:async url=>{calls.push(url);return [{...record,status:'cancelled'}];},tbtEdit:()=>{opened++;context.tbtListViewGeneration++;},window:{AurisToolboxRecordWorkspace:{open:async(id,value)=>{assert.equal(id,'talk-1');options=value;}}}};
  vm.runInNewContext(core.slice(core.indexOf('async function tbtOpenFromRegister('),core.indexOf('function tbtShowForm(){')),context);
  await context.tbtOpenFromRegister('talk-1',current,2,3);assert.equal(calls.length,0);assert.equal(opened,0);assert.equal(context.tbtAllData[0].status,'draft');
  await options.openEditor();assert.equal(calls.length,1);assert.match(calls[0],/company_id=eq.co-a&id=eq.talk-1&limit=1/);assert.equal(opened,1);assert.equal(context.tbtAllData[0].status,'cancelled');
  assert.throws(()=>options.assertContext(),/register changed/);await assert.rejects(options.openEditor(),/register changed/);assert.equal(opened,1);
});
test('new record adapter is ordered and release-required with no business writes or new transitions',()=>{
  const html=read('index.html'),adapter=read('auris-toolbox-record-workspace.js');assert.ok(html.indexOf('src="auris-toolbox-list-workspace.js?')<html.indexOf('src="auris-toolbox-record-workspace.js?'));assert.ok(html.indexOf('src="auris-toolbox-record-workspace.js?')<html.indexOf('src="auris-core.js?'));
  for(const file of ['sw-assets.js','scripts/verify-production-smoke.cjs','scripts/verify-staging-acceptance.cjs'])assert.match(read(file),/auris-toolbox-record-workspace\.js/);
  assert.doesNotMatch(adapter,/\bfetch\(|\btbtAllData\b|\btbtEdit\(|onTransition|m:['"](POST|PATCH|DELETE)/);
});
