const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const service=require('../auris-source-action-sync.js'),core=fs.readFileSync('auris-core.js','utf8');
const COMPANY='f1280000-0000-4000-8000-000000000010',USER='f1280000-0000-4000-8000-000000000001',SOURCE='f1280000-0000-4000-8000-000000000100',ACTION='f1280000-0000-4000-8000-000000000201';
const clone=value=>JSON.parse(JSON.stringify(value));
function section(a,b){const start=core.indexOf(a),end=core.indexOf(b,start);assert.ok(start>=0&&end>start,a);return core.slice(start,end);}
function harness(options={}){
  const fields={};const field=(id,value='')=>fields[id]??(fields[id]={id,className:'',type:'text',value,checked:false,classList:{contains:()=>false}});
  for(const [id,value] of Object.entries({'inv-status-sel':options.parentStatus||'open','inv-type-sel':'incident','inv-method':'5why','ws1-description':'Entered investigation narrative','ws1-location':'Fixture workshop'}))field(id,value);
  fields['inv-form3ref']={textContent:options.new?'INV-AUTO':'INV-2026-001'};
  const rowFields={'.inv-ca-desc':field('action-desc','Repair the guard'),'.inv-ca-assigned':field('action-owner','Named owner'),'.inv-ca-due':field('action-date','2026-12-01'),'.inv-ca-status':field('action-status',options.sourceStatus||'open')};
  rowFields['.inv-ca-status'].classList={contains:name=>name==='inv-ca-status'};
  const row={dataset:{actionKey:'stable-action-key',actionId:options.newAction?'':ACTION,recordedStatus:'',actionPriority:'high',actionInitial:encodeURIComponent(JSON.stringify({description:'Repair the guard',responsible:'Named owner',target_date:'2026-12-01',priority:'high'}))},classList:{contains:name=>name==='inv-ca-row'},querySelector:selector=>rowFields[selector]||null};
  const rows=options.noActions?[]:[row];
  const original={id:SOURCE,company_id:COMPANY,status:'open',investigation_ref:'INV-2026-001',updated_at:'2026-11-28T10:00:00Z',corrective_actions:JSON.stringify([{action_key:'stable-action-key',action_id:ACTION,description:'Repair the guard',status:'open'}])};
  const database=options.new?null:clone(original),actions=options.newAction?[]:[{id:ACTION,company_id:COMPANY,source_module:'investigation',source_type:'investigation',source_id:SOURCE,source_ref:'INV-2026-001',action_no:'stable-action-key',description:'Repair the guard',title:'Repair the guard',status:options.canonicalStatus||'open',responsible:'Named owner',assigned_to_name:'Named owner',target_date:'2026-12-01',priority:'high',updated_at:'2026-11-28T10:00:00Z',evidence:'Retained verification evidence',closure_notes:'Retained closure history'}];
  let stored=database,revision=0;const requests=[],notices=[],effects=[],hydrations=[];
  const c={Date,JSON,Array,Set,Map,console,document:{getElementById:id=>fields[id]||null,querySelectorAll:selector=>selector==='.inv-ca-row'?rows:selector.includes('#ims-inv-form')?Object.values(fields).filter(item=>'value' in item):[]},
    window:null,AurisSourceActions:service,imsInvEditId:options.new?null:SOURCE,imsInvAllData:options.new?[]:[clone(original)],invTeam:[],
    prof:{id:USER,company_id:COMPANY,role:'admin',full_name:'Fixture reviewer'},ccid:()=>c.prof.company_id,activeRole:()=>c.prof.role,
    isSA:()=>false,isAdm:()=>true,isMgr:()=>true,canAccessPage:page=>page!=='actions'||!options.denyActions,workflowCanMutate:()=>true,invCanEditRecord:()=>true,
    invSaveWitnesses:async()=>effects.push('witnesses'),invRefreshSignButtons:()=>effects.push('signs'),invApplyLockMode:()=>effects.push('lock'),imsInvBack:()=>effects.push('back'),
    nextCompanyRef:async()=>{effects.push('reference');return 'INV-2026-001';},toast:(message,ok)=>notices.push({message,ok}),toastActionError:(_action,_module,error)=>notices.push({message:error.message,ok:false}),
    showPage:async(page)=>effects.push('page:'+page),mapEdit:async(id,expected)=>effects.push({type:'map',id,expected}),escH:value=>String(value).replaceAll('"','&quot;'),
    api:async(path,request={})=>{
      requests.push({path,request:clone(request)});
      if(options.before)await options.before(path,request,c,stored);
      if(path.startsWith('/action_tracker?')&&!request.m){const q=new URL(path,'https://fixture.invalid').searchParams;assert.equal(q.get('company_id'),'eq.'+COMPANY);assert.equal(q.get('source_id'),'eq.'+SOURCE);const columns=q.get('select').split(',');return actions.map(record=>Object.fromEntries(columns.map(key=>[key,record[key]??null])));}
      if(path.startsWith('/action_tracker')){
        assert.notEqual(request.m,'DELETE');
        if(request.m==='POST'){
          assert.equal(request.b.status,'open');const created={...clone(request.b),id:ACTION,updated_at:'2026-11-28T10:01:00Z'};actions.push(created);return options.rejectActionWrites?[]:[clone(created)];
        }
        assert.equal(request.m,'PATCH');assert.equal(Object.hasOwn(request.b,'status'),false);
        if(options.rejectActionWrites)return [];
        Object.assign(actions[0],clone(request.b));return [clone(actions[0])];
      }
      assert.ok(path.startsWith('/investigations'),'Writes stay inside the exact investigation and its canonical action');
      if(request.m==='POST'){
        assert.equal(stored,null,'An unconfirmed source-link save must not create a second investigation');
        assert.equal(request.b.status,'open','A new source remains editable until linked actions are confirmed');
        stored={...clone(request.b),id:SOURCE,updated_at:'2026-11-28T10:00:00Z'};return [clone(stored)];
      }
      assert.equal(request.m,'PATCH');const q=new URL(path,'https://fixture.invalid').searchParams;assert.equal(q.get('id'),'eq.'+SOURCE);assert.equal(q.get('company_id'),'eq.'+COMPANY);
      if(!request.b.status&&request.b.corrective_actions&&options.rejectClaim)return [];
      if(request.b.status&&options.rejectSource)return [];
      if(q.has('updated_at')&&q.get('updated_at')!=='eq.'+stored.updated_at)return [];
      Object.assign(stored,clone(request.b),{updated_at:`2026-11-28T10:0${++revision}:00Z`});return [clone(stored)];
    }};
  c.window=c;vm.createContext(c);
  vm.runInContext(section('var invSourceActionInstance=','async function saveInv()')+section('async function invSyncToMAP(','var invSourceActionInstance=')+section('function invCaRow(','function invAddCA()')+section('async function invSave(){','async function invReleaseForEdit(){'),c);
  const hydrate=c.invHydrateSourceActionRows;
  c.invHydrateSourceActionRows=(values,id)=>{
    hydrations.push(clone(values));for(const value of values){if(value.action_key!==row.dataset.actionKey&&value.action_id!==row.dataset.actionId)continue;row.dataset.actionKey=value.action_key;row.dataset.actionId=value.action_id||'';row.dataset.recordedStatus=value.recorded_status||'';row.dataset.investigationId=id;if(value.status)rowFields['.inv-ca-status'].value=value.status;}
  };
  return {c,fields,row,rowFields,actions,requests,notices,effects,hydrations,hydrate,stored:()=>stored,values:()=>Object.fromEntries(Object.entries(fields).filter(([,item])=>'value' in item).map(([key,item])=>[key,item.value]))};
}
test('editing a source completion updates its exact existing MAP link without closing or recreating it',async()=>{
  const h=harness({sourceStatus:'completed'});await h.c.invSave();
  assert.equal(h.actions.length,1);assert.equal(h.actions[0].id,ACTION);assert.equal(h.actions[0].status,'open');assert.equal(h.actions[0].evidence,'Retained verification evidence');
  const saved=JSON.parse(h.stored().corrective_actions);assert.equal(saved[0].action_id,ACTION);assert.equal(saved[0].status,'open');assert.equal(saved[0].recorded_status,'closed');
  assert.ok(h.notices.some(item=>/still needs.*Master Action/.test(item.message)));assert.ok(!h.effects.includes('back'),'Keep the source and review note visible while completion still requires approval');
});
test('a canonical MAP closure is persisted back into the exact source row when the investigation is saved',async()=>{
  const h=harness({sourceStatus:'open',canonicalStatus:'closed'});await h.c.invSave();
  assert.equal(JSON.parse(h.stored().corrective_actions)[0].status,'closed');assert.equal(h.actions[0].id,ACTION);assert.equal(h.actions[0].closure_notes,'Retained closure history');
  assert.equal(h.requests.filter(item=>item.path.startsWith('/action_tracker')&&item.request.m).length,0);assert.ok(h.effects.includes('back'));
});
test('saving only investigation narrative preserves newer canonical MAP owner, deadline and priority',async()=>{
  const h=harness();Object.assign(h.actions[0],{responsible:'New MAP owner',assigned_to_name:'New MAP owner',assigned_to_id:USER,target_date:'2027-01-20',priority:'critical'});
  h.fields['ws1-description'].value='Amended investigation narrative';assert.equal(await h.c.invSave(),true);
  assert.equal(h.requests.filter(item=>item.path.startsWith('/action_tracker')&&item.request.m).length,0);
  const row=JSON.parse(h.stored().corrective_actions)[0];assert.equal(row.assigned_to,'New MAP owner');assert.equal(row.due_date,'2027-01-20');assert.equal(row.priority,'critical');assert.equal(h.actions[0].assigned_to_id,USER);
});
test('editing source action description changes only that metadata, retaining newer MAP assignment and deadline',async()=>{
  const h=harness();Object.assign(h.actions[0],{responsible:'New MAP owner',assigned_to_name:'New MAP owner',assigned_to_id:USER,target_date:'2027-01-20',priority:'critical'});
  h.rowFields['.inv-ca-desc'].value='Repair and test the guard';assert.equal(await h.c.invSave(),true);
  const patch=h.requests.find(item=>item.path.startsWith('/action_tracker')&&item.request.m==='PATCH');assert.deepEqual(patch.request.b,{title:'Repair and test the guard',description:'Repair and test the guard',action_no:'stable-action-key',source_ref:'INV-2026-001'});
  assert.equal(h.actions[0].assigned_to_name,'New MAP owner');assert.equal(h.actions[0].target_date,'2027-01-20');assert.equal(h.actions[0].priority,'critical');assert.equal(h.actions[0].assigned_to_id,USER);
});
test('a source edit to closed action metadata is explicitly rejected without discarding entered fields',async()=>{
  const h=harness({canonicalStatus:'closed'}),stored=clone(h.stored());h.rowFields['.inv-ca-desc'].value='Entered amendment to a closed action';const entered=h.values();
  assert.equal(await h.c.invSave(),false);assert.deepEqual(h.values(),entered);assert.deepEqual(h.stored(),stored);assert.equal(h.actions[0].description,'Repair the guard');assert.equal(h.requests.some(item=>item.request.m),false);assert.equal(h.effects.includes('back'),false);assert.ok(h.notices.some(item=>/approved metadata cannot be changed here.*edits are retained.*Manage linked action/.test(item.message)));
});
test('closing the parent investigation never approves its open corrective actions',async()=>{
  const h=harness({parentStatus:'closed'});await h.c.invSave();assert.equal(h.stored().status,'closed');assert.equal(h.actions[0].status,'open');
  assert.ok(h.requests.every(item=>!item.path.startsWith('/action_tracker')||item.request.m!=='DELETE'));
});
test('new source retry keeps its confirmed investigation ID after an unconfirmed action insert',async()=>{
  const options={new:true,newAction:true,rejectActionWrites:true},h=harness(options),entered=h.values();
  assert.equal(await h.c.invSave(),false);assert.equal(h.c.imsInvEditId,SOURCE);assert.equal(h.stored().status,'open');assert.deepEqual(h.values(),entered);assert.equal(h.effects.includes('back'),false);
  options.rejectActionWrites=false;assert.equal(await h.c.invSave(),true);
  assert.equal(h.requests.filter(item=>item.path==='/investigations'&&item.request.m==='POST').length,1);assert.equal(h.requests.filter(item=>item.path==='/action_tracker'&&item.request.m==='POST').length,1);
  assert.equal(h.actions.length,1);assert.equal(JSON.parse(h.stored().corrective_actions)[0].action_id,ACTION);
});
test('a source save conflict retains the entered fields and does not report success or close the editor',async()=>{
  const h=harness({rejectSource:true}),entered=h.values();assert.equal(await h.c.invSave(),false);
  assert.deepEqual(h.values(),entered);assert.ok(!h.effects.includes('back'));assert.ok(h.notices.some(item=>/not confirmed/.test(item.message)));assert.ok(!h.notices.some(item=>item.message==='Investigation and linked Master Actions saved.'));
});
test('an existing source claims stable action keys under its source revision before any MAP insert',async()=>{
  const h=harness({newAction:true});assert.equal(await h.c.invSave(),true);
  const claim=h.requests.findIndex(item=>item.path.startsWith('/investigations?')&&item.request.b?.corrective_actions&&!item.request.b.status),insert=h.requests.findIndex(item=>item.path==='/action_tracker'&&item.request.m==='POST');
  assert.ok(claim>=0&&claim<insert);assert.match(h.requests[claim].path,/updated_at=eq\.2026-11-28T10%3A00%3A00Z/);assert.deepEqual(Object.keys(h.requests[claim].request.b).sort(),['corrective_actions','updated_at']);
  const claimedRows=JSON.parse(h.requests[claim].request.b.corrective_actions);assert.equal(claimedRows[0].action_key,'stable-action-key');assert.equal(Object.hasOwn(claimedRows[0],'metadata_changed_fields'),false);
  const final=h.requests.find(item=>item.path.startsWith('/investigations?')&&item.request.b?.status);assert.match(final.path,/updated_at=eq\.2026-11-28T10%3A01%3A00Z/,'Final status write uses the confirmed claim version');
});
test('a conflicting source identity claim blocks MAP insertion and retains the entered form',async()=>{
  const h=harness({newAction:true,rejectClaim:true}),entered=h.values(),saved=clone(h.stored());assert.equal(await h.c.invSave(),false);assert.deepEqual(h.values(),entered);assert.deepEqual(h.stored(),saved);assert.equal(h.requests.some(item=>item.path==='/action_tracker'&&item.request.m==='POST'),false);assert.equal(h.requests.some(item=>item.request.b?.status),false);assert.equal(h.effects.includes('back'),false);
});
test('a double click cannot create duplicate source or linked action records',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve);let started=false;
  const h=harness({new:true,newAction:true,before:async(path,request)=>{if(path==='/investigations'&&request.m==='POST'&&!started){started=true;await wait;}}});
  const pending=h.c.invSave();await h.c.invSave();assert.equal(h.requests.length,1);release();await pending;
  assert.equal(h.requests.filter(item=>item.path==='/investigations').length,1);assert.equal(h.actions.length,1);
});
test('an investigation without corrective actions can save without granting Master Action access',async()=>{
  const h=harness({noActions:true,denyActions:true});assert.equal(await h.c.invSave(),true);assert.equal(h.requests.some(item=>item.path.startsWith('/action_tracker')),false);
});
test('the legacy synchronizer preserves canonical identity rather than deleting and recreating actions',async()=>{
  const h=harness(),body={company_id:COMPANY,corrective_actions:[{action_key:'stable-action-key',action_id:ACTION,desc:'Repair the guard',resp:'Named owner',date:'2026-12-01',prio:'high',status:'closed'}]};
  const result=await h.c.invSyncToMAP(SOURCE,body);assert.equal(result.rows[0].action_id,ACTION);assert.equal(body.corrective_actions[0].status,'open');assert.equal(h.actions.length,1);assert.equal(h.requests.length,1);
});
test('source controls display pending closure explicitly and require the existing Master Action workflow',()=>{
  const h=harness(),html=h.c.invCaRow('Repair the guard','Named owner','2026-12-01','pending_closure',0,{action_key:'stable-action-key',action_id:ACTION});
  assert.match(html,/data-action-id="f1280000/);assert.match(html,/<select disabled[^>]*class="inv-ca-status"/);assert.match(html,/<option value="pending_closure" selected>/);assert.match(html,/Manage linked action/);
});
test('managing the exact linked action is blocked while source edits remain unsaved',async()=>{
  const h=harness();await h.c.invSave();h.effects.length=0;h.fields['ws1-description'].value='Unsaved narrative amendment';
  await assert.rejects(h.c.invSourceActionService().manage({module:'investigation',id:SOURCE},{action_id:ACTION}),/Save the investigation first/);assert.equal(h.effects.length,0);
});
test('the exact confirmed source action opens the established MAP editor with its saved company context',async()=>{
  const h=harness();await h.c.invSave();h.effects.length=0;
  await h.c.invSourceActionService().manage({module:'investigation',id:SOURCE},{action_id:ACTION});
  assert.equal(h.effects[0],'page:actions');assert.equal(h.effects[1].id,ACTION);assert.equal(h.effects[1].expected.companyId,COMPANY);
});
function openHarness(raw){
  const h=harness();h.c.imsInvAllData[0].corrective_actions=raw;
  h.c.document.getElementById=id=>h.fields[id]??(h.fields[id]={id,value:'',textContent:'',innerHTML:'',style:{},dataset:{},className:'',classList:{contains:()=>false},querySelectorAll:()=>[],addEventListener(){}});
  for(const name of ['imsLoadPersonnel','invRenderTeam','invLoadWitnesses','invSelectMethod','invShowTab'])h.c[name]=()=>{};
  h.c.canAdministerControlledRecord=()=>true;
  h.c.invSourceFormFingerprint=()=>'';h.c.invLoadSourceActions=(record,rows)=>h.hydrations.push(clone(rows));
  vm.runInContext(section('function imsOpenInvestigation(id){','function imsAddWhyRow('),h.c);return h;
}
test('opening a saved investigation parses its TEXT corrective-action JSON and retains exact action links',()=>{
  const h=openHarness(JSON.stringify([{description:'Repair the guard',assigned_to:'Named owner',action_id:ACTION,action_key:'stable-action-key',status:'pending_closure'}]));
  h.c.imsOpenInvestigation(SOURCE);
  assert.match(h.fields['inv-ca-body'].innerHTML,/Repair the guard/);assert.match(h.fields['inv-ca-body'].innerHTML,/data-action-id="f1280000/);assert.match(h.fields['inv-ca-body'].innerHTML,/<option value="pending_closure" selected>/);
  assert.equal(h.hydrations[0][0].action_id,ACTION);assert.equal(h.hydrations[0][0].action_key,'stable-action-key');
});
test('unreadable legacy action content blocks saving rather than silently replacing it with an empty list',async()=>{
  const raw='Legacy non-JSON corrective action record',h=openHarness(raw);h.c.imsOpenInvestigation(SOURCE);
  assert.match(h.fields['inv-ca-body'].innerHTML,/original content is retained/);assert.equal(await h.c.invSave(),false);assert.equal(h.requests.length,0);assert.equal(h.c.imsInvAllData[0].corrective_actions,raw);
});
test('a late action-status response cannot overwrite a newer source refresh',async()=>{
  const h=harness();h.fields['inv-ca-body']={querySelectorAll:()=>[]};let release,count=0;
  const row={...h.actions[0]},sourceRows=[{action_id:ACTION,action_key:'stable-action-key',description:'Repair the guard',status:'open'}];
  h.c.api=async()=>++count===1?new Promise(resolve=>release=()=>resolve([row])):[{...row,status:'closed'}];
  const first=h.c.invLoadSourceActions({id:SOURCE,company_id:COMPANY},sourceRows);
  await h.c.invLoadSourceActions({id:SOURCE,company_id:COMPANY},sourceRows);release();await first;
  assert.equal(h.hydrations.length,1);assert.equal(h.hydrations[0][0].status,'closed');
});
test('canonical refresh preserves typed source edits while refreshing unchanged assignment fields',async()=>{
  const h=harness();h.fields['inv-ca-body']={querySelectorAll:()=>[h.row]};h.c.invHydrateSourceActionRows=h.hydrate;h.c.invSourceActionSnapshot=h.c.invSourceFormFingerprint();
  h.rowFields['.inv-ca-desc'].value='An unsaved action edit';Object.assign(h.actions[0],{assigned_to_name:'New MAP owner',responsible:'New MAP owner',target_date:'2027-01-20',priority:'critical'});
  await h.c.invLoadSourceActions({id:SOURCE,company_id:COMPANY},[{action_id:ACTION,action_key:'stable-action-key',description:'Repair the guard',status:'open'}]);
  assert.equal(h.rowFields['.inv-ca-desc'].value,'An unsaved action edit');assert.equal(h.rowFields['.inv-ca-assigned'].value,'New MAP owner');assert.equal(h.rowFields['.inv-ca-due'].value,'2027-01-20');assert.equal(h.row.dataset.actionPriority,'critical');
  assert.deepEqual(Array.from(h.c.invSourceActionIdentity(h.row).metadata_changed_fields),['description']);assert.notEqual(h.c.invSourceFormFingerprint(),h.c.invSourceActionSnapshot);
});
test('saving during initial legacy lookup waits for the exact link and cannot create a duplicate after a description edit',async()=>{
  let release,first=true;const gate=new Promise(resolve=>release=resolve),h=harness({before:async(path,request)=>{if(path.startsWith('/action_tracker?')&&!request.m&&first){first=false;await gate;}}});
  h.actions[0].action_no=null;h.row.dataset.actionId='';h.fields['inv-ca-body']={querySelectorAll:()=>[h.row]};h.c.invHydrateSourceActionRows=h.hydrate;
  const loading=h.c.invLoadSourceActions({id:SOURCE,company_id:COMPANY},[{action_key:'stable-action-key',description:'Repair the guard',status:'open'}]);h.rowFields['.inv-ca-desc'].value='Repair and test the guard';
  const saving=h.c.invSave();assert.equal(h.requests.length,1);release();await loading;assert.equal(await saving,true);
  assert.equal(h.actions.length,1);assert.equal(h.requests.some(item=>item.path==='/action_tracker'&&item.request.m==='POST'),false);assert.equal(h.actions[0].description,'Repair and test the guard');assert.equal(JSON.parse(h.stored().corrective_actions)[0].action_id,ACTION);
});
test('a failed initial link lookup blocks saving and retains the entered investigation fields',async()=>{
  const h=harness({before:async(path)=>{if(path.startsWith('/action_tracker?'))throw Error('Lookup unavailable');}});h.fields['inv-ca-body']={querySelectorAll:()=>[]};
  await h.c.invLoadSourceActions({id:SOURCE,company_id:COMPANY},[{action_id:ACTION,action_key:'stable-action-key',description:'Repair the guard'}]);const entered=h.values();assert.equal(await h.c.invSave(),false);assert.deepEqual(h.values(),entered);assert.equal(h.requests.length,1);assert.ok(h.notices.some(item=>/entries are retained/.test(item.message)));
});
