const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=fs.readFileSync(path.join(__dirname,'..','auris-core.js'),'utf8');
const errorHelper=core.slice(core.indexOf('function wsTEErrorMessage('),core.indexOf('async function wsOpenToolsCheck('));
const loader=core.slice(core.indexOf('async function wsTELoadItems('),core.indexOf('function wsTESearchEquipment('));

function harness(api){
  const state={company:'company-a',work:'work-a',items:[],error:'',messages:[],renders:0,calls:[]};
  const context={
    ccid:()=>state.company,wsCurrentId:state.work,toolsAllData:[{id:'tool-a',company_id:'company-a',ref_number:'EQ-1',name:'Ladder',category:'equipment'}],
    api:async url=>{state.calls.push(url);return api(url);},
    wsTERenderItems:()=>{state.renders++;},toast:(message)=>state.messages.push(message),encodeURIComponent
  };
  vm.createContext(context);
  vm.runInContext('var wsTEItems=[],wsTELoadError="";'+errorHelper+loader,context);
  return {state,context};
}

test('linked equipment loads from the scoped link list and cached register without a second database query',async()=>{
  const {state,context}=harness(async()=>[{company_id:'company-a',work_order_id:'work-a',record_id:'tool-a',record_ref:'EQ-1'}]);
  await context.wsTELoadItems();
  assert.equal(state.calls.length,1);
  assert.match(state.calls[0],/work_schedule_links\?select=record_id,record_ref,company_id,work_order_id/);
  assert.equal(vm.runInContext('wsTEItems[0].name',context),'Ladder');
  assert.equal(vm.runInContext('wsTELoadError',context),'');
});

test('missing link table shows setup guidance instead of a false empty list',async()=>{
  const {state,context}=harness(async()=>{throw Object.assign(new Error('Could not find public.work_schedule_links in schema cache'),{code:'PGRST205'});});
  await context.wsTELoadItems();
  assert.match(vm.runInContext('wsTELoadError',context),/migration/);
  assert.equal(state.renders,1);
  assert.equal(state.messages.length,1);
  assert.match(core,/if\(wsTELoadError\)\{el.innerHTML='<div role="alert"/);
});

test('permission errors distinguish access from missing database setup',()=>{
  const {context}=harness(async()=>[]);
  assert.match(context.wsTEErrorMessage({code:'42501',message:'permission denied'}),/administrator.*Work Schedule access/);
  assert.match(context.wsTEErrorMessage(new Error('timeout')),/Check the connection/);
});

test('equipment picker distinguishes store stock from other active jobs and closed work',()=>{
  const source=core.slice(core.indexOf('function wsTEPickerOptions('),core.indexOf('function wsTEPickerRender('));
  const context={Map,String,Object};vm.createContext(context);vm.runInContext(source,context);
  const tools=[
    {id:'available',company_id:'co-a',status:'active'},
    {id:'busy',company_id:'co-a',status:'active'},
    {id:'person',company_id:'co-a',status:'active',assigned_to:'person-a'},
    {id:'broken',company_id:'co-a',status:'out_of_service'},
    {id:'foreign',company_id:'co-b',status:'active'}
  ];
  const links=[{record_id:'busy',work_order_id:'work-b'}];
  const orders=[{id:'work-b',status:'in_progress',ref_number:'WO-2'}];
  const open=context.wsTEPickerOptions(tools,links,orders,'co-a','work-a',false);
  assert.deepEqual(Array.from(open,x=>x.id),['available','busy','person','broken']);
  assert.equal(open[0].unavailable,'');
  assert.match(open[1].unavailable,/WO-2/);
  assert.match(open[2].unavailable,/person/);
  assert.match(open[3].unavailable,/Not in service/);
  orders[0].status='completed';
  assert.equal(context.wsTEPickerOptions(tools,links,orders,'co-a','work-a',false)[1].unavailable,'');
  assert.equal(context.wsTEPickerOptions(tools,links,orders,'co-a','work-a',true)[3].unavailable,'');
});
