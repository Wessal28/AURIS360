const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const upgrade=fs.readFileSync('incident-management-upgrade.js','utf8');
function section(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
const COMPANY='company-a',USER='user-a';
const lesson=(extra={})=>({id:'lesson-a',company_id:COMPANY,record_type:'lesson',incident_id:'incident-a',investigation_id:'investigation-a',title:'Check equipment guards',status:'approved',owner_name:'Fictional reviewer',payload:{key_learning:'Check each guard',approved_facts:'Guard loosened',required_behaviours:'Stop and isolate'},...extra});
const incident=(extra={})=>({id:'incident-a',company_id:COMPANY,event_ref:'INC-2026-001',description:'Guard loosened',event_date:'2026-11-20',location:'Workshop',...extra});
const investigation=(extra={})=>({id:'investigation-a',company_id:COMPANY,event_id:'incident-a',investigation_ref:'INV-2026-001',status:'closed',root_causes:'Fastener inspection missing',...extra});

function lessonEditor(options={}){
 const previous=lesson(options.previous),fields={
  'imx-f-incident_id':{value:'incident-a'},'imx-f-title':{value:'Edited validated lesson'},'imx-f-status':{value:'approved'},'imx-f-key_learning':{value:'Retain the approved learning'}
 };if(options.control!==undefined)fields['imx-f-investigation_id']={value:options.control};
 const writes=[],notices=[],validations=[],expected={companyId:COMPANY,userId:USER,role:'hse_manager'},c={Date,X:{lessonSession:expected,data:{records:[previous],events:[incident()],investigations:[investigation(),investigation({id:'investigation-b'})]}},
  document:{getElementById:id=>fields[id]||null},val:id=>fields[id]?.value||'',companyId:()=>COMPANY,byId:(rows,id)=>(rows||[]).find(row=>row.id===id),notify:(...args)=>notices.push(args),
  persist:async(table,body,id)=>{writes.push({table,body:structuredClone(body),id});return {...previous,...body,id};},audit:async()=>{},imv2CloseDrawer(){},render(){},RECORD_TABLE:'incident_mgmt_records',communicationServices:()=>({session:()=>expected}),AurisIncidentCommunication:{validateSource:async(...args)=>validations.push(args)}};
 c.window=c;vm.createContext(c);vm.runInContext(section(upgrade,'var FORMS=','function fieldHtml(')+section(upgrade,'function serialise(','async function persist(')+section(upgrade,'window.imv2SaveForm=','window.imv2OpenTriage='),c);
 return {c,fields,writes,notices,validations,previous};
}

test('editing a lesson preserves its stored investigation when an older form has no source-investigation control',async()=>{
 const h=lessonEditor();await h.c.imv2SaveForm('lesson','lesson-a');assert.equal(h.writes.length,1);assert.equal(h.writes[0].id,'lesson-a');assert.equal(h.writes[0].body.incident_id,'incident-a');assert.equal(h.writes[0].body.investigation_id,'investigation-a');assert.equal(h.previous.investigation_id,'investigation-a');
});

test('the lesson editor offers a source-investigation selector and saves its explicit selected identity',async()=>{
 const h=lessonEditor({control:'investigation-b'}),field=Array.from(h.c.FORMS.lesson.fields).find(def=>def[1]==='investigation_id');assert.ok(field);assert.equal(field[2],'lesson_investigation');
 await h.c.imv2SaveForm('lesson','lesson-a');assert.equal(h.writes.length,1);assert.equal(h.writes[0].body.investigation_id,'investigation-b');assert.equal(h.writes[0].body.incident_id,'incident-a');
 assert.equal(h.validations[0][0],'investigation-b');assert.equal(h.validations[0][1],'incident-a');assert.equal(h.validations[0][2].expectedSession.userId,USER);
});

test('an explicitly cleared source-investigation control remains distinct from an absent older control',async()=>{const h=lessonEditor({control:''});await h.c.imv2SaveForm('lesson','lesson-a');assert.equal(h.writes[0].body.investigation_id,null);assert.equal(h.validations[0][0],null);});

function valueAt(row,key){return String(key).replace(/::text$/,'').split(/->>?/).reduce((value,part)=>value?.[part.replace(/^['"]|['"]$/g,'')],row);}
function terms(value){let depth=0,quoted=false,start=0,result=[];for(let i=0;i<value.length;i++){const char=value[i];if(char==='"')quoted=!quoted;if(!quoted){if(char==='(')depth++;if(char===')')depth--;if(char===','&&depth===0){result.push(value.slice(start,i));start=i+1;}}}result.push(value.slice(start));return result;}
function comparison(row,key,expression){
 const [operator,...rest]=expression.split('.'),raw=rest.join('.'),expected=raw.replace(/^"|"$/g,'');
 if(operator==='eq')return String(valueAt(row,key)??'')===expected;
 if(operator==='neq')return String(valueAt(row,key)??'')!==expected;
 if(operator==='is')return expected==='null'?valueAt(row,key)==null:String(valueAt(row,key))===expected;
 if(operator==='in')return terms(raw.replace(/^\(|\)$/g,'')).map(value=>value.replace(/^"|"$/g,'')).includes(String(valueAt(row,key)));
 if(operator==='not')return !comparison(row,key,raw);
 throw Error('Unsupported fixture comparison '+expression);
}
function expression(row,term){if(term.startsWith('and('))return terms(term.slice(4,-1)).every(item=>expression(row,item));if(term.startsWith('or('))return terms(term.slice(3,-1)).some(item=>expression(row,item));const match=term.match(/^(.+?)\.(eq|neq|is|in|not)\.(.*)$/);assert.ok(match,'Expected PostgREST filter '+term);return comparison(row,match[1],match[2]+'.'+match[3]);}
function generation(options={}){
 const tables={incident_mgmt_records:options.records||[lesson(options.lesson)],events:options.events||[incident()],investigations:options.investigations||[investigation()],action_tracker:options.actions||[],safety_bulletins:options.bulletins||[]};
 for(const name of Object.keys(tables))tables[name]=structuredClone(tables[name]);
 const current={companyId:COMPANY,userId:USER,role:'hse_manager',name:'Fictional manager'},requests=[],saved=[],writes=[];
 const c={Date,Map,Set,URL,URLSearchParams,TextEncoder,TextDecoder,crypto:require('node:crypto').webcrypto};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('incident-safety-communication.js','utf8'),c);
 const h={c,tables,current,requests,saved,writes,failBulletin:false,failBulletinRead:false,badConfirmation:false,allowed:true};
 const services={session:()=>({...current}),canManage:()=>h.allowed,chooseInvestigation:options.choose,onSaved:receipt=>saved.push(receipt),api:async(path,request)=>{
  const method=request?.m||'GET',url=new URL('https://fixture.invalid'+path),table=url.pathname.slice(1),parameters=url.searchParams;assert.ok(table in tables,'No notifications, messages or unrelated writes during draft generation: '+path);
  requests.push({path,request:request&&structuredClone(request)});
  if(method==='GET'){
   assert.equal(parameters.get('company_id'),'eq.'+current.companyId,'Every source and retained-draft read must be scoped to the active company');
   if(table==='safety_bulletins'&&h.failBulletinRead)throw Error('Bulletin lookup unavailable');
   let rows=tables[table].filter(row=>Array.from(parameters).every(([key,value])=>{
    if(['select','order','offset','limit','on_conflict'].includes(key))return true;
    if(key==='or')return terms(value.replace(/^\(|\)$/g,'')).some(term=>expression(row,term));
    if(key==='and')return terms(value.replace(/^\(|\)$/g,'')).every(term=>expression(row,term));
    return comparison(row,key,value);
   }));const offset=Number(parameters.get('offset')||0),limit=Number(parameters.get('limit')||1000);rows=structuredClone(rows.slice(offset,offset+limit));
   if(options.afterRead)await options.afterRead(path,rows,h);return rows;
  }
  assert.ok(['incident_mgmt_records','safety_bulletins'].includes(table),'Generation must never change its approved lesson, incident or investigation');assert.equal(request.p,'return=representation');
  writes.push({table,method,body:structuredClone(request.b),path});if(table==='safety_bulletins'&&h.failBulletin)throw Error('Bulletin write unavailable');
  const body=structuredClone(request.b);if(body.company_id!==undefined)assert.equal(body.company_id,current.companyId);let row;
  if(method==='POST'){
   const id=body.id||table+'-'+(tables[table].length+1);if(tables[table].some(existing=>existing.id===id))throw Object.assign(Error('Duplicate identity'),{code:'23505'});
   row={created_at:'2026-11-26T10:00:00Z',updated_at:'2026-11-26T10:00:00Z',...body,id};tables[table].push(row);
  }else{
   assert.equal(method,'PATCH');const id=parameters.get('id')?.replace(/^eq\./,'');row=tables[table].find(existing=>existing.id===id&&existing.company_id===current.companyId);assert.ok(row,'PATCH must retain an existing exact record ID');Object.assign(row,body);
  }
  if(table==='incident_mgmt_records'&&h.badConfirmation)return [];return [structuredClone(row)];
 }};
 h.services=services;h.generate=()=>c.AurisIncidentCommunication.generate('lesson-a',services);h.communications=()=>tables.incident_mgmt_records.filter(row=>row.record_type==='safety_communication');return h;
}
function noWrites(h){assert.equal(h.writes.length,0);assert.equal(h.communications().length,0);assert.equal(h.tables.safety_bulletins.length,0);assert.equal(h.saved.length,0);}

test('the lesson source selector offers only investigations linked to the selected same-company incident',()=>{
 const h=generation({investigations:[investigation(),investigation({id:'reference-only',event_id:null,linked_event_ref:'INC-2026-001'}),investigation({id:'unrelated',event_id:'incident-other'}),investigation({id:'foreign',company_id:'company-b'})]});
 h.c.X={data:{events:h.tables.events,investigations:h.tables.investigations}};h.c.companyId=()=>COMPANY;h.c.byId=(rows,id)=>(rows||[]).find(row=>row.id===id);vm.runInContext(section(upgrade,'function lessonInvestigationOptions(','function field('),h.c);
 assert.deepEqual(Array.from(h.c.lessonInvestigationOptions('incident-a',''),option=>option[0]),['','investigation-a','reference-only']);
 const legacy=h.c.lessonInvestigationOptions('incident-a','previously-linked');assert.equal(legacy.at(-1)[0],'previously-linked');assert.match(legacy.at(-1)[1],/Saved investigation/);
});

test('a validated lesson can generate from a closed reference-only investigation without sending or publishing',async()=>{
 const h=generation({lesson:{investigation_id:null},investigations:[investigation({event_id:null,linked_event_ref:'INC-2026-001'})]}),receipt=await h.generate();
 assert.equal(receipt.investigation.id,'investigation-a');assert.equal(receipt.communication.status,'draft');assert.equal(receipt.bulletin.status,'draft');assert.equal(receipt.communication.investigation_id,'investigation-a');assert.equal(receipt.communication.incident_id,'incident-a');assert.equal(receipt.communication.payload.source_lesson_id,'lesson-a');assert.equal(receipt.communication.payload.source_investigation_id,'investigation-a');
 assert.equal(h.communications().length,1);assert.equal(h.tables.safety_bulletins.length,1);assert.equal(h.saved.length,1);assert.ok(h.writes.every(write=>write.body.status==='draft'||write.body.status===undefined));assert.ok(h.requests.every(request=>!request.path.includes('notification')));
});

test('an explicit completed lesson investigation wins over an earlier open investigation for the same incident',async()=>{
 const h=generation({investigations:[investigation({id:'open-first',status:'open'}),investigation({status:'completed'})]}),receipt=await h.generate();assert.equal(receipt.investigation.id,'investigation-a');assert.equal(receipt.communication.payload.source_investigation_id,'investigation-a');
});

test('without an explicit lesson link, a unique completed investigation is not masked by an open candidate',async()=>{
 const h=generation({lesson:{investigation_id:null},investigations:[investigation({id:'open-first',status:'open'}),investigation()]}),receipt=await h.generate();assert.equal(receipt.investigation.id,'investigation-a');
});

test('pending lessons and incomplete investigations remain blocked without creating any drafts',async()=>{
 for(const status of ['draft','content_review','privacy_review','withdrawn']){const h=generation({lesson:{status}});await assert.rejects(h.generate(),error=>error.code==='lesson_not_approved');noWrites(h);}
 for(const status of ['open','in_progress','submitted']){const h=generation({investigations:[investigation({status,plan_status:'approved'})]});await assert.rejects(h.generate(),error=>error.code==='investigation_incomplete');noWrites(h);}
});

test('an explicit missing, foreign-company or wrongly linked investigation never falls back to another completed record',async()=>{
 for(const invalid of [null,investigation({company_id:'company-b'}),investigation({event_id:'incident-other'}),investigation({event_id:'incident-a',incident_id:'incident-other'})]){
  const h=generation({investigations:[...(invalid?[invalid]:[]),investigation({id:'different-completed'})]});await assert.rejects(h.generate());noWrites(h);
 }
});

test('other-company records cannot supply an approved lesson or its source incident',async()=>{
 for(const options of [{lesson:{company_id:'company-b'}},{events:[incident({company_id:'company-b'})]}]){const h=generation(options);await assert.rejects(h.generate());noWrites(h);}
});

test('ambiguous completed sources require an explicit choice and generation records the selected exact ID',async()=>{
 const options={lesson:{investigation_id:null},investigations:[investigation(),investigation({id:'investigation-b'})]},blocked=generation(options);await assert.rejects(blocked.generate(),error=>error.code==='ambiguous_source');noWrites(blocked);
 let candidates;const chosen=generation({...options,choose:async rows=>{candidates=rows;return 'investigation-b';}}),receipt=await chosen.generate();assert.deepEqual(Array.from(candidates,row=>row.id).sort(),['investigation-a','investigation-b']);assert.equal(receipt.investigation.id,'investigation-b');assert.equal(receipt.communication.investigation_id,'investigation-b');
});

test('ambiguous reference links and an invalid chooser result remain blocked',async()=>{
 const duplicate=generation({lesson:{investigation_id:null},events:[incident(),incident({id:'duplicate-reference'})],investigations:[investigation({event_id:null,linked_event_ref:'INC-2026-001'})]});await assert.rejects(duplicate.generate());noWrites(duplicate);
 const invalidChoice=generation({lesson:{investigation_id:null},investigations:[investigation(),investigation({id:'investigation-b'})],choose:async()=> 'not-a-candidate'});await assert.rejects(invalidChoice.generate());noWrites(invalidChoice);
});

test('source completion is refreshed on each attempt rather than inherited from a previous cached result',async()=>{
 const h=generation({investigations:[investigation({status:'open'})]});await assert.rejects(h.generate(),error=>error.code==='investigation_incomplete');noWrites(h);
 h.tables.investigations[0].status='closed';await h.generate();assert.equal(h.communications().length,1);const count=h.writes.length;
 h.tables.investigations[0].status='open';await assert.rejects(h.generate(),error=>error.code==='investigation_incomplete');assert.equal(h.writes.length,count);assert.equal(h.communications().length,1);
});

test('a source reopened after candidate lookup cannot pass the fresh pre-write completion check',async()=>{
 let changed=false;const h=generation({afterRead:(path,_rows,state)=>{if(!changed&&path.startsWith('/investigations?')){changed=true;state.tables.investigations[0].status='open';}}});await assert.rejects(h.generate());noWrites(h);
});

test('company, account and role changes during source reads prevent stale generation',async()=>{
 for(const field of ['companyId','userId','role']){
  let changed=false;const h=generation({afterRead:(_path,_rows,state)=>{if(!changed){changed=true;state.current[field]='changed';}}});await assert.rejects(h.generate(),error=>error.code==='context_changed');noWrites(h);
 }
});

test('a context switch during source selection prevents writes using the old choice',async()=>{
 let h;h=generation({lesson:{investigation_id:null},investigations:[investigation(),investigation({id:'investigation-b'})],choose:async()=>{h.current.userId='different-user';return 'investigation-b';}});await assert.rejects(h.generate(),error=>error.code==='context_changed');noWrites(h);
});

test('generation requires management access before reading or writing source records',async()=>{const h=generation();h.allowed=false;await assert.rejects(h.generate());assert.equal(h.requests.length,0);noWrites(h);});

test('a failed bulletin write retains the confirmed communication and retry reuses its ID',async()=>{
 const h=generation();h.failBulletin=true;let failure;try{await h.generate();assert.fail('The bulletin failure must be reported');}catch(error){failure=error;}
 assert.equal(failure.code,'bulletin_failed');assert.ok(failure.receipt?.communication?.id);const id=failure.receipt.communication.id;assert.equal(h.communications().length,1);assert.equal(h.communications()[0].id,id);assert.equal(h.tables.safety_bulletins.length,0);assert.equal(h.saved.length,0);
 h.failBulletin=false;const receipt=await h.generate();assert.equal(receipt.communication.id,id);assert.equal(receipt.reusedCommunication,true);assert.equal(h.communications().length,1);assert.equal(h.tables.safety_bulletins.length,1);assert.equal(h.saved.length,1);assert.equal(h.writes.filter(write=>write.table==='incident_mgmt_records'&&write.method==='POST').length,1);
 const again=await h.generate();assert.equal(again.communication.id,id);assert.equal(again.bulletin.id,receipt.bulletin.id);assert.equal(again.reusedBulletin,true);assert.equal(h.communications().length,1);assert.equal(h.tables.safety_bulletins.length,1);
});

test('the module bridge retains and opens a verified partial communication when its bulletin fails',async()=>{
 const h=generation(),opened=[],notices=[];h.failBulletin=true;
 Object.assign(h.c,{X:{data:{records:[lesson()]}},communicationServices:()=>h.services,byId:(rows,id)=>(rows||[]).find(row=>row.id===id),render(){},imv2OpenSafetyCommunication:id=>opened.push(id),notify:(...args)=>notices.push(args),audit:async()=>{},console:{warn(){}}});
 vm.runInContext(section(upgrade,'window.imv2GenerateSafetyCommunication=','function safetyCommunicationHtml('),h.c);await h.c.imv2GenerateSafetyCommunication('lesson-a');
 const retained=h.c.X.data.records.find(row=>row.record_type==='safety_communication');assert.ok(retained,'The successfully saved communication must remain accessible after its bulletin fails');assert.equal(retained.id,h.communications()[0].id);assert.deepEqual(opened,[retained.id]);assert.equal(notices.at(-1)[1],false);assert.equal(h.tables.safety_bulletins.length,0);
});

test('an incomplete save confirmation never reports success or creates a bulletin',async()=>{
 const h=generation();h.badConfirmation=true;await assert.rejects(h.generate(),error=>error.code==='confirmation_failed');assert.equal(h.tables.safety_bulletins.length,0);assert.equal(h.saved.length,0);
});

test('a retained communication cannot redirect generation to an arbitrary same-company bulletin draft',async()=>{
 const retained={id:'retained-communication',company_id:COMPANY,incident_id:'incident-a',investigation_id:'investigation-a',record_type:'safety_communication',status:'draft',payload:{source_lesson_id:'lesson-a',source_investigation_id:'investigation-a',source_bulletin_id:'unrelated-bulletin'}};
 const bulletin={id:'unrelated-bulletin',company_id:COMPANY,status:'draft',bulletin_type:'safety_bulletin',distribution_method:'AURIS360 Safety Communications'},h=generation({records:[lesson(),retained],bulletins:[bulletin]});
 await assert.rejects(h.generate(),error=>error.code==='source_mismatch');assert.equal(h.writes.length,0);assert.equal(h.saved.length,0);assert.equal(h.communications().length,1);assert.deepEqual(h.tables.safety_bulletins,[bulletin]);
});

test('an existing legacy bulletin with the same title cannot trigger title-only reuse or another bulletin creation',async()=>{
 const legacy={id:'legacy-bulletin',company_id:COMPANY,status:'draft',bulletin_type:'safety_bulletin',distribution_method:'AURIS360 Safety Communications',title:'Safety Bulletin · INC-2026-001 · Check equipment guards',summary:'Existing unverified source content'},h=generation({bulletins:[legacy]});
 await assert.rejects(h.generate(),error=>error.code==='legacy_bulletin_ambiguous');assert.equal(h.writes.length,0);assert.deepEqual(h.tables.safety_bulletins,[legacy]);assert.equal(h.communications().length,0);assert.equal(h.saved.length,0);
});

test('a legacy bulletin collision preserves a verified existing communication without altering either draft',async()=>{
 const retained={id:'legacy-communication',company_id:COMPANY,incident_id:'incident-a',investigation_id:'investigation-a',record_type:'safety_communication',status:'draft',payload:{source_lesson_id:'lesson-a',source_investigation_id:'investigation-a'}},legacy={id:'legacy-bulletin',company_id:COMPANY,status:'draft',bulletin_type:'safety_bulletin',title:'Safety Bulletin · INC-2026-001 · Check equipment guards'},h=generation({records:[lesson(),retained],bulletins:[legacy]});
 await assert.rejects(h.generate(),error=>error.code==='bulletin_failed'&&error.cause?.code==='legacy_bulletin_ambiguous'&&error.receipt?.communication?.id==='legacy-communication');assert.equal(h.writes.length,0);assert.deepEqual(h.communications(),[retained]);assert.deepEqual(h.tables.safety_bulletins,[legacy]);assert.equal(h.saved.length,0);
});

test('multiple retained drafts for the same source are reported instead of creating or selecting another arbitrarily',async()=>{
 const retained={company_id:COMPANY,incident_id:'incident-a',investigation_id:'investigation-a',record_type:'safety_communication',status:'draft',payload:{source_lesson_id:'lesson-a',source_investigation_id:'investigation-a'}};
 const h=generation({records:[lesson(),{...retained,id:'draft-a'},{...retained,id:'draft-b'}]});await assert.rejects(h.generate(),error=>error.code==='ambiguous_draft');assert.equal(h.writes.length,0);assert.equal(h.communications().length,2);assert.equal(h.saved.length,0);
});

test('concurrent clicks share one verified draft generation instead of creating duplicate records',async()=>{
 let release,started,blocked=false;const ready=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;}),h=generation({afterRead:async()=>{if(!blocked){blocked=true;started();await gate;}}});
 const first=h.generate();await ready;const second=h.generate();release();const [one,two]=await Promise.all([first,second]);assert.equal(one.communication.id,two.communication.id);assert.equal(one.bulletin.id,two.bulletin.id);assert.equal(h.communications().length,1);assert.equal(h.tables.safety_bulletins.length,1);assert.equal(h.saved.length,1);
});

test('a context switch during a rejected source request reports the changed context without exposing a partial receipt',async()=>{
 for(const field of ['companyId','userId','role']){let changed=false;const h=generation({afterRead:(_path,_rows,state)=>{if(!changed){changed=true;state.current[field]='changed';throw Error('Connection failed');}}});await assert.rejects(h.generate(),error=>error.code==='context_changed'&&!error.receipt);noWrites(h);}
});

test('a context switch during a failed bulletin lookup cannot expose the saved old-company draft in its error',async()=>{
 const h=generation({afterRead:(path,_rows,state)=>{if(path.startsWith('/safety_bulletins?')){state.current.userId='different-user';throw Error('Connection failed');}}});await assert.rejects(h.generate(),error=>error.code==='context_changed'&&!error.receipt);assert.equal(h.saved.length,0);assert.equal(h.tables.safety_bulletins.length,0);
});

test('a view-refresh failure reports both verified drafts as saved and retry reuses both IDs',async()=>{
 const h=generation();h.services.onSaved=async()=>{throw Error('The view closed');};let failure;try{await h.generate();assert.fail('The view refresh error must be reported');}catch(error){failure=error;}
 assert.equal(failure.code,'presentation_failed');assert.ok(failure.receipt?.communication?.id);assert.ok(failure.receipt?.bulletin?.id);assert.equal(h.communications().length,1);assert.equal(h.tables.safety_bulletins.length,1);
 h.services.onSaved=receipt=>h.saved.push(receipt);const receipt=await h.generate();assert.equal(receipt.communication.id,failure.receipt.communication.id);assert.equal(receipt.bulletin.id,failure.receipt.bulletin.id);assert.equal(h.communications().length,1);assert.equal(h.tables.safety_bulletins.length,1);
});

test('different explicitly selected completed sources retain separate canonical drafts despite the same bulletin title',async()=>{
 const h=generation({investigations:[investigation(),investigation({id:'investigation-b'})]}),first=await h.generate(),storedLesson=h.tables.incident_mgmt_records.find(row=>row.id==='lesson-a');
 storedLesson.investigation_id='investigation-b';const second=await h.generate();assert.notEqual(second.communication.id,first.communication.id);assert.notEqual(second.bulletin.id,first.bulletin.id);assert.equal(second.bulletin.title,first.bulletin.title);assert.equal(second.communication.investigation_id,'investigation-b');
 const secondRetry=await h.generate();assert.equal(secondRetry.communication.id,second.communication.id);assert.equal(secondRetry.bulletin.id,second.bulletin.id);
 storedLesson.investigation_id='investigation-a';const firstRetry=await h.generate();assert.equal(firstRetry.communication.id,first.communication.id);assert.equal(firstRetry.bulletin.id,first.bulletin.id);
 assert.equal(h.communications().length,2);assert.equal(h.tables.safety_bulletins.length,2);assert.equal(h.writes.filter(write=>write.method==='POST'&&write.table==='incident_mgmt_records').length,2);assert.equal(h.writes.filter(write=>write.method==='POST'&&write.table==='safety_bulletins').length,2);
});

test('a failed retry lookup retains the previously confirmed communication receipt and later retry completes the same draft',async()=>{
 const h=generation();h.failBulletin=true;let initial;try{await h.generate();assert.fail('The first bulletin write must fail');}catch(error){initial=error;}
 assert.equal(initial.code,'bulletin_failed');const id=initial.receipt.communication.id;h.failBulletin=false;h.failBulletinRead=true;
 await assert.rejects(h.generate(),error=>error.code==='bulletin_failed'&&error.receipt?.communication?.id===id);assert.equal(h.communications().length,1);assert.equal(h.tables.safety_bulletins.length,0);assert.equal(h.saved.length,0);assert.equal(h.writes.filter(write=>write.table==='incident_mgmt_records'&&write.method==='POST').length,1);
 h.failBulletinRead=false;const finished=await h.generate();assert.equal(finished.communication.id,id);assert.equal(h.communications().length,1);assert.equal(h.tables.safety_bulletins.length,1);assert.equal(h.saved.length,1);assert.equal(h.writes.filter(write=>write.table==='incident_mgmt_records'&&write.method==='POST').length,1);
});
