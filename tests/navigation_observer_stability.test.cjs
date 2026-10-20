const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Model DOM mutation delivery and animation frames, including the browser's
// mutation for classList.add() when the token is already present.
function runtime(){
  const observers=[],frames=[];
  let records=[],writes=0;
  function mutate(target,type,name){writes++;records.push({target,type,attributeName:name});}
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.attrs={};this.listeners={};this._text='';this._hidden=false;this.value='';this.dataset={};}
    get classList(){const el=this;return {contains:t=>(el.attrs.class||'').split(' ').includes(t),add(t){el.attrs.class=Array.from(new Set((el.attrs.class||'').split(' ').filter(Boolean).concat(t))).join(' ');mutate(el,'attributes','class');},remove(t){el.attrs.class=(el.attrs.class||'').split(' ').filter(x=>x!==t).join(' ');mutate(el,'attributes','class');}};}
    set className(v){this.attrs.class=v;mutate(this,'attributes','class');}
    get className(){return this.attrs.class||'';}
    set hidden(v){this._hidden=v;mutate(this,'attributes','hidden');}
    get hidden(){return this._hidden;}
    set textContent(v){this._text=v;mutate(this,'childList');}
    get textContent(){return this._text||this.children.map(x=>x.textContent).join('');}
    get parentNode(){return this.parentElement;}
    get previousElementSibling(){return this.parentElement?.children[this.parentElement.children.indexOf(this)-1]||null;}
    get options(){return this.children;}
    appendChild(el){el.parentElement=this;this.children.push(el);mutate(this,'childList');return el;}
    insertBefore(el,next){el.parentElement=this;this.children.splice(this.children.indexOf(next),0,el);mutate(this,'childList');}
    replaceChildren(){this.children=[];mutate(this,'childList');}
    setAttribute(k,v){this.attrs[k]=v;mutate(this,'attributes',k);}
    getAttribute(k){return this.attrs[k]??null;}
    hasAttribute(k){return k in this.attrs;}
    addEventListener(k,fn){this.listeners[k]=fn;}
    click(){this.listeners.click?.();}
    querySelector(s){if(s==='select')return this.children.find(x=>x.tagName==='SELECT')||null;return null;}
    closest(s){if(s==='.page')return this.page||null;if(s.includes('auris-section-picker'))return null;return null;}
  }
  const page=new Element('section'),host=new Element('div'),bar=new Element('div');
  page.id='page-ppe';bar.page=page;bar.className='module-tabs';host.appendChild(bar);
  const buttons=['Dashboard','Inspections'].map((label,index)=>{const b=new Element('button');b.textContent=label;b.id=index?'ppe-tab-inspections':'ppe-tab-dash';if(!index)b.className='active';bar.appendChild(b);return b;});
  const document={readyState:'complete',body:host,documentElement:host,createElement:t=>new Element(t),querySelectorAll:()=>[bar],querySelector:()=>null,getElementById:id=>buttons.find(b=>b.id===id)||null};
  const scope={document,requestAnimationFrame:fn=>frames.push(fn),MutationObserver:class{constructor(fn){this.fn=fn;}observe(root,options){observers.push({fn:this.fn,options});}},prof:{role:'employee',permissions:{access_v1:{}}}};
  scope.window=scope;scope.globalThis=scope;
  function flush(limit=12){for(let frame=0;frame<limit;frame++){const batch=records;records=[];for(const o of observers){const relevant=batch.filter(r=>(r.type==='childList'&&o.options.childList)||(r.type==='attributes'&&o.options.attributes&&(!o.options.attributeFilter||o.options.attributeFilter.includes(r.attributeName))));if(relevant.length)o.fn(relevant);}const queued=frames.splice(0);queued.forEach(fn=>fn());if(!records.length&&!frames.length)return frame+1;}assert.fail('Navigation keeps scheduling updates after '+limit+' idle frames');}
  function load(file){vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),scope);}
  records=[];
  return {scope,bar,buttons,load,flush,mutate,writes:()=>writes,picker:()=>host.children[0].querySelector('select')};
}

test('section navigation settles after mounting, dynamic content and tab changes',()=>{
  const r=runtime();r.load('auris-section-picker.js');r.flush();
  assert.deepEqual(r.picker().options.map(x=>x.textContent),['Dashboard','Inspections']);
  const idle=r.writes();r.flush();assert.equal(r.writes(),idle);
  r.buttons[0].classList.remove('active');r.buttons[1].classList.add('active');r.flush();assert.equal(r.picker().value,'1');
  r.buttons[1].textContent='Inspection register';r.flush();assert.equal(r.picker().options[1].textContent,'Inspection register');
  let opened=0;r.buttons[0].listeners.click=()=>opened++;r.picker().value='0';r.picker().listeners.change();assert.equal(opened,1);
});

test('permission and section observers settle together and react to permission changes',()=>{
  const r=runtime();r.load('auris-user-access.js');r.load('auris-section-picker.js');r.flush();
  const idle=r.writes();r.scope.AurisUserAccess.applySections();r.flush();assert.equal(r.writes(),idle,'unchanged access does not rewrite hidden');
  r.scope.prof.permissions.access_v1['ppe.inspections']={view:false};r.scope.AurisUserAccess.applySections();r.flush();assert.equal(r.buttons[1].hidden,true);
  delete r.scope.prof.permissions.access_v1['ppe.inspections'];r.scope.AurisUserAccess.applySections();r.flush();assert.equal(r.buttons[1].hidden,false);
  r.mutate(r.bar,'childList');r.flush();const settled=r.writes();r.flush();assert.equal(r.writes(),settled);
});
