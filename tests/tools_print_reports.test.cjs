const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function runtime(){
 let company='client',denied='',fail='',hook=null;const requests=[],controls={},state={tab:'register',filters:{},inspectionFilters:{search:'',status:'active'},personId:'',rcd:{}};
 const tables={
 tools_register:[
 {id:'eq-1',company_id:'client',ref_number:'EQ-001',name:'Hand <tool>',category:'hand_tool',serial_number:'SN-1',location:'Workshop',assigned_to:'person-a',assigned_to_name:'Asha Shah',status:'active',inspection_frequency:'monthly',requires_statutory:false},
 {id:'eq-2',company_id:'client',ref_number:'EQ-002',name:'Power drill',category:'power_tool',brand:'North',serial_number:'SN-2',location:'Office',status:'active',inspection_frequency:'monthly'},
 {id:'eq-3',company_id:'client',ref_number:'EQ-003',name:'Ladder',category:'equipment',location:'Workshop',assigned_to:'person-b',assigned_to_name:'Ben Stone',status:'under_maintenance',inspection_frequency:'monthly',requires_statutory:true,statutory_type:'Load examination',next_statutory_date:'2026-10-01'},
 {id:'lift',company_id:'client',ref_number:'LIFT-001',name:'Web sling',category:'lifting',status:'active',inspection_frequency:'monthly'},
 {id:'rcd',company_id:'client',ref_number:'RCD-001',name:'Distribution board RCD',category:'electrical',status:'out_of_service',requires_statutory:true,next_statutory_date:null},
 {id:'tester',company_id:'client',ref_number:'EQ-TEST',name:'RCD tester',category:'electrical',status:'active'},
 {id:'vehicle',company_id:'client',ref_number:'VEH-001',name:'Delivery vehicle',category:'vehicle',is_vehicle:true,status:'active'}],
 tool_inspections:[
 {id:'old-pass',company_id:'client',tool_id:'eq-1',inspection_date:'2026-10-01',overall_result:'pass',status:'active',inspection_type:'periodic'},
 {id:'failure',company_id:'client',tool_id:'eq-1',inspection_date:'2026-10-20',overall_result:'fail',status:'active',inspection_type:'pre_use',inspected_by_name:'Asha Shah',defects_found:'Guard <missing>',checklist_results:[{item:'Guard fitted',result:'fail',note:'<replace>'},{item:'Power isolated',result:'',note:''}]},
 {id:'archived-pass',company_id:'client',tool_id:'eq-1',inspection_date:'2026-10-21',overall_result:'pass',status:'archived',inspection_type:'periodic',archive_reason:'Superseded duplicate'},
 {id:'current',company_id:'client',tool_id:'eq-2',inspection_date:'2026-10-01',overall_result:'pass',status:'active',inspection_type:'periodic'},
 {id:'overdue',company_id:'client',tool_id:'eq-3',inspection_date:'2026-08-01',overall_result:'conditional',status:'active',inspection_type:'periodic'},
 {id:'lift-insp',company_id:'client',tool_id:'lift',inspection_date:'2026-10-21',overall_result:'conditional',status:'active',inspection_type:'periodic',next_inspection_date:'2026-11-21'},
 {id:'rcd-test',company_id:'client',tool_id:'rcd',inspection_date:'2026-10-01',overall_result:'fail',status:'active',inspection_type:'rcd_monthly',next_inspection_date:'2026-11-01'},
 {id:'rcd-preuse',company_id:'client',tool_id:'rcd',inspection_date:'2026-10-20',overall_result:'pass',status:'active',inspection_type:'pre_use'},
 {id:'orphan',company_id:'client',tool_id:'missing',inspection_date:'2026-10-01',overall_result:null,status:'active',inspection_type:'periodic'}],
 equipment_assurance_profiles:[{id:'profile',company_id:'client',equipment_id:'eq-1',acceptance_status:'accepted',criticality:'safety_critical',critical_block:true,block_reason:'Reinspection required',intended_use:'Bench work'}],
 equipment_assurance_records:[{id:'cert',company_id:'client',equipment_id:'eq-1',reference:'CERT-001',record_type:'certificate',result:'pass',validation_status:'submitted',release_status:'pending',restrictions:'Indoor only',evidence_reference:'CERT/evidence'}],
 equipment_movements:[{id:'issue',company_id:'client',equipment_id:'eq-1',movement_type:'issue',holder_name:'Asha Shah',issued_at:'2026-10-01T09:00:00Z',expected_return_at:'2026-10-02T09:00:00Z',status:'open',condition_out:'Good',eligibility_verified:false}],
 equipment_maintenance_events:[{id:'maintenance',company_id:'client',equipment_id:'eq-1',reference:'MNT-001',maintenance_type:'corrective',status:'completed',work_performed:'Guard fitted',release_status:'pending',release_authority:null}],
 equipment_defects:[{id:'defect',company_id:'client',equipment_id:'eq-1',reference:'DEF-001',description:'Guard missing',severity:'critical',status:'quarantined',release_required:true}],
 work_schedule:[{id:'work',company_id:'client',ref_number:'WO-005',status:'planned'}],work_schedule_links:[{id:'link',company_id:'client',link_type:'equipment',record_id:'eq-2',work_order_id:'work'}]
 };
 class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-10-22T12:00:00Z']));}static now(){return new Date('2026-10-22T12:00:00Z').getTime();}}
 const c={Date:Clock,Intl,Map,Set,URL,console,setTimeout,clearTimeout,location:{href:'https://fixture.test/',origin:'https://fixture.test'},document:{getElementById:id=>controls[id]||null},prof:{id:'user',role:'sephs_admin',company_id:'sephs'},co:{id:'sephs',name:'SEPHS Consulting'},saCompanyList:[{id:'client',name:'Selected Engineering Ltd',logo_url:'/client-logo.png'}],sephsCompanyContext:'client',isSA:()=>true,ccid:()=>company,activeRole:()=>c.prof.role,canAccessPage:()=>true,AurisUserAccess:{sectionAllowed:(p,m,s)=>s!==denied},apiAllRows:async path=>{requests.push(path);const u=new URL('https://fixture.test'+path),table=u.pathname.slice(1);if(hook)await hook(table);if(table===fail)throw Error('network unavailable');const id=u.searchParams.get('id');return structuredClone((tables[table]||[]).filter(r=>!id||String(r.id)===id.slice(3)));},toast(){},AurisToolsReportState:()=>structuredClone(state)};
 c.window=c;vm.createContext(c);for(const file of ['auris-tools-list-workspace.js','module-report-preview.js','tools-print-reports.js'])vm.runInContext(fs.readFileSync(file,'utf8'),c);
 return {c,tables,state,requests,controls,api:c.AurisToolsPrint,select:v=>company=v,deny:v=>denied=v,fail:v=>fail=v,hook:v=>hook=v};
}
test('full company register uses fresh records, selected branding, and excludes vehicles and RCD devices',async()=>{
 const h=runtime();h.state.filters={search:'Nothing matches',category:'ppe'};const result=await h.api.capture({kind:'register',filtered:false,paper:'A4'});
 assert.match(result.sourceLabel,/5 saved records.*Full company register/);assert.equal(result.paper,'A4');assert.match(result.html,/EQ-001/);assert.match(result.html,/EQ-TEST/);assert.doesNotMatch(result.html,/VEH-001|RCD-001|WO-005|In store/);assert.ok(!h.requests.some(path=>path.startsWith('/work_schedule')));assert.match(result.html,/Asha Shah/);assert.match(result.html,/Restricted - failed check/);assert.match(result.html,/20\/10\/2026/);assert.match(result.html,/Hand &lt;tool&gt;/);assert.doesNotMatch(result.html,/<button|<select|created_at|updated_at|<tool>/);
 const brand=h.c.AurisModuleReports.company(result.context);assert.equal(brand.name,'Selected Engineering Ltd');const print=h.c.AurisModuleReports.documentHtml(result,brand,result.html);assert.match(print,/client-logo.png/);assert.doesNotMatch(print,/SEPHS Consulting/);
 h.tables.tools_register[0].name='Freshly saved name';assert.match((await h.api.capture({kind:'register'})).html,/Freshly saved name/);assert.ok(h.requests.every(path=>path.includes('company_id=eq.client')));
});
test('saved personal-view filters use the exact equipment projection, including failed-active restrictions',async()=>{
 const h=runtime();h.state.filters={search:'guard',category:'hand_tool',status:'out_of_service',inspection:''};h.tables.tools_register[0].notes='Guard review';
 const result=await h.api.capture({kind:'register',filtered:true});assert.match(result.sourceLabel,/1 saved records.*Search: guard.*Hand Tool.*Out Of Service/);assert.match(result.html,/EQ-001/);assert.doesNotMatch(result.html,/EQ-002/);
 await assert.rejects(h.api.capture({kind:'register',filtered:true,filters:{status:'active',search:'EQ-001'}}),/No saved equipment/);
 const overdue=await h.api.capture({kind:'register',filtered:true,filters:{inspection:'overdue',category:'equipment'}});assert.match(overdue.html,/EQ-003/);assert.doesNotMatch(overdue.html,/EQ-001/);
});
test('personal and inspection filtered scopes use their own controls',async()=>{
 const h=runtime();h.state.filters={search:'irrelevant register filter'};h.state.personId='person-a';const assigned=await h.api.capture({kind:'personal',filtered:true});assert.match(assigned.html,/EQ-001/);assert.doesNotMatch(assigned.html,/EQ-003/);
 const inspected=await h.api.capture({kind:'inspection',filtered:true,inspectionFilters:{status:'archived',search:'Superseded'}});assert.match(inspected.sourceLabel,/1 saved records/);assert.match(inspected.html,/Superseded duplicate/);assert.doesNotMatch(inspected.html,/Guard &lt;missing&gt;/);
 const full=await h.api.capture({kind:'inspection'});assert.match(full.html,/Equipment reference unavailable/);assert.match(full.html,/Not Recorded/,'Missing results must not default to Pass');
});
test('specialist registers preserve recorded conditions and missing statutory dates',async()=>{
 const h=runtime();const lifting=await h.api.capture({kind:'lifting'});assert.match(lifting.html,/LIFT-001/);assert.match(lifting.html,/Conditional/);assert.doesNotMatch(lifting.html,/RCD-001/);
 const rcd=await h.api.capture({kind:'rcd'});assert.match(rcd.html,/RCD-001/);assert.match(rcd.html,/>Fail</);assert.doesNotMatch(rcd.html,/EQ-TEST|20\/10\/2026/,'Pre-use checks must not replace the latest RCD test');
 const statutory=await h.api.capture({kind:'statutory'});assert.match(statutory.html,/Overdue/);assert.match(statutory.html,/Due date not recorded/);assert.doesNotMatch(statutory.html,/>OK</);
});
test('lifecycle registers keep work result, validation, quarantine and release separate',async()=>{
 const h=runtime();for(const kind of ['custody','assurance','maintenance','defects']){const r=await h.api.capture({kind});assert.match(r.html,/EQ-001/);assert.match(r.sourceLabel,/Full company register/);}
 const maintenance=await h.api.capture({kind:'maintenance'});assert.match(maintenance.html,/Completed/);assert.match(maintenance.html,/Pending/);assert.doesNotMatch(maintenance.html,/>Released</);
 const cert=await h.api.capture({kind:'assurance'});assert.match(cert.html,/Submitted/);assert.match(cert.html,/Blocked — Reinspection required/);assert.match(cert.html,/Not assessed/);
 h.tables.equipment_defects.push({id:'missing-asset',company_id:'client',equipment_id:'gone',reference:'DEF-ORPHAN',description:'Retain history',status:'open'});assert.match((await h.api.capture({kind:'defects'})).html,/Equipment reference unavailable/);
});
test('exact asset report rereads complete history and never uses the screen history limits',async()=>{
 const h=runtime();h.tables.equipment_movements=Array.from({length:620},(_,i)=>({id:'movement-'+i,company_id:'client',equipment_id:i===619?'eq-2':'eq-1',movement_type:'issue',holder_name:'Historical holder '+i,status:'returned'}));
 const result=await h.api.capture({kind:'record',recordId:'eq-1'});assert.match(h.requests[0],/tools_register.*id=eq.eq-1/);assert.match(result.html,/Historical holder 618/);assert.doesNotMatch(result.html,/Historical holder 619|latest 200/);assert.match(result.html,/Guard fitted/);assert.match(result.html,/&lt;replace&gt;/);assert.match(result.html,/Not Recorded/);assert.match(result.html,/Quarantined/);assert.match(result.html,/Release decision/);assert.doesNotMatch(result.html,/created_at|updated_at/);
 await assert.rejects(h.api.capture({kind:'record'}),/Select a saved/);await assert.rejects(h.api.capture({kind:'record',recordId:'vehicle'}),/Fleet/);await assert.rejects(h.api.capture({kind:'record',recordId:'eq-1',section:'rcd'}),/does not belong/);
});
test('missing, failed and forbidden histories stay distinct without reading forbidden sections',async()=>{
 const h=runtime();h.fail('equipment_assurance_records');let report=await h.api.capture({kind:'record',recordId:'eq-1'});assert.match(report.html,/Unavailable — saved history could not be loaded/);
 h.fail('');h.deny('inspection');h.requests.length=0;report=await h.api.capture({kind:'record',recordId:'eq-1'});assert.match(report.html,/Not accessible to your account/);assert.ok(!h.requests.some(x=>x.startsWith('/tool_inspections')));
 const register=await h.api.capture({kind:'register'});assert.match(register.html,/Not accessible to your account/);assert.doesNotMatch(register.html,/Never inspected|>Pass</);
 await assert.rejects(h.api.capture({kind:'register',filtered:true,filters:{inspection:'overdue'}}),/Inspection history is unavailable/);
 h.deny('register');const count=h.requests.length;await assert.rejects(h.api.capture({kind:'maintenance'}),/cannot view/);assert.equal(h.requests.length,count);
});
test('record reports preserve all saved operational dates but omit internal UUID and runtime timestamps',async()=>{
 const h=runtime(),uuid='12345678-1234-1234-1234-123456789012';h.tables.tools_register[0].assigned_to_name=uuid;h.tables.equipment_assurance_records[0].validated_by=uuid;h.tables.tools_register[0].updated_at='2001-01-01T00:00:00Z';const report=await h.api.capture({kind:'record',recordId:'eq-1'});
 assert.doesNotMatch(report.html,new RegExp(uuid));assert.doesNotMatch(report.html,/2001-01-01T00:00:00Z/);assert.match(report.html,/Return due/);
});
test('RCD history is fresh, exact, date-bounded and excludes unrelated inspection types',async()=>{
 const h=runtime();const report=await h.api.capture({kind:'rcdHistory',recordId:'rcd',from:'2026-10-01',to:'2026-10-02'});assert.match(report.html,/>Fail</);assert.doesNotMatch(report.html,/20\/10\/2026|EQ-001/);assert.match(report.sourceLabel,/01\/10\/2026 to 02\/10\/2026/);
 const empty=await h.api.capture({kind:'rcdHistory',recordId:'rcd',from:'2099-01-01'});assert.match(empty.html,/No saved tests match/);await assert.rejects(h.api.capture({kind:'rcdHistory',recordId:'rcd',from:'2027-01-01',to:'2026-01-01'}),/start date/);
});
test('exact saved inspection contains unanswered checklist items without inventing N/A or pass',async()=>{
 const h=runtime();const r=await h.api.capture({kind:'inspectionRecord',recordId:'failure'});assert.match(r.html,/Guard &lt;missing&gt;/);assert.match(r.html,/Guard fitted/);assert.match(r.html,/Power isolated/);assert.match(r.html,/Not Recorded/);assert.doesNotMatch(r.html,/Not applicable|>Pass</);assert.match(r.title,/EQ-001/);
});
test('pagination is performed by the shared saved-record reader beyond the first database page',async()=>{
 const h=runtime();delete h.c.apiAllRows;h.tables.equipment_defects=Array.from({length:501},(_,i)=>({id:'def-'+i,company_id:'client',equipment_id:'eq-1',reference:'DEF-'+i,status:'open'}));const paths=[];h.c.api=async path=>{paths.push(path);const u=new URL('https://fixture.test'+path);return structuredClone((h.tables[u.pathname.slice(1)]||[]).slice(Number(u.searchParams.get('offset')||0),Number(u.searchParams.get('offset')||0)+Number(u.searchParams.get('limit')||500)));};
 const r=await h.api.capture({kind:'defects'});assert.match(r.sourceLabel,/501 saved records/);assert.match(r.html,/DEF-500/);assert.ok(paths.some(p=>p.startsWith('/equipment_defects')&&p.includes('offset=500')));
});
test('foreign responses and company, user, role and permission changes abort late reports',async()=>{
 const h=runtime();h.tables.tools_register.push({id:'foreign',company_id:'other'});await assert.rejects(h.api.capture({kind:'register'}),/did not match/);
 for(const change of [x=>x.select('other'),x=>x.c.prof.id='other-user',x=>x.c.prof.role='employee',x=>x.deny('inspection')]){const x=runtime();x.hook(table=>{if(table==='tool_inspections')change(x);});await assert.rejects(x.api.capture({kind:'register'}),/changed|cannot view/);}
 const x=runtime();x.hook(table=>{if(table==='equipment_movements')x.select('other');});await assert.rejects(x.api.capture({kind:'record',recordId:'eq-1'}),/changed/);
});
test('direct record preview rejects a stale viewer session before reserving or reading',async()=>{
 const h=runtime();let reserved=0,message='';h.c.AurisModuleReports.reserve=()=>{reserved++;return {closed:false};};h.c.toast=v=>message=v;const result=await h.api.record('eq-1',{companyId:'old',userId:'user',role:'sephs_admin'});assert.equal(result,false);assert.equal(reserved,0);assert.equal(h.requests.length,0);assert.match(message,/changed/);
});
function deferred(){let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};}
function dialogRuntime(){
 const h=runtime(),windows=[],previews=[];let dialog,focusCount=0;function target(extra={}){return Object.assign({events:{},addEventListener(event,handler){this.events[event]=handler;},focus(){}},extra);}
 const elements={kind:target({value:'register'}),scope:target({value:'all'}),paper:{value:'A3'},record:{value:''},from:{value:''},to:{value:''}},button={disabled:false},cancel=target(),error={textContent:''},description={textContent:''},recordArea={hidden:true},scopeArea={hidden:false},rangeArea={hidden:true};
 const form=target({elements,querySelector(selector){assert.equal(selector,'[type="submit"]');return button;}});h.c.document.activeElement={isConnected:true,focus(){focusCount++;}};
 h.c.document.createElement=tag=>{assert.equal(tag,'dialog');dialog=target({isConnected:false,setAttribute(){},showModal(){this.open=true;},close(){this.open=false;},remove(){this.isConnected=false;delete h.controls[this.id];},querySelector(selector){return {form,'[data-cancel]':cancel,'[data-error]':error,'[data-description]':description,'[data-record]':recordArea,'[data-scope]':scopeArea,'[data-range]':rangeArea}[selector];}});return dialog;};h.c.document.body={appendChild(d){d.isConnected=true;h.controls[d.id]=d;}};
 h.c.AurisModuleReports.ensureStyle=()=>{};h.c.AurisModuleReports.reserve=()=>{const w={closed:false,closeCount:0,close(){this.closed=true;this.closeCount++;}};windows.push(w);return w;};h.c.AurisModuleReports.preview=async r=>{previews.push(r);return r.preparedWindow;};
 return Object.assign(h,{windows,previews,elements,button,error,recordArea,rangeArea,open(kind){h.api.open(kind);return dialog;},submit(){return form.events.submit({preventDefault(){}});},cancel(){cancel.events.click();},escape(){dialog.events.cancel({preventDefault(){}});},focusCount:()=>focusCount});
}
test('chooser prevents duplicate submit and closes a cancelled preview reservation before late data arrives',async()=>{
 for(const dismiss of ['cancel','escape']){const h=dialogRuntime(),load=deferred();h.c.apiAllRows=()=>load.promise;const d=h.open('register'),submission=h.submit();assert.equal(h.button.disabled,true);await h.submit();assert.equal(h.windows.length,1);h[dismiss]();assert.equal(d.isConnected,false);assert.equal(h.windows[0].closed,true);load.resolve(structuredClone(h.tables.tools_register));await submission;assert.equal(h.previews.length,0);assert.equal(h.button.disabled,false);}
});
test('chooser captures selected filters and paper, keeps options on failure, then opens a successful preview',async()=>{
 const h=dialogRuntime();h.state.filters={search:'Power drill'};const d=h.open('register');h.elements.scope.value='filters';h.elements.paper.value='A4';h.fail('tools_register');await h.submit();assert.equal(d.isConnected,true);assert.equal(h.windows[0].closed,true);assert.match(h.error.textContent,/unavailable/);
 h.fail('');await h.submit();assert.equal(h.previews.length,1);assert.equal(h.previews[0].paper,'A4');assert.match(h.previews[0].sourceLabel,/1 saved records.*Search: Power drill/);assert.doesNotMatch(h.previews[0].html,/EQ-001/);assert.equal(d.isConnected,false);assert.equal(h.windows[1].closed,false);assert.equal(h.focusCount(),1);
});
test('RCD chooser exposes an exact saved device and range instead of stale screen history',async()=>{
 const h=dialogRuntime();h.state.rcd={id:'rcd',from:'2026-10-01',to:'2026-10-02'};h.open('rcdHistory');await new Promise(resolve=>setImmediate(resolve));assert.equal(h.recordArea.hidden,false);assert.equal(h.rangeArea.hidden,false);assert.equal(h.elements.record.value,'rcd');assert.doesNotMatch(h.elements.record.innerHTML,/EQ-TEST/);await h.submit();assert.match(h.previews[0].sourceLabel,/01\/10\/2026 to 02\/10\/2026/);assert.doesNotMatch(h.previews[0].html,/20\/10\/2026/);
});
function restrict(h,keys){
 h.c.prof.role='employee';h.c.prof.company_id='client';h.c.prof.permissions={access_v1:{tools:{view:true}}};for(const key of ['register','personal','inspection','lifting','statutory','rcd'])h.c.prof.permissions.access_v1['tools.'+key]={view:keys.includes(key)};
 vm.runInContext(fs.readFileSync('auris-user-access.js','utf8'),h.c);return h;
}
test('real section restrictions allow exact asset reports from RCD, lifting, statutory and personal pages',async()=>{
 for(const [section,id,reference] of [['rcd','rcd','RCD-001'],['lifting','lift','LIFT-001'],['statutory','eq-3','EQ-003'],['personal','eq-1','EQ-001']]){
  const h=restrict(runtime(),[section]);h.state.tab=section;const report=await h.api.capture({kind:'record',recordId:id});assert.match(report.title,new RegExp(reference));assert.ok(report.section.includes(section));assert.ok(!report.section.includes('register'));assert.ok(!h.requests.some(path=>path.startsWith('/equipment_')),'Denied lifecycle histories must not be read');assert.match(report.html,/Not accessible to your account/);
  if(section==='rcd'){assert.match(report.html,/Rcd Monthly/);assert.doesNotMatch(report.html,/Pre Use/);}if(section==='lifting')assert.match(report.html,/Conditional/);
  await assert.rejects(h.api.capture({kind:'record',recordId:'eq-2'}),/does not belong/);
 }
});
test('specialist inspection permissions require the exact asset and permitted inspection type',async()=>{
 const rcd=restrict(runtime(),['rcd']);rcd.state.tab='rcd';const report=await rcd.api.capture({kind:'inspectionRecord',recordId:'rcd-test'});assert.equal(report.section,'rcd');assert.match(report.title,/RCD-001/);assert.match(report.html,/>Fail</);
 for(const id of ['failure','rcd-preuse','orphan'])await assert.rejects(rcd.api.capture({kind:'inspectionRecord',recordId:id}),/does not belong/);
 const lifting=restrict(runtime(),['lifting']),lift=await lifting.api.capture({kind:'inspectionRecord',recordId:'lift-insp'});assert.equal(lift.section,'lifting');assert.match(lift.html,/Conditional/);await assert.rejects(lifting.api.capture({kind:'inspectionRecord',recordId:'rcd-test'}),/does not belong/);
 const personal=restrict(runtime(),['personal']);await assert.rejects(personal.api.capture({kind:'inspectionRecord',recordId:'failure'}),/cannot view an inspection/);
});
test('full asset chooser is available with specialist access and offers only matching assets',async()=>{
 const h=restrict(dialogRuntime(),['rcd']);h.state.tab='rcd';const dialog=h.open('record');await new Promise(resolve=>setImmediate(resolve));assert.match(dialog.innerHTML,/Full saved equipment report/);assert.equal(h.elements.kind.value,'record');assert.match(h.elements.record.innerHTML,/RCD-001/);assert.doesNotMatch(h.elements.record.innerHTML,/EQ-001|LIFT-001|EQ-TEST/);h.elements.record.value='rcd';await h.submit();assert.equal(h.previews.length,1);assert.ok(h.previews[0].section.includes('rcd'));assert.equal(dialog.isConnected,false);
});
test('originating reader context and same-role specialist revocation remain guarded',async()=>{
 const h=restrict(runtime(),['rcd']);h.state.tab='rcd';let preview;h.c.AurisModuleReports.reserve=()=>({closed:false,close(){this.closed=true;}});h.c.AurisModuleReports.preview=async r=>(preview=r);await h.api.record('rcd',{companyId:'client',userId:'user',role:'employee'});assert.match(preview.title,/RCD-001/);assert.ok(preview.section.includes('rcd'));
 const x=restrict(runtime(),['rcd']);x.state.tab='rcd';x.hook(table=>{if(table==='tool_inspections')x.c.prof.permissions.access_v1['tools.rcd'].view=false;});await assert.rejects(x.api.capture({kind:'record',recordId:'rcd'}),/cannot view/);
});
