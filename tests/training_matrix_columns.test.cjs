const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const matrixSource=()=>fs.readFileSync('training-matrix.js','utf8');
const workflowSource=fs.readFileSync('training-workflow.js','utf8');
const clone=value=>JSON.parse(JSON.stringify(value));

class Element{
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.doc=doc;this.children=[];this.listeners={};this.attributes={};this.hidden=false;this.disabled=false;this.value='';this.checked=false;this._text='';this._html='';}
  appendChild(child){this.children.push(child);child.parentElement=this;return child;}
  append(...children){children.forEach(child=>this.appendChild(child));}
  replaceChildren(...children){this.children.forEach(child=>child.parentElement=null);this.children=[];this.append(...children);}
  set textContent(value){this._text=String(value??'');this.replaceChildren();}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(value){this._html=String(value);this.replaceChildren();}
  get innerHTML(){return this._html;}
  get elements(){return this.all().filter(node=>['INPUT','SELECT','TEXTAREA','BUTTON'].includes(node.tagName));}
  get isConnected(){return this===this.doc.body||!!this.parentElement?.isConnected;}
  all(){return this.children.flatMap(child=>[child,...child.all()]);}
  addEventListener(name,callback,options){(this.listeners[name]??=[]).push({callback,once:options?.once});}
  async trigger(name,event={}){for(const listener of [...(this.listeners[name]||[])]){if(listener.once)this.listeners[name]=this.listeners[name].filter(item=>item!==listener);await listener.callback({...event,target:event.target||this});}}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  add(option){this.appendChild(option);}
  showModal(){this.open=true;}
  close(){
    this.open=false;
    // Browsers queue the close event rather than dispatching it inside close().
    this.doc.closeEvents.push(new Promise((resolve,reject)=>queueMicrotask(()=>this.trigger('close').then(resolve,reject))));
  }
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
  focus(){this.doc.activeElement=this;}
  querySelectorAll(selector){return this.all().filter(node=>selector==='input:checked'?node.tagName==='INPUT'&&node.checked:selector==='button'?node.tagName==='BUTTON':selector==='input'?node.tagName==='INPUT':selector==='form'?node.tagName==='FORM':selector.startsWith('.')?String(node.className||'').split(/\s+/).includes(selector.slice(1)):false);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}

function runtime(options={}){
  let company='company-a',manager=true,permission=true;
  const requests=[],messages=[],audits=[];
  const doc={closeEvents:[],createElement:tag=>new Element(tag,doc),getElementById:id=>doc.body.all().find(node=>node.id===id)||null};
  doc.body=new Element('body',doc);
  const controls={};
  for(const id of ['cm3table','cm3reset-btn','cm3rows-btn','cm3columns-btn','cm3add-comp-btn']){const node=doc.createElement(id==='cm3table'?'div':'button');node.id=id;node.hidden=true;doc.body.appendChild(node);controls[id]=node;}
  const tables={
    people:[{id:'learner',company_id:company,first_name:'Fictional',last_name:'Learner',job_title:'Technician',status:'active'}],
    competencies:[{id:'fire',company_id:company,name:'Fire safety',category:'General',sort_order:0},{id:'aid',company_id:company,name:'First aid',category:null,sort_order:1}],
    competency_matrix:[{id:'assessment',company_id:company,person_id:'learner',competency_id:'fire',current_level:0,required_level:2,notes:'Observed assessment',supporting_training_id:'training-evidence'}],
    training_matrix_settings:[{company_id:company,person_ids:null,competency_ids:options.selected??null}]
  };
  function matches(record,search){
    for(const [key,value] of search){if(['select','order','limit','offset'].includes(key))continue;if(value==='is.null'&&record[key]!=null)return false;if(value.startsWith('eq.')&&String(record[key])!==value.slice(3))return false;}
    return true;
  }
  const api=async(path,request={})=>{
    requests.push({path,request:clone(request)});
    if(path==='/rpc/set_training_matrix_members'){
      const body=request.b;assert.equal(body.p_company_id,company);assert.equal(body.p_axis,'columns');
      const row=tables.training_matrix_settings[0];row.competency_ids=body.p_add?Array.from(new Set((row.competency_ids||tables.competencies.map(item=>item.id)).concat(body.p_ids))):clone(body.p_ids);
      if(options.layoutResponse)return options.layoutResponse(clone(row));
      return clone(row);
    }
    const url=new URL(path,'https://api.test'),table=url.pathname.slice(1);
    if(table==='training_matrix_settings'&&options.settingsAvailable===false)throw Error('training_matrix_settings does not exist in the schema cache');
    const records=(tables[table]||[]).filter(record=>matches(record,url.searchParams));
    if(request.m==='PATCH'){
      if(options.renameResponse)return options.renameResponse(path,request,records);
      records.forEach(record=>Object.assign(record,request.b));return clone(records);
    }
    assert.ok(!request.m||request.m==='GET','Unexpected mutation: '+request.m+' '+path);
    return clone(records);
  };
  const c={Date,Intl,URL,Map,Set,console,document:doc,Option:function(text,value){const node=doc.createElement('option');node.textContent=text;node.value=value;return node;},
    ccid:()=>company,prof:{id:'manager-a'},sephsCompanyContext:company,isSA:()=>false,isMgr:()=>manager,
    AurisUserAccess:{requestIssue:()=>permission?null:'Denied'},api,apiAllRows:api,
    cmPeople:[],cmCompetencies:[],cmAllData:[],LEVEL_COLORS:['0','1','2','3','4'],LEVEL_TEXT:['0','1','2','3','4'],
    escH:value=>String(value??'').replace(/[&<>\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char])),
    personFullName:person=>[person.first_name,person.last_name].filter(Boolean).join(' '),sidebarViewedCompany:()=>({name:'Fictional Company'}),
    registerErrorHtml:(_scope,message)=>'<p>'+message+'</p>',toast:(...args)=>messages.push(args),toastActionError:(...args)=>messages.push(args),trainingAudit:(...args)=>audits.push(args)
  };
  c.window=c;vm.createContext(c);vm.runInContext(workflowSource,c);vm.runInContext(matrixSource(),c);
  const dialog=()=>doc.getElementById('training-matrix-dialog');
  const choices=()=>dialog()?.all().filter(node=>node.tagName==='INPUT'&&node.type==='checkbox')||[];
  const settleDialogs=async()=>{while(doc.closeEvents.length)await Promise.all(doc.closeEvents.splice(0));};
  const save=async()=>{const form=dialog()?.querySelector('form');assert.ok(form,'Expected an open matrix form');await form.trigger('submit',{preventDefault(){}});await settleDialogs();};
  const button=(name,root=dialog())=>root?.all().find(node=>node.tagName==='BUTTON'&&node.textContent===name);
  const field=label=>dialog()?.all().find(node=>node.tagName==='LABEL'&&node.textContent===label)?.children.find(node=>['INPUT','SELECT','TEXTAREA'].includes(node.tagName));
  return {c,doc,controls,tables,requests,messages,audits,dialog,choices,save,button,field,
    company:value=>company=value,deny:()=>permission=false,employee:()=>manager=false,
    async load(){await c.AurisTrainingMatrix.load();},
    async manage(){await this.load();assert.equal(controls['cm3columns-btn'].hidden,false);controls['cm3columns-btn'].onclick();assert.ok(dialog());},
    async edit(id='fire'){
      const item=tables.competencies.find(row=>row.id===id);
      const edit=dialog()?.all().find(node=>node.tagName==='BUTTON'&&node.getAttribute('aria-label')==='Edit '+item.name+' column');
      assert.ok(edit,'Expected a named Edit control for '+item.name);await edit.trigger('click');await settleDialogs();
      assert.ok(field('Column name'),'Expected the column editor');
    }
  };
}

test('managing columns removes a selected column through layout settings and retains assessment evidence',async()=>{
  const h=runtime(),before=clone(h.tables);
  await h.manage();
  assert.equal(h.choices().length,2);
  assert.ok(h.choices().every(input=>input.checked));
  h.choices().find(input=>input.value==='fire').checked=false;
  await h.save();
  const writes=h.requests.filter(({request})=>request.m);
  assert.equal(writes.length,1);
  assert.equal(writes[0].path,'/rpc/set_training_matrix_members');
  assert.deepEqual(writes[0].request.b,{p_company_id:'company-a',p_axis:'columns',p_ids:['aid'],p_add:false});
  assert.deepEqual(h.tables.competency_matrix,before.competency_matrix);
  assert.deepEqual(h.tables.competencies,before.competencies);
  assert.deepEqual(h.tables.people,before.people);
  assert.doesNotMatch(h.controls.cm3table.innerHTML,/Fire safety/);
  assert.match(h.controls.cm3table.innerHTML,/First aid/);
});

test('managers can remove every column and restore recorded cells by selecting the competency again',async()=>{
  const h=runtime();await h.manage();
  h.choices().forEach(input=>input.checked=false);await h.save();
  assert.deepEqual(h.tables.training_matrix_settings[0].competency_ids,[]);
  assert.match(h.controls.cm3table.innerHTML,/No columns/);
  h.controls['cm3columns-btn'].onclick();
  assert.ok(h.choices().every(input=>!input.checked));
  h.choices().find(input=>input.value==='fire').checked=true;await h.save();
  assert.deepEqual(h.tables.training_matrix_settings[0].competency_ids,['fire']);
  assert.match(h.controls.cm3table.innerHTML,/Fire safety/);
  assert.match(h.controls.cm3table.innerHTML,/>0</);
  assert.equal(h.tables.competency_matrix[0].supporting_training_id,'training-evidence');
});

test('column management is unavailable without the matrix settings upgrade or edit access',async()=>{
  const absent=runtime({settingsAvailable:false});await absent.load();assert.equal(absent.controls['cm3columns-btn'].hidden,true);
  const denied=runtime();denied.deny();await denied.load();assert.equal(denied.controls['cm3columns-btn'].hidden,true);
  const employee=runtime();employee.employee();await employee.load();assert.equal(employee.controls['cm3columns-btn'].hidden,true);
});

test('an account or permission change while column choices are open prevents the layout write',async()=>{
  for(const change of [h=>h.company('company-b'),h=>h.c.prof.id='another-user',h=>h.deny(),h=>h.employee()]){
    const h=runtime();await h.manage();h.choices()[0].checked=false;change(h);await h.save();
    assert.equal(h.requests.filter(({request})=>request.m).length,0);
    assert.equal(h.dialog()?.open,true);
    assert.match(h.dialog().textContent,/changed|access|permission/i);
    assert.equal(h.choices()[0].checked,false);
  }
});

test('a wrong returned company or column roster keeps column selections open instead of reporting success',async()=>{
  for(const response of [row=>({...row,company_id:'company-b'}),row=>({...row,competency_ids:null}),row=>({...row,competency_ids:['fire','aid']})]){
    const h=runtime({layoutResponse:response});await h.manage();
    h.choices().find(input=>input.value==='fire').checked=false;await h.save();
    assert.equal(h.requests.filter(({request})=>request.m).length,1);
    assert.ok(h.dialog()?.open);assert.match(h.dialog().textContent,/could not be confirmed/i);
    assert.equal(h.choices().find(input=>input.value==='fire').checked,false);
    assert.equal(h.messages.filter(([message])=>message==='Matrix columns saved.').length,0);
  }
});

test('editing a column keeps its identity and evidence and returns to the pending column selection',async()=>{
  const h=runtime(),before=clone(h.tables.competency_matrix);await h.manage();
  const picker=h.dialog();
  h.choices().find(input=>input.value==='aid').checked=false;
  await h.edit();
  assert.equal(picker.isConnected,false,'Queued picker close must finish before the editor opens');
  assert.equal(h.doc.body.all().filter(node=>node.tagName==='DIALOG').length,1);
  h.field('Column name').value='  Fire & <rescue>  ';
  h.field('Category').value='  Emergency response  ';
  await h.save();
  const writes=h.requests.filter(({request})=>request.m);
  assert.equal(writes.length,1);
  assert.equal(writes[0].request.m,'PATCH');
  assert.equal(writes[0].request.p,'return=representation');
  const query=new URL(writes[0].path,'https://api.test').searchParams;
  assert.equal(query.get('id'),'eq.fire');assert.equal(query.get('company_id'),'eq.company-a');
  assert.equal(query.get('name'),'eq.Fire safety');assert.equal(query.get('category'),'eq.General');
  assert.deepEqual(writes[0].request.b,{name:'Fire & <rescue>',category:'Emergency response'});
  assert.deepEqual(h.tables.competency_matrix,before);
  assert.equal(h.tables.competencies[0].id,'fire');
  assert.equal(h.audits.length,1);
  assert.match(h.controls.cm3table.innerHTML,/Fire &amp; &lt;rescue&gt;/);
  assert.doesNotMatch(h.controls.cm3table.innerHTML,/<rescue>/);
  assert.ok(h.dialog()?.open);
  assert.equal(h.doc.body.all().filter(node=>node.tagName==='DIALOG').length,1,'Queued editor close must leave one manager dialog');
  assert.deepEqual(h.choices().map(input=>[input.value,input.checked]),[['fire',true],['aid',false]]);
  assert.equal(h.tables.training_matrix_settings[0].competency_ids,null,'Editing must not silently save the layout choices');
});

test('renaming a column with no category matches NULL and can clear its new category',async()=>{
  const h=runtime();await h.manage();await h.edit('aid');
  h.field('Column name').value='Emergency first aid';h.field('Category').value='  ';
  await h.save();
  const write=h.requests.find(({request})=>request.m==='PATCH');
  assert.equal(new URL(write.path,'https://api.test').searchParams.get('category'),'is.null');
  assert.equal(write.request.b.category,null);
  assert.equal(h.tables.competencies[1].name,'Emergency first aid');
  assert.equal(h.tables.competencies[1].id,'aid');
});

test('stale column edits are rejected without replacing another manager\'s name or discarding typed input',async()=>{
  const h=runtime();await h.manage();await h.edit();
  h.tables.competencies[0].name='Changed by another manager';
  h.field('Column name').value='My proposed name';
  await h.save();
  assert.equal(h.tables.competencies[0].name,'Changed by another manager');
  assert.equal(h.audits.length,0);
  assert.ok(h.dialog()?.open);
  assert.equal(h.field('Column name').value,'My proposed name');
  assert.match(h.dialog().textContent,/changed|could not be confirmed/i);
});

test('column edits require current manager access and the original account and company',async()=>{
  for(const change of [h=>h.company('company-b'),h=>h.c.prof.id='another-user',h=>h.deny(),h=>h.employee()]){
    const h=runtime();await h.manage();await h.edit();h.field('Column name').value='Proposed name';change(h);await h.save();
    assert.equal(h.requests.filter(({request})=>request.m).length,0);
    assert.equal(h.audits.length,0);assert.ok(h.dialog()?.open);
    assert.match(h.dialog().textContent,/changed|access|permission/i);
  }
});

test('a save response for another competency or company does not confirm the column edit',async()=>{
  for(const changed of [{id:'different-column'},{company_id:'company-b'}]){
    const h=runtime({renameResponse:(_path,request,records)=>[{...records[0],...request.b,...changed}]});
    await h.manage();await h.edit();h.field('Column name').value='Proposed name';await h.save();
    assert.equal(h.audits.length,0);assert.ok(h.dialog()?.open);
    assert.equal(h.field('Column name').value,'Proposed name');
    assert.match(h.dialog().textContent,/could not be confirmed/i);
  }
});

test('an empty competency name cannot be submitted',async()=>{
  const h=runtime();await h.manage();await h.edit();h.field('Column name').value='  ';await h.save();
  assert.equal(h.requests.filter(({request})=>request.m).length,0);assert.ok(h.dialog()?.open);
  assert.match(h.dialog().textContent,/Enter a column name/);
});

test('the printed matrix follows managed columns and restored columns retain their recorded levels',async()=>{
  const h=runtime();vm.runInContext(fs.readFileSync('training-print-reports.js','utf8'),h.c);
  const report=()=>h.c.AurisTrainingPrint.buildRows('matrix',{...h.tables,matrixSettings:h.tables.training_matrix_settings[0]},null,'A4').html;
  await h.manage();h.choices().find(input=>input.value==='fire').checked=false;await h.save();
  assert.doesNotMatch(report(),/Fire safety|0 \/ 2/);assert.match(report(),/First aid/);
  h.controls['cm3columns-btn'].onclick();h.choices().find(input=>input.value==='fire').checked=true;await h.save();
  assert.match(report(),/Fire safety/);assert.match(report(),/0 \/ 2/);
});
