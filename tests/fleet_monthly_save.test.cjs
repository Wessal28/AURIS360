const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const copy=value=>JSON.parse(JSON.stringify(value));
const inspectionId='f2400000-0000-4000-8000-000000000001';
const decode=value=>String(value).replace(/&quot;/g,'"').replace(/&#39;|&#x27;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');

// Parse the actual dialog markup, so assertions exercise the same controls and
// event handlers used in the app without depending on an installed browser.
class Element{
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.doc=doc;this.children=[];this.listeners={};this.attributes={};this.dataset={};this.style={};this.disabled=false;this.hidden=false;this._value='';this._selectedOption=null;this._hasValue=false;this._text='';}
  appendChild(child){child.remove();this.children.push(child);child.parentElement=this;if(this.tagName==='SELECT'&&child.tagName==='OPTION'&&!this._selectedOption)this._selectedOption=child;return child;}
  append(...nodes){nodes.forEach(node=>this.appendChild(node));}
  prepend(node){node.remove();this.children.unshift(node);node.parentElement=this;}
  replaceChildren(...nodes){this.children.forEach(node=>node.parentElement=null);this.children=[];this._text='';this._selectedOption=null;this.append(...nodes);}
  before(node){if(!this.parentElement)return;node.remove();const parent=this.parentElement;parent.children.splice(parent.children.indexOf(this),0,node);node.parentElement=parent;}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}
  get options(){return this.tagName==='SELECT'?this.all().filter(node=>node.tagName==='OPTION'):undefined;}
  get selectedOptions(){return this.tagName==='SELECT'?this.options.filter(node=>node===this._selectedOption):undefined;}
  get value(){
    if(this.tagName==='SELECT')return this.options.find(node=>node===this._selectedOption)?.value||'';
    if(this.tagName==='OPTION'&&!this._hasValue)return this.textContent;
    return this._value;
  }
  set value(value){
    if(this.tagName==='SELECT'){this._selectedOption=this.options.find(node=>node.value===String(value))||null;return;}
    this._value=String(value??'');this._hasValue=true;
  }
  get isConnected(){return this===this.doc.body||!!this.parentElement?.isConnected;}
  all(){return this.children.flatMap(node=>[node,...node.all()]);}
  set textContent(value){this.replaceChildren();this._text=String(value??'');}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  set innerHTML(value){
    this.replaceChildren();this._html=String(value);const stack=[this];
    for(const token of this._html.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g)||[]){
      if(token.startsWith('<!--'))continue;
      if(token.startsWith('</')){stack.pop();continue;}
      if(!token.startsWith('<')){stack.at(-1)._text+=decode(token);continue;}
      const tag=/^<([\w-]+)/.exec(token)?.[1];if(!tag)continue;
      const node=this.doc.createElement(tag);
      for(const match of token.slice(tag.length+1,-1).matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))node.setAttribute(match[1],decode(match[2]??match[3]??match[4]??''));
      stack.at(-1).appendChild(node);
      if(!/^(input|br|hr|img|meta|link)$/i.test(tag)&&!token.endsWith('/>'))stack.push(node);
    }
  }
  get innerHTML(){return this._html||'';}
  setAttribute(name,value){
    this.attributes[name]=String(value);
    if(name==='id')this.id=String(value);
    if(name==='class')this.className=String(value);
    if(name==='value')this.value=String(value);
    if(name==='disabled')this.disabled=true;
    if(name==='hidden')this.hidden=true;
    if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_m,c)=>c.toUpperCase())]=String(value);
  }
  getAttribute(name){return this.attributes[name]??null;}
  removeAttribute(name){delete this.attributes[name];if(name==='disabled')this.disabled=false;}
  matches(selector){
    const attribute=/\[([^=\]]+)(?:="([^"]*)")?\]/.exec(selector);
    if(attribute&&(this.getAttribute(attribute[1])===null||(attribute[2]!==undefined&&this.getAttribute(attribute[1])!==attribute[2])))return false;
    const plain=selector.replace(/\[[^\]]+\]/g,'');
    if(plain.startsWith('#'))return this.id===plain.slice(1);
    if(plain.startsWith('.'))return String(this.className||'').split(/\s+/).includes(plain.slice(1));
    return !plain||this.tagName===plain.toUpperCase();
  }
  querySelectorAll(selector){const choices=selector.split(',').map(value=>value.trim());return this.all().filter(node=>choices.some(choice=>node.matches(choice)));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(name,callback){(this.listeners[name]??=[]).push(callback);}
  async trigger(name,event={}){for(const callback of [...(this.listeners[name]||[])])await callback({target:this,preventDefault(){},stopPropagation(){},...event});}
  focus(){this.doc.activeElement=this;}
}

function runtime(options={}){
  const state={companyId:'company-a',userId:'user-a',role:'manager',name:'Fictional Inspector'};
  const requests=[],peopleRequests=[],messages=[],events=[];
  const doc={createElement:tag=>new Element(tag,doc),getElementById:id=>doc.body.all().find(node=>node.id===id)||null};doc.body=new Element('body',doc);
  const session=()=>({...state});
  const assertSession=expected=>{
    if(['companyId','userId','role'].some(key=>state[key]!==expected[key]))throw Error('Your account, company or access changed. Reload the fleet register.');
    return session();
  };
  const c={Date,Intl,Map,Set,URL,URLSearchParams,console,document:doc,
    fleetVehicles:[{id:'vehicle-a',company_id:'company-a',is_vehicle:true,vehicle_type:'car',registration_number:'FLEET-001',...options.vehicle}],
    TOOL_INSPECTION_CHECKLISTS:{vehicle:['Tyres and wheels','Brakes and steering']},
    AurisFleetListWorkspace:{session,assertSession},ccid:()=>state.companyId,isMgr:()=>state.role==='manager',
    prof:{id:'user-a',full_name:'Fictional Inspector'},escH:value=>String(value),fleetLabel:vehicle=>vehicle.registration_number,
    toast:(message,ok)=>messages.push([String(message),ok]),toastActionError:(_action,_module,error)=>messages.push([String(error.message),false]),
    loadFleet:async()=>{events.push({type:'refresh',modalOpen:!!doc.getElementById('fleet-check-modal')});if(options.refresh)await options.refresh();}
  };
  let payload;
  c.api=async(path,request={})=>{
    if(path.startsWith('/people?')){
      peopleRequests.push({path,request:copy(request)});
      return typeof options.people==='function'?await options.people():copy(options.people||[]);
    }
    requests.push({path,request:copy(request)});
    if(path==='/rpc/record_fleet_monthly_check'){
      payload=copy(request.b);
      return options.rpc?await options.rpc(payload):inspectionId;
    }
    assert.match(path,/^\/tool_inspections\?/,'Confirm through the saved inspection table');
    const search=new URL(path,'https://example.test').searchParams;
    assert.equal(search.get('id'),'eq.'+inspectionId);
    assert.equal(search.get('company_id'),'eq.company-a');
    assert.equal(search.get('tool_id'),'eq.vehicle-a');
    const row={id:inspectionId,company_id:payload.p_company_id,tool_id:payload.p_vehicle_id,inspection_date:payload.p_inspection_date,inspection_type:'periodic',inspected_by_name:payload.p_inspector_name,overall_result:payload.p_checklist.some(item=>item.result==='fail')?'fail':'pass',checklist_results:copy(payload.p_checklist),defects_found:payload.p_defects,actions_taken:payload.p_actions};
    return options.read?await options.read(row):[row];
  };
  c.window=c;vm.createContext(c);
  const records=fs.readFileSync('auris-fleet-records.js','utf8');
  const guard=records.match(/function fleetAssertEditor\(current\)\{[^\n]*\}/)?.[0];assert.ok(guard,'Use the fleet editor guard');
  vm.runInContext(guard,c);
  const source=fs.readFileSync('auris-core.js','utf8'),start=source.indexOf('function fleetMonthlyCheck(id){'),end=source.indexOf('\nasync function fleetFuelNew(',start);
  assert.ok(start>=0&&end>start,'Load the live monthly-check handler');vm.runInContext(source.slice(start,end),c);
  const open=()=>c.fleetMonthlyCheck('vehicle-a');
  const modal=()=>doc.getElementById('fleet-check-modal');
  const save=()=>modal().querySelector('.fleet-check-save');
  const fill=()=>{
    const form=modal(),checks=form.querySelectorAll('.fleet-check-item'),notes=form.querySelectorAll('.fleet-check-note');
    checks[0].value='fail';notes[0].value='Tyre is damaged';checks[1].value='na';notes[1].value='Vehicle is immobilised';
    form.querySelector('#fleet-check-date').value='2026-11-23';form.querySelector('#fleet-check-defects').value='Retain this defect';form.querySelector('#fleet-check-actions').value='Repair before release';
  };
  const entries=()=>modal().querySelectorAll('input,select,textarea').map(node=>({id:node.id||null,label:node.dataset.label||null,value:node.value}));
  return {c,state,requests,peopleRequests,messages,events,doc,open,modal,save,fill,entries};
}

test('missing monthly-check RPC keeps every field in an editable dialog and reports a useful setup error',async()=>{
  let missing=true;
  const h=runtime({rpc:async()=>{if(missing)throw Error('Could not find the function public.record_fleet_monthly_check(p_actions, p_checklist, p_company_id, p_defects, p_inspection_date, p_inspector_name, p_vehicle_id) in the schema cache');return inspectionId;}});
  h.open();h.fill();const entered=h.entries();await h.save().trigger('click');
  assert.ok(h.modal());assert.deepEqual(h.entries(),entered);assert.ok(h.modal().querySelectorAll('input,select,textarea').every(node=>!node.disabled));
  assert.match(h.modal().textContent,/database|setup|update/i);assert.match(h.modal().textContent,/retain|kept|keep|unchanged/i);
  assert.doesNotMatch(h.modal().textContent,/public\.record_fleet_monthly_check|p_checklist|schema cache/);
  assert.equal(h.save().disabled,false);assert.equal(h.events.length,0);
  missing=false;await h.save().trigger('click');
  assert.equal(h.requests.filter(call=>call.path==='/rpc/record_fleet_monthly_check').length,2);assert.equal(h.modal(),null);
});

test('a double click and every close control cannot dismiss or duplicate an in-flight save',async()=>{
  let release;
  const h=runtime({rpc:()=>new Promise(resolve=>release=resolve)});h.open();h.fill();const dialog=h.modal(),button=h.save();
  const first=button.trigger('click');assert.equal(button.disabled,true);await button.trigger('click');
  for(const close of dialog.querySelectorAll('.fleet-check-close'))await close.trigger('click');
  await dialog.trigger('click');assert.equal(h.modal(),dialog);assert.equal(h.requests.length,1);
  release(inspectionId);await first;
  assert.equal(h.modal(),null);assert.equal(h.requests.filter(call=>call.path==='/rpc/record_fleet_monthly_check').length,1);
});

test('foreign-company and nonvehicle cached records cannot open an inspection editor',()=>{
  for(const vehicle of [{company_id:'company-b'},{is_vehicle:false}]){
    const h=runtime({vehicle});h.open();assert.equal(h.modal(),null);assert.equal(h.requests.length,0);assert.ok(h.messages.length);
  }
  const h=runtime();h.state.role='employee';h.open();assert.equal(h.modal(),null);assert.equal(h.requests.length,0);
});

for(const [change,value] of [['companyId','company-b'],['userId','user-b'],['role','employee']]){
  test(`${change} changes before saving preserve answers and prevent any RPC`,async()=>{
    const h=runtime();h.open();h.fill();const entered=h.entries();h.state[change]=value;await h.save().trigger('click');
    assert.equal(h.requests.length,0);assert.ok(h.modal());assert.deepEqual(h.entries(),entered);assert.equal(h.events.length,0);
  });
  test(`${change} changes while the RPC is pending cannot confirm or refresh the wrong session`,async()=>{
    let release;
    const h=runtime({rpc:()=>new Promise(resolve=>release=resolve)});h.open();h.fill();const pending=h.save().trigger('click');
    h.state[change]=value;release(inspectionId);await pending;
    assert.equal(h.requests.length,1);assert.equal(h.events.length,0);assert.ok(h.modal());
    assert.ok(!h.messages.some(([message])=>/check saved|saved in Fleet/i.test(message)));
  });
  test(`${change} changes during confirmation prevent success and any register refresh`,async()=>{
    let release,readStarted;
    const started=new Promise(resolve=>readStarted=resolve);
    const h=runtime({read:row=>new Promise(resolve=>{release=()=>resolve([row]);readStarted();})});h.open();h.fill();
    const pending=h.save().trigger('click');await started;h.state[change]=value;release();await pending;
    assert.equal(h.requests.length,2);assert.equal(h.events.length,0);assert.ok(h.modal());assert.match(h.save().textContent,/Retry confirmation/i);
    await h.save().trigger('click');assert.equal(h.requests.length,2,'A stale session cannot retry confirmation or create another inspection');
    assert.ok(!h.messages.some(([message])=>/check saved|saved in Fleet/i.test(message)));
  });
}

test('a scalar RPC receipt is verified against the saved company vehicle, date, result and checklist before success',async()=>{
  const h=runtime();h.open();h.fill();await h.save().trigger('click');
  assert.equal(h.requests.length,2);assert.equal(h.requests[0].request.b.p_inspection_date,'2026-11-23');
  assert.equal(h.requests[0].request.b.p_defects,'Retain this defect');assert.equal(h.requests[0].request.b.p_actions,'Repair before release');
  assert.equal(h.modal(),null);assert.deepEqual(h.events,[{type:'refresh',modalOpen:false}]);assert.ok(h.messages.some(([message])=>/saved/i.test(message)));
});

for(const [field,value] of [['company_id','company-b'],['tool_id','vehicle-b'],['inspection_date','2026-11-22'],['inspected_by_name','Different Inspector'],['overall_result','pass'],['checklist_results',[]]]){
  test(`a mismatching ${field} confirmation retains the receipt and never reports a successful save`,async()=>{
    const h=runtime({read:row=>[{...row,[field]:value}]});h.open();h.fill();const entered=h.entries();await h.save().trigger('click');
    assert.ok(h.modal());assert.deepEqual(h.entries(),entered);assert.equal(h.events.length,0);assert.match(h.save().textContent,/Retry confirmation/i);
    assert.ok(h.modal().querySelectorAll('input,select,textarea').every(node=>node.disabled));
    await h.save().trigger('click');assert.equal(h.requests.filter(call=>call.path==='/rpc/record_fleet_monthly_check').length,1);
    assert.equal(h.requests.length,3);assert.equal(h.events.length,0);
  });
}

test('lost confirmation locks the submitted fields and retries the same UUID without creating another inspection',async()=>{
  let reads=0;
  const h=runtime({read:row=>{if(++reads===1)throw Error('Connection timed out');return [row];}});h.open();h.fill();const entered=h.entries();await h.save().trigger('click');
  assert.ok(h.modal());assert.deepEqual(h.entries(),entered);assert.match(h.save().textContent,/Retry confirmation/i);assert.equal(h.save().disabled,false);
  assert.ok(h.modal().querySelectorAll('input,select,textarea').every(node=>node.disabled));assert.equal(h.events.length,0);
  await h.save().trigger('click');
  assert.equal(h.modal(),null);assert.equal(h.requests.filter(call=>call.path==='/rpc/record_fleet_monthly_check').length,1);
  assert.equal(h.requests.filter(call=>call.path.startsWith('/tool_inspections?')).length,2);assert.deepEqual(h.events,[{type:'refresh',modalOpen:false}]);
});

test('a confirmed save closes before a failed register refresh and cannot be retried as a new inspection',async()=>{
  const h=runtime({refresh:async()=>{throw Error('Register connection timed out');}});h.open();h.fill();const button=h.save();await button.trigger('click');
  assert.equal(h.modal(),null);assert.deepEqual(h.events,[{type:'refresh',modalOpen:false}]);
  assert.ok(h.messages.some(([message])=>/saved[\s\S]*refresh|refresh[\s\S]*saved/i.test(message)));
  await button.trigger('click');assert.equal(h.requests.filter(call=>call.path==='/rpc/record_fleet_monthly_check').length,1);
});


const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function chooseOther(h,name){
  const form=h.modal(),inspector=form.querySelector('#fleet-check-inspector');
  inspector.value='__other__';await inspector.trigger('change');
  const other=form.querySelector('#fleet-check-inspector-other');assert.ok(other,'A separate field accepts another inspector name');
  other.value=name;return other;
}
function visible(node){for(let current=node;current;current=current.parentElement)if(current.hidden)return false;return true;}

test('inspector defaults to the signed-in user and saves another entered, trimmed name',async()=>{
  const h=runtime();h.open();const inspector=h.modal().querySelector('#fleet-check-inspector');
  assert.equal(inspector.tagName,'SELECT','Use a real dropdown whose full employee list remains available with a default value');
  assert.equal(inspector.value,'Fictional Inspector');assert.equal(inspector.disabled,false);
  await chooseOther(h,'  Selected Inspector  ');h.fill();await h.save().trigger('click');
  assert.equal(h.requests[0].request.b.p_inspector_name,'Selected Inspector');
  assert.equal(h.requests[0].request.b.p_created_by,undefined,'The inspector is separate from the authenticated save actor');
  assert.match(h.requests[1].path,/inspected_by_name/);assert.equal(h.modal(),null);
});

test('a blank custom inspector name prevents saving and leaves inspection answers intact',async()=>{
  const h=runtime();h.open();h.fill();const other=await chooseOther(h,'  '),entered=h.entries();
  await h.save().trigger('click');assert.equal(h.requests.length,0);assert.deepEqual(h.entries(),entered);
  assert.equal(other.disabled,false);assert.match(h.modal().textContent,/inspector/i);assert.equal(h.doc.activeElement,other);
});

test('a failed save retains the selected custom inspector and permits correction before retry',async()=>{
  let unavailable=true;const h=runtime({rpc:async()=>{if(unavailable)throw Error('Database is unavailable');return inspectionId;}});
  h.open();h.fill();const inspector=h.modal().querySelector('#fleet-check-inspector'),other=await chooseOther(h,'Chosen Inspector');
  await h.save().trigger('click');assert.ok(h.modal());assert.equal(inspector.value,'__other__');assert.equal(other.value,'Chosen Inspector');assert.equal(other.disabled,false);
  other.value='Replacement Inspector';unavailable=false;await h.save().trigger('click');
  const saves=h.requests.filter(call=>call.path==='/rpc/record_fleet_monthly_check');
  assert.deepEqual(saves.map(call=>call.request.b.p_inspector_name),['Chosen Inspector','Replacement Inspector']);assert.equal(h.modal(),null);
});

test('confirmation-only retry retains the custom inspector without creating another inspection',async()=>{
  let reads=0;const h=runtime({read:row=>{if(++reads===1)throw Error('Confirmation timed out');return [row];}});
  h.open();h.fill();const other=await chooseOther(h,'Chosen Inspector');await h.save().trigger('click');
  assert.ok(h.modal());assert.equal(other.disabled,true);assert.equal(other.value,'Chosen Inspector');
  await h.save().trigger('click');assert.equal(h.modal(),null);
  const saves=h.requests.filter(call=>call.path==='/rpc/record_fleet_monthly_check');assert.equal(saves.length,1);assert.equal(saves[0].request.b.p_inspector_name,'Chosen Inspector');
});

test('the dropdown shows the whole same-company employee list while retaining the current-user default',async()=>{
  const h=runtime({people:[{company_id:'company-a',first_name:'Selected',last_name:'Inspector'},{company_id:'company-a',first_name:'Another',last_name:'Employee'},{company_id:'company-b',first_name:'Foreign',last_name:'Person'}]});
  h.open();await settle();const inspector=h.modal().querySelector('#fleet-check-inspector');
  assert.equal(inspector.tagName,'SELECT');assert.equal(inspector.value,'Fictional Inspector');
  const names=inspector.options.map(option=>option.value);
  assert.ok(names.includes('Selected Inspector'));assert.ok(names.includes('Another Employee'));assert.ok(names.includes('__other__'));
  assert.ok(!names.some(name=>/Foreign/.test(name)));
  const query=new URL(h.peopleRequests[0].path,'https://example.test').searchParams;
  assert.equal(query.get('company_id'),'eq.company-a');assert.equal(query.get('status'),'eq.active');
  inspector.value='Selected Inspector';await inspector.trigger('change');h.fill();await h.save().trigger('click');
  assert.equal(h.requests[0].request.b.p_inspector_name,'Selected Inspector');assert.equal(h.modal(),null);
});

test('employee options arriving late preserve a custom inspector selected while loading',async()=>{
  let release;const h=runtime({people:()=>new Promise(resolve=>release=resolve)});h.open();const other=await chooseOther(h,'Edited While Loading');
  release([{company_id:'company-a',first_name:'Selected',last_name:'Inspector'}]);await settle();
  assert.equal(h.modal().querySelector('#fleet-check-inspector').value,'__other__');assert.equal(other.value,'Edited While Loading');assert.ok(visible(other));
  h.fill();await h.save().trigger('click');assert.equal(h.requests[0].request.b.p_inspector_name,'Edited While Loading');assert.equal(h.modal(),null);
});

test('a People loading failure is visible and another inspector can still be entered',async()=>{
  const h=runtime({people:async()=>{throw Error('People unavailable');}});h.open();await settle();
  const help=h.modal().querySelector('#fleet-check-inspector-status');assert.ok(help);assert.ok(visible(help));
  assert.match(help.textContent,/unable|could not|unavailable|cannot/i);
  await chooseOther(h,'External Inspector');h.fill();await h.save().trigger('click');
  assert.equal(h.requests[0].request.b.p_inspector_name,'External Inspector');assert.equal(h.modal(),null);
});

test('employee options arriving after a company switch cannot populate the old editor',async()=>{
  let release;const h=runtime({people:()=>new Promise(resolve=>release=resolve)});h.open();h.state.companyId='company-b';
  release([{company_id:'company-a',first_name:'Stale',last_name:'Inspector'}]);await settle();
  assert.ok(!h.modal().querySelector('#fleet-check-inspector').options.some(option=>option.value==='Stale Inspector'));
});

test('reason fields occupy space only for failed and N/A answers and retain typed notes',async()=>{
  const h=runtime();h.open();const checks=h.modal().querySelectorAll('.fleet-check-item'),notes=h.modal().querySelectorAll('.fleet-check-note');
  assert.ok(notes.every(note=>!visible(note)),'Unanswered checks do not add a row of empty reason fields');
  checks[0].value='ok';await checks[0].trigger('change');assert.equal(visible(notes[0]),false);
  checks[0].value='fail';await checks[0].trigger('change');assert.equal(visible(notes[0]),true);notes[0].value='Retain the failure reason';
  checks[0].value='ok';await checks[0].trigger('change');assert.equal(visible(notes[0]),false);assert.equal(notes[0].value,'Retain the failure reason');
  checks[0].value='na';await checks[0].trigger('change');assert.equal(visible(notes[0]),true);assert.equal(notes[0].value,'Retain the failure reason');
});

test('compact header groups inspector and inspection date without nesting checklist controls in labels',()=>{
  const h=runtime();h.open();const meta=h.modal().querySelector('.fleet-check-meta');assert.ok(meta);
  assert.ok(meta.querySelector('#fleet-check-inspector'));assert.ok(meta.querySelector('#fleet-check-date'));
  for(const check of h.modal().querySelectorAll('.fleet-check-item'))assert.notEqual(check.parentElement.tagName,'LABEL','Each result and reason has its own accessible control rather than sharing a wrapping label');
});
