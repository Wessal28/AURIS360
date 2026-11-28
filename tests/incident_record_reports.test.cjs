const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('incident-record-reports.js','utf8');
const css=fs.readFileSync('auris-print-incident.css','utf8');
const upgrade=fs.readFileSync('incident-management-upgrade.js','utf8');
function fixture(){
 const context={console,Date,JSON,Object,Array,String,encodeURIComponent,Error};context.window=context;
 vm.runInNewContext(source,context);
 let identity={companyId:'company-a',userId:'user-a',role:'hse_manager'},permission=true,hook=null;
 const incident={id:'incident-a',company_id:'company-a',event_ref:'INC-2026-001',status:'submitted',event_type:'injury',description:'The full recorded description\nSecond line',event_date:'2026-07-20',event_time:'10:30',estimated_time:true,location:'Workshop',reported_by_name:'Reporter',injured_person:'Saved person',injury_type:'first_aid',treatment:'First aid',confidentiality:'internal'};
 const investigation={id:'investigation-a',company_id:'company-a',event_id:'incident-a',investigation_ref:'INV-2026-001',status:'closed',description:'Investigation facts',root_causes:'Recorded root cause',five_whys:['First why','Second why'],fishbone_causes:{methods:'Recorded methods'},timeline_events:[{time:'10:30',description:'Recorded event'}],corrective_actions:JSON.stringify([{description:'Route the cable',status:'open'}]),sign_approver:'Recorded approver',sign_app_date:'2026-08-01',confidentiality:'internal'};
 const communication={id:'communication-a',company_id:'company-a',record_type:'safety_communication',title:'Saved safety alert',status:'draft',payload:{incident_ref:'INC-2026-001',headline:'Keep access routes clear',event_date:'2026-07-20',location:'Workshop',what_happened:'Recorded facts',immediate_causes:'Recorded cause',actions_taken:['Recorded control'],shared_learning:'Full learning\nSecond line',relevant_standards:'Saved requirements',contact:'HSE team'}};
 const lesson={id:'lesson-a',company_id:'company-a',record_type:'lesson',title:'Saved lesson',status:'approved',payload:{key_learning:'A full learning paragraph. '.repeat(100),approved_facts:'Reviewed facts',required_behaviours:'Keep routes clear'}};
 const rows={events:[incident],investigations:[investigation],incident_mgmt_records:[communication,lesson]},reads=[],printed=[],prepared=[];
 const services={session:()=>identity,canRead:(kind,row)=>permission,companyName:()=> 'Fictional company',incidentReference:()=>incident.event_ref,api:async path=>{reads.push(path);if(hook)await hook(path);const url=new URL('https://fixture.invalid'+path),table=url.pathname.slice(1),id=url.searchParams.get('id')?.slice(3);return structuredClone((rows[table]||[]).filter(row=>row.id===id));},preparePrint:()=>{const win={closed:false,close(){this.closed=true;}};prepared.push(win);return win;},print:(...args)=>printed.push(args)};
 return {R:context.AurisIncidentReports,services,rows,incident,investigation,communication,lesson,reads,printed,prepared,setIdentity:v=>{identity={...identity,...v};},setPermission:v=>{permission=v;},setHook:v=>{hook=v;}};
}
test('incident viewer loads exactly one fresh company-scoped source and keeps complete saved facts',async()=>{
 const h=fixture(),before=structuredClone(h.rows),receipt=await h.R.load('incident','incident-a',h.services);
 assert.match(h.reads[0],/^\/events\?select=\*&company_id=eq\.company-a&id=eq\.incident-a&limit=2$/);
 for(const value of ['INC-2026-001','The full recorded description','Second line','10:30','Estimated','Saved person','First aid','Fictional company'])assert.ok(receipt.html.includes(value),value);
 assert.equal(receipt.record.status,'submitted');assert.deepEqual(h.rows,before);
});
test('investigation report uses current field names, all structured analysis and recorded sign-off without creating approvals',async()=>{
 const h=fixture(),receipt=await h.R.load('investigation','investigation-a',h.services);
 for(const value of ['INV-2026-001','INC-2026-001','First why','Second why','Recorded methods','Recorded event','Route the cable','Recorded approver','2026-08-01'])assert.ok(receipt.html.includes(value),value);
 assert.equal(receipt.record.status,'closed');assert.equal(h.reads.length,2);assert.ok(h.reads.every(path=>!path.includes('/rpc/')));
});
test('lesson view preserves the full long text and exposes a left-aligned details grid',async()=>{
 const h=fixture(),receipt=await h.R.load('record','lesson-a',h.services);
 assert.ok(receipt.html.includes(h.lesson.payload.key_learning));assert.match(receipt.html,/imx-detail-field full/);assert.doesNotMatch(receipt.html,/text-align:right|max-width:62%/);
 assert.match(css,/\.imx-detail-field>dd\{[^}]*text-align:left/);assert.match(css,/white-space:pre-wrap/);
});
test('safety communication view and print reuse the exact same orange document, CSS and saved snapshot',async()=>{
 const h=fixture(),receipt=await h.R.load('communication','communication-a',h.services),reads=h.reads.length;
 h.communication.payload.shared_learning='Changed after the viewer opened';
 await h.R.print('communication','communication-a',h.services,receipt);
 assert.equal(h.reads.length,reads);assert.equal(h.printed.length,1);assert.equal(h.printed[0][0],receipt.html);
 assert.match(receipt.html,/<link rel="stylesheet" href="\/auris-print-incident\.css\?v=20261128-1">/);
 for(const value of ['imx-safety-comm','What happened','Immediate root causes','Actions taken','Shared learning','Relevant group standards / required behaviours'])assert.ok(receipt.html.includes(value),value);
 assert.match(css,/background:linear-gradient\(135deg,#f97316,#dc2626\)/);assert.match(css,/print-color-adjust:exact/);
 assert.equal(h.communication.status,'draft');
});
test('register printing reserves its window synchronously, then reads the exact saved record',async()=>{
 const h=fixture();let release;h.setHook(()=>new Promise(resolve=>{release=resolve;}));
 const pending=h.R.print('incident','incident-a',h.services);assert.equal(h.prepared.length,1);assert.equal(h.printed.length,0);
 release();await pending;assert.equal(h.printed.length,1);assert.equal(h.printed[0][2],h.prepared[0]);
});
test('changing company, user or role during a read blocks the viewer and print, closing only its blank prepared window',async()=>{
 for(const change of [{companyId:'company-b'},{userId:'other-user'},{role:'employee'}]){
  const h=fixture();h.setHook(async()=>h.setIdentity(change));await assert.rejects(h.R.load('incident','incident-a',h.services),/changed/);
  const p=fixture();p.setHook(async()=>p.setIdentity(change));await assert.rejects(p.R.print('incident','incident-a',p.services),/changed/);assert.equal(p.printed.length,0);assert.equal(p.prepared[0].closed,true);
 }
});
test('wrong-company, missing, duplicate and mismatched row receipts cannot render or print',async()=>{
 for(const change of [h=>h.incident.company_id='company-b',h=>h.rows.events=[],h=>h.rows.events.push(structuredClone(h.incident)),h=>h.services.api=async()=>[{...h.incident,id:'another-id'}]]){
  const h=fixture();change(h);await assert.rejects(h.R.print('incident','incident-a',h.services),/unavailable/);assert.equal(h.printed.length,0);assert.equal(h.prepared[0].closed,true);
 }
});
test('lost view or confidentiality permission prevents reuse of an earlier viewer receipt',async()=>{
 const h=fixture(),receipt=await h.R.load('incident','incident-a',h.services);h.setPermission(false);
 await assert.rejects(h.R.print('incident','incident-a',h.services,receipt),/access/);assert.equal(h.printed.length,0);
 const privateRecord=fixture();privateRecord.incident.confidentiality='privileged';privateRecord.services.canRead=(kind,row)=>!row||row.confidentiality!=='privileged';
 await assert.rejects(privateRecord.R.load('incident','incident-a',privateRecord.services),/access/);
});
test('record-type and authoritative incident-link mismatches fail instead of printing another source',async()=>{
 const h=fixture();await assert.rejects(h.R.load('communication','lesson-a',h.services),/Safety Communication/);
 h.investigation.event_id='missing-event';await assert.rejects(h.R.load('investigation','investigation-a',h.services),/unavailable/);
});
test('every formatter escapes saved text, including structured analysis, rather than executing HTML',()=>{
 const h=fixture(),attack='<img src=x onerror=alert(1)>';
 h.incident.description=attack;h.investigation.five_whys=[attack];h.communication.payload.what_happened=attack;h.lesson.payload[attack]=attack;
 for(const html of [h.R.incidentHtml(h.incident),h.R.investigationHtml(h.investigation),h.R.communicationHtml(h.communication),h.R.recordHtml(h.lesson)]){assert.ok(html.includes('&lt;img'));assert.doesNotMatch(html,/<img src=x/);}
});
test('anonymous incident reporting does not print the saved reporter name',()=>{
 const h=fixture();h.incident.reporter_mode='anonymous';assert.ok(!h.R.incidentHtml(h.incident).includes('Reporter'));
});
test('viewers expose individual record printing without touching core closure or generation gates',()=>{
 for(const name of ['imv2PrintIncident','imv2PrintInvestigation','imv2PrintRecord','imv2PrintSafetyCommunication'])assert.ok(upgrade.includes('window.'+name+'=function(id)'),name);
 assert.match(upgrade,/openDrawer\(receipt\.title,receipt\.html,foot,true\)/);assert.match(upgrade,/X\.recordView=receipt/);
 assert.match(upgrade,/reportServices\(\),X\.recordView/);assert.match(upgrade,/aria-modal="true"/);assert.match(upgrade,/aria-label="Close incident record"/);
 assert.doesNotMatch(source,/m:'POST'|m:'PATCH'|m:'DELETE'|queueNotification|update_fleet|status='closed'/);
});
function bridge(h){
 const opened=[],notices=[],c={X:{data:{events:[],investigations:[],records:[]},drawerDirty:false},FORMS:{lesson:{recordType:'lesson'}},reportServices:()=>h.services,canManage:()=>true,userId:()=> 'user-a',notify:(...args)=>notices.push(args),button:(label,command)=>label+' '+command,openDrawer:(...args)=>opened.push(args),JSON,String,Object};
 c.window=c;c.AurisIncidentReports=h.R;
 vm.runInNewContext(upgrade.slice(upgrade.indexOf('async function viewRecordReport('),upgrade.indexOf('function ensureShell(){')),c);
 return {c,opened,notices};
}
test('the real viewer bridge renders a saved Closed investigation with an exact-ID print action and no status change',async()=>{
 const h=fixture(),b=bridge(h);await b.c.viewRecordReport('investigation','investigation-a');
 assert.equal(b.opened.length,1);assert.match(b.opened[0][2],/imv2PrintInvestigation\("investigation-a"\)/);assert.equal(b.opened[0][3],true);assert.equal(b.c.X.recordView.record.status,'closed');
 assert.equal(h.investigation.status,'closed');await b.c.imv2PrintInvestigation('investigation-a');assert.equal(h.printed[0][0],b.opened[0][1]);
});
test('a slower viewer request cannot replace a newer selected record, and a dismissed pending request stays dismissed',async()=>{
 const h=fixture();h.rows.events.push({...h.incident,id:'incident-b',event_ref:'INC-2026-002'});let release;
 h.setHook(path=>path.includes('id=eq.incident-a')?new Promise(resolve=>{release=resolve;}):undefined);
 const b=bridge(h),first=b.c.viewRecordReport('incident','incident-a');await b.c.viewRecordReport('incident','incident-b');release();await first;
 assert.equal(b.opened.length,1);assert.match(b.opened[0][0],/INC-2026-002/);
 const pending=b.c.viewRecordReport('incident','incident-a');b.c.X.viewerTicket+=1;release();await pending;assert.equal(b.opened.length,1);
});
test('fresh viewers synchronize the lexical legacy editor caches instead of reopening stale same-ID facts',async()=>{
 const h=fixture(),b=bridge(h);b.c.imsAllData=[{...h.incident,description:'Stale incident facts'}];b.c.imsInvAllData=[{...h.investigation,description:'Stale investigation facts'}];
 await b.c.viewRecordReport('incident','incident-a');assert.equal(b.c.imsAllData[0].description,h.incident.description);assert.equal(b.c.imsAllData.length,1);
 await b.c.viewRecordReport('investigation','investigation-a');assert.equal(b.c.imsInvAllData[0].description,h.investigation.description);assert.equal(b.c.imsInvAllData.length,1);assert.equal(b.c.imsInvAllData[0].status,'closed');
});
test('a final context change before the viewer bridge resumes cannot publish fresh rows into legacy caches',async()=>{
 const h=fixture(),b=bridge(h);b.c.imsAllData=[{...h.incident,description:'Retained cache'}];
 b.c.AurisIncidentReports={...h.R,load:async(...args)=>{var receipt=await h.R.load(...args);h.setIdentity({companyId:'company-b'});return receipt;}};
 await b.c.viewRecordReport('incident','incident-a');assert.equal(b.opened.length,0);assert.equal(b.c.imsAllData[0].description,'Retained cache');assert.equal(b.c.X.data.events.length,0);
});
