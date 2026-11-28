const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('auris-core.js','utf8');
function runtime(){
  const nodes=new Map(),listeners={},calls=[],timers=[],main={scrollTop:0,scrollLeft:0};
  let company='company-a',role='manager',allowed=true,holdHistory=false,onFrame=null;
  class Node{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attrs={};this.events={};this._text='';this.hidden=false;this.disabled=false;}
    get id(){return this.attrs.id||'';}set id(v){this.attrs.id=v;nodes.set(v,this);}
    get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}set textContent(v){this._text=String(v);this.children=[];}
    appendChild(n){this.children.push(n);n.parentElement=this;return n;}
    insertBefore(n,ref){this.children.splice(this.children.indexOf(ref),0,n);n.parentElement=this;}
    replaceChildren(...n){this._text='';this.children=[];n.forEach(x=>this.appendChild(x));}
    addEventListener(k,fn){this.events[k]=fn;}setAttribute(k,v){this.attrs[k]=v;}
    getAttribute(k){return this.attrs[k]??null;}hasAttribute(k){return k in this.attrs;}
    closest(){return null;}
  }
  const pages={};
  function page(key,label){
    const p=new Node();p.id='page-'+key;p.isConnected=true;p.active=false;p.style={getPropertyValue:()=>'',removeProperty(){}};
    p.classList={contains:k=>k==='active'&&p.active,add:k=>{if(k==='active')p.active=true;},remove:k=>{if(k==='active')p.active=false;}};
    p.picker={value:'plan',options:[],get selectedOptions(){return this.options.filter(o=>o.value===this.value);},dispatchEvent(){p.section=this.selectedOptions[0]?.textContent||'';p.tab.textContent=p.section;}};
    p.setSection=(text,value)=>{p.section=text;p.picker.value=value||text;p.picker.options=[{value:p.picker.value,textContent:text}];p.tab.textContent=text;};
    p.tab={id:key+'-active-tab',textContent:label,hidden:false,disabled:false,click(){p.setSection(label,'plan');}};nodes.set(p.tab.id,p.tab);
    p.filter=new Node('input');p.filter.id=key+'-search';p.filter.type='search';p.filter.value='';p.filter.writes=0;p.filter.dispatchEvent=()=>p.filter.writes++;
    p.querySelector=s=>s.includes('auris-section-picker')?p.picker:s.includes('button.active')?p.tab:null;
    p.querySelectorAll=s=>s==='input,select'?[p.filter]:[];
    p.contains=n=>[p.tab,p.picker,p.filter].includes(n);p.setSection(label,'plan');pages[key]=p;return p;
  }
  page('dashboard','');page('training','Training Plan');page('people','People Register');page('actions','All Actions');pages.dashboard.active=true;
  const crumb=new Node('span');crumb.id='crumb';new Node().appendChild(crumb);
  const document={createElement:t=>new Node(t),createTextNode:t=>{const n=new Node('text');n.textContent=t;return n;},getElementById:id=>nodes.get(id)||null,
    querySelector:s=>s==='#app .page.active'?Object.values(pages).find(p=>p.active):s==='.main'?main:null,
    querySelectorAll:s=>s==='.page'?Object.values(pages):[],addEventListener:(k,fn)=>listeners[k]=fn,dispatchEvent(){}};
  const historyRows=[{}];let historyIndex=0;
  const history={get state(){return historyRows[historyIndex];},replaceState(state){historyRows[historyIndex]=state;},pushState(state){historyRows.splice(++historyIndex);historyRows.push(state);},go(delta){if(holdHistory)return;historyIndex+=delta;assert.ok(historyIndex>=0&&historyIndex<historyRows.length);setImmediate(()=>c.AurisNavigationTrail.handlePopState({state:history.state,preventDefault(){}}));}};
  const c={console,document,history,Date,setTimeout:(fn,ms)=>{if(ms===1200)timers.push(fn);else setImmediate(fn);},requestAnimationFrame:fn=>setImmediate(()=>{onFrame?.();fn();}),Event:class{constructor(type,options){this.type=type;Object.assign(this,options);}},CustomEvent:class{constructor(type,options){this.type=type;Object.assign(this,options);}},prof:{id:'user-a'},ccid:()=>company,activeRole:()=>role,canAccessPage:()=>allowed,co:{},innerWidth:1400,scrollX:0,scrollY:0,scrollTo:(x,y)=>calls.push(['scroll',x,y]),
    closeTransientOverlays(){},peopleCloseProfile(){},usersCloseModal(){},peopleFormVisible(){},activatePageNavigation(){},toast:message=>calls.push(['error',message]),mapEditorBusy:false,mapEditorDirty:()=>false,
    loadDash:()=>calls.push('load:dashboard'),loadTraining:()=>{calls.push('load:training');pages.training.setSection('Training Plan','plan');},loadPeople:()=>calls.push('load:people'),loadActions:()=>calls.push('load:actions')};
  c.window=c;c.globalThis=c;vm.createContext(c);
  for(const f of ['auris-module-registry.js','auris-module-runtime.js','auris-navigation-trail.js'])vm.runInContext(fs.readFileSync(f,'utf8'),c);
  c.moduleLoaderFor=key=>c[c.AurisModuleRegistry.get(key)?.loader];
  vm.runInContext(core.slice(core.indexOf('function showPage('),core.indexOf('\nfunction toggleForm(',core.indexOf('function showPage('))),c);
  c.AurisModuleHeader={preparePage(){},refresh(){render();}};
  function render(){const p=document.querySelector('#app .page.active');c.AurisNavigationTrail.render(crumb,{key:p.id.slice(5),name:c.AurisModuleRegistry.get(p.id.slice(5)).name,section:p.section});}
  function gesture(direct=false){listeners.click({target:{closest:selector=>direct&&selector.includes('.sidebar')?{}:null}});}
  function visit(key,direct=false){gesture(direct);const result=c.showPage(key);render();return result;}
  return {c,pages,main,crumb,calls,timers,history,render,gesture,visit,active:()=>document.querySelector('#app .page.active').id.slice(5),company:v=>company=v,role:v=>role=v,allowed:v=>allowed=v,holdHistory:v=>holdHistory=v,onFrame:fn=>onFrame=fn};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('real router records cross-module origin and Back retains training section, filters and scroll without rerunning its loader',async()=>{
  const h=runtime();h.visit('training',true);h.pages.training.filter.value='Golden Rules';h.main.scrollTop=480;h.main.scrollLeft=90;h.visit('people');
  assert.match(h.crumb.textContent,/Training & Competency \/ Training Plan \/ People/);assert.equal(h.c.AurisNavigationTrail.diagnostics().depth,1);
  h.main.scrollTop=0;assert.equal(await h.c.AurisNavigationTrail.back(),true);assert.equal(h.active(),'training');assert.equal(h.pages.training.filter.value,'Golden Rules');assert.equal(h.main.scrollTop,480);assert.equal(h.main.scrollLeft,90);assert.equal(h.calls.filter(x=>x==='load:training').length,1);
});
test('same-module record links retain the original section and return through the source tab',async()=>{
  const h=runtime();h.visit('training',true);h.gesture();h.pages.training.setSection('Training Records','records');h.render();
  assert.equal(h.c.AurisNavigationTrail.diagnostics().depth,1);assert.match(h.crumb.textContent,/Training Plan \/ Training Records/);assert.equal(await h.c.AurisNavigationTrail.back(),true);assert.equal(h.pages.training.section,'Training Plan');
});
test('nested links and native browser history return to each exact originating module',async()=>{
  const h=runtime();h.visit('training',true);h.visit('people');h.visit('actions');assert.equal(h.c.AurisNavigationTrail.diagnostics().depth,2);
  assert.equal(await h.c.AurisNavigationTrail.back(),true);assert.equal(h.active(),'people');assert.equal(h.c.AurisNavigationTrail.diagnostics().depth,1);
  h.history.go(-1);for(let i=0;i<6;i++)await settle();assert.equal(h.active(),'training');assert.equal(h.c.AurisNavigationTrail.diagnostics().depth,0);
});
test('cancelled dirty-action navigation retains both the current page and matching history position',async()=>{
  const h=runtime();h.visit('training',true);h.visit('actions');const previous=h.history.state.aurisNavigation.id;
  h.c.mapEditorDirty=()=>true;h.c.mapEditorLeave=async()=>false;
  assert.equal(await h.c.AurisNavigationTrail.back(),false);for(let i=0;i<4;i++)await settle();assert.equal(h.active(),'actions');assert.equal(h.history.state.aurisNavigation.id,previous);assert.equal(h.c.AurisNavigationTrail.diagnostics().depth,1);
});
test('direct navigation cancels a pending Back and its timer cannot reopen the old source',async()=>{
  const h=runtime();h.visit('training',true);h.visit('people');h.holdHistory(true);const pending=h.c.AurisNavigationTrail.back();assert.equal(await h.c.AurisNavigationTrail.back(),false);
  h.visit('dashboard',true);assert.equal(await pending,false);for(const timer of h.timers)timer();for(let i=0;i<3;i++)await settle();assert.equal(h.active(),'dashboard');assert.equal(h.c.AurisNavigationTrail.diagnostics().depth,0);
});
test('company or role changes discard navigation snapshots and cannot restore another tenant screen',async()=>{
  for(const change of ['company','role']){const h=runtime();h.visit('training',true);h.visit('people');h[change]('changed');assert.equal(await h.c.AurisNavigationTrail.back(),false);assert.equal(h.active(),'people');assert.equal(h.c.AurisNavigationTrail.diagnostics().depth,0);}
});
test('a scope change during a restoration frame prevents restoring any old controls',async()=>{
  const h=runtime();h.visit('training',true);h.pages.training.filter.value='Old company filter';h.visit('people');h.pages.training.filter.value='';h.onFrame(()=>h.company('company-b'));
  assert.equal(await h.c.AurisNavigationTrail.back(),false);assert.equal(h.pages.training.filter.value,'');assert.equal(h.pages.training.filter.writes,0);
});

test('a return cancelled by context change or direct navigation never compensates stale browser history',async()=>{
  for(const cancel of ['context','direct']){
    const h=runtime();h.visit('training',true);h.visit('people');let moves=0;const go=h.history.go;h.history.go=delta=>{moves++;go(delta);};
    h.onFrame(()=>{h.onFrame(null);if(cancel==='context')h.company('company-b');else h.visit('dashboard',true);});
    assert.equal(await h.c.AurisNavigationTrail.back(),false);for(let i=0;i<3;i++)await settle();
    assert.equal(moves,1);assert.equal(h.c.AurisNavigationTrail.diagnostics().depth,0);if(cancel==='direct')assert.equal(h.active(),'dashboard');
  }
});
test('denied routes never capture an origin or change the active module',()=>{
  const h=runtime();h.visit('training',true);h.allowed(false);h.visit('people');assert.equal(h.active(),'training');assert.equal(h.c.AurisNavigationTrail.diagnostics().depth,0);
});
test('returning through runtime lifecycle keeps access hooks but does not reload or re-extract a retained view',async()=>{
  const h=runtime();h.visit('training',true);h.visit('people');let enters=0,preparations=0;h.c.AurisModuleRuntime.register('training',{beforeEnter(){enters++;}});h.c.AurisModuleExtraction={prepare(){preparations++;return Promise.resolve();}};
  assert.equal(await h.c.AurisNavigationTrail.back(),true);assert.equal(enters,1);assert.equal(preparations,0);assert.equal(h.c.AurisModuleRuntime.current(),'training');
});
