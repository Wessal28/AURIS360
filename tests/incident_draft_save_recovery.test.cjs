const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('incident-management-upgrade.js','utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
const COMPANY='company-a',USER='reporter-a';
const rejection=()=>Object.assign(new Error('new row for relation "notification_queue" violates check constraint "notification_queue_workflow_relationship_check"'),{code:'23514'});
function harness(options={}){
 const fields={};
 for(const [id,value] of Object.entries({
  'ev-type':'near_miss','ev-date':'2026-11-26T09:15','ev-location':'Workshop','ev-department':'Maintenance','ev-description':'Guard loosened during preparation','ev-immediate':'Stopped and isolated equipment',
  'ev-reported-by-name':'Fictional reporter','ev-assigned-name':'Fictional reviewer','ev-status':'open','ev-severity':'high','ev-potential-severity':'critical','ev-reg-required':'yes',
  'imx-likelihood':'possible','imx-estimated-time':'true','imx-confidentiality':'internal','imx-emergency-gate':'none','imx-immediate-danger':'false','imx-reporter-mode':'named','imx-work-activity':'Maintenance preparation'
 }))fields[id]={value};
 fields['ims-form3ref']={textContent:options.existing?.event_ref||'INC-AUTO'};
 const report={style:{display:'block'},children:[],prepend(element){this.children.unshift(element);fields[element.id]=element;}};fields['ims-view-report']=report;
 const records=new Map(options.existing?[[options.existing.id,structuredClone(options.existing)]]:[]),cache=options.cache||[],requests=[],notices=[],effects=[];
 const X={schemaReady:true,data:{events:cache,records:[]}};
 const c={Date,console:{warn(){}},document:{getElementById:id=>fields[id]||null,createElement:()=>({attributes:{},setAttribute(name,value){this.attributes[name]=value;}})},
  X,imsEditId:options.existing?.id||null,imsAllData:cache,prof:{id:USER,company_id:COMPANY,full_name:'Fictional reporter'},
  companyId:()=>COMPANY,userId:()=>USER,userName:()=> 'Fictional reporter',workflowCanMutate:()=>true,imsIsSimpleReporter:()=>false,byId:(rows,id)=>(rows||[]).find(row=>String(row.id)===String(id)),
  notify:(...args)=>notices.push(args),nextCompanyRef:async()=>{effects.push('reference');return 'INC-2026-0007';},
  queueNotification:()=>effects.push('notification'),imsNotifyAssignee:()=>effects.push('assignee-notification'),imsNotifyIncidentTypeRecipients:()=>effects.push('type-notification'),
  val:id=>fields[id]?.value||'',imv2IncidentTypeAllowed:()=>true,confirm:()=>true,legacySave:async()=>false,
  recordForIncident:()=>[],RECORD_TABLE:'incident_mgmt_records',persist:async()=>{effects.push('triage');return {id:'unexpected-triage'};},audit:async()=>effects.push('audit'),triageDueDays:()=>1,incidentRef:row=>row?.event_ref||'INC-DRAFT',
  api:async(path,options)=>{
   requests.push({path,options:JSON.parse(JSON.stringify(options))});
   if(options.b?.status)assert.equal(options.b.status,'draft','Save draft must never change its workflow state to Open to bypass a constraint');
   if(c.rejectWrites)throw rejection();
   if(path==='/events'&&options.m==='POST'){
    const saved={...structuredClone(options.b),id:'confirmed-draft'};records.set(saved.id,saved);return [structuredClone(saved)];
   }
   const match=path.match(/^\/events\?id=eq\.([^&]+)$/);
   assert.ok(match,'Draft saving must not send client notifications or write unrelated records');assert.equal(options.m,'PATCH');const id=decodeURIComponent(match[1]);assert.ok(records.has(id));records.set(id,{...records.get(id),...structuredClone(options.b)});return null;
  }};
 c.window=c;vm.createContext(c);vm.runInContext(section('window.imv2SaveDraft=','window.imv2SubmitIncident=')+section('window.imv2SubmitIncident=','function enhanceInvestigationTabs('),c);
 return {c,fields,report,requests,notices,effects,X,records,values:()=>Object.fromEntries(Object.entries(fields).filter(([,field])=>'value' in field).map(([id,field])=>[id,field.value]))};
}

test('a rejected new draft POST retains entered fields, unsaved identity and cache without client notifications',async()=>{
 const unrelated={id:'other-draft',company_id:COMPANY,status:'draft',description:'Already stored'},h=harness({cache:[unrelated]}),before=JSON.stringify(h.X.data.events),entered=h.values();h.c.rejectWrites=true;
 await h.c.imv2SaveDraft();
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].path,'/events');assert.equal(h.requests[0].options.m,'POST');assert.equal(h.requests[0].options.b.status,'draft');assert.equal(h.requests[0].options.b.company_id,COMPANY);assert.equal(h.requests[0].options.b.created_by,USER);
 assert.deepEqual(h.values(),entered);assert.equal(h.c.imsEditId,null);assert.equal(JSON.stringify(h.X.data.events),before);assert.equal(JSON.stringify(h.c.imsAllData),before);assert.equal(h.records.size,0);assert.deepEqual(h.effects,[]);assert.equal(h.report.style.display,'block');
 assert.match(h.fields['imx-draft-feedback'].textContent,/Draft not saved:.*notification_queue_workflow_relationship_check/);assert.equal(h.fields['imx-draft-feedback'].attributes.role,'alert');assert.equal(h.notices.at(-1)[1],false);assert.ok(!h.notices.some(([message])=>/draft saved/i.test(message)));
});

test('a rejected existing draft PATCH retains its record ID, edited fields and saved cache',async()=>{
 const existing={id:'draft-existing',company_id:COMPANY,status:'draft',description:'Previously stored narrative',event_ref:'INC-2026-0003'},h=harness({existing,cache:[{...existing}]}),before=JSON.stringify(h.X.data.events),entered=h.values();h.c.rejectWrites=true;
 await h.c.imv2SaveDraft();
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].path,'/events?id=eq.draft-existing');assert.equal(h.requests[0].options.m,'PATCH');assert.equal(h.requests[0].options.b.status,'draft');assert.equal(h.requests[0].options.b.description,'Guard loosened during preparation');
 assert.equal(h.c.imsEditId,'draft-existing');assert.deepEqual(h.values(),entered);assert.equal(JSON.stringify(h.X.data.events),before);assert.equal(h.records.get('draft-existing').description,'Previously stored narrative');assert.equal(h.fields['ims-form3ref'].textContent,'INC-2026-0003');assert.deepEqual(h.effects,[]);assert.equal(h.report.style.display,'block');assert.match(h.fields['imx-draft-feedback'].textContent,/Draft not saved:/);
});

test('retry after a rejected insert confirms one draft ID and subsequent saves PATCH that same record',async()=>{
 const h=harness();h.c.rejectWrites=true;await h.c.imv2SaveDraft();assert.equal(h.records.size,0);assert.equal(h.c.imsEditId,null);
 h.c.rejectWrites=false;await h.c.imv2SaveDraft();assert.equal(h.records.size,1);assert.equal(h.c.imsEditId,'confirmed-draft');assert.equal(h.X.data.events.length,1);assert.equal(h.X.data.events[0].id,'confirmed-draft');assert.equal(h.fields['ims-form3ref'].textContent,'INC-2026-0007');
 h.fields['ev-description'].value='Clarified description after saved confirmation';await h.c.imv2SaveDraft();
 assert.equal(h.records.size,1);assert.equal(h.records.get('confirmed-draft').description,'Clarified description after saved confirmation');assert.equal(h.X.data.events.length,1);assert.equal(h.X.data.events[0].description,'Clarified description after saved confirmation');assert.equal(h.c.imsEditId,'confirmed-draft');
 assert.deepEqual(h.requests.map(request=>[request.options.m,request.path]),[['POST','/events'],['POST','/events'],['PATCH','/events?id=eq.confirmed-draft'],['PATCH','/events?id=eq.confirmed-draft']]);assert.deepEqual(h.effects,['reference']);assert.match(h.fields['imx-draft-feedback'].textContent,/^Draft saved at /);
});

test('failed incident submission stops before creating triage records, audits or notifications',async()=>{
 const existing={id:'draft-existing',company_id:COMPANY,status:'draft',event_ref:'INC-2026-0003'},h=harness({existing,cache:[existing]});let saves=0;
 h.c.legacySave=async()=>{saves++;assert.equal(h.fields['ev-status'].value,'submitted');return false;};
 await h.c.imv2SubmitIncident();
 assert.equal(saves,1);assert.equal(h.c.imsEditId,'draft-existing');assert.equal(h.X.data.records.length,0);assert.equal(h.X.data.events[0].status,'draft');assert.equal(h.requests.length,0);assert.deepEqual(h.effects,[]);assert.equal(h.report.style.display,'block');assert.equal(h.notices.length,0);
});
