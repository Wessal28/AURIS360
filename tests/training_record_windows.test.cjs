const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

class Element {
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.doc=doc;this.children=[];this.attributes={};this.listeners={};this.style={};this._text='';this.tabIndex=['BUTTON','INPUT','SELECT','TEXTAREA','A'].includes(this.tagName)?0:-1;this.classList={add:word=>this.className=[...new Set((this.className||'').split(/\s+/).concat(word))].join(' '),remove:word=>this.className=(this.className||'').split(/\s+/).filter(x=>x!==word).join(' '),contains:word=>(this.className||'').split(/\s+/).includes(word)};}
  appendChild(child){child.parentElement=this;this.children.push(child);return child;}
  append(...children){children.forEach(child=>this.appendChild(child));}
  prepend(...children){children.reverse().forEach(child=>{child.parentElement=this;this.children.unshift(child);});}
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
  set innerHTML(value){this.children=[];parse(value,this);}get innerHTML(){return this._html||'';}
  insertAdjacentHTML(_where,value){parse(value,this);}
  setAttribute(key,value){this.attributes[key]=String(value);if(key==='class')this.className=String(value);if(key==='id')this.id=String(value);if(key==='tabindex')this.tabIndex=Number(value);}
  getAttribute(key){return this.attributes[key]??null;}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  get lastElementChild(){return this.children.at(-1);}
  get isConnected(){return this===this.doc.body||!!this.parentElement?.isConnected;}
  all(){return this.children.flatMap(child=>[child,...child.all()]);}
  matches(selector){const cls=selector.match(/^\.([\w-]+)$/);if(cls)return this.classList.contains(cls[1]);const attr=selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);if(attr)return attr[2]==null?this.getAttribute(attr[1])!=null:this.getAttribute(attr[1])===attr[2];if(selector.endsWith(':not(:disabled)'))return this.tagName===selector.split(':')[0].toUpperCase()&&!this.disabled;if(selector==='a[href]')return this.tagName==='A'&&this.getAttribute('href')!=null;return this.tagName===selector.toUpperCase();}
  querySelectorAll(selector){return this.all().filter(node=>selector.split(',').some(part=>node.matches(part.trim())));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){for(let node=this;node;node=node.parentElement)if(selector.split(',').some(part=>node.matches(part.trim())))return node;return null;}
  getClientRects(){return this.hidden?[]:[{}];}
  focus(){this.doc.activeElement=this;}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=null;}
  trigger(type,event={}){for(const fn of this.listeners[type]||[])fn({...event,target:event.target||this});}
}
function parse(html,parent){
  const stack=[parent];for(const token of String(html).match(/<[^>]+>|[^<]+/g)||[]){
    if(token.startsWith('</')){stack.pop();continue;}
    if(token.startsWith('<')){const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;const node=new Element(tag,parent.doc);for(const m of token.matchAll(/([\w-]+)="([^"]*)"/g))node.setAttribute(m[1],m[2]);stack.at(-1).appendChild(node);if(!['INPUT','BR','HR','IMG','LINK'].includes(node.tagName)&&!token.endsWith('/>'))stack.push(node);}
    else stack.at(-1)._text+=token;
  }
}
function runtime(){
  const listeners={},doc={createElement:tag=>new Element(tag,doc),getElementById:id=>doc.body.all().find(node=>node.id===id)||null,addEventListener:(type,fn)=>{(listeners[type]??=new Set()).add(fn);},removeEventListener:(type,fn)=>listeners[type]?.delete(fn)};doc.body=new Element('body',doc);doc.activeElement=doc.body;
  const trigger=doc.createElement('button');trigger.textContent='Add provider';doc.body.appendChild(trigger);trigger.focus();
  const requests=[],scope={document:doc,console,Date,Intl,api:async(path,options)=>{requests.push({path,options});return [];}};scope.window=scope;vm.createContext(scope);vm.runInContext(fs.readFileSync('learning-competency-upgrade.js','utf8'),scope);
  function key(key,shiftKey=false){const event={key,shiftKey,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};for(const fn of listeners.keydown||[])fn(event);return event;}
  return {scope,doc,trigger,requests,key,listeners,overlay:()=>doc.getElementById('lcu-drawer-bg'),dialog:()=>doc.getElementById('lcu-drawer-bg')?.querySelector('[role="dialog"]')};
}

test('external provider opens an accessible learning window without saving and labels every field',()=>{
  const r=runtime();r.scope.lcuOpenProvider();const dialog=r.dialog();
  assert.equal(dialog.getAttribute('aria-modal'),'true');assert.equal(dialog.getAttribute('aria-labelledby'),'lcu-drawer-title');
  assert.equal(r.doc.activeElement,r.doc.getElementById('lcu-drawer-title'));
  assert.equal(r.overlay().getAttribute('aria-hidden'),'false');
  assert.equal(r.requests.length,0);
  const fields=dialog.querySelectorAll('input,select,textarea');assert.equal(fields.length,10);
  for(const field of fields)assert.ok(dialog.querySelectorAll('label').some(label=>label.getAttribute('for')===field.id),'A visible label identifies '+field.id);
  assert.ok(dialog.textContent.includes('Save provider'));assert.ok(dialog.textContent.includes('Provider approval is evidence-based.'));
});

test('Tab wraps within the learning window and Escape restores the opening button without altering edits',()=>{
  const r=runtime();r.scope.lcuOpenProvider();const buttons=r.dialog().querySelectorAll('button'),first=buttons[0],last=buttons.at(-1),name=r.doc.getElementById('lep-name');
  name.value='Unsubmitted provider';assert.equal(r.key('Tab').prevented,true);assert.equal(r.doc.activeElement,first);
  assert.equal(r.key('Tab',true).prevented,true);assert.equal(r.doc.activeElement,last);
  assert.equal(r.key('Tab').prevented,true);assert.equal(r.doc.activeElement,first);
  name.focus();assert.equal(r.key('Tab').prevented,false,'Normal movement between fields remains native');
  const close=r.key('Escape');assert.equal(close.prevented,true);assert.equal(close.stopped,true);
  assert.equal(r.overlay().classList.contains('open'),false);assert.equal(r.overlay().getAttribute('aria-hidden'),'true');
  assert.equal(r.doc.activeElement,r.trigger);assert.equal(name.value,'Unsubmitted provider');assert.equal(r.requests.length,0);assert.equal(r.listeners.keydown.size,0);
});

test('replacing an open learning form retains the original focus target and never registers duplicate key handlers',()=>{
  const r=runtime();r.scope.lcuOpenProvider();r.doc.getElementById('lep-name').focus();r.scope.lcuOpenProvider();
  assert.equal(r.listeners.keydown.size,1);r.scope.lcuCloseDrawer();assert.equal(r.doc.activeElement,r.trigger);assert.equal(r.listeners.keydown.size,0);
  r.scope.lcuOpenProvider();r.trigger.remove();assert.doesNotThrow(()=>r.key('Escape'));assert.equal(r.listeners.keydown.size,0);
});

test('a child record picker retains its own Escape and Tab keys while the learning window remains open',()=>{
  const r=runtime();r.scope.lcuOpenProvider();const child=r.doc.createElement('section'),control=r.doc.createElement('button');child.setAttribute('role','dialog');child.appendChild(control);r.doc.body.appendChild(child);control.focus();
  assert.equal(r.key('Escape').prevented,false);assert.equal(r.key('Tab').prevented,false);assert.equal(r.doc.activeElement,control);assert.equal(r.overlay().classList.contains('open'),true);
  child.remove();r.doc.getElementById('lcu-drawer-title').focus();r.key('Escape');assert.equal(r.doc.activeElement,r.trigger);
});

test('training session view retains the full scoped saved values and manager actions in the compact window',async()=>{
  const r=runtime(),record={id:'plan-one',company_id:'company-a',training_topic:'Site induction',objective:'Detailed objective\n'+('Full saved wording '.repeat(100)),training_type:'refresher',status:'completed',planned_date:'2026-11-01',actual_date:'2026-11-02',trainer:'Saved trainer',location:'Saved location',updated_at:'2026-11-02T10:00:00Z'};
  Object.assign(r.scope,{ccid:()=> 'company-a',prof:{id:'user-a'},isMgr:()=>true,tpTypeLabel:value=>value,tpProviderFromRecord:()=> 'Saved provider',tpAllData:[],tpOpen:()=>{},lcuSwitch:()=>{},escH:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),displayRecordRef:()=> 'READ ONLY',toastActionError:(_action,_module,error)=>{throw error;},api:async(path,options)=>{r.requests.push({path,options});return [structuredClone(record)];}});
  const core=fs.readFileSync('auris-core.js','utf8'),start=core.indexOf('function aurisReadOnlyRecordModal('),end=core.indexOf('\nfunction aurisRowRecordId',start);vm.runInContext(core.slice(start,end),r.scope);vm.runInContext(fs.readFileSync('training-workflow.js','utf8'),r.scope);
  await r.scope.TrainingWorkflow.viewPlan('plan-one');const modal=r.doc.getElementById('auris-readonly-record-modal');assert.ok(modal.classList.contains('auris-record-view-compact'));
  assert.equal(r.requests.length,1);assert.match(r.requests[0].path,/company_id=eq\.company-a&id=eq\.plan-one&limit=1$/);assert.equal(r.requests[0].options,undefined);
  assert.ok(modal.textContent.includes(record.objective));assert.ok(modal.textContent.includes('Saved provider'));assert.ok(modal.textContent.includes('Saved trainer'));
  const actions=modal.querySelectorAll('button').map(node=>node.textContent);assert.ok(actions.includes('Create attendee records'));assert.ok(actions.includes('Edit planned session'));
  assert.ok(modal.querySelectorAll('.auris-readonly-field').filter(node=>node.classList.contains('wide')).some(node=>node.textContent.includes(record.objective)));
  assert.equal(r.doc.activeElement,modal.querySelector('.auris-readonly-close'));modal.trigger('keydown',{key:'Escape',preventDefault(){}});assert.equal(modal.isConnected,false);assert.equal(r.doc.activeElement,r.trigger);
});
