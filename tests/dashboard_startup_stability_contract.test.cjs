const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','auris-core.js'),'utf8');
function between(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Missing dashboard test boundary: '+start);
  return source.slice(a,b);
}
const startupSource=[
  between('async function doLogin()','// -- doRegister'),
  between('async function authOnSignIn(authData)','// -- doLogout'),
  between('async function authInitSession()','async function authLoadCompanyDropdown'),
  between('var _dashLoadGeneration=','// DASHBOARD REDESIGN HELPERS'),
  between('function dashRenderControlCentre(data)','// -- Personal dashboard render')
].join('\n');
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function harness(){
  const nodes=new Map(),paint=[],timers=[],errors=[],calls=[],requests=[];
  function element(){
    const classes=new Set();let html='';
    return {dataset:{},style:{},options:[],value:'',textContent:'',disabled:false,
      classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},
      get innerHTML(){return html;},set innerHTML(value){html=value;},
      querySelector:()=>null,querySelectorAll:()=>[],appendChild(){}};
  }
  function node(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);}
  const panel=node('dash-control-centre');let panelHtml='';
  Object.defineProperty(panel,'innerHTML',{get:()=>panelHtml,set:value=>{panelHtml=value;paint.push(value);}});
  node('login-email').value='fictional@example.test';node('login-pw').value='fictional-password';
  let stored={access_token:'fictional-token',refresh_token:'fictional-refresh',user_id:'user-1',expires_at:Date.now()/1000+3600};
  const c={console:{warn(){},log(){},error(...args){errors.push(args);}},URLSearchParams,URL,Date,
    tok:'fictional-token',prof:{id:'user-1',role:'admin',company_id:'company-1',full_name:'Fictional User'},
    co:{id:'company-1',name:'Fictional Company'},sephsCompanyContext:null,saCompanyList:[],
    company:'company-1',_authLoginBusy:false,_authSessionGeneration:0,_authRefreshTimer:null,_authRefreshPromise:null,_authSession:null,
    AURIS_RUNTIME_CONFIG_READY:true,navigator:{},history:{replaceState(){}},
    location:{hash:'',search:'',pathname:'/'},
    document:{getElementById:node,querySelectorAll:()=>[],querySelector:()=>null},
    setTimeout(fn,delay){const timer={fn,delay,cleared:false};timers.push(timer);return timer;},
    clearTimeout(timer){if(timer)timer.cleared=true;},
    authGetStoredSession:()=>stored,authSaveSession:session=>{stored=session;},authScheduleRefresh(){},
    authClearSession(){stored=null;},authShowErr(){},authShowLoading(){},authHideLoading(){},authShowPanel(){},authLoadCompanyDropdown(){},
    authQ:async()=>{calls.push('authenticate');return {access_token:'fictional-token',refresh_token:'fictional-refresh',user:{id:'user-1',email:'fictional@example.test'}};},
    loadProf:async id=>{calls.push('profile');c.prof={...c.prof,id};},
    loadRolloutRuntimeConfig:async()=>{calls.push('configuration');},
    api:async()=>[],
    saCompanyInit:async()=>{calls.push('company');},
    workflowHydrateTenant:async()=>{},
    loadPeopleCache:async()=>{calls.push('people');},loadLocationSitesCache:async()=>{calls.push('sites');},
    applyRoles(){},sidebarApplyState(){},sidebarGetState:()=>'',devModeUpdateUI(){},sbInitRoleSelect(){},auditLogEvent(){},
    deepLinkScheduleResume(){},genDashAI(){},
    ccid:()=>c.company,cf:()=>c.company?'&company_id=eq.'+c.company:'',activeRole:()=>c.prof?.role,
    isSA:()=>false,isPersonalDashRole:()=>false,dashRouteView(){},
    dashEnsureControlCentreMount:()=>panel,
    aurisSetDisplay(target,display){if(typeof target==='string')target=node(target);if(target)target.style.display=display;},
    apiAllRows:async query=>{requests.push(query);calls.push('dashboard');return [];},
    hseIsRecordableEvent:()=>false,hseVerifiedHours:()=>null,
    escH:value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),
    aurisSafeMediaUrl:()=>'',canAccessPage:()=>true,dashKpiAsset:()=>'',
    dashIsDoneStatus:value=>value==='closed',dashIsOverdue:()=>false,dashSoon:()=>false,dashRiskWeight:()=>0,dashFmtDate:value=>value||'–'
  };
  for(const name of ['dashRenderTrendChart','dashRenderSeverityChart','dashRenderComplianceRings','dashRenderDemoReadiness','dashRenderGreeting','dashRenderHero','dashApplyTones','dashRenderSparklines','dashRenderDeptHeatmap','dashRenderHighRisk','dashRenderRecentEvents','dashRenderPriorityActions','dashRenderTrainingCompliance'])c[name]=()=>{};
  c.window=c;vm.createContext(c);vm.runInContext(startupSource,c);
  return {c,nodes,node,panel,paint,timers,errors,calls,requests,setStored:value=>{stored=value;}};
}
async function assertStartup(path){
  const h=harness();
  if(path==='signin')await h.c.authOnSignIn({access_token:'fictional-token',refresh_token:'fictional-refresh',user:{id:'user-1',email:'fictional@example.test'}});
  else await h.c.authInitSession();
  assert.deepEqual(h.errors,[]);
  assert.equal(h.paint.length,2,'one loading paint and one populated paint');
  assert.match(h.paint[0],/Loading company performance/);
  assert.match(h.paint[1],/Home Command Centre/);
  assert.notEqual(h.panel.dataset.dashboardLoading,'true');
  const firstRead=h.calls.indexOf('dashboard');
  for(const stage of ['company','people','sites'])assert.ok(h.calls.indexOf(stage)>=0&&h.calls.indexOf(stage)<firstRead,stage+' must finish before dashboard reads');
  assert.equal(h.node('page-dashboard').dataset.dashboardReady,'true');
}

test('fresh sign-in paints one stable loading state and then real company data',()=>assertStartup('signin'));
test('stored-session restoration uses the same ordered, stable dashboard startup',()=>assertStartup('restore'));

test('the dashboard loading renderer is idempotent and resets after data arrives',()=>{
  const h=harness();
  h.c.dashRenderControlCentre({loading:true});h.c.dashRenderControlCentre({loading:true});
  assert.equal(h.paint.length,1);
  h.c.dashRenderControlCentre({events:[],actions:[]});
  assert.equal(h.paint.length,2);assert.notEqual(h.panel.dataset.dashboardLoading,'true');
  h.c.dashRenderControlCentre({loading:true});
  assert.equal(h.paint.length,3,'a new company can show a new loading state');
});

test('a persistently missing source stays unavailable without scheduled full-dashboard reloads',async()=>{
  const h=harness();
  h.c.apiAllRows=async query=>{h.requests.push(query);if(query.startsWith('/legal_requirements?'))throw new Error('column legal_requirements.archived_at does not exist');return [];};
  await h.c.loadDash({initial:true,attempt:0});
  assert.deepEqual(h.errors,[]);assert.equal(h.requests.filter(x=>x.startsWith('/legal_requirements?')).length,1);
  assert.match(h.panel.innerHTML,/Some figures are unavailable/);assert.match(h.panel.innerHTML,/legal/);assert.match(h.panel.innerHTML,/Refresh to retry/);
  assert.match(h.node('d-compliance').textContent,/Unavailable|Unable to load/);
  assert.equal(h.timers.filter(x=>!x.cleared).length,0,'failed sources must not reset the entire screen twice');
});

test('manual refresh retains populated same-company data until new results are ready',async()=>{
  const h=harness();await h.c.loadDash();const old=h.panel.innerHTML,paintCount=h.paint.length;
  const pending=deferred();h.c.apiAllRows=()=>pending.promise;
  const refresh=h.c.loadDash();
  assert.equal(h.panel.innerHTML,old);assert.equal(h.paint.length,paintCount);
  pending.resolve([]);await refresh;
  assert.deepEqual(h.errors,[]);assert.equal(h.paint.length,paintCount+1);
});

test('changing company clears the previous company dashboard while the replacement is loading',async()=>{
  const h=harness();await h.c.loadDash();
  const pending=deferred();h.c.apiAllRows=()=>pending.promise;h.c.company='company-2';
  const loading=h.c.loadDash();
  assert.match(h.panel.innerHTML,/Loading company performance/);assert.doesNotMatch(h.panel.innerHTML,/Home Command Centre/);
  pending.resolve([]);await loading;assert.deepEqual(h.errors,[]);
});

for(const changed of ['company','user','role','session'])test('late dashboard responses cannot paint after a '+changed+' change',async()=>{
  const h=harness(),pending=deferred();h.c.apiAllRows=()=>pending.promise;
  const loading=h.c.loadDash();const paintCount=h.paint.length;
  if(changed==='company')h.c.company='company-2';
  if(changed==='user')h.c.prof={...h.c.prof,id:'user-2'};
  if(changed==='role')h.c.prof={...h.c.prof,role:'executive'};
  if(changed==='session')h.c._authSessionGeneration++;
  pending.resolve([]);await loading;
  assert.deepEqual(h.errors,[]);assert.equal(h.paint.length,paintCount);
  assert.equal(h.node('page-dashboard').dataset.dashboardReady,undefined);
});

test('a slower refresh cannot overwrite a newer completed refresh',async()=>{
  const h=harness(),oldRead=deferred();h.c.apiAllRows=()=>oldRead.promise;
  const oldLoad=h.c.loadDash();h.c.apiAllRows=async()=>[];
  await h.c.loadDash();const latest=h.panel.innerHTML,paintCount=h.paint.length;
  oldRead.resolve([]);await oldLoad;
  assert.deepEqual(h.errors,[]);assert.equal(h.panel.innerHTML,latest);assert.equal(h.paint.length,paintCount);
});

test('a company change during personal follow-up prevents stale dashboard completion',async()=>{
  const h=harness(),pending=deferred();let started=false,postRender=0;
  h.c.isPersonalDashRole=()=>true;
  h.c.dashRenderPersonal=()=>{started=true;return pending.promise;};
  h.c.dashLoadMyElearning=async()=>{};
  h.c.dashRenderDeptHeatmap=()=>postRender++;
  const loading=h.c.loadDash();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(started,true);
  h.c.company='company-2';pending.resolve();await loading;
  assert.deepEqual(h.errors,[]);assert.equal(postRender,0);
  assert.equal(h.node('page-dashboard').dataset.dashboardReady,undefined);
  assert.equal(h.c._dashRenderedScope,'');
});

test('repeated Enter while signing in issues one authentication request and one startup',async()=>{
  const h=harness(),pending=deferred();let requests=0,startups=0;
  h.c.authQ=()=>{requests++;return pending.promise;};h.c.authOnSignIn=async()=>{startups++;};
  const first=h.c.doLogin(),second=h.c.doLogin(),third=h.c.doLogin();
  assert.equal(requests,1);assert.equal(h.node('login-btn').disabled,true);
  pending.resolve({access_token:'fictional-token',user:{id:'user-1'}});
  await Promise.all([first,second,third]);
  assert.equal(startups,1);assert.equal(h.node('login-btn').disabled,false);assert.equal(h.c._authLoginBusy,false);
});

test('a rejected login releases the busy state so a deliberate retry can succeed',async()=>{
  const h=harness();let requests=0,startups=0;
  h.c.authQ=async()=>{requests++;if(requests===1)throw new Error('Invalid login');return {user:{id:'user-1'}};};
  h.c.authOnSignIn=async()=>{startups++;};
  await h.c.doLogin();assert.equal(h.c._authLoginBusy,false);assert.equal(h.node('login-btn').disabled,false);
  await h.c.doLogin();assert.equal(requests,2);assert.equal(startups,1);
});
