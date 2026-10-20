const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('module-report-preview.js','utf8');
class Node{
 constructor(tag,value){this.tagName=tag?.toUpperCase();this.nodeType=tag?1:value===undefined?11:3;this.value=value||'';this.childNodes=[];this.attributes={};this.events={};this.classList={toggle(){}};}
 get textContent(){return this.nodeType===3?this.value:this.childNodes.map(x=>x.textContent).join('');}
 set textContent(v){if(this.nodeType===3)this.value=v;else this.childNodes=[new Node(null,String(v))];}
 appendChild(n){if(n.nodeType===11)this.childNodes.push(...n.childNodes);else this.childNodes.push(n);return n;}
 setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k]||null;}
 addEventListener(k,v){this.events[k]=v;}
 querySelectorAll(){return [];}
 get innerHTML(){return this.childNodes.map(n=>n.nodeType===3?n.value.replace(/&/g,'&amp;').replace(/</g,'&lt;'):n.nodeType===11?n.innerHTML:'<'+n.tagName.toLowerCase()+Object.keys(n.attributes).map(k=>' '+k+'="'+n.attributes[k]+'"').join('')+'>'+n.innerHTML+'</'+n.tagName.toLowerCase()+'>').join('');}
 set innerHTML(v){this.childNodes=[new Node(null,String(v))];}
}
function documentFixture(){return {getElementById:()=>null,querySelector:()=>null,createTextNode:v=>new Node(null,v),createDocumentFragment:()=>new Node(),createElement:tag=>{const n=new Node(tag);if(tag==='template'){n.content=new Node();n.content.appendChild(new Node('p')).appendChild(new Node(null,'Saved record content'));}return n;}};}
function runtime(){let selected='client',portfolio=false,denied='',prints=0;const requests=[],windows=[],tables={
 legal_requirements:[{id:'req',company_id:'client',req_ref:'LEG-001',legislation:'Internal policy',legislation_type:'internal_policy',requirement:'Keep <evidence>',status:'not_assessed',category:'training',controls:'Saved controls'},{id:'archived',company_id:'client',legislation:'Retired duty',status:'archived'}],
 legal_changes:[{id:'change',company_id:'client',legislation:'Policy',changes:'Proposed wording',review_status:'proposed',implemented:false},{id:'old',company_id:'client',archived_at:'2026-01-01'}],
 compliance_assessments:[{id:'assessment',company_id:'client',assessment_ref:'CA-1',title:'Saved assessment',status:'approved',total_requirements:76,overall_score:96,compliance_score:0},{id:'archived-assessment',company_id:'client',archived_at:'2026-01-01'}],
 compliance_gaps:[{id:'gap',company_id:'client',gap_ref:'GAP-1',legislation:'Policy',gap_description:'Finding',action_required:'Retain evidence',risk_level:'high',status:'open'}],compliance_calendar:[{id:'cal',company_id:'client',title:'Review',due_date:'2026-11-01',status:'upcoming'}],
 legal_compliance_records:[{id:'evidence',company_id:'client',record_type:'evidence',title:'Submitted evidence',status:'submitted',payload:{secret:'Not in register report'}},{id:'licence',company_id:'client',record_type:'permit_licence',title:'Licence',status:'pending'}],
 meeting_series:[{id:'series',company_id:'client',title:'Safety committee',recurrence:'monthly',next_date:'2026-10-18',active:true}],
 hse_meetings:[{id:'minutes',company_id:'client',series_id:'series',title:'Fictional saved minutes',meeting_date:'2026-10-18T05:00:00Z',meeting_timezone:'Asia/Dubai',minutes:'Saved narrative <not executable>',status:'draft',agenda_items:JSON.stringify([{item:'Review hazards',notes:'Recorded discussion'}]),recommendations:JSON.stringify([{desc:'Saved action',resp:'Owner',date:'2026-11-01',status:'open'},{_kind:'mom_meta',signoff:{}}])}],
 toolbox_talks:[{id:'talk',company_id:'client',title:'Planned toolbox talk',status:'planned',topic_category:'safety_general',talk_date:'2026-10-18',attendees:[]}],safety_alerts:[{id:'alert',company_id:'client',title:'Draft alert',severity:'high',status:'draft',summary:'Review required'}],safety_bulletins:[{id:'bulletin',company_id:'client',title:'Draft bulletin',status:'draft',publication_date:'2026-10-18'}],safety_awareness_topics:[{id:'topic',company_id:'client',plan_year:2026,planned_month:10,theme:'Chemical safety',discussion_points:['Locate SDS','Review controls']}]
 };
 const doc=documentFixture(),c={console,Intl,Date,URL,Map,Set,document:doc,location:{href:'https://auris.test/',origin:'https://auris.test'},setTimeout,clearTimeout,prof:{id:'reviewer',company_id:'sephs',role:'sephs_admin'},co:{id:'sephs',name:'SEPHS Consulting',logo_url:'/wrong.png'},saCompanyList:[{id:'client',name:'Client <Engineering>',logo_url:'/client.png'}],ccid:()=>selected,isSA:()=>true,sephsCompanyContext:'client',activeRole:()=>c.prof.role,canAccessPage:()=>true,AurisUserAccess:{sectionAllowed:(p,m,s)=>s!==denied},AurisMeetingTime:{display:r=>r+' (Asia/Dubai)',wall:()=> '2026-10-18T09:00',occurrences:()=>['2026-10-18']},apiAllRows:async path=>{requests.push(path);return structuredClone(tables[path.split(/[/?]/)[1]]||[]);}};
 c.window=c;c.open=()=>{const nodes={};for(const key of ['mrp-print','mrp-status','mrp-retry','mrp-paper','mrp-close'])nodes[key]=new Node('button');const w={closed:false,close(){this.closed=true;},focus(){},print(){prints++;},document:{title:'',body:new Node('body'),fonts:{ready:Promise.resolve()},open(){},write(v){w.markup=v;},close(){},getElementById:id=>nodes[id],querySelectorAll:()=>[{tagName:'LINK',sheet:{}}]}};w.nodes=nodes;windows.push(w);return w;};
 vm.createContext(c);vm.runInContext(source,c);
 return {c,api:c.AurisModuleReports,tables,requests,windows,prints:()=>prints,select:v=>{selected=v;c.sephsCompanyContext=v;},portfolio:()=>{c.sephsCompanyContext=null;},deny:s=>{denied=s;}};
}
test('selected-company branding never uses an administrator company or portfolio fallback',()=>{
 const h=runtime(),c=h.api.context('legal');assert.equal(h.api.company(c).name,'Client <Engineering>');
 const html=h.api.documentHtml({moduleKey:'legal',title:'Saved <assessment>',sourceLabel:'Scope & reference',paper:'A3'},h.api.company(c),'<p>Saved record</p>');
 assert.match(html,/Client &lt;Engineering&gt;/);assert.match(html,/Saved &lt;assessment&gt;/);assert.match(html,/https:\/\/auris.test\/client.png/);assert.doesNotMatch(html,/SEPHS|wrong.png/);assert.match(html,/mrp-a3/);assert.match(html,/Generated:/);
 h.portfolio();assert.throws(()=>h.api.context('legal'),/Select a company/);h.select('unknown');assert.throws(()=>h.api.company(h.api.context('legal')),/identity is unavailable/);
});
test('every register reads current company records afresh without writes or business loader calls',async()=>{
 const h=runtime();for(const moduleKey of ['legal','meetings'])for(const [key,def] of Object.entries(h.api.reports[moduleKey])){if(def.detail)continue;const result=await h.api.capture(moduleKey,key,{year:2026,filters:{},paper:'A4'},h.api.context(moduleKey));assert.match(result.html,/<table>/);assert.ok(result.title);}
 assert.ok(h.requests.length>10);assert.ok(h.requests.every(p=>p.includes('company_id=eq.client')&&p.includes('select=*')));assert.ok(h.requests.every(p=>!p.includes('archived_at=')));assert.equal(h.windows.length,0);
});
test('foreign-company responses and company or role changes cannot produce a report',async()=>{
 const h=runtime();h.tables.legal_changes.push({id:'foreign',company_id:'other'});await assert.rejects(h.api.capture('legal','changes',{filters:{}},h.api.context('legal')),/did not match/);
 const x=runtime(),c=x.api.context('legal');x.c.apiAllRows=async()=>{x.select('other');return x.tables.legal_changes;};await assert.rejects(x.api.capture('legal','changes',{filters:{}},c),/changed/);
 const y=runtime(),old=y.api.context('meetings');y.c.prof.role='employee';assert.throws(()=>y.api.check(old,'meetings','minutes'),/changed/);y.deny('minutes');await assert.rejects(y.api.capture('meetings','minutes',{},y.api.context('meetings')),/cannot view/);
});
test('recorded approvals, pending outcomes, archive state and evidence boundaries are preserved',async()=>{
 const h=runtime(),c=h.api.context('legal'),s=await h.api.capture('legal','assessments',{filters:{}},c);assert.match(s.html,/96%/);assert.doesNotMatch(s.html,/>0%|archived-assessment/);assert.match(s.html,/Historical reported approval/);
 const evidence=await h.api.capture('legal','evidence',{filters:{}},c);assert.match(evidence.html,/Submitted/);assert.doesNotMatch(evidence.html,/Not in register report|Licence/);
 const changes=await h.api.capture('legal','changes',{filters:{}},c);assert.match(changes.html,/Not marked implemented/);assert.doesNotMatch(changes.html,/>old</);
 const alert=await h.api.capture('meetings','alerts',{filters:{}},h.api.context('meetings'));assert.match(alert.html,/Draft/);
});
test('assessment register does not present raw actor UUIDs as names or recalculate the saved score',async()=>{
 const h=runtime(),r=h.tables.compliance_assessments[0];r.assessor='12345678-1234-4234-8234-123456789012';r.approved_by='87654321-1234-4234-8234-123456789012';r.approved_at='2026-10-19T09:00:00Z';const s=await h.api.capture('legal','assessments',{filters:{}},h.api.context('legal'));assert.match(s.html,/Name not recorded/);assert.doesNotMatch(s.html,/12345678-1234|87654321-1234/);assert.match(s.html,/96%/);
});
test('report filter values apply to fresh records and empty matches produce a useful error',async()=>{
 const h=runtime(),c=h.api.context('legal'),r=await h.api.capture('legal','gaps',{filters:{risk_level:'high',status:'open'},filtered:true},c);assert.equal((r.html.match(/GAP-1/g)||[]).length,1);assert.match(r.sourceLabel,/Selected screen filter values/);assert.match(r.sourceLabel,/Risk Level: high/);assert.match(r.sourceLabel,/Status: open/);
 await assert.rejects(h.api.capture('legal','gaps',{filters:{risk_level:'low'},filtered:true},c),/No saved compliance actions.*Adjust/i);
 const awareness=await h.api.capture('meetings','awareness',{year:2026,filters:{}},h.api.context('meetings'));assert.match(awareness.html,/October/);assert.match(awareness.html,/Locate SDS\nReview controls/);assert.match(awareness.note,/Example suggestions.*excluded/);
});
test('legal attention filters reuse the actual legal projection without using cached company rows',async()=>{
 const h=runtime();vm.runInContext(fs.readFileSync('auris-legal-list-workspace.js','utf8'),h.c);h.tables.legal_requirements[0].review_date='2001-01-01';
 const s=await h.api.capture('legal','register',{filters:{attention:'review_overdue'},filtered:true},h.api.context('legal'));assert.match(s.html,/LEG-001/);assert.doesNotMatch(s.html,/Retired duty/);
});
test('toolbox filter and attendance interpretation match the actual register helper',async()=>{
 const h=runtime();vm.runInContext(fs.readFileSync('auris-toolbox-list-workspace.js','utf8'),h.c);h.c.TBT_TOPIC_CFG={safety_general:{label:'General workplace safety'}};h.tables.toolbox_talks[0].attendance_count=5;
 const s=await h.api.capture('meetings','tbt',{filters:{category:'safety_general',status:'planned',search:'workplace'},filtered:true},h.api.context('meetings'));assert.match(s.html,/General workplace safety/);assert.match(s.html,/<td>5<\/td>/);
 await assert.rejects(h.api.capture('meetings','tbt',{filters:{search:'not-the-topic'}},h.api.context('meetings')),/No saved/);
});
test('an agenda cannot imply missing minutes when minutes access is denied',async()=>{
 const h=runtime();h.deny('minutes');const s=await h.api.capture('meetings','schedule',{year:2026,filters:{}},h.api.context('meetings'));assert.match(s.html,/not accessible to your account/);assert.doesNotMatch(s.html,/No saved minutes/);assert.match(s.sourceLabel,/scheduled occurrences/);assert.ok(!h.requests.some(p=>p.startsWith('/hse_meetings')));
});
test('revoking section access while records load prevents the saved report from being returned',async()=>{
 const h=runtime();h.c.apiAllRows=async()=>{h.deny('assessments');return h.tables.compliance_assessments;};await assert.rejects(h.api.capture('legal','assessments',{},h.api.context('legal')),/cannot view/);
});
test('minutes reports use saved narrative, structured agenda and actions without metadata or inferred completion',()=>{
 const h=runtime(),body=h.api.minutesBody(h.tables.hse_meetings[0]);assert.match(body.html,/Saved narrative &lt;not executable&gt;/);assert.match(body.html,/Recorded discussion/);assert.match(body.html,/Saved action/);assert.match(body.html,/Draft/);assert.match(body.html,/Asia\/Dubai/);assert.doesNotMatch(body.html,/mom_meta|Completed|undefined|\[object Object\]/);
});
test('legacy minutes retain recorded agenda, readable attendees and explicit sign-off fields',()=>{
 const h=runtime(),record={...h.tables.hse_meetings[0],agenda_items:[],agenda:'Retained legacy agenda',attendees:'[{"name":"Asha Shah"}]',recommendations:[{_kind:'mom_meta',signoff:{chair:'Chair name',chair_date:'2026-10-18',approver:'Reviewer',approver_date:'2026-10-19'}}]};
 const result=h.api.minutesBody(record);assert.match(result.html,/Retained legacy agenda/);assert.match(result.html,/Asha Shah/);assert.doesNotMatch(result.html,/\[object Object\]/);assert.match(result.html,/Recorded sign-off fields/);assert.match(result.html,/Reviewer/);
});
test('legacy agenda sign-off is retained as sign-off, never an empty discussion row',()=>{
 const h=runtime(),r={...h.tables.hse_meetings[0],agenda_items:[{item:'Recorded item',notes:'Discussion'},{_kind:'signoff',chair:'Legacy chair',approver:'Legacy approver',approver_date:'2026-10-18'}],recommendations:[{_kind:'mom_meta',recorder:'Recorder name',signoff:{}}]};
 const body=h.api.minutesBody(r);assert.equal((body.html.match(/<td>Recorded item<\/td>/g)||[]).length,1);assert.match(body.html,/Legacy chair/);assert.match(body.html,/Legacy approver/);assert.match(body.html,/Recorder name/);assert.doesNotMatch(body.html,/mom_meta|_kind/);
});
test('sanitizer keeps readable semantic cells while removing executable controls, styles and attributes',()=>{
 const h=runtime(),doc=documentFixture(),section=new Node('section'),p=section.appendChild(new Node('p'));p.setAttribute('onclick','steal()');p.setAttribute('style','position:fixed');p.appendChild(new Node(null,'Saved & reviewed'));
 const script=section.appendChild(new Node('script'));script.appendChild(new Node(null,'steal()'));const button=section.appendChild(new Node('button'));button.appendChild(new Node(null,'Delete record'));
 const td=section.appendChild(new Node('td'));td.setAttribute('colspan','2');td.setAttribute('rowspan','9999');td.setAttribute('data-id','private');td.appendChild(new Node(null,'Recorded value'));
 section.setAttribute('class','legal-assessment-report random-layout');const holder=new Node('div');holder.appendChild(h.api.cleanNode(section,doc));assert.match(holder.innerHTML,/Saved &amp; reviewed/);assert.match(holder.innerHTML,/colspan="2"/);assert.match(holder.innerHTML,/class="legal-assessment-report"/);assert.doesNotMatch(holder.innerHTML,/steal|Delete record|onclick|style=|data-id|9999|random-layout/);
});
test('preview waits for resources and only a deliberate button click prints; stale contexts are blocked',async()=>{
 const h=runtime(),c=h.api.context('legal');await h.api.preview({moduleKey:'legal',section:'assessments',title:'Saved assessment',html:'<p>Saved record</p>',context:c});
 const w=h.windows[0];assert.equal(h.prints(),0);assert.equal(w.nodes['mrp-print'].disabled,false);assert.match(w.nodes['mrp-status'].textContent,/Ready/);assert.match(w.markup,/Client &lt;Engineering&gt;/);
 w.nodes['mrp-print'].events.click();assert.equal(h.prints(),1);h.select('other');w.nodes['mrp-print'].events.click();assert.equal(h.prints(),1);assert.equal(w.nodes['mrp-print'].disabled,true);assert.match(w.nodes['mrp-status'].textContent,/changed/);
});
test('failed logo loading leaves printing disabled with an explicit retry route',async()=>{
 const h=runtime(),original=h.c.open;h.c.open=()=>{const w=original();w.document.querySelectorAll=()=>[{tagName:'IMG',complete:true,naturalWidth:0}];return w;};await h.api.preview({moduleKey:'meetings',section:'minutes',title:'Saved minutes',html:'saved',context:h.api.context('meetings')});
 const w=h.windows[0];assert.equal(h.prints(),0);assert.equal(w.nodes['mrp-print'].disabled,true);assert.equal(w.nodes['mrp-retry'].hidden,false);assert.match(w.nodes['mrp-status'].textContent,/could not load/);
});
test('an exact minutes preview rejects a mismatched record response and supports chosen paper',async()=>{
 const h=runtime();await h.api.minutes('minutes',null,'A3');assert.match(h.requests[0],/id=eq.minutes/);assert.match(h.windows[0].markup,/mrp-a3/);assert.equal(h.prints(),0);
 const x=runtime();x.tables.hse_meetings[0].id='different';await assert.rejects(x.api.minutes('minutes'),/unavailable/);assert.equal(x.windows[0].closed,true);
});
test('minutes editor printing fetches the saved record and never reads unfinished form values',async()=>{
 const h=runtime(),messages=[];h.c.toast=value=>messages.push(value);h.c.mtgCollectAgenda=h.c.mtgCollectRecs=()=>{throw Error('Unsaved editor collector must not run');};
 await h.c.mtgPrintMom();assert.match(messages[0],/Save the minutes/);assert.equal(h.requests.length,0);assert.equal(h.windows.length,0);
 h.c.mtgEditingMomId='minutes';await h.c.mtgPrintMom();assert.match(h.requests[0],/hse_meetings.*id=eq.minutes/);assert.equal(h.windows.length,1);assert.equal(h.prints(),0);assert.match(h.windows[0].markup,/unsaved form entries excluded/);
});
test('full saved toolbox talks preserve confirmations, actions, linked work and notes without inventing signatures',()=>{
 const h=runtime(),body=h.api.talkBody({title:'Saved <talk>',tbt_ref:'TBT-1',status:'planned',talk_date:'2026-10-18',key_points:'Recorded points',notes:'Retained notes\n\n[AURIS360_LINKED_WORK:{"id":"work-id","ref":"WO-42","title":"Planned repair"}]',attendees:[{name:'Asha',dept:'HSE',confirmed_at:'2026-10-18T05:00:00Z',confirmation_method:'employee_pin'},{name:'Wesley',dept:'Operations'}],actions_raised:[{description:'Review controls',assigned_to:'Owner',due_date:'2026-11-01'}]});
 assert.match(body.title,/Saved <talk>/);assert.match(body.html,/Recorded points/);assert.match(body.html,/Retained notes/);assert.match(body.html,/WO-42 · Planned repair/);assert.doesNotMatch(body.html,/work-id|AURIS360_LINKED_WORK|Signature record|Supervisor/);assert.match(body.html,/Employee Pin/);assert.match(body.html,/Not confirmed/);assert.match(body.html,/Review controls/);assert.match(body.html,/01\/11\/2026/);assert.match(body.html,/Planned/);
 const signed=h.api.talkBody({title:'Historic talk',signed_by:'Recorded signer',signed_at:'2026-10-18T05:00:00Z'});assert.match(signed.html,/Retained signature record/);assert.match(signed.html,/Recorded signer/);
});
test('toolbox talk print actions read the exact saved row and keep unfinished entries untouched',async()=>{
 const h=runtime(),messages=[];h.c.toast=value=>messages.push(value);h.c.tbtCurrentFormData=()=>{throw Error('Do not read editor entries');};await h.c.printToolboxTalk();assert.equal(h.requests.length,0);assert.match(messages[0],/Save the toolbox talk/);
 h.c.tbtEditId='talk';await h.c.printToolboxTalk();assert.match(h.requests[0],/toolbox_talks.*id=eq.talk/);assert.equal(h.windows.length,1);assert.equal(h.prints(),0);assert.match(h.windows[0].markup,/Saved toolbox talk/);
 const x=runtime();x.tables.toolbox_talks[0].id='other';await assert.rejects(x.api.talk('talk'),/unavailable/);assert.equal(x.windows[0].closed,true);
});
test('minutes preserve the shared meeting-type labels including the HSE acronym',async()=>{
 const h=runtime();h.c.MTG_TYPES={hse_committee:'HSE Committee Meeting'};h.tables.hse_meetings[0].meeting_type='hse_committee';assert.match(h.api.minutesBody(h.tables.hse_meetings[0]).html,/HSE Committee Meeting/);const register=await h.api.capture('meetings','minutes',{filters:{}},h.api.context('meetings'));assert.match(register.html,/HSE Committee Meeting/);assert.doesNotMatch(register.html,/Hse Committee/);
});
