const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('settings restrict business and support groups while keeping personal access',()=>{
 const source=read('auris-core.js');const code=source.slice(source.indexOf('function settingsGroups(){'),source.indexOf('function settingsSelectGroup('));
 for(const role of ['employee','hse_officer','hse_manager','admin']){
 const ctx={isAdm:()=>role==='admin',activeRole:()=>role,systemHealthCanView:()=>role!=='employee'};vm.runInNewContext(code,ctx);
 const groups=ctx.settingsGroups(),allowed=groups.filter(g=>g[3]).map(g=>g[0]);assert.ok(allowed.includes('personal'));assert.equal(allowed.includes('support'),role!=='employee');assert.equal(allowed.includes('company'),role==='admin');assert.equal(allowed.includes('workflows'),['admin','hse_manager'].includes(role));
 const ids=groups.flatMap(g=>g[2]);assert.equal(ids.length,new Set(ids).size);
 }
});
test('automation load failure hides editor and retry recovers without writes',async()=>{
 const ctx={console,Date,Promise};vm.runInNewContext(read('auris-automation-engine.js'),ctx);vm.runInNewContext(read('auris-automation-centre.js'),ctx);
 let retry,fail=true;const calls=[];const host={innerHTML:'',querySelector:()=>({addEventListener:(event,fn)=>{retry=fn;}}),querySelectorAll:()=>[]};
 await ctx.AurisAutomationCentre.mount(host,{role:'admin',companyId:'co-a',request:async(p,o)=>{calls.push([p,o]);if(fail)throw Error('unavailable');return [];}});
 assert.match(host.innerHTML,/Unable to load automation rules/);assert.doesNotMatch(host.innerHTML,/Save draft|New rule|No company automation rules/);fail=false;await retry();assert.match(host.innerHTML,/Save draft/);assert.equal(calls.length,2);assert.ok(calls.every(c=>!c[1]));
});
