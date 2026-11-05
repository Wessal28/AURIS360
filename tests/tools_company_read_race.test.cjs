'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const core=fs.readFileSync(path.join(__dirname,'../auris-core.js'),'utf8');
const loaders={toolsLoadRegister:'tools-register-list',toolsLoadPersonal:'tools-personal-list',toolsLoadInspections:'tools-insp-list',toolsLoadLiftingAccessories:'tools-lifting-list',toolsLoadRCD:'tools-rcd-list',toolsLoadStatutory:'tools-stat-list'};
const source=core.match(/^var toolsReadRequests=.*[\s\S]*?^}\r?\n(?=\r?\n\/\/ -- REGISTER)/m)[0]+'\n'+Object.keys(loaders).map(name=>core.match(new RegExp('^async function '+name+'\\(\\)\\{[\\s\\S]*?^}','m'))[0]).join('\n');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function runtime(){
  let company='a';
  const pending=[];
  const elements=Object.fromEntries([...Object.values(loaders),'tools-stat-alerts'].map(id=>[id,{innerHTML:''}]));
  const ctx={
    document:{getElementById:id=>elements[id]||null},
    prof:{id:'user',role:'sephs_admin'},ccid:()=>company,cf:()=>'&company_id=eq.'+company,_authSessionGeneration:1,
    activeRole:()=>ctx.prof.role,
    toolsAllData:[],toolsLastInspectionByTool:{},toolsInspectionData:[],toolsLiftingData:[],toolsRcdData:[],toolsRcdTests:[],
    toolsIsGeneralEquipment:()=>true,toolsIsRCD:()=>true,toolsInspectionState:()=>({due:false}),
    toolsFilterRegister:()=>{elements['tools-register-list'].innerHTML='Equipment register rendered';},
    toolsRenderInspections:()=>{elements['tools-insp-list'].innerHTML='Inspections rendered';},
    registerErrorHtml:(title,message)=>message,setupFriendlyMessage:(title,message)=>message,isMgr:()=>false,
    api:url=>new Promise((resolve,reject)=>pending.push({company,url,resolve,reject}))
  };
  vm.createContext(ctx);
  vm.runInContext(source,ctx);
  return {ctx,elements,pending,selectCompany:value=>{company=value;}};
}

for(const [loader,id] of Object.entries(loaders)){
  test(loader+' ignores both late results and late failures after a company switch',{timeout:2000},async()=>{
    for(const fail of [false,true]){
      const {ctx,elements,pending,selectCompany}=runtime();
      const oldLoad=ctx[loader]();
      const oldRequests=pending.slice();
      selectCompany('b');
      const newLoad=ctx[loader]();
      for(const request of pending.filter(request=>request.company==='b'))request.resolve([]);
      if(loader==='toolsLoadRCD'){
        await tick();
        assert.match(pending.at(-1).url,/\/tool_inspections/);
        pending.at(-1).resolve([]);
      }
      await newLoad;
      const currentHtml=elements[id].innerHTML;
      assert.ok(currentHtml && !currentHtml.includes('Loading'));
      for(const [index,request] of oldRequests.entries()){
        if(fail&&index===0)request.reject(new Error('Old company failed'));
        else request.resolve(index===0?[{id:'old',name:'Old company equipment'}]:[]);
      }
      await oldLoad;
      assert.equal(elements[id].innerHTML,currentHtml);
      for(const name of ['toolsAllData','toolsInspectionData','toolsLiftingData','toolsRcdData','toolsRcdTests'])assert.equal(ctx[name].length,0,name);
      if(loader==='toolsLoadRCD')assert.equal(pending.length,3,'The stale load does not query inspections for the new company');
    }
  });
}

test('RCD discards a pending second response when the authenticated user changes',async()=>{
  const {ctx,elements,pending}=runtime();
  const load=ctx.toolsLoadRCD();
  pending[0].resolve([{id:'device'}]);
  await tick();
  assert.match(pending[1].url,/\/tool_inspections/);
  ctx.prof={id:'new-user',role:'sephs_admin'};
  pending[1].resolve([{id:'test'}]);
  await load;
  assert.equal(ctx.toolsRcdData.length,0);
  assert.equal(ctx.toolsRcdTests.length,0);
  assert.match(elements['tools-rcd-list'].innerHTML,/Loading/);
});

test('the latest Personal Custody filter request wins in the same company',async()=>{
  const {ctx,elements,pending}=runtime();
  const oldLoad=ctx.toolsLoadPersonal();
  const newLoad=ctx.toolsLoadPersonal();
  pending[1].resolve([]);
  await newLoad;
  const currentHtml=elements['tools-personal-list'].innerHTML;
  pending[0].reject(new Error('Previous request failed'));
  await oldLoad;
  assert.match(currentHtml,/No personal tool assignments/);
  assert.equal(elements['tools-personal-list'].innerHTML,currentHtml);
});

test('Personal Custody replaces the previous company’s employee filter',async()=>{
  const {ctx,elements,pending,selectCompany}=runtime();
  const filter={
    value:'',dataset:{},options:[],
    set innerHTML(value){this.options=[{value:'',textContent:'All employees'}];this.value='';},
    appendChild(option){this.options.push(option);}
  };
  elements['tools-personal-filter']=filter;
  ctx.document.createElement=()=>({});
  const people=[{id:'employee-a',company_id:'a',first_name:'Alice',last_name:'Example'},{id:'employee-b',company_id:'b',first_name:'Bob',last_name:'Example'}];
  ctx.tenantPeople=()=>people.filter(person=>person.company_id===ctx.ccid());
  const first=ctx.toolsLoadPersonal();
  pending[0].resolve([]);
  await first;
  filter.value='employee-a';
  selectCompany('b');
  const next=ctx.toolsLoadPersonal();
  assert.deepEqual(filter.options.map(option=>option.value),['','employee-b']);
  assert.equal(filter.value,'');
  assert.match(pending[1].url,/company_id=eq\.b.*assigned_to=not\.is\.null/);
  pending[1].resolve([]);
  await next;
});
