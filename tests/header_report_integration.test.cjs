const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=name=>fs.readFileSync(name,'utf8');
// A small DOM for executing the actual layout, adapter, section-picker and header
// scripts together. Browser QA additionally checks the application's CSS.
class Node{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.attrs={};this.events={};this.dataset={};this.style={};this.hidden=false;this._text='';this._value=undefined;this.classList={contains:k=>this.className.split(/\s+/).includes(k),add:(...k)=>{this.className=[...new Set(this.className.split(/\s+/).filter(Boolean).concat(k))].join(' ');},remove:k=>{this.className=this.className.split(/\s+/).filter(v=>v!==k).join(' ');},toggle:(k,on)=>{on=on===undefined?!this.classList.contains(k):on;if(on)this.classList.add(k);else this.classList.remove(k);}};}
 get nodeType(){return this.tagName==='DOCUMENT'?9:1;}
 get id(){return this.attrs.id||'';}set id(v){this.attrs.id=String(v);}
 get className(){return this.attrs.class||'';}set className(v){this.attrs.class=String(v);}
 get parentNode(){return this.parentElement;}get firstChild(){return this.children[0]||null;}get previousElementSibling(){if(!this.parentElement)return null;return this.parentElement.children[this.parentElement.children.indexOf(this)-1]||null;}
 get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}set textContent(v){this._text=String(v);this.replaceChildren();}
 get value(){return this._value===undefined?(this.tagName==='SELECT'?this.options[0]?.value||'':this.attrs.value||''):this._value;}set value(v){this._value=String(v);}
 get options(){return this.querySelectorAll('option');}get selectedOptions(){return this.options.filter(x=>x.value===this.value);}
 get elements(){return Object.fromEntries(this.querySelectorAll('[name]').map(n=>[n.getAttribute('name'),n]));}get isConnected(){let n=this;while(n){if(n.tagName==='BODY')return true;n=n.parentElement;}return false;}
 set innerHTML(html){this.replaceChildren();this._text='';let current=this;for(const token of String(html).match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){current=current.parentElement||this;continue;}if(token.startsWith('<')){const match=token.match(/^<([\w-]+)/);if(!match)continue;const n=new Node(match[1]);for(const attr of token.slice(match[0].length).matchAll(/([\w:-]+)(?:="([^"]*)"|'([^']*)')?/g))n.setAttribute(attr[1],attr[2]??attr[3]??'');current.appendChild(n);if(!['INPUT','IMG','BR','HR','LINK','META'].includes(n.tagName)&&!token.endsWith('/>'))current=n;}else current._text+=token.replace(/&amp;/g,'&').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&quot;/g,'"');}}
 appendChild(n){if(n.parentElement)n.parentElement.children.splice(n.parentElement.children.indexOf(n),1);this.children.push(n);n.parentElement=this;return n;}
 insertBefore(n,ref){if(!ref)return this.appendChild(n);if(n.parentElement)n.parentElement.children.splice(n.parentElement.children.indexOf(n),1);this.children.splice(this.children.indexOf(ref),0,n);n.parentElement=this;return n;}
 insertAdjacentElement(where,n){assert.equal(where,'afterend');this.parentElement.insertBefore(n,this.parentElement.children[this.parentElement.children.indexOf(this)+1]);}
 insertAdjacentHTML(where,markup){
  const fragment=new Node();fragment.innerHTML=markup;
  const inside=where==='afterbegin'||where==='beforeend',parent=inside?this:this.parentElement;
  const reference=inside?(where==='afterbegin'?this.firstChild:null):(where==='beforebegin'?this:parent.children[parent.children.indexOf(this)+1]);
  for(const node of fragment.children.slice())parent.insertBefore(node,reference);
 }
 replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];nodes.forEach(n=>this.appendChild(n));}
 remove(){if(this.parentElement)this.parentElement.children.splice(this.parentElement.children.indexOf(this),1);this.parentElement=null;}showModal(){this.open=true;}close(){this.open=false;}
 setAttribute(k,v){this.attrs[k]=String(v);if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(v);}
 getAttribute(k){return (k.startsWith('data-')?this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]:this.attrs[k])??null;}
 hasAttribute(k){return this.getAttribute(k)!==null;}
 addEventListener(k,fn){(this.events[k]||=[]).push(fn);}
 dispatchEvent(e){e.target=e.target||this;this['on'+e.type]?.(e);for(const fn of this.events[e.type]||[])fn(e);if(e.bubbles&&this.parentElement)this.parentElement.dispatchEvent(e);return true;}
 click(){this.dispatchEvent({type:'click',target:this,bubbles:true,preventDefault(){}});}focus(){}
 getClientRects(){return this.hidden||this.style.display==='none'||this.classList.contains('page')&&!this.classList.contains('active')||this.parentElement&&!this.parentElement.getClientRects().length?[]:[{}];}
 matches(selector){const attrs=[...selector.matchAll(/\[([\w-]+)(?:([~^]?=)"([^"]*)")?\]/g)];selector=selector.replace(/\[[^\]]+\]/g,'');for(const [,key,op,value] of attrs){const actual=this.getAttribute(key);if(actual===null||op==='='&&actual!==value||op==='^='&&!actual.startsWith(value))return false;}const id=selector.match(/#([\w-]+)/);if(id&&this.id!==id[1])return false;for(const name of [...selector.matchAll(/\.([\w-]+)/g)].map(x=>x[1]))if(!this.classList.contains(name))return false;const tag=selector.match(/^[\w-]+/);return !tag||this.tagName===tag[0].toUpperCase();}
 closest(selector){let n=this;while(n){if(selector.split(',').some(s=>n.matches(s.trim())))return n;n=n.parentElement;}return null;}
 querySelectorAll(selector){let out=[];for(const choice of selector.split(',')){const s=choice.trim();if(s.startsWith(':scope > ')){out.push(...this.children.filter(n=>n.matches(s.slice(9))));continue;}const parts=s.split(/\s+/),all=[];function descend(n){for(const x of n.children){all.push(x);descend(x);}}descend(this);out.push(...all.filter(n=>{if(!n.matches(parts.at(-1)))return false;let parent=n.parentElement;for(let i=parts.length-2;i>=0;i--){while(parent&&!parent.matches(parts[i]))parent=parent.parentElement;if(!parent)return false;parent=parent.parentElement;}return true;}));}return [...new Set(out)];}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
function runtime(){
 const body=new Node('body');body.innerHTML='<div id="app"><div id="auris-module-bar"><span id="auris-module-name"></span><span id="auris-module-crumb"></span><label id="auris-module-section-wrap"><select id="auris-module-section"></select></label></div><div id="page-actions" class="page active"><div class="page-header"><div><div class="page-title">Master Action Plan</div></div><div><button id="map-print-btn">Print reports</button></div></div><input id="map-search" value="Retained search"><select id="map-filter-source"><option value="audit">Audit</option></select></div><div id="page-legal" class="page"><div class="page-header"><div class="page-title">Legal Compliance</div></div><div class="module-tabs"><button id="legal-tab-register" class="active">Legal Register</button><button id="legal-tab-assessments">Assessments</button></div><input id="lr-search" value="Retained legal search"></div></div>';
 const frames=[],observers=[],lifecycle={},doc=new Node('document');
 doc.body=doc.appendChild(body);doc.readyState='loading';doc.createElement=tag=>new Node(tag);doc.getElementById=id=>body.querySelector('#'+id);
 const c={console,document:doc,requestAnimationFrame:fn=>frames.push(fn),MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},getComputedStyle:n=>({display:n.style.display||'block',visibility:n.style.visibility||'visible'}),Event:class{constructor(type,options){this.type=type;Object.assign(this,options);}},AurisModuleRuntime:{register:(k,v)=>lifecycle[k]=v},AurisUserAccess:{currentProfile:()=>null},MODULES_DIR:[{k:'actions',l:'Master Action Plan',i:'ti-clipboard-check'},{k:'legal',l:'Legal Compliance',i:'ti-scale'}]};c.window=c;c.globalThis=c;vm.createContext(c);
 for(const name of ['auris-module-registry.js','auris-module-layout.js','auris-priority-module-adapters.js','auris-section-picker.js','auris-universal-header.js'])vm.runInContext(read(name),c);
 doc.dispatchEvent({type:'DOMContentLoaded'});doc.readyState='complete';function flush(){for(let limit=0;frames.length&&limit<20;limit++)frames.shift()();assert.equal(frames.length,0,'Header integration must settle');}flush();
 return {c,body,doc,lifecycle,flush,refresh(){observers.forEach(fn=>fn());flush();}};
}
test('real priority adapter, shared layout, picker and universal header retain a visible MAP print command',()=>{
 const h=runtime(),page=h.doc.getElementById('page-actions'),print=h.doc.getElementById('map-print-btn'),header=page.querySelector('.page-header');assert.ok(print,'Adapter remount must recreate the print button');assert.equal(print.textContent,'Print reports');assert.equal(print.getAttribute('data-layout-command'),'print');assert.ok(print.closest('.auris-module-commandbar'));assert.notEqual(header.firstChild,print.closest('.auris-module-commandbar'),'The command must stay outside the identity wrapper hidden by the universal-header CSS');assert.equal(print.hidden,false);
 assert.equal(h.doc.getElementById('auris-module-name').textContent,'Master Action Plan');assert.equal(h.doc.getElementById('auris-module-section').options.length,5);assert.match(h.doc.getElementById('auris-module-crumb').textContent,/All Actions/);
 const css=read('auris-universal-header.css');assert.ok(!/#page-actions[^{}]*auris-module-commandbar[^{}]*\{[^}]*display:none/.test(css));
});
test('MAP print dispatch resolves the current lazy handler after remount without automatic printing',()=>{
 const h=runtime(),calls=[];h.c.mapPrintRegister=()=>calls.push('lazy loader');h.doc.getElementById('map-print-btn').click();assert.deepEqual(calls,['lazy loader']);h.c.mapPrintRegister=()=>calls.push('professional chooser');h.lifecycle.actions.enter();h.refresh();h.doc.getElementById('map-print-btn').click();assert.deepEqual(calls,['lazy loader','professional chooser']);assert.equal(h.doc.querySelectorAll('#map-print-btn').length,1);
});
test('the remounted MAP button opens the real chooser and prints full or freshly filtered saved actions',async()=>{
 const h=runtime(),previews=[],requests=[],ctx={company:'client',user:'reviewer',role:'company_admin'},rows=[{id:'a',company_id:'client',action_ref:'MAP-001',title:'Retained search finding',source_module:'audit',status:'open',priority:'high'},{id:'b',company_id:'client',action_ref:'MAP-002',title:'Other saved action',source_module:'manual',status:'pending_closure',progress_pct:100}];h.c.prof={id:'reviewer'};h.c.mapCurrentView='all';h.c.AurisUserAccess.sectionAllowed=()=>true;
 h.c.AurisModuleReports={context:()=>ctx,company:()=>({name:'Client company'}),allowed:()=>true,ensureStyle(){},check(){},read:async(table,c)=>{requests.push({table,company:c.company});return structuredClone(rows);},reserve:()=>({closed:false,close(){this.closed=true;}}),preview:async report=>{previews.push(report);return report;}};
 for(const path of ['auris-action-list-workspace.js','action-print-reports.js'])vm.runInContext(read(path),h.c);h.lifecycle.actions.enter();h.refresh();h.doc.getElementById('map-print-btn').click();let dialog=h.doc.getElementById('mrp-options'),form=dialog.querySelector('form');assert.match(dialog.textContent,/Master Action Plan reports/);form.elements.scope.value='all';await form.events.submit[0]({preventDefault(){}});assert.match(previews[0].html,/MAP-001/);assert.match(previews[0].html,/MAP-002/);assert.match(previews[0].sourceLabel,/Full company register/);
 h.doc.getElementById('map-print-btn').click();dialog=h.doc.getElementById('mrp-options');form=dialog.querySelector('form');form.elements.scope.value='filters';await form.events.submit[0]({preventDefault(){}});assert.match(previews[1].html,/MAP-001/);assert.doesNotMatch(previews[1].html,/MAP-002/);assert.match(previews[1].sourceLabel,/Search: Retained search/);assert.equal(h.doc.getElementById('map-search').value,'Retained search');assert.deepEqual(requests,[{table:'action_tracker',company:'client'},{table:'action_tracker',company:'client'}]);
});
test('header observer updates and section mirroring preserve current MAP and Legal search filters',()=>{
 const h=runtime(),map=h.doc.getElementById('map-search'),legal=h.doc.getElementById('lr-search');let writes=0;map.addEventListener('input',()=>writes++);legal.addEventListener('input',()=>writes++);h.refresh();assert.equal(map.value,'Retained search');assert.equal(legal.value,'Retained legal search');assert.equal(writes,0);
 const css=read('auris-universal-header.css');assert.doesNotMatch(css,/#map-search|#lr-search|#page-legal \.legx-filter-field\.search/);
 h.doc.getElementById('page-actions').classList.remove('active');h.doc.getElementById('page-legal').classList.add('active');h.refresh();assert.equal(legal.value,'Retained legal search');assert.equal(h.doc.getElementById('auris-module-name').textContent,'Legal Compliance');assert.equal(h.doc.getElementById('auris-module-section').options.length,2);
});
test('the generated Legal header uses the report chooser label rather than a current-view print claim',()=>{
 const source=read('legal-compliance-upgrade.js'),header=source.match(/header\.outerHTML='([^\n]+)';/)[1];assert.match(header,/id="legal-print-btn"[^>]*><i class="ti ti-printer"><\/i>Print reports<\/button>/);assert.doesNotMatch(header,/Print current view/);
});

function chooseSection(h,label){
 const mirror=h.doc.getElementById('auris-module-section');
 const option=mirror.options.find(option=>option.textContent===label);
 assert.ok(option,'Expected section '+label);
 assert.equal(!!mirror.disabled,false,'The section control should be ready');
 mirror.value=option.value;
 mirror.dispatchEvent(new h.c.Event('change',{bubbles:true}));
 h.refresh();
 h.refresh(); // A route can rebuild its source bar before the new mirror is available.
 assert.equal(mirror.selectedOptions[0]?.textContent,label);
 assert.ok(h.doc.getElementById('auris-module-crumb').textContent.endsWith(' / '+label));
}

test('Master Action Plan routes filter the same register by assignee, due date and workflow stage',()=>{
 const h=runtime(),page=h.doc.getElementById('page-actions'),list=new Node('div');
 list.id='actions-list';page.appendChild(list);
 h.doc.getElementById('map-search').value='';
 h.doc.getElementById('map-filter-source').value='';
 h.c.prof={id:'reviewer',full_name:'Fictional Reviewer',company_id:'client'};
 h.c.mapAllData=[
  {id:'mine',title:'My open action',assigned_to_id:'reviewer',status:'open'},
  {id:'late',title:'Other overdue action',target_date:'2000-01-01',status:'open'},
  {id:'verify',title:'Needs verification',status:'pending_verification'},
  {id:'close',title:'Needs closure',status:'pending_closure'}
 ].map(row=>({...row,company_id:'client'}));
 Object.assign(h.c,{
  MAP_SOURCE_CFG:{},MAP_PRIORITY_CFG:{},MAP_STATUS_CFG:{},MAP_TYPE_CFG:{},
  mapDisplayRef:row=>row.id,mapSourceKey:key=>key,
  AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>true,current:()=>({profile:h.c.prof})},rbac:{requireAccess(){}}},
  AurisViewEngine:{mount:(host,rows)=>{host.textContent=rows.map(row=>row.title).join('|');}}
 });
 h.c.AurisUserAccess.sectionAllowed=()=>true;
 const source=read('auris-core.js');
 for(const name of ['mapSetView','mapRenderList','mapRenderTableList']){
  const start=source.indexOf('function '+name+'(');
  vm.runInContext(source.slice(start,source.indexOf('\nfunction ',start+1)),h.c);
 }
 vm.runInContext(read('auris-action-list-workspace.js'),h.c);
 const filters=[
  ['Assigned to Me','My open action'],
  ['Overdue','Other overdue action'],
  ['Pending Verification','Needs verification'],
  ['Pending Closure','Needs closure'],
  ['All Actions','My open action|Other overdue action|Needs verification|Needs closure']
 ];
 for(const [label,expected] of filters){chooseSection(h,label);assert.equal(list.textContent,expected);}
});

function showFixturePage(h,key,name,markup=''){
 const page=new Node();
 page.id='page-'+key;page.className='page active';page.innerHTML=markup;
 h.doc.querySelector('.page.active')?.classList.remove('active');
 h.doc.getElementById('app').appendChild(page);
 h.c.MODULES_DIR.push({k:key,l:name});
 return page;
}

test('SWMS dropdown opens each of its seven distinct workspaces',()=>{
 const h=runtime();
 const page=showFixturePage(h,'swms','SWMS / Method Statements',
  '<div class="swx-hero"></div><div id="swms-list-view"><div id="swms-list"></div></div>');
 h.c.swmsAllData=[];
 for(const path of ['swms-upgrade.js','auris-module-event-handlers-batch-3.js'])vm.runInContext(read(path),h.c);
 h.c.swxSwitch('register');h.refresh();
 const routes=[
  ['Dashboard','dashboard'],['SWMS Register','register'],['My Work','mywork'],
  ['Briefings','briefing'],['Field Verification','verification'],['Change Requests','change_request'],['Work Packs','work_pack']
 ];
 for(const [label,view] of routes){
  chooseSection(h,label);
  const visible=page.querySelectorAll('.swx-view').filter(node=>node.getClientRects().length);
  assert.deepEqual(visible.map(node=>node.dataset.swxView),[view]);
  assert.ok(visible[0].textContent.trim(),'Expected rendered content for '+label);
 }
});

test('Document Control keeps its native page picker and opens each of its seven workspaces',()=>{
 const h=runtime();
 showFixturePage(h,'documents','Document Control');
 h.c.prof={id:'reviewer',role:'sephs_admin'};
 vm.runInContext(read('document-control-upgrade.js'),h.c);
 h.refresh();
 const main=h.doc.getElementById('dcx-main');
 assert.ok(main);
 const routes=[
  ['My Tasks',/My Tasks/i],['Drafts and Reviews',/Drafts and Reviews/i],
  ['Controlled Copies',/Controlled Copies/i],['Distribution and Acknowledgement',/Distribution.*Acknowledgement/i],
  ['Reports',/Reports/i],['Configuration',/General & Numbering/i],['Document Library',/Document Library/i]
 ];
 for(const [label,content] of routes){chooseSection(h,label);assert.match(main.textContent,content);}
});

test('rebuilt BBS, Safety Engagement and Noise pickers open the observed working routes',async()=>{
 const h=runtime(),requests=[];
 h.c.prof={id:'reviewer',role:'sephs_admin',company_id:'client'};h.c.co={name:'Fictional Company'};
 h.c.api=async(path,options)=>{requests.push({path,options});return [];};
 const routes=[
  {key:'observation',name:'BBS Observations',asset:'bbs-observations.js',handlers:4,loader:'loadBbsObservations',label:'Register',content:'#bbs-root main',expected:/Observation register/},
  {key:'engagement',name:'Safety Engagement',asset:'safety-engagement.js',handlers:5,loader:'loadSafetyEngagement',markup:'<div id="se-root"></div>',label:'My Safety Performance',content:'#se-root .se-view',expected:/No personal result/},
  {key:'noise',name:'Occupational Noise',asset:'noise-management.js',handlers:1,loader:'loadNoiseManagement',label:'My Work',content:'#noise-root main',expected:/Assigned records remain visible/}
 ];
 for(const route of routes){
  showFixturePage(h,route.key,route.name,route.markup);
  for(const path of [route.asset,'auris-module-event-handlers-batch-'+route.handlers+'.js'])vm.runInContext(read(path),h.c);
  h.c[route.loader]();await new Promise(resolve=>setImmediate(resolve));h.refresh();
  chooseSection(h,route.label);
  assert.match(h.doc.querySelector(route.content)?.textContent||'',route.expected);
 }
 assert.ok(requests.length>0);
 for(const {path,options} of requests){
  assert.match(path,/company_id=eq\.client/);
  assert.ok(!options||options.m==='GET');
 }
});
