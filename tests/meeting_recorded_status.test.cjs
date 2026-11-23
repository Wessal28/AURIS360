const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const core=fs.readFileSync('auris-core.js','utf8');
const reliability=fs.readFileSync('meeting-reliability.js','utf8');
function section(start,end){const a=core.indexOf(start),b=core.indexOf(end,a);assert.ok(a>=0&&b>a,start);return core.slice(a,b);}
function decode(value){return value.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
function selectedOption(html){const option=/<option value="([^"]*)" selected>([\s\S]*?)<\/option>/.exec(html);assert.ok(option,'The saved recorded status must remain selected');return {value:decode(option[1]),label:decode(option[2])};}

function runtime(recorded='closed'){
  const requests=[],messages=[],navigation=[],buttons=[{disabled:false},{disabled:false}];
  const form={dataset:{editVersion:'editor-a',editCompany:'company-a',editUser:'user-a',timezone:'Asia/Dubai',savedUpdatedAt:'2026-11-20T05:00:00Z'},querySelectorAll:()=>buttons,prepend(node){elements[node.id]=node;}};
  const elements={'mtg-mom3form':form};
  for(const [id,value] of Object.entries({mom3title:'Fictional reviewed minutes',mom3date:'2026-01-15T09:00',mom3type:'management_review',mom3notes:'Edited discussion retained',mom3location:'Fictional office',mom3status:'completed','mom3next-date':'2026-04-15'}))elements[id]={value};
  const fields={'.mom3rec-desc':{value:'Recorded follow-up'},'.mom3rec-resp':{value:'Fictional owner'},'.mom3rec-date':{value:'2026-02-01'},'.mom3rec-prio':{value:'high'},'.mom3rec-status':{value:recorded}};
  const row={dataset:{recommendationKey:'stable-recommendation-key'},querySelector:selector=>fields[selector]||null};
  const c={Date,Intl,Map,Set,crypto:require('node:crypto').webcrypto,
    document:{addEventListener(){},getElementById:id=>elements[id],querySelectorAll:selector=>selector==='#mom3rec-body tr'?[row]:[],createElement:()=>({setAttribute(){}})},
    ccid:()=> 'company-a',prof:{id:'user-a'},isMgr:()=>true,mtgMinutesData:[],mtgEditingMomId:'minute-a',mapAllData:[],
    toast:(...args)=>messages.push(args),toastActionError:(_action,_module,error)=>messages.push([error.message,false]),
    mtgCollectAgenda:()=>[{item:'Review',notes:'Edited discussion retained'}],mtgCollectSignoff:()=>({chair:'Fictional chair'}),mtgCollectMeta:()=>({}),
    momGetAttendees:()=> 'Fictional attendees',momGetApologies:()=>'',personFromValue:()=>null,personIdsFromText:()=>[],
    mtgBuildAgendaPayload:agenda=>agenda,mtgBuildRecommendationPayload:recs=>recs,mtgMomBack:()=>navigation.push('back')};
  c.window=c;vm.createContext(c);vm.runInContext(reliability,c);
  vm.runInContext(section('function escH2(str){','async function saveMtg()')+section('function mtgCollectRecs(){','function mtgCollectAgenda(){')+
    'var mtgSavingMom=false,mtgMinutesRemovalPending=false;'+section('async function mtgSaveMom(){','async function mtgDeleteMom(){'),c);
  c.api=async(path,request)=>{requests.push({path,request:JSON.parse(JSON.stringify(request))});return {minutes:{...request.b.p_minutes,id:request.b.p_id,updated_at:'2026-11-23T06:00:00Z'},actions:[{id:'action-a',company_id:'company-a',status:'open'}]};};
  return {c,requests,messages,navigation,buttons,form,elements,fields};
}

test('the recorded-status control selects each normal saved value and defaults only missing values to open',()=>{
  const h=runtime();
  for(const [value,label] of [['open','Open'],['in_progress','In progress'],['closed','Closed']]){
    const html=h.c.mtgRecordedStatusOptions(value);
    assert.deepEqual(selectedOption(html),{value,label});
    assert.equal((html.match(/ selected/g)||[]).length,1);
  }
  for(const value of [undefined,null,''])assert.equal(selectedOption(h.c.mtgRecordedStatusOptions(value)).value,'open');
});

test('legacy workflow values stay selected rather than becoming Open during an unrelated minutes edit',()=>{
  const h=runtime();
  for(const value of ['pending_closure','verification','cancelled','on_hold','completed']){
    const html=h.c.mtgRecordedStatusOptions(value);
    assert.equal(selectedOption(html).value,value);
    assert.match(selectedOption(html).label,/\(recorded\)$/);
    assert.equal((html.match(/ selected/g)||[]).length,1);
  }
});

test('unknown recorded values are escaped in both option attributes and visible labels',()=>{
  const h=runtime(),value='legacy\"><img src=x onerror="bad"> & review';
  const html=h.c.mtgRecordedStatusOptions(value);
  assert.equal(selectedOption(html).value,value);
  assert.doesNotMatch(html,/<img|onerror="bad"/);
  assert.match(html,/&quot;&gt;&lt;img/);
  assert.match(html,/&amp; review/);
});

test('saving minutes transmits the recorded value unchanged and accepts the separate live Master Action state',async()=>{
  for(const value of ['closed','pending_closure','cancelled']){
    const h=runtime(value);
    // Model the browser's selected value after opening the saved recommendation.
    h.fields['.mom3rec-status'].value=selectedOption(h.c.mtgRecordedStatusOptions(value)).value;
    await h.c.mtgSaveMom();
    assert.equal(h.requests.length,1);
    assert.equal(h.requests[0].path,'/rpc/save_hse_minutes');
    assert.equal(h.requests[0].request.b.p_id,'minute-a');
    assert.equal(h.requests[0].request.b.p_minutes.recommendations[0].status,value);
    assert.equal(h.requests[0].request.b.p_minutes.recommendations[0].key,'stable-recommendation-key');
    assert.equal(h.requests[0].request.b.p_minutes.status,'completed');
    assert.equal(h.c.mtgMinutesData[0].recommendations[0].status,value);
    assert.equal(h.c.mapAllData[0].status,'open','The live action response must remain distinct from the recorded minutes value');
    assert.deepEqual(h.navigation,['back']);
  }
});

test('a closure failure retains edited minutes, recommendation status and concurrency token for a safe retry',async()=>{
  const h=runtime('closed');
  h.c.api=async(path,request)=>{h.requests.push({path,request});throw Error('Submit the action for closure before approving it.');};
  await h.c.mtgSaveMom();
  assert.equal(h.elements.mom3notes.value,'Edited discussion retained');
  assert.equal(h.elements.mom3status.value,'completed');
  assert.equal(h.fields['.mom3rec-status'].value,'closed');
  assert.equal(h.form.dataset.savedUpdatedAt,'2026-11-20T05:00:00Z');
  assert.equal(h.form.dataset.pendingMinutesId,'minute-a');
  assert.match(h.elements['mtg-save-error'].textContent,/Your entries are retained/);
  assert.deepEqual(h.navigation,[]);
  assert.ok(h.buttons.every(button=>!button.disabled));
  assert.equal(h.c.mtgSavingMom,false);
});

test('new and existing recommendation editors use the preserving control and label it separately from action approval',()=>{
  const add=section('function mtgAddRec(){','function mtgCollectRecs(){');
  const open=section('async function mtgOpenMom(id){','async function mtgDeleteMomFromList(');
  assert.match(add,/mtgRecordedStatusOptions\('open'\)/);
  assert.match(open,/mtgRecordedStatusOptions\(r\.status\)/);
  assert.match(core,/\['Recorded status','status'\]/);
  const index=fs.readFileSync('index.html','utf8');
  const recommendations=index.slice(index.indexOf('<!-- Recommendations / Action plan -->'),index.indexOf('<!-- -- TRAINING MATRIX -- -->'));
  assert.match(recommendations,/>Recorded status<\/th>/);
  assert.match(recommendations,/Approve closure or reopen actions in Master Action Plan/);
});
