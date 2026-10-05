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
