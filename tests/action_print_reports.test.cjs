const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function runtime(){
 let company='client',denied='';const controls={},requests=[],rows=[
 {id:'meeting',company_id:'client',action_ref:'MAP-001',title:'Review <training>',source_module:'meetings',source_ref:'MOM-001',responsible:'Asha Shah',target_date:'2001-01-01',priority:'high',status:'open',progress_pct:25,action_type:'corrective'},
 {id:'audit',company_id:'client',action_ref:'MAP-002',title:'Inspect controls',source_module:'audit',responsible:'Ben Stone',assigned_to_id:'reviewer',target_date:'2099-01-01',priority:'low',status:'pending_verification',progress_pct:100,action_type:'preventive'},
 {id:'closed',company_id:'client',action_ref:'MAP-003',title:'Closed finding',source_module:'event',responsible:'Other',target_date:'2001-01-01',priority:'high',status:'closed',progress_pct:0,action_type:'improvement'},
 {id:'closure',company_id:'client',action_ref:'MAP-004',title:'Verified finding',source_module:'noise',responsible:'Other',target_date:'2001-01-01',priority:'medium',status:'pending_closure',progress_pct:100}
 ];
 const c={Date,Intl,Set,Map,URL,console,setTimeout,clearTimeout,document:{getElementById:id=>controls[id]||null},prof:{id:'reviewer',full_name:'Asha Shah',company_id:'sephs',role:'sephs_admin'},co:{id:'sephs',name:'SEPHS Consulting'},saCompanyList:[{id:'client',name:'Selected Engineering Ltd',logo_url:'/client-logo.png'}],sephsCompanyContext:'client',isSA:()=>true,ccid:()=>company,canAccessPage:()=>true,activeRole:()=>c.prof.role,AurisUserAccess:{sectionAllowed:(p,m,s)=>s!==denied},apiAllRows:async path=>{requests.push(path);return structuredClone(rows);},mapCurrentView:'all'};
 c.window=c;vm.createContext(c);for(const file of ['auris-action-list-workspace.js','module-report-preview.js','action-print-reports.js'])vm.runInContext(fs.readFileSync(file,'utf8'),c);
 return {c,rows,requests,controls,api:c.AurisActionPrint,select:v=>company=v,deny:v=>denied=v};
}
test('full action report rereads all saved company actions and ignores the screen queue and filters',async()=>{
 const h=runtime();h.c.mapCurrentView='closure';h.controls['map-search']={value:'No match'};
 const report=await h.api.capture({filtered:false,filters:{scope:'closure',search:'No match'},paper:'A4'});
 assert.match(h.requests[0],/^\/action_tracker\?select=\*&company_id=eq.client/);assert.match(report.sourceLabel,/4 saved actions.*Full company register.*screen filters excluded/);assert.equal(report.paper,'A4');assert.match(report.html,/MAP-001/);assert.match(report.html,/MAP-004/);assert.match(report.html,/>Closed</);assert.match(report.html,/>0%</,'A closed record must not acquire invented progress');
 h.rows[0].title='Freshly saved wording';const fresh=await h.api.capture({filtered:false});assert.match(fresh.html,/Freshly saved wording/);assert.equal(h.requests.length,2);
});
test('filtered action reports match queue, search, aliased source, priority, status and action type',async()=>{
 const h=runtime();const combined=await h.api.capture({filtered:true,filters:{scope:'mine',source:'meeting',search:'training',priority:'high',status:'open',type:'corrective'}});
 assert.match(combined.sourceLabel,/1 saved actions.*My actions.*Search: training/);assert.match(combined.html,/MAP-001/);assert.doesNotMatch(combined.html,/MAP-002|MAP-003|MAP-004/);
 for(const [scope,expected] of [['mine',['MAP-001','MAP-002']],['overdue',['MAP-001','MAP-004']],['verify',['MAP-002']],['closure',['MAP-004']]]){
  const result=await h.api.capture({filtered:true,filters:{scope}});for(const ref of ['MAP-001','MAP-002','MAP-003','MAP-004'])assert.equal(result.html.includes(ref),expected.includes(ref),scope+' '+ref);
 }
 const aliased=await h.api.capture({filtered:true,filters:{source:'incident'}});assert.match(aliased.html,/MAP-003/);assert.doesNotMatch(aliased.html,/MAP-001/);
});
test('current control values capture the same filters used by selected personal views',()=>{
 const h=runtime();h.c.mapCurrentView='mine';for(const [id,value] of [['map-search','review'],['map-filter-source','meeting'],['filter-priority','high'],['filter-status','open'],['map-filter-type','preventive']])h.controls[id]={value};
 assert.deepEqual(JSON.parse(JSON.stringify(h.api.filters())),{scope:'mine',search:'review',source:'meeting',priority:'high',status:'open',type:'preventive'});
});
test('legacy display references use the fresh complete register without consulting stale cached rows',async()=>{
 const h=runtime();h.rows.splice(0,h.rows.length,...['b','a'].map(id=>({id,company_id:'client',action_ref:'legacy-'+id,created_at:'2026-01-01',action_type:'corrective',title:'Legacy '+id,status:'open'})));
 h.c.mapHasProfessionalRef=ref=>/^MAP-[A-Z]{2}-\d{4}-\d{3,}$/.test(ref);h.c.mapDisplayRef=()=>{throw Error('Stale cached reference helper must not run');};
 const result=await h.api.capture({filtered:false});assert.match(result.html,/MAP-CA-2026-001/);assert.match(result.html,/MAP-CA-2026-002/);
 const filtered=await h.api.capture({filtered:true,filters:{search:'MAP-CA-2026-002'}});assert.match(filtered.html,/Legacy b/);assert.doesNotMatch(filtered.html,/Legacy a/);
});
test('report markup escapes data and contains ordinary labels without interface controls',async()=>{
 const h=runtime(),report=await h.api.capture({filtered:false});assert.match(report.html,/Review &lt;training&gt;/);assert.match(report.html,/01\/01\/2001/);assert.doesNotMatch(report.html,/<button|<select|created_at|updated_at|data-view-action|<training>/);assert.match(report.html,/Recorded status/);
});
test('empty scopes are explicit, and inaccessible queues cannot be used to print all company actions',async()=>{
 const h=runtime();await assert.rejects(h.api.capture({filtered:true,filters:{search:'Nothing matches'}}),/No saved actions match/);h.deny('all');const count=h.requests.length;
 await assert.rejects(h.api.capture({filtered:false}),/cannot view this report section/);assert.equal(h.requests.length,count);const mine=await h.api.capture({filtered:true,filters:{scope:'mine'}});assert.match(mine.sourceLabel,/2 saved actions/);
});
test('foreign rows and company, account, role or section changes reject the report',async()=>{
 const h=runtime();h.rows.push({id:'foreign',company_id:'other'});await assert.rejects(h.api.capture({filtered:false}),/did not match/);
 for(const change of [h=>h.select('other'),h=>h.c.prof.id='other',h=>h.c.prof.role='employee',h=>h.deny('all')]){
  const x=runtime();x.c.apiAllRows=async()=>{change(x);return structuredClone(x.rows);};await assert.rejects(x.api.capture({filtered:false}),/changed|cannot view/);
 }
});

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function dialogRuntime(){
 const h=runtime(),windows=[],previews=[];let focusCount=0,current;
 function target(extra){return Object.assign({events:{},addEventListener(name,handler){this.events[name]=handler;},focus(){}},extra);}
 const scope=target({value:'all'}),paper={value:'A3'},button={disabled:false},cancel=target(),error={textContent:''},description={textContent:''};
 const form=target({elements:{scope,paper},querySelector(selector){assert.equal(selector,'[type="submit"]');return button;}});
 const document=h.c.document;document.activeElement={isConnected:true,focus(){focusCount++;}};
 document.createElement=tag=>{
  assert.equal(tag,'dialog');
  current=target({isConnected:false,setAttribute(){},showModal(){this.open=true;},close(){this.open=false;},remove(){this.isConnected=false;if(h.controls[this.id]===this)delete h.controls[this.id];},querySelector(selector){return {form,'[data-cancel]':cancel,'[data-error]':error,'[data-filters]':description}[selector];}});
  return current;
 };
 document.body={appendChild(dialog){dialog.isConnected=true;h.controls[dialog.id]=dialog;}};
 const tools=h.c.AurisModuleReports;tools.ensureStyle=()=>{};tools.reserve=()=>{const w={closed:false,closeCount:0,close(){this.closed=true;this.closeCount++;}};windows.push(w);return w;};tools.preview=async report=>{previews.push(report);return report.preparedWindow;};
 Object.assign(h,{windows,previews,button,error,scope,open(){h.api.open();return current;},submit(){return form.events.submit({preventDefault(){}});},cancel(){return cancel.events.click({type:'click'});},escape(){return current.events.cancel({preventDefault(){}});}});Object.defineProperty(h,'focusCount',{get:()=>focusCount});return h;
}

test('cancel and Escape close pending reservations and never preview an abandoned action report',async()=>{
 for(const dismiss of ['cancel','escape']){
  const h=dialogRuntime(),load=deferred();h.c.apiAllRows=()=>load.promise;const dialog=h.open(),submission=h.submit();
  assert.equal(h.button.disabled,true);assert.equal(h.windows.length,1);h[dismiss]();
  assert.equal(dialog.isConnected,false,dismiss);assert.equal(h.windows[0].closed,true,dismiss);
  load.resolve(structuredClone(h.rows));await submission;
  assert.equal(h.previews.length,0,dismiss);assert.equal(h.windows[0].closeCount,1,dismiss);assert.equal(h.button.disabled,false);
 }
});

test('a detached action report dialog cannot launch a preview after its saved-data request completes',async()=>{
 const h=dialogRuntime(),load=deferred();h.c.apiAllRows=()=>load.promise;const dialog=h.open(),submission=h.submit();dialog.remove();
 load.resolve(structuredClone(h.rows));await submission;
 assert.equal(h.previews.length,0);assert.equal(h.windows[0].closed,true);
});

test('successful action preview closes the options dialog and keeps the completed preview open',async()=>{
 const h=dialogRuntime(),dialog=h.open();await h.submit();
 assert.equal(h.previews.length,1);assert.match(h.previews[0].html,/MAP-001/);assert.equal(h.previews[0].preparedWindow,h.windows[0]);
 assert.equal(dialog.isConnected,false);assert.equal(h.windows[0].closed,false);assert.equal(h.button.disabled,false);assert.equal(h.focusCount,1);
 await h.submit();assert.equal(h.windows.length,1,'A detached, completed dialog cannot submit again');
});

test('cancel during asynchronous preview preparation closes its reservation without reopening it',async()=>{
 const h=dialogRuntime(),render=deferred(),started=deferred();h.c.AurisModuleReports.preview=report=>{h.previews.push(report);started.resolve();return render.promise;};
 const dialog=h.open(),submission=h.submit();await started.promise;assert.equal(h.previews.length,1);h.cancel();
 assert.equal(dialog.isConnected,false);assert.equal(h.windows[0].closed,true);render.resolve(h.windows[0]);await submission;
 assert.equal(h.windows.length,1);assert.equal(h.windows[0].closeCount,1);assert.equal(h.button.disabled,false);
});

test('failed saved-data loading retains options for a retry and reserves a new preview window',async()=>{
 const h=dialogRuntime(),dialog=h.open();h.c.apiAllRows=async()=>{throw Error('Saved actions could not be loaded');};await h.submit();
 assert.equal(dialog.isConnected,true);assert.equal(h.button.disabled,false);assert.match(h.error.textContent,/Saved actions could not be loaded/);assert.equal(h.windows[0].closed,true);
 h.c.apiAllRows=async()=>structuredClone(h.rows);await h.submit();
 assert.equal(h.previews.length,1);assert.equal(h.windows.length,2);assert.equal(h.windows[1].closed,false);assert.equal(dialog.isConnected,false);
});
