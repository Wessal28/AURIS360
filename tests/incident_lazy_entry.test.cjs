const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function fixture(failedAsset){
 const scripts=[],reads=[],events=[],pageCalls=[],services={};let legacyCalls=0;
 for(const name of ['auth','api','rbac','audit'])services[name]={isReady:()=>true};
 const doc={readyState:'complete',createElement:tag=>({tagName:tag.toUpperCase(),dataset:{}}),getElementById:id=>{if(id==='page-events')pageCalls.push(new Error().stack);return null;},querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},dispatchEvent:event=>{events.push(event.type);return true;},head:{appendChild(script){const asset=script.src.split('?')[0];scripts.push(asset);Promise.resolve().then(()=>{if(asset===failedAsset){script.onerror();return;}try{vm.runInContext(fs.readFileSync(asset,'utf8'),c,{filename:asset});script.onload();}catch(error){script.onerror(error);}});}}};
 const oldLoader=()=>{legacyCalls++;throw Error('The legacy loader must not run before Incident Management is prepared.');};
 const c=vm.createContext({console,document:doc,CustomEvent:class{constructor(type,options){this.type=type;Object.assign(this,options);}},AurisPlatformServices:services,loadEvents:oldLoader,L:{events:oldLoader},api:async(path,options)=>{reads.push({path,options});throw Error('No live API is available in the lazy-entry fixture.');},setTimeout,clearTimeout});c.window=c;c.globalThis=c;
 for(const name of ['auris-module-registry.js','auris-module-extraction.js','auris-module-runtime.js'])vm.runInContext(fs.readFileSync(name,'utf8'),c,{filename:name});
 return {c,scripts,reads,events,oldLoader,legacyCalls:()=>legacyCalls,loaderCalls:()=>pageCalls.filter(stack=>stack.includes('at window.loadIncidentManagementV2')).length,hookCalls:()=>pageCalls.filter(stack=>stack.includes('at hook ')).length};
}
test('first Incident Management entry prepares the actual upgrade before runtime resolves and calls its loader',async()=>{
 const h=fixture();assert.equal(h.c.loadIncidentManagementV2,undefined);assert.equal(h.c.loadEvents,h.oldLoader);
 const result=await h.c.AurisModuleRuntime.activate('events',{loader:h.oldLoader,activateView(){}});
 assert.equal(result.ok,true);
 assert.deepEqual(h.scripts.slice(0,3),['incident-record-reports.js','incident-safety-communication.js','incident-management-upgrade.js']);
 assert.equal(new Set(h.scripts).size,h.scripts.length,'each lazy asset is prepared once');
 assert.equal(typeof h.c.AurisIncidentReports.load,'function');assert.equal(typeof h.c.AurisIncidentCommunication.generate,'function');
 assert.equal(h.c.loadEvents,h.c.loadIncidentManagementV2);assert.equal(h.c.L.events,h.c.loadIncidentManagementV2);
 assert.equal(h.legacyCalls(),0);assert.equal(h.hookCalls(),1,'actual upgrade hook ran during preparation');assert.equal(h.loaderCalls(),1,'runtime invoked the actual upgraded loader after preparation');
 assert.equal(h.reads.length,0,'preparing the module does not write or contact a live API');
 assert.ok(h.events.includes('auris:module-enter'));
});
test('reopening Incident Management reuses its loaded assets while still calling the upgraded loader',async()=>{
 const h=fixture();await h.c.AurisModuleRuntime.activate('events');const count=h.loaderCalls(),assets=h.scripts.slice();
 await h.c.AurisModuleRuntime.activate('events');assert.deepEqual(h.scripts,assets);assert.equal(h.loaderCalls(),count+1);assert.equal(h.hookCalls(),1);assert.equal(h.legacyCalls(),0);
});

test('the legacy investigation route also prepares the shared incident upgrade before its own loader',async()=>{
 const h=fixture();let calls=0;
 h.c.loadInvs=()=>{calls++;assert.equal(typeof h.c.imv2OpenInvestigationReadOnly,'function');assert.equal(typeof h.c.AurisIncidentReports.load,'function');};
 const result=await h.c.AurisModuleRuntime.activate('investigation');
 assert.equal(result.ok,true);assert.equal(calls,1);assert.equal(h.hookCalls(),1);assert.equal(h.legacyCalls(),0);
 assert.deepEqual(h.scripts.slice(0,3),['incident-record-reports.js','incident-safety-communication.js','incident-management-upgrade.js']);
});
test('a failed first upgrade load is isolated instead of running a stale legacy incident loader',async()=>{
 const h=fixture('incident-management-upgrade.js'),result=await h.c.AurisModuleRuntime.activate('events',{loader:h.oldLoader});
 assert.equal(result.ok,false);assert.equal(result.recoverable,true);assert.equal(h.legacyCalls(),0);assert.equal(h.c.loadIncidentManagementV2,undefined);assert.equal(h.reads.length,0);
});

test('leaving during first Incident Management preparation cancels the stale loader before it reads any incidents',async()=>{
 const h=fixture(),pending=h.c.AurisModuleRuntime.activate('events',{loader:h.oldLoader});let peopleCalls=0;
 h.c.loadPeople=()=>peopleCalls++;
 const people=await h.c.AurisModuleRuntime.activate('people'),incident=await pending;
 assert.equal(people.ok,true);assert.equal(peopleCalls,1);assert.equal(incident.ok,false);assert.equal(incident.cancelled,true);
 assert.equal(h.c.AurisModuleRuntime.current(),'people');assert.equal(h.loaderCalls(),0);assert.equal(h.legacyCalls(),0);assert.equal(h.reads.length,0);
});

function linkedIncidentFixture(cached=true){
 const opened=[],messages=[],reads=[],state={company:'company-a',user:'user-a',role:'manager',active:false,allowed:true};let resolveRoute;
 const row={id:'incident-a',company_id:'company-a',event_ref:'INC-QA-001'},route=new Promise(resolve=>resolveRoute=resolve);
 const c=vm.createContext({console,document:{querySelector:()=>null,getElementById:id=>id==='page-events'?{classList:{contains:key=>key==='active'&&state.active}}:null},
  prof:{id:state.user},ccid:()=>state.company,activeRole:()=>state.role,canAccessPage:()=>state.allowed,wsCurrentId:'work-a',imsAllData:cached?[row]:[],
  showPage:()=>route,wsRestEqValue:encodeURIComponent,toast:(text,ok)=>messages.push({text,ok}),actionErrorMessage:(_action,_module,error)=>error.message,
  api:async(path,options)=>{reads.push({path,options});return [row];}});c.window=c;
 const core=fs.readFileSync('auris-core.js','utf8'),start=core.indexOf('async function wsOpenLinkedRecord('),end=core.indexOf('// wsRenderLinkedRecords',start);
 assert.ok(start>=0&&end>start);vm.runInContext(core.slice(start,end),c,{filename:'auris-core.js'});
 return {c,state,row,opened,messages,reads,finishRoute(result={ok:true}){state.active=true;c.imv2OpenIncidentReadOnly=async id=>opened.push(id);resolveRoute(result);}};
}

test('a work-order incident link waits for first module preparation before opening its cached exact record',async()=>{
 const h=linkedIncidentFixture(),pending=h.c.wsOpenLinkedRecord('event','INC-QA-001');
 assert.equal(h.opened.length,0);assert.equal(h.messages.length,0);assert.equal(h.reads.length,0);
 h.finishRoute();await pending;assert.deepEqual(h.opened,['incident-a']);assert.equal(h.messages.length,0);assert.equal(h.reads.length,0);
});

test('a rejected route or changed source context cannot open the work-order incident after lazy preparation',async()=>{
 for(const change of ['cancelled','company','user','role','work','module','permission']){
  const h=linkedIncidentFixture(),pending=h.c.wsOpenLinkedRecord('event','incident-a');
  h.finishRoute(change==='cancelled'?{ok:false,cancelled:true}:{ok:true});
  if(change==='company')h.state.company='company-b';if(change==='user')h.c.prof.id='user-b';if(change==='role')h.state.role='employee';
  if(change==='work')h.c.wsCurrentId='work-b';if(change==='module')h.state.active=false;if(change==='permission')h.state.allowed=false;
  await pending;assert.equal(h.opened.length,0,change);assert.equal(h.reads.length,0,change);assert.equal(h.messages.length,1,change);
 }
});

test('a work-order incident lookup remains company-scoped and blocks a context change while the source is fetched',async()=>{
 const h=linkedIncidentFixture(false);let resolveRead;
 h.c.api=async(path,options)=>{h.reads.push({path,options});return new Promise(resolve=>resolveRead=resolve);};
 h.c.imsAllData=[{id:h.row.id,company_id:'company-b',event_ref:h.row.event_ref}];
 const pending=h.c.wsOpenLinkedRecord('event','incident-a');h.finishRoute();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.reads.length,1);assert.match(h.reads[0].path,/company_id=eq\.company-a/);assert.equal(h.reads[0].options,undefined,'linked incident lookup is read only');
 h.state.company='company-b';resolveRead([h.row]);await pending;assert.equal(h.opened.length,0);assert.equal(h.messages.length,1);
});
test('deployment shell defers Incident Management to its declared extraction assets',()=>{
 const index=fs.readFileSync('index.html','utf8');assert.doesNotMatch(index,/<script\b[^>]*src="incident-management-upgrade\.js/);
 const h=fixture(),manifest=h.c.AurisModuleRegistry.get('events');assert.ok(manifest.extraction.assets.includes('incident-management-upgrade.js'));
});
