const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../auris-tools-records.js'),'utf8');
function runtime(overrides={}){
  const current={companyId:'co-a',userId:'user',role:'manager'};
  const ctx={URL,URLSearchParams,location:{search:''},escH:v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),AurisToolsListWorkspace:{session:()=>current,assertSession:expected=>{if(expected.companyId!==current.companyId)throw Error('Company changed');}},api:async()=>[],isMgr:()=>true,...overrides};
  vm.createContext(ctx);vm.runInContext(source,ctx);return {ctx,current};
}
test('history requests are scoped to equipment and company and reject foreign rows',async()=>{
  const calls=[],{ctx,current}=runtime({api:async url=>{calls.push(url);return [{id:'a',company_id:'co-a',tool_id:'eq',equipment_id:'eq'},{id:'b',company_id:'other',tool_id:'eq',equipment_id:'eq'},{id:'c',company_id:'co-a',tool_id:'other',equipment_id:'other'}];}});
  const results=await ctx.toolsReadHistory({id:'eq'},current);
  assert.equal(results.length,5);assert.ok(results.every(r=>r.rows.length===1&&r.rows[0].id==='a'));
  assert.ok(calls.every(url=>url.includes('company_id=eq.co-a')&&url.includes('=eq.eq')));
});
test('partial failures are distinguished from empty history',async()=>{
  const {ctx,current}=runtime({api:async url=>{if(url.includes('equipment_movements'))throw Error('offline');return [];}});
  const results=await ctx.toolsReadHistory({id:'eq'},current);
  assert.match(ctx.toolsHistoryHtml(results[2]),/could not be loaded/);assert.doesNotMatch(ctx.toolsHistoryHtml(results[2]),/No records/);
  assert.match(ctx.toolsHistoryHtml(results[0]),/No records/);
});
test('company changes during history loading prevent rendering',async()=>{
  const {ctx,current}=runtime();const expected={...current};ctx.api=async()=>{current.companyId='co-b';return [];};
  await assert.rejects(ctx.toolsReadHistory({id:'eq'},expected),/Company changed/);
});
test('evidence links allow HTTPS only and preserve plain references safely',()=>{
  const {ctx}=runtime();for(const value of ['javascript:alert(1)','data:text/html,test','https://user:pass@example.com','//example.com','MSB 001'])assert.equal(ctx.toolsEvidenceHref(value),'');
  assert.equal(ctx.toolsEvidenceHref('https://example.com/cert.pdf'),'https://example.com/cert.pdf');
  const html=ctx.toolsHistoryHtml({info:ctx.TOOLS_RECORD_HISTORY[1],rows:[{evidence_reference:'<script>alert(1)</script>'}]});assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script>/);
});
test('unauthorised edit and foreign-company links cannot open editors',async()=>{
  const {ctx}=runtime({location:{search:'?equipmentMode=edit'},isMgr:()=>false,api:async()=>[{id:'eq',company_id:'co-a'}]});
  await assert.rejects(ctx.toolsOpenLinkedRecord({record:'eq',company:'co-b'}),/company/);
  await assert.rejects(ctx.toolsOpenLinkedRecord({record:'eq',company:'co-a'}),/Manager access/);
});
test('view routing loads a read-only record without invoking an editor',async()=>{
  const {ctx}=runtime({api:async url=>url.startsWith('/tools_register?')?[{id:'eq',company_id:'co-a',name:'Drill'}]:[]});
  let viewed;ctx.toolsShowRecord=(row,current,history)=>{viewed={row,history};};ctx.toolsEdit=()=>assert.fail('view opened editor');
  assert.equal(await ctx.toolsOpenLinkedRecord({record:'eq',company:'co-a'}),true);assert.equal(viewed.row.name,'Drill');assert.equal(viewed.history.length,5);
});
