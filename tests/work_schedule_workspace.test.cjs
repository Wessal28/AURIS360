const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../auris-work-schedule-workspace.js'),'utf8');
const rows=[{id:'wo-1',company_id:'co-a',title:'Service pump',ref_number:'WO-001',supervisor_name:'Ada Smith',status:'in_progress',priority:'high',planned_start:'2026-09-19',planned_end:'2026-09-20',toolbox_talk_id:'11111111-1111-4111-8111-111111111111'},{id:'wo-2',company_id:'co-a',title:'Cancelled job',status:'cancelled',priority:'low',planned_end:'2026-09-01'},{id:'secret',company_id:'co-b',title:'Other company'}];
function runtime(){
  const identity={company:{id:'co-a'},profile:{id:'user-a'},role:'manager'},requests=[];let mounted,view,canEdit=true,allowed=true;
  const context={document:{getElementById:()=>null},URL,URLSearchParams,Date,console,location:{search:''},wsAllData:[],wsCurrentId:null,ccid:()=>identity.company.id,isMgr:()=>canEdit,canAccessPage:()=>allowed,toast:()=>{},escH:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),wsRestEqValue:encodeURIComponent,
    deepLinkRecordUrl:record=>'https://example.com/?goto='+record.module+'&record='+record.id+'&company='+record.company_id+'&table='+record.table,
    AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>true,current:()=>identity},rbac:{requireAccess:key=>{assert.equal(key,'workschedule');if(!allowed)throw Error('Access denied');}}},
    AurisViewEngine:{mount:(host,data,options)=>{mounted={data,options};return mounted;}},
    api:async(url,options)=>{assert.equal(options,undefined,'record viewing never writes');requests.push(url);if(url.startsWith('/work_schedule?'))return [rows[0]];if(url.startsWith('/work_schedule_links?'))return [];if(url.startsWith('/toolbox_talks?'))return [{id:rows[0].toolbox_talk_id,company_id:'co-a',title:'Linked talk'}];throw Error('Unexpected request '+url);},
    wsEdit:async id=>{view={edit:id};},wsShowDetail:async id=>{view={manage:id};}
  };context.window=context;vm.createContext(context);vm.runInContext(source,context);context.wsShowReadOnly=(...args)=>{view=args;};
  return {context,identity,requests,api:context.AurisWorkScheduleWorkspace,mounted:()=>mounted,view:()=>view,viewer:()=>{canEdit=false;},deny:()=>{allowed=false;}};
}
test('work filters combine supervisor search, priority and status without leaking other companies',()=>{
  const r=runtime(),current=r.api.session(),select=filters=>Array.from(r.api.project(rows,current,{filters}),x=>x.id);
  assert.deepEqual(select({}),['wo-1','wo-2']);assert.deepEqual(select({search:'ada',priority:'high',status:'in_progress'}),['wo-1']);assert.deepEqual(select({search:'ada',priority:'low'}),[]);assert.deepEqual(select({status:'cancelled'}),['wo-2']);
});
test('day boundaries include both endpoints and due today is not overdue',()=>{
  const r=runtime();assert.equal(r.api.onDay(rows[0],'2026-09-20'),true);assert.equal(r.api.onDay(rows[0],'2026-09-21'),false);assert.equal(r.api.onDay({planned_start:'2026-09-20'},'2026-09-20'),true);
  assert.equal(r.api.overdue(rows[0],new Date(2026,8,20,23,59)),false);assert.equal(r.api.overdue(rows[0],new Date(2026,8,21)),true);assert.equal(r.api.overdue(rows[1],new Date(2026,8,21)),false);
});
test('saved filters use the shared register and reject a changed session',()=>{
  const r=runtime();let applied;r.api.mount({},rows,{canEdit:false,filters:{status:'cancelled'},onApplyFilters:f=>{applied=f;}});const m=r.mounted();assert.equal(m.options.moduleKey,'work-schedule');assert.equal(m.options.actions[1].when(),false);m.options.onApplyFilters({search:'Ada'});assert.equal(applied.search,'Ada');
  assert.equal(m.options.actions[0].href,undefined);assert.equal(typeof m.options.onAction,'function');r.identity.company.id='co-b';assert.throws(()=>m.options.onApplyFilters({}),/changed/);
});
test('read-only rendering escapes record content and creates no editing controls',()=>{
  const r=runtime(),html=r.context.wsReadOnlyHtml({description:'<img onerror=bad>',requires_ra:false,team_members:['Ada','Ben']});assert.match(html,/&lt;img/);assert.match(html,/Ada, Ben/);assert.match(html,/No<\/dd>/);assert.doesNotMatch(html,/<input|<select|<textarea|contenteditable|<img/);
});
test('view loads the exact company record and its links through read-only requests',async()=>{
  const r=runtime();assert.equal(await r.context.wsOpenRecordRequest({record:'wo-1',company:'co-a',table:'work_schedule'}),true);assert.equal(r.view()[0].id,'wo-1');assert.match(r.requests[0],/id=eq.wo-1&company_id=eq.co-a/);
  await assert.rejects(r.context.wsOpenRecordRequest({record:'wo-1',company:'co-b'}),/company/);
});
test('linked view verifies the parent relationship and module access before opening',async()=>{
  const r=runtime();r.context.location.search='?wsLinkedKind=tbt&wsLinkedValue='+rows[0].toolbox_talk_id;
  await r.context.wsOpenRecordRequest({record:'wo-1',company:'co-a'});assert.equal(r.view()[3].row.title,'Linked talk');assert.match(r.requests.at(-1),/toolbox_talks.*company_id=eq.co-a&id=eq/);
  r.context.location.search='?wsLinkedKind=tbt&wsLinkedValue=unrelated';await assert.rejects(r.context.wsOpenRecordRequest({record:'wo-1'}),/no longer linked/);
});
test('edit and manage require manager access, stale responses never open',async()=>{
  const r=runtime();r.context.location.search='?wsMode=edit';await r.context.wsOpenRecordRequest({record:'wo-1'});assert.equal(r.view().edit,'wo-1');r.viewer();await assert.rejects(r.context.wsOpenRecordRequest({record:'wo-1'}),/Manager/);
  const stale=runtime();stale.context.api=async()=>{stale.identity.company.id='co-b';return [rows[0]];};await assert.rejects(stale.context.wsOpenRecordRequest({record:'wo-1'}),/changed/);assert.equal(stale.view(),undefined);
});
test('additional link failure is disclosed while direct links remain available',async()=>{
  const r=runtime();r.context.api=async()=>{throw Error('offline');};const data=await r.context.wsReadRecordLinks(rows[0],r.api.session());assert.match(data.warning,/could not be loaded/);assert.equal(data.links[0].kind,'tbt');
});

test('linked labels resolve readable references without changing exact record IDs',async()=>{
 const r=runtime(),id=rows[0].toolbox_talk_id;
 r.context.api=async url=>url.startsWith('/toolbox_talks?')?[{id,company_id:'co-a',tbt_ref:'TBT-0042'}]:[];
 const result=await r.context.wsReadRecordLinks(rows[0],r.context.AurisWorkScheduleWorkspace.session());
 assert.equal(result.links[0].ref,'TBT-0042');assert.equal(result.links[0].value,id);
 r.context.api=async()=>{throw Error('offline');};
 const fallback=await r.context.wsReadRecordLinks(rows[0],r.context.AurisWorkScheduleWorkspace.session());
 assert.equal(fallback.links[0].ref,'Reference unavailable');assert.equal(fallback.links[0].value,id);
});
test('reference lookup rejects another company record',async()=>{
 const r=runtime();r.context.api=async url=>url.startsWith('/toolbox_talks?')?[{id:rows[0].toolbox_talk_id,company_id:'co-b',tbt_ref:'PRIVATE'}]:[];
 const result=await r.context.wsReadRecordLinks(rows[0],r.context.AurisWorkScheduleWorkspace.session());assert.equal(result.links[0].ref,'Reference unavailable');
});
test('work order startup mask is removed on completion and has a bounded fallback',()=>{
 let timer,removed=false;const r=runtime();r.context.location.search='?wsMode=view';r.context.document={documentElement:{classList:{add:()=>{},remove:()=>{removed=true;}}}};r.context.setTimeout=(fn,ms)=>{timer=fn;assert.equal(ms,30000);return 1;};r.context.clearTimeout=()=>{};
 vm.runInNewContext(source,r.context);assert.equal(removed,false);timer();assert.equal(removed,true);
});

test('register view uses the existing authenticated page and never opens a browser window',async()=>{
 const r=runtime();r.context.open=()=>{throw Error('Unexpected browser window');};r.api.mount({},rows,{canEdit:true});const m=r.mounted();await m.options.onAction('view',m.data[0]);assert.equal(r.view()[0].id,'wo-1');assert.ok(m.options.actions.every(action=>!action.href));
 r.context.location.search='?wsMode=edit';await r.context.wsRecordWindow('wo-1','view');assert.equal(r.view()[0].id,'wo-1');
});

test('linked toolbox form renders attendance without internal metadata or JSON',()=>{
 const r=runtime();const html=r.context.wsLinkedRecordHtml({info:{table:'toolbox_talks'},row:{tbt_ref:'TBT-001',title:'Safety',created_at:'PRIVATE_DATE',presenter_person_id:'PRIVATE_ID',attendees:[{name:'Ada',signed:true,person_id:'SECRET_ID'},{name:'Ben',signed:false}]}});
 assert.match(html,/<table>/);assert.match(html,/Ada/);assert.match(html,/Not confirmed/);assert.doesNotMatch(html,/PRIVATE|SECRET|person_id|created_at|updated_at/);
});
test('linked inspections use the existing inspection report form',()=>{
 const r=runtime();let received;r.context.auditInspectionReportHTML=row=>{received=row;return 'Inspection form';};const row={reference_no:'WI-001',items:[]};assert.equal(r.context.wsLinkedRecordHtml({info:{table:'inspections'},row}),'Inspection form');assert.equal(received,row);
});

test('linked dialog Back returns to parent work order in read-only mode',async()=>{
 const r=runtime(),listeners={};const button={disabled:false,addEventListener:(event,fn)=>{listeners.back=fn;},focus:()=>{}};
 const host={innerHTML:'',querySelector:selector=>selector==='[data-ws-back]'?button:{addEventListener:()=>{},focus:()=>{}},addEventListener:()=>{},remove:()=>{}};
 r.context.document={getElementById:id=>id==='page-workschedule'?{appendChild:()=>{}}:null,createElement:()=>host};
 const start=source.indexOf('function wsShowReadOnly('),end=source.indexOf('async function wsOpenRecordRequest',start);vm.runInContext(source.slice(start,end),r.context);
 let request;r.context.wsOpenRecordRequest=async req=>{request=req;return true;};
 r.context.wsShowReadOnly(rows[0],r.api.session(),{links:[]},{info:{table:'toolbox_talks',ref:'tbt_ref',label:'Toolbox talk'},row:{tbt_ref:'TBT-001'}});
 assert.match(host.innerHTML,/Back to work order/);await listeners.back();assert.equal(request.record,'wo-1');assert.equal(request.mode,'view');assert.equal(request.company,'co-a');assert.equal(button.disabled,false);
});

test('related records list includes every linked type and escapes reference text',()=>{
 const r=runtime(),links=[{kind:'tbt',value:'t1',ref:'TBT-001'},{kind:'prestart',value:'p1',ref:'PS-001'},{kind:'site',value:'s1',ref:'<WI-001>'}];
 const html=r.context.wsRelatedRecordsHtml({links},null);assert.equal((html.match(/data-ws-related=/g)||[]).length,3);assert.match(html,/Toolbox talk/);assert.match(html,/Pre-start check/);assert.match(html,/Site inspection/);assert.match(html,/&lt;WI-001&gt;/);assert.doesNotMatch(html,/target="_blank"/);
});

test('all saved toolbox talks for a work order appear even when the link table is unavailable',async()=>{
 const r=runtime(),queries=[];r.context.api=async url=>{
  queries.push(url);
  if(url.startsWith('/work_schedule_links?'))throw Error('link table unavailable');
  if(url.includes('work_schedule_id=eq.wo-1'))return [{id:'talk-a',company_id:'co-a',work_schedule_id:'wo-1',tbt_ref:'TBT-A'},{id:'talk-b',company_id:'co-b',work_schedule_id:'wo-1',tbt_ref:'PRIVATE'}];
  if(url.includes('notes=ilike.'))return [{id:'talk-c',company_id:'co-a',tbt_ref:'TBT-C',notes:'[AURIS360_LINKED_WORK:{"id":"wo-1"}]'},{id:'talk-d',company_id:'co-a',tbt_ref:'TBT-D',notes:'[AURIS360_LINKED_WORK:{"id":"other"}]'}];
  return [];
 };
 const data=await r.context.wsReadRecordLinks(rows[0],r.api.session());
 assert.deepEqual(Array.from(data.links.filter(link=>link.kind==='tbt'),link=>link.ref),['TBT-A','TBT-C','Reference unavailable']);
 assert.ok(queries.every(url=>url.includes('company_id=eq.co-a')));
});
test('read-only work order puts creation shortcuts above details and related records below',()=>{
 const r=runtime(),host={innerHTML:'',querySelector:()=>({addEventListener:()=>{},focus:()=>{}}),addEventListener:()=>{}};
 r.context.document={getElementById:id=>id==='page-workschedule'?{appendChild:()=>{}}:null,createElement:()=>host};
 const start=source.indexOf('function wsShowReadOnly('),end=source.indexOf('async function wsOpenRecordRequest',start);vm.runInContext(source.slice(start,end),r.context);
 r.context.wsShowReadOnly(rows[0],r.api.session(),{links:[]},null);
 assert.ok(host.innerHTML.indexOf('data-ws-create="tbt"')<host.innerHTML.indexOf('Work details'));
 assert.ok(host.innerHTML.indexOf('Work details')<host.innerHTML.indexOf('Related HSE records'));
});
