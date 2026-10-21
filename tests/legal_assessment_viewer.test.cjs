const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('legal-assessment-viewer.js','utf8');
class Node{
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.doc=doc;this.children=[];this.dataset={};this.attributes={};this.handlers={};this.className='';this._text='';this._html='';this.classList={add:value=>{this.className+=' '+value;},toggle:(value,on)=>{this.className=this.className.split(' ').filter(item=>item!==value).concat(on?[value]:[]).join(' ');}};}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}set textContent(value){this._text=String(value);this.children=[];}
  get innerHTML(){return this._html;}set innerHTML(value){this._html=String(value);this.children=[];}
  get isConnected(){return this===this.doc.body||!!this.parentNode?.isConnected;}
  appendChild(child){child.parentNode=this;this.children.push(child);return child;}
  prepend(child){child.parentNode=this;this.children.unshift(child);}
  replaceChildren(...children){this.children.forEach(child=>child.parentNode=null);this.children=[];this._text='';this._html='';children.forEach(child=>this.appendChild(child));}
  insertBefore(child,prior){child.parentNode=this;this.children.splice(this.children.indexOf(prior),0,child);}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}}
  setAttribute(key,value){this.attributes[key]=value;if(key==='id')this.id=value;}
  addEventListener(name,fn){this.handlers[name]=fn;}
  focus(){this.doc.activeElement=this;}
  all(){return this.children.flatMap(child=>[child,...child.all()]);}
  matches(selector){if(selector==='button[data-id]')return this.tagName==='BUTTON'&&!!this.dataset.id;if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));if(selector.startsWith('button'))return this.tagName==='BUTTON'&&!this.disabled;if(selector==='a[href]')return this.tagName==='A'&&!!this.href;return this.tagName===selector.toUpperCase();}
  querySelectorAll(selector){if(selector==='tbody tr')return this.all().filter(node=>node.tagName==='TR'&&node.parentNode.tagName==='TBODY');return this.all().filter(node=>selector.split(',').some(part=>node.matches(part.trim())));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
function runtime(record={},options={}){
  let company='company-a',role='admin',access=true,section=true,editable=true;const requests=[],previews=[],windows=[],edits=[],messages=[],doc={handlers:{},createElement:tag=>new Node(tag,doc),addEventListener:(type,handler)=>doc.handlers[type]=handler,removeEventListener:type=>delete doc.handlers[type],getElementById:id=>[...doc.head.all(),...doc.body.all()].find(node=>node.id===id)||null};doc.body=new Node('body',doc);doc.head=new Node('head',doc);doc.activeElement=doc.body;
  const saved={id:'assessment-a',company_id:'company-a',assessment_ref:'CA-2026-014',title:'Quarterly compliance review',status:'draft',assessment_date:'2026-10-20',assessment_type:'periodic',assessor:'Asha Shah',scope:'Operations and maintenance',total_requirements:76,compliant_count:35,partial_count:3,non_compliant_count:0,na_count:38,overall_score:96,compliance_score:0,methodology:'Evidence and interview review',findings:'Three partial findings',recommendations:'Complete recorded actions',revision:2,...record};
  const profile={id:'user-a',role:'admin'},scope={document:doc,setTimeout,clearTimeout,prof:profile,ccid:()=>company,activeRole:()=>role,canAccessPage:()=>access,AurisUserAccess:{sectionAllowed:()=>section,allowed:()=>editable},api:async(path,options)=>{requests.push({path,options});return [structuredClone(saved)];},lcaAllData:[{...saved,title:'STALE cached title'}],lcaEdit:async id=>edits.push(id),AurisModuleReports:{reserve:()=>{const window={closed:false,close(){this.closed=true;}};windows.push(window);return window;},preview:async options=>{previews.push(options);return true;}},toast:message=>messages.push(message)};scope.window=scope;vm.createContext(scope);
  if(options.lexicalProfile){scope.fixtureProfile=profile;delete scope.prof;vm.runInContext('let prof=fixtureProfile;',scope);delete scope.fixtureProfile;}
  if(options.coreLoader){const host=doc.createElement('div');host.id='lca-list';host.innerHTML='Loading...';doc.body.appendChild(host);const core=fs.readFileSync('auris-core.js','utf8'),start=core.indexOf('async function lcaLoad(){');Object.assign(scope,{cf:()=> '&company_id=eq.'+company,isMgr:()=>false,escH:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),ohIsArchivedText:v=>String(v||'').startsWith('[Archived'),setupFriendlyMessage:(label,message)=>label+': '+message,apiAllRows:async path=>{requests.push({path});return [structuredClone(saved)];}});vm.runInContext(core.slice(start,core.indexOf('function lcaCalcScore()',start)),scope);}
  vm.runInContext(source,scope);
  return {scope,profile,api:scope.AurisLegalAssessmentViewer,record:saved,doc,requests,previews,windows,edits,messages,setCompany:value=>company=value,setRole:value=>role=value,deny:()=>access=false,denySection:()=>section=false,denyEdit:()=>editable=false,modal:()=>doc.getElementById('legal-assessment-viewer'),buttons:()=>doc.getElementById('legal-assessment-viewer')?.querySelectorAll('button')||[],button:label=>doc.getElementById('legal-assessment-viewer')?.querySelectorAll('button').find(node=>node.textContent===label)};
}

test('the dedicated report preserves saved reported values, human labels and narratives without UUID metadata',()=>{
  const r=runtime({worksheet:[{requirement_id:'66666666-6666-4666-8666-666666666666',status:'partial',controls:'Recorded guard checks',recommendation:'Retain competent inspection evidence',responsible:'Maintenance lead',target_date:'2026-11-01',requirement_snapshot:{reference:'LEG-014',title:'Internal machinery policy',section:'4.2',requirement:'Keep the original saved wording.',source_reference:'Policy revision 2'}}],created_at:'2026-10-01T07:34:12Z',updated_at:'2026-10-20T06:00:00Z'}),before=JSON.stringify(r.record),built=r.api.build(r.record);
  assert.equal(built.title,'Quarterly compliance review');assert.equal(built.reference,'CA-2026-014');assert.match(built.html,/>96%</);assert.doesNotMatch(built.html,/>0%</);assert.match(built.html,/>0<\/td>/,'An explicit zero count remains visible');assert.match(built.html,/20\/10\/2026/);assert.match(built.html,/Saved reported totals/);assert.match(built.html,/Evidence and interview review/);assert.match(built.html,/Internal machinery policy/);assert.match(built.html,/original saved wording/);assert.match(built.html,/Recorded guard checks/);assert.match(built.html,/Maintenance lead/);assert.match(built.html,/01\/11\/2026/);assert.match(built.html,/Policy revision 2/);assert.doesNotMatch(built.html,/66666666|created_at|updated_at|2026-10-01T07:34:12Z|<strong>/);assert.equal(JSON.stringify(r.record),before);assert.equal(r.requests.length,0);
});

test('summary-only legacy assessments explicitly report unavailable detail instead of inventing current worksheet results',()=>{
  const r=runtime({worksheet:undefined,status:'approved',assessor:'66666666-6666-4666-8666-666666666666'});r.scope.lrAllData=[{id:'requirement-a',requirement:'TODAY PRIVATE REQUIREMENT',status:'compliant'}];
  const built=r.api.build(r.record);assert.match(built.html,/saved detailed worksheet is unavailable/);assert.match(built.html,/No present-day legal requirements/);assert.match(built.html,/authenticated approval timestamp was not retained/);assert.match(built.html,/Name not recorded/);assert.doesNotMatch(built.html,/TODAY PRIVATE REQUIREMENT|66666666/);assert.equal(built.worksheetRows,0);
  const row=r.api.build({...r.record,worksheet:[{requirement_id:'hidden-id',status:'not_assessed',controls:'Retained control'}]});assert.match(row.html,/Requirement wording was not retained/);assert.match(row.html,/Not assessed/);assert.doesNotMatch(row.html,/hidden-id|TODAY PRIVATE REQUIREMENT/);
});

test('saved values are escaped and missing scores/counts never become achieved zero or a derived score',()=>{
  const r=runtime({overall_score:null,total_requirements:null,na_count:'',scope:'<svg onload="alert(1)">',findings:'Line one\n<script>attack()</script>',worksheet:'[{"status":"partial","controls":"<img src=x onerror=attack()>","recommendation":"Use <approved> evidence"}]'}),built=r.api.build(r.record);
  assert.match(built.html,/&lt;svg/);assert.match(built.html,/Line one<br>&lt;script&gt;/);assert.match(built.html,/&lt;img/);assert.doesNotMatch(built.html,/<svg|<script>|<img|>0%<|>96%<|>null</);assert.match(built.html,/Reported score/);assert.match(built.html,/Not recorded/);
});

test('report reads a fresh exact assessment with company scope and rejects unexpected response identities',async()=>{
  const r=runtime(),report=await r.api.report('assessment-a');assert.equal(report.title,'Quarterly compliance review');assert.equal(report.context.company,'company-a');assert.equal(r.requests.length,1);assert.equal(r.requests[0].options,undefined);const query=new URL(r.requests[0].path,'https://fixture.invalid').searchParams;assert.equal(query.get('select'),'*');assert.equal(query.get('company_id'),'eq.company-a');assert.equal(query.get('id'),'eq.assessment-a');
  for(const bad of [[],[null],[{...r.record,id:'other'}],[{...r.record,company_id:'company-b'}],[r.record,r.record]]){r.scope.api=async()=>bad;await assert.rejects(()=>r.api.report('assessment-a'),/unavailable/);}
});

test('company, role, user or read-permission changes during fetch reject stale reports',async()=>{
  for(const change of [r=>r.setCompany('company-b'),r=>r.setRole('viewer'),r=>r.scope.prof.id='other',r=>r.deny(),r=>r.denySection()]){
    const r=runtime();r.scope.api=async()=>{change(r);return [r.record];};await assert.rejects(()=>r.api.report('assessment-a'),/changed|access/);
  }
  const denied=runtime();denied.denySection();await assert.rejects(async()=>denied.api.report('assessment-a'),/access/);assert.equal(denied.requests.length,0);
});

test('read-only view opens the fresh assessment and refreshes exact saved HTML before manual print preview',async()=>{
  const r=runtime();assert.equal(await r.api.open('assessment-a'),true);assert.equal(r.doc.getElementById('lav-title').textContent,'Quarterly compliance review');assert.ok(r.button('Edit assessment'));r.record.findings='Newly saved findings for printing';await r.button('Print assessment').handlers.click();assert.equal(r.requests.length,2);assert.equal(r.previews.length,1);assert.equal(r.previews[0].moduleKey,'legal');assert.equal(r.previews[0].section,'assessments');assert.equal(r.previews[0].sourceLabel,'Saved assessment CA-2026-014');assert.equal(r.previews[0].html,r.api.build(r.record).html);assert.match(r.previews[0].html,/Newly saved findings for printing/);assert.equal(r.previews[0].context.company,'company-a');assert.equal(r.previews[0].preparedWindow,r.windows[0]);assert.match(r.modal().textContent,/Print preview opened/);assert.equal(r.edits.length,0);
  await r.button('Edit assessment').handlers.click();assert.deepEqual(r.edits,['assessment-a']);assert.equal(r.modal(),null);
});

test('print refresh reserves its window before awaiting and closes it on failure, context change or viewer close',async()=>{
  for(const invalidate of [r=>r.setCompany('company-b'),r=>r.api.close()]){
    const r=runtime();await r.api.open('assessment-a');let resolve;const pending=new Promise(done=>resolve=done);r.scope.api=()=>pending;const printing=r.button('Print assessment').handlers.click();assert.equal(r.windows.length,1,'The preview is reserved synchronously in the click handler');invalidate(r);resolve([r.record]);await printing;assert.equal(r.previews.length,0);assert.equal(r.windows[0].closed,true);
  }
  const failed=runtime();await failed.api.open('assessment-a');failed.scope.api=async()=>{throw Error('Save service unavailable');};await failed.button('Print assessment').handlers.click();assert.equal(failed.windows[0].closed,true);assert.equal(failed.previews.length,0);assert.match(failed.modal().textContent,/Save service unavailable/);
});

test('approved or read-only access hides Edit, and changed context blocks both printing and editing',async()=>{
  for(const setup of [r=>r.record.status='approved',r=>r.denyEdit()]){const r=runtime();setup(r);await r.api.open('assessment-a');assert.equal(r.button('Edit assessment'),undefined);assert.ok(r.button('Print assessment'));}
  const r=runtime();await r.api.open('assessment-a');const edit=r.button('Edit assessment'),print=r.button('Print assessment');r.setCompany('company-b');await print.handlers.click();await edit.handlers.click();assert.equal(r.previews.length,0);assert.equal(r.edits.length,0);assert.match(r.modal().textContent,/changed/);
});

test('a failed opening is recoverable and a closed or superseded request never restores stale content',async()=>{
  const r=runtime(),api=r.scope.api;r.scope.api=async()=>{throw Error('Fictional connection interruption');};assert.equal(await r.api.open('assessment-a'),false);assert.ok(r.button('Retry'));assert.match(r.modal().textContent,/Fictional connection interruption/);r.scope.api=api;await r.button('Retry').handlers.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(r.doc.getElementById('lav-title').textContent,'Quarterly compliance review');
  let resolve;const pending=new Promise(done=>resolve=done);r.scope.api=()=>pending;const opening=r.api.open('assessment-a');r.api.close();resolve([r.record]);assert.equal(await opening,false);assert.equal(r.modal(),null);
  let first;const delayed=new Promise(done=>first=done);r.scope.api=async path=>path.includes('assessment-a')?delayed:[{...r.record,id:'assessment-b',title:'Second saved assessment'}];const earlier=r.api.open('assessment-a');await r.api.open('assessment-b');first([r.record]);assert.equal(await earlier,false);assert.equal(r.doc.getElementById('lav-title').textContent,'Second saved assessment');
});

test('the register receives a keyboard-accessible View assessment action without replacing Edit',async()=>{
  const r=runtime(),host=r.doc.createElement('div'),table=r.doc.createElement('table'),body=r.doc.createElement('tbody'),row=r.doc.createElement('tr'),cell=r.doc.createElement('td'),edit=r.doc.createElement('button');host.id='lca-list';edit.dataset.id='assessment-a';edit.textContent='Edit';cell.appendChild(edit);row.appendChild(cell);body.appendChild(row);table.appendChild(body);host.appendChild(table);r.doc.body.appendChild(host);r.api.enhance();r.api.enhance();const views=host.querySelectorAll('.lav-view-assessment');assert.equal(views.length,1);assert.equal(views[0].attributes['aria-label'],'View assessment CA-2026-014');assert.equal(cell.children[1],edit);views[0].handlers.click({stopPropagation(){}});await new Promise(resolve=>setImmediate(resolve));assert.equal(r.doc.getElementById('lav-title').textContent,'Quarterly compliance review');
});

test('the viewer owns its lazy stylesheet and follows the real access policy edit signature',async()=>{
  const r=runtime(),style=r.doc.getElementById('legal-assessment-viewer-style');assert.equal(style.tagName,'LINK');assert.equal(style.rel,'stylesheet');assert.equal(style.href,'/legal-assessment-viewer.css?v=20261020-1&legal-meetings-fix-1');assert.equal(r.doc.head.children.length,1);
  const policy=require('../auris-user-access.js');r.scope.AurisUserAccess=policy;r.scope.prof.permissions={access_v1:{legal:{view:true,edit:true},'legal.assessments':{view:true,edit:false}}};await r.api.open('assessment-a');assert.equal(r.button('Edit assessment'),undefined,'A module-level edit grant cannot override assessment-specific denial');
  r.scope.prof.permissions.access_v1['legal.assessments'].edit=true;await r.api.open('assessment-a');assert.ok(r.button('Edit assessment'));r.scope.prof.permissions.access_v1.legal.edit=false;await r.button('Edit assessment').handlers.click();assert.equal(r.edits.length,0);assert.match(r.modal().textContent,/access to edit.*changed/);assert.equal(r.doc.head.children.length,1);
});

test('the actual core assessment loader works with the application lexical profile and exact assessment printing',async()=>{
  const r=runtime({worksheet:[{status:'partial',controls:'Saved original controls',requirement_snapshot:{reference:'LEG-014',requirement:'Saved original requirement'}}]},{lexicalProfile:true,coreLoader:true});
  assert.equal(r.scope.prof,undefined,'A global let profile is not a window property');assert.equal(r.api.context().user,'user-a');await r.scope.lcaLoad();
  const host=r.doc.getElementById('lca-list');assert.match(host.innerHTML,/Quarterly compliance review/);assert.doesNotMatch(host.innerHTML,/Loading/);assert.equal(host.attributes['aria-busy'],'false');assert.match(r.requests[0].path,/^\/compliance_assessments\?select=\*&company_id=eq.company-a/);
  r.scope.AurisUserAccess.allowed=(profile,module,action)=>{assert.equal(profile,r.profile);assert.equal(action,'edit');return ['legal','legal.assessments'].includes(module);};await r.api.open('assessment-a');assert.ok(r.button('Edit assessment'));r.record.worksheet[0].controls='Freshly saved exact assessment controls';await r.button('Print assessment').handlers.click();
  assert.match(r.previews[0].html,/Freshly saved exact assessment controls/);assert.match(r.previews[0].html,/Saved original requirement/);assert.equal(r.previews[0].context.user,'user-a');assert.equal(r.previews[0].preparedWindow.closed,false);
});

function manualTimers(r){const timers=[];r.scope.setTimeout=(callback,delay)=>{const timer={callback,delay};timers.push(timer);return timer;};r.scope.clearTimeout=timer=>{if(timer)timer.cleared=true;};return timers;}
test('an unresponsive core assessment load becomes a recoverable error and late data cannot overwrite a retry',async()=>{
  const r=runtime({},{lexicalProfile:true,coreLoader:true}),timers=manualTimers(r),host=r.doc.getElementById('lca-list');let resolve;
  r.scope.apiAllRows=()=>new Promise(done=>resolve=done);const first=r.scope.lcaLoad();assert.equal(host.attributes['aria-busy'],'true');assert.equal(timers[0].delay,15000);timers[0].callback();await first;
  assert.equal(host.attributes['aria-busy'],'false');assert.match(host.textContent,/did not respond within 15 seconds/);const retry=host.querySelectorAll('button').find(x=>x.textContent==='Retry assessments');assert.ok(retry);
  r.scope.apiAllRows=async()=>[{...r.record,title:'Recovered assessment'}];await retry.handlers.click();assert.match(host.innerHTML,/Recovered assessment/);
  resolve([{...r.record,title:'OLD delayed response'}]);await new Promise(done=>setImmediate(done));assert.match(host.innerHTML,/Recovered assessment/);assert.doesNotMatch(host.innerHTML,/OLD delayed response/);assert.equal(r.scope.lcaAllData[0].title,'Recovered assessment');
});

test('core assessment read failures preserve a useful retry without a misleading setup-only message',async()=>{
  const r=runtime({},{coreLoader:true}),host=r.doc.getElementById('lca-list');r.scope.apiAllRows=async()=>{throw Error('Connection interrupted during assessment loading');};await r.scope.lcaLoad();
  assert.match(host.textContent,/Unable to load compliance assessments/);assert.match(host.textContent,/Connection interrupted/);assert.equal(host.attributes['aria-busy'],'false');assert.ok(host.querySelectorAll('button').some(x=>x.textContent==='Retry assessments'));
});

test('denied assessment access is explicit and concurrent same-company loads retain only the latest result',async()=>{
  const denied=runtime({},{coreLoader:true});denied.denySection();await denied.scope.lcaLoad();assert.equal(denied.requests.length,0);assert.match(denied.doc.getElementById('lca-list').textContent,/access to Compliance Assessments/);
  const r=runtime({},{coreLoader:true});let resolve;r.scope.apiAllRows=()=>new Promise(done=>resolve=done);const old=r.scope.lcaLoad();r.scope.apiAllRows=async()=>[{...r.record,title:'Latest requested record'}];await r.scope.lcaLoad();resolve([{...r.record,title:'Obsolete response'}]);await old;assert.match(r.doc.getElementById('lca-list').innerHTML,/Latest requested record/);assert.doesNotMatch(r.doc.getElementById('lca-list').innerHTML,/Obsolete response/);
});

test('unresponsive exact assessment loading and print refresh stop loading with a retryable message',async()=>{
  const r=runtime(),timers=manualTimers(r);r.scope.api=()=>new Promise(()=>{});const loading=r.api.open('assessment-a');timers[0].callback();await loading;assert.ok(r.button('Retry'));assert.match(r.modal().textContent,/did not respond within 15 seconds/);
  r.scope.api=async()=>[r.record];await r.api.open('assessment-a');r.scope.api=()=>new Promise(()=>{});const printing=r.button('Print assessment').handlers.click(),timer=timers.at(-1);timer.callback();await printing;assert.equal(r.windows[0].closed,true);assert.equal(r.button('Print assessment').disabled,false);assert.match(r.modal().textContent,/did not respond within 15 seconds/);assert.equal(r.previews.length,0);
});
