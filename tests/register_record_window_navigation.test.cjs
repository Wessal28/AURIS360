const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

for(const entry of [
  {file:'auris-tools-records.js',workspace:'AurisToolsListWorkspace',window:'toolsRecordWindow',handler:'toolsOpenLinkedRecord',args:['eq-1','view'],table:'tools_register'},
  {file:'auris-fleet-records.js',workspace:'AurisFleetListWorkspace',window:'fleetRecordWindow',handler:'fleetOpenLinkedRecord',args:['vehicle-1','view'],table:'tools_register'},
  {file:'auris-ppe-records.js',window:'ppeRecordWindow',handler:'ppeOpenLinkedRecord',args:['catalogue','ppe-1','view'],table:'ppe_catalogue'},
  {file:'auris-chemical-records.js',workspace:'AurisChemicalListWorkspace',window:'chemRecordWindow',handler:'chemOpenRecordRequest',args:['chem-1','view'],table:'chemical_register'}
]){
  test(`${entry.file} opens a company-scoped record in the current app`,async()=>{
    let request;
    const ctx={URL,URLSearchParams,location:{search:''},ccid:()=> 'company-a',isMgr:()=>true,
      document:{addEventListener(){},getElementById:()=>null},
      window:{open(){assert.fail('A record must not launch another AURIS360 window');}},
      toast(message){assert.fail(message)}};
    if(entry.workspace)ctx[entry.workspace]={session:()=>({companyId:'company-a'})};
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..',entry.file),'utf8'),ctx);
    ctx[entry.handler]=async value=>{request=value;return true;};
    assert.equal(await ctx[entry.window](...entry.args),true);
    assert.equal(request.table,entry.table);
    assert.equal(request.company,'company-a');
    assert.equal(request.mode,'view');
  });
}
