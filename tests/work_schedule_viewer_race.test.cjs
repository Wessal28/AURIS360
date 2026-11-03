'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../auris-work-schedule-workspace.js'),'utf8');
const deferred=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function runtime({active=true}={}){
  const identity={company:{id:'company'},profile:{id:'user'},role:'manager'},requests=[],notices=[],timers=[],documentEvents=new Map();let allowed=true,hook=null;
  const doc={activeElement:null,addEventListener:(name,fn)=>documentEvents.set(name,fn),removeEventListener:(name,fn)=>{if(documentEvents.get(name)===fn)documentEvents.delete(name);}};
  function node(){
    const n={id:'',className:'',innerHTML:'',isConnected:false,disabled:false,hidden:false,attrs:{},events:{},children:[],parent:null,
      setAttribute(name,value){this.attrs[name]=String(value);},getAttribute(name){return this.attrs[name]??null;},
      addEventListener(name,fn){(this.events[name]??=[]).push(fn);},
      async fire(name,event={}){for(const fn of this.events[name]||[])await fn({target:this,preventDefault(){},...event});},
      appendChild(child){child.parent=this;child.isConnected=this.isConnected;this.children.push(child);return child;},
      remove(){this.isConnected=false;for(const child of this.children)child.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);},
      focus(options){this.focusOptions=options;doc.activeElement=this;},
      contains(target){return target===this||this.children.some(child=>child.contains(target));},
      getClientRects(){return this.isConnected?[{}]:[];},
      querySelector(selector){if(selector==='[data-ws-back]'&&!this.innerHTML.includes('data-ws-back'))return null;if(selector==='[data-ws-back]')return this.back??=this.appendChild(node());if(selector==='button'||selector==='[data-ws-close]')return this.close??=this.appendChild(node());return null;},
      querySelectorAll(){return this.children.filter(child=>!child.disabled);}
    };return n;
  }
  const classes=new Set(['page',...(active?['active']:[])]),page=node();page.id='page-workschedule';page.isConnected=true;page.classList={contains:value=>classes.has(value),add:value=>classes.add(value),remove:value=>classes.delete(value)};page.scrollLeft=314;page.scrollTop=271;
  const origin=node();origin.isConnected=true;origin.tagName='BUTTON';origin.focus();
  doc.getElementById=id=>id==='page-workschedule'?page:page.children.find(child=>child.id===id&&child.isConnected)||null;
  doc.createElement=()=>node();
  const rows={a:{id:'a',company_id:'company',ref_number:'WO-A',title:'First saved work order',description:'Read-only A',status:'planned'},b:{id:'b',company_id:'company',ref_number:'WO-B',title:'Second saved work order',description:'Read-only B',status:'approved'}};
  const c={document:doc,URL,URLSearchParams,Date,console,location:{search:''},wsAllData:[],wsCurrentId:null,ccid:()=>identity.company.id,isMgr:()=>false,canAccessPage:()=>allowed,
    escH:value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),wsRestEqValue:encodeURIComponent,
    toast:(message,success)=>notices.push({message,success}),deepLinkRecordUrl:()=> 'https://example.test/',
    setTimeout:(fn,ms)=>{const timer={fn,ms,cleared:false};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cleared=true;},
    AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>true,current:()=>identity},rbac:{requireAccess:()=>{if(!allowed)throw Error('Access denied');}}},
    api:async(url,options)=>{assert.equal(options,undefined,'Viewer opening never writes business records');requests.push(url);if(hook){const value=await hook(url);if(value!==undefined)return value;}if(url.startsWith('/work_schedule?')){const id=new URL('https://example.test'+url).searchParams.get('id').slice(3);return rows[id]?[{...rows[id]}]:[];}return [];}
  };
  c.window=c;vm.createContext(c);vm.runInContext(source,c);
  return {c,doc,page,origin,rows,identity,requests,notices,timers,documentEvents,node,hook:fn=>hook=fn,deny:()=>allowed=false,viewer:()=>doc.getElementById('ws-record-view'),open:(id,options)=>c.wsRecordWindow(id,'view',{origin,...options})};
}

test('same-context A/B exact-fetch race opens only B and never commits stale A to the selected record',async()=>{
  const h=runtime(),gate=deferred();h.hook(url=>url.startsWith('/work_schedule?')&&url.includes('id=eq.a&')?gate.promise:undefined);
  const a=h.open('a');await tick();const b=h.open('b');assert.equal(await b,true);assert.match(h.viewer().innerHTML,/Second saved work order/);assert.equal(h.c.wsCurrentId,'b');
  gate.resolve([{...h.rows.a}]);assert.equal(await a,false);await tick();assert.match(h.viewer().innerHTML,/Second saved work order/);assert.equal(h.c.wsCurrentId,'b');assert.deepEqual(Array.from(h.c.wsAllData,row=>row.id),['b']);assert.equal(h.notices.length,0);
});

test('a newer request also cancels an older request already loading related records',async()=>{
  const h=runtime(),gate=deferred();h.hook(url=>url.startsWith('/work_schedule_links?')&&url.includes('work_order_id=eq.a&')?gate.promise:undefined);
  const a=h.open('a');await tick();assert.ok(h.requests.some(url=>url.includes('work_order_id=eq.a')));assert.equal(await h.open('b'),true);gate.resolve([]);assert.equal(await a,false);await tick();assert.match(h.viewer().innerHTML,/Second saved work order/);assert.equal(h.c.wsCurrentId,'b');
});

test('navigation away, disconnected origin and explicit Gantt guard changes block late viewers',async()=>{
  for(const scenario of ['page','origin','guard']){
    const h=runtime(),gate=deferred();let visible=true;h.hook(url=>url.startsWith('/work_schedule?')?gate.promise:undefined);
    const p=h.open('a',{guard:()=>{if(!visible)throw Error('A different Gantt period is open.');}});await tick();
    if(scenario==='page')h.page.classList.remove('active');else if(scenario==='origin')h.origin.isConnected=false;else visible=false;
    gate.resolve([{...h.rows.a}]);assert.equal(await p,false,scenario);assert.equal(h.viewer(),null,scenario);assert.equal(h.c.wsCurrentId,null);assert.equal(h.notices.length,0);
  }
});

test('startup deep links can open before the Work Schedule page has become active',async()=>{
  const h=runtime({active:false});h.doc.activeElement=null;assert.equal(await h.c.wsOpenRecordRequest({record:'a',company:'company',table:'work_schedule',mode:'view'}),true);assert.match(h.viewer().innerHTML,/First saved work order/);
});

test('navigation cancellation remains effective when the user returns before the old response arrives',async()=>{
  const h=runtime(),gate=deferred(),observers=[];h.c.MutationObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
  h.hook(url=>url.startsWith('/work_schedule?')?gate.promise:undefined);const p=h.open('a');await tick();h.page.classList.remove('active');observers[0].callback();assert.equal(await p,false);h.page.classList.add('active');gate.resolve([{...h.rows.a}]);await tick();assert.equal(h.viewer(),null);assert.equal(observers[0].disconnected,true);
  assert.equal(await h.open('a',{guard:()=>false}),false);assert.equal(h.viewer(),null);
});

test('user, company, role and RBAC changes fail closed before any late viewer opens',async()=>{
  for(const change of [h=>h.identity.company.id='other',h=>h.identity.profile.id='other',h=>h.identity.role='employee',h=>h.deny()]){
    const h=runtime(),gate=deferred();h.hook(url=>url.startsWith('/work_schedule?')?gate.promise:undefined);const p=h.open('a');await tick();change(h);gate.resolve([{...h.rows.a}]);assert.equal(await p,false);assert.equal(h.viewer(),null);assert.equal(h.c.wsCurrentId,null);assert.equal(h.notices.length,1);assert.match(h.notices[0].message,/changed|Access denied/);
  }
});

test('Close cancels a pending related opening and restores the native opener without scrolling or resetting the schedule',async()=>{
  const h=runtime();assert.equal(await h.open('a'),true);const viewer=h.viewer(),close=viewer.querySelector('[data-ws-close]'),gate=deferred();
  h.hook(url=>url.startsWith('/work_schedule?')&&url.includes('id=eq.b&')?gate.promise:undefined);const p=h.open('b');await tick();await close.fire('click');assert.equal(await p,false);assert.equal(h.viewer(),null);assert.equal(h.doc.activeElement,h.origin);assert.equal(h.origin.focusOptions.preventScroll,true);
  gate.resolve([{...h.rows.b}]);await tick();assert.equal(h.viewer(),null);assert.equal(h.page.scrollLeft,314);assert.equal(h.page.scrollTop,271);assert.equal(h.c.wsCurrentId,'a');assert.equal(h.documentEvents.has('focusin'),false);
});

test('Escape closes the overlay, traps Tab and outside focus, and preserves the opening button',async()=>{
  const h=runtime();await h.open('a');const host=h.viewer(),close=host.querySelector('[data-ws-close]'),second=host.appendChild(h.node());let prevented=0,stopped=0;
  close.focus();await host.fire('keydown',{key:'Tab',shiftKey:true,preventDefault(){prevented++;}});assert.equal(h.doc.activeElement,second);
  await host.fire('keydown',{key:'Tab',shiftKey:false,preventDefault(){prevented++;}});assert.equal(h.doc.activeElement,close);assert.equal(prevented,2);
  const outside=h.node();outside.isConnected=true;h.doc.activeElement=outside;h.documentEvents.get('focusin')({target:outside});assert.equal(h.doc.activeElement,close);
  await host.fire('keydown',{key:'Escape',preventDefault(){prevented++;},stopPropagation(){stopped++;}});assert.equal(h.viewer(),null);assert.equal(h.doc.activeElement,h.origin);assert.equal(stopped,1);assert.equal(h.documentEvents.has('focusin'),false);
});

test('leaving the module disposes the viewer focus trap instead of stealing focus from the new page',async()=>{
  const h=runtime();await h.open('a');h.page.classList.remove('active');const nextPageButton=h.node();nextPageButton.isConnected=true;h.doc.activeElement=nextPageButton;h.documentEvents.get('focusin')({target:nextPageButton});assert.equal(h.viewer(),null);assert.equal(h.doc.activeElement,nextPageButton);assert.equal(h.documentEvents.has('focusin'),false);
});

test('bounded loading can be cancelled and late network completion cannot reopen the overlay',async()=>{
  const h=runtime(),gate=deferred();h.hook(url=>url.startsWith('/work_schedule?')?gate.promise:undefined);const p=h.open('a');await tick();
  const loading=h.page.children.find(child=>child.className.includes('ws-record-open-status'));assert.match(loading.innerHTML,/Opening saved work order/);assert.equal(loading.attrs.role,'status');await loading.querySelector('button').fire('click');assert.equal(await p,false);gate.resolve([{...h.rows.a}]);await tick();assert.equal(h.viewer(),null);assert.equal(loading.isConnected,false);assert.equal(h.notices.length,0);
});

test('timeout and network failures show recoverable feedback without raw database diagnostics',async()=>{
  const h=runtime(),gate=deferred();h.hook(url=>url.startsWith('/work_schedule?')?gate.promise:undefined);const pending=h.open('a');await tick();h.timers.find(timer=>timer.ms===20000).fn();assert.equal(await pending,false);assert.match(h.notices[0].message,/took too long/);assert.ok(h.page.children.some(child=>child.attrs.role==='alert'));
  gate.resolve([{...h.rows.a}]);await tick();assert.equal(h.viewer(),null);
  const failed=runtime();failed.hook(()=>{throw Error('SQL SECRET-TENANT-ID canceling statement: SELECT private_payload');});assert.equal(await failed.open('a'),false);assert.match(failed.notices[0].message,/could not be opened/);assert.doesNotMatch(failed.notices[0].message,/SQL|SECRET|private_payload/);assert.ok(failed.page.children.some(child=>child.attrs.role==='alert'));failed.hook(null);assert.equal(await failed.open('a'),true);assert.match(failed.viewer().innerHTML,/First saved work order/);assert.equal(failed.page.children.filter(child=>child.className.includes('ws-record-open-status')).length,0);
});

test('read-only field formatting uses readable people and local dates without raw JSON or identity details',()=>{
  const h=runtime(),html=h.c.wsReadOnlyHtml({team_members:[{full_name:'Fictional Ada',person_id:'SECRET-ID',email:'SECRET-CONTACT'},{first_name:'Fictional',last_name:'Ben'}],supervisor_name:{name:'Fictional Supervisor',id:'SECRET-SUPERVISOR'},planned_start:'2026-11-03',planned_end:'2026-11-04T14:30:00Z',status:'in_progress',requires_permit:false});
  assert.match(html,/Fictional Ada, Fictional Ben/);assert.match(html,/Fictional Supervisor/);assert.match(html,/03\/11\/2026/);assert.match(html,/04\/11\/2026/);assert.match(html,/In progress/);assert.match(html,/No<\/dd>/);assert.doesNotMatch(html,/SECRET|person_id|full_name|\{&quot;|T14:30/);
});
