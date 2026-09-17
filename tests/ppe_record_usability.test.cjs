const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('auris-ppe-records.js','utf8');
function runtime(){
 let company='a',manager=true,calls=[],opened=[];
 const c={URL,URLSearchParams,location:{search:''},document:{addEventListener(){}},window:{open:(url)=>{opened.push(url);return {};}},ccid:()=>company,isMgr:()=>manager,canAccessPage:()=>true,people:[],fillPplDrops(){calls.push('fill');},api:async url=>{calls.push(url);return [{id:'e1',company_id:'a',first_name:'Alice',last_name:'Worker'},{id:'e2',company_id:'b',first_name:'Foreign'}];},toast(){},deepLinkRecordUrl:()=> 'https://example.test/?goto=ppe',escH:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'),ppeStripCertMeta:x=>x,PPE_CAT_CFG:{head:{label:'Head protection'}}};
 vm.createContext(c);vm.runInContext(source,c);return {c,calls,opened,setCompany:x=>company=x,setManager:x=>manager=x};
}
test('PPE employee refresh loads current tenant before populating and rejects stale company response',async()=>{
 const r=runtime();await r.c.ppeRefreshPeople();assert.match(r.calls[0],/company_id=eq.a/);assert.equal(r.calls[1],'fill');assert.equal(r.c.people.length,1);assert.equal(r.c.people[0].first_name,'Alice');
 r.c.api=async()=>{r.setCompany('b');return [];};await assert.rejects(r.c.ppeRefreshPeople(),/Company changed/);
});
test('PPE view and edit open distinct modes without changing current window; edit checks role',()=>{
 const r=runtime();r.c.ppeRecordWindow('catalogue','one','view');assert.equal(new URL(r.opened[0]).searchParams.get('ppeMode'),'view');r.setManager(false);r.c.ppeRecordWindow('catalogue','one','edit');assert.equal(r.opened.length,1);r.setManager(true);r.c.ppeRecordWindow('catalogue','one','edit');assert.equal(new URL(r.opened[1]).searchParams.get('ppeMode'),'edit');
});
test('PPE linked record rejects foreign company before reading and never edits in view mode',async()=>{
 const r=runtime();await assert.rejects(r.c.ppeOpenLinkedRecord({table:'ppe_catalogue',record:'one',company:'b'}),/company that owns/);assert.equal(r.calls.length,0);
 r.c.api=async()=>[{id:'one',company_id:'a',name:'Helmet'}];let viewed;r.c.ppeShowRecord=(kind,row)=>viewed=[kind,row.name];r.c.ppeCatEdit=()=>assert.fail('View must not edit');assert.equal(await r.c.ppeOpenLinkedRecord({table:'ppe_catalogue',record:'one',company:'a'}),true);assert.deepEqual(viewed,['catalogue','Helmet']);
});
test('record presentation escapes text, keeps zeros, groups fields, and has no editable inputs',()=>{
 const r=runtime(),html=r.c.ppeRecordDetails('catalogue',{name:'<script>alert(1)</script>',quantity_available:0,category:'head',employee_name:'Alice'});assert.match(html,/&lt;script&gt;/);assert.match(html,/<dd>0<\/dd>/);assert.match(html,/Head protection/);assert.match(html,/People/);assert.doesNotMatch(html,/<input|<textarea|contenteditable/);
});
