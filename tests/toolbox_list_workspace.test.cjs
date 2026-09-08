const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8'),core=read('auris-core.js');
const current={companyId:'co-a',userId:'user-a',role:'manager'},topics={chemical:{label:'Chemical / COSHH'},ppe:{label:'PPE'}};
const rows=[
  {id:'a',company_id:'co-a',tbt_ref:'TBT-2026-001',title:'Safe handling',topic_category:'chemical',status:'planned',talk_date:'2026-09-01',presenter:'Worker A',location:'Factory',department:'Operations',attendees:[{name:'Worker One'},{full_name:'Worker Two'}],attendance_count:9,actions_raised:[{description:'Check gloves'}],duration_mins:0},
  {id:'b',company_id:'co-a',tbt_ref:'TBT-2026-002',title:'Wear gloves',topic_category:'ppe',status:'completed',talk_date:'2026-08-31',attendees:[],attendance_count:7,actions_raised:[],duration_mins:15},
  {id:'c',company_id:'co-a',title:'Generated talk',status:'draft'},
  {id:'foreign',company_id:'co-b',title:'Secret'}, {id:'unscoped',title:'Unscoped'}
];
function runtime(){
  const identity={company:{id:'co-a'},profile:{id:'user-a'},role:'manager'};let mounted,allowed=true,authenticated=true;
  const window={navigator:{onLine:true},AurisPlatformServices:{ready:()=>true,auth:{isAuthenticated:()=>authenticated,current:()=>identity},rbac:{requireAccess:key=>{assert.equal(key,'meetings');if(!allowed)throw Error('Access denied');}}},AurisViewEngine:{mount:(host,data,options)=>{mounted={data,options};return mounted;}}};
  vm.runInNewContext(read('auris-toolbox-list-workspace.js'),window);
  return {api:window.AurisToolboxListWorkspace,window,identity,mounted:()=>mounted,deny:()=>allowed=false,signOut:()=>authenticated=false};
}
test('toolbox projection preserves exact tenant identity and recorded facts without writes',()=>{
  const r=runtime(),before=JSON.stringify(rows),data=r.api.project(rows,current,{topics});
  assert.equal(data.length,3);assert.equal(data[0].source_table,'toolbox_talks');assert.equal(data[0].topic,'Chemical / COSHH');assert.equal(data[0].reference,'TBT-2026-001');
  assert.equal(data[0].presenter,'Worker A');assert.equal(data[0].location,'Factory');assert.equal(data[0].department,'Operations');assert.equal(data[0].talk_date,'2026-09-01');assert.equal(data[0].attendees,2);assert.equal(data[0].actions,1);assert.equal(data[0].duration,0);assert.equal(data[1].attendees,7);assert.equal(JSON.stringify(rows),before);
});
test('search combines with topic and status; unknown and absent values are not called completed',()=>{
  const r=runtime(),select=filters=>Array.from(r.api.project(rows,current,{topics,filters}),x=>x.id);
  assert.deepEqual(select({category:'chemical',status:'planned',search:'factory'}),['a']);assert.deepEqual(select({search:'coshh'}),['a']);assert.deepEqual(select({search:'Worker A'}),['a']);assert.deepEqual(select({status:'draft'}),['c']);assert.deepEqual(select({status:'cancelled'}),[]);
  const data=r.api.project([{id:'x',company_id:'co-a'},{id:'y',company_id:'co-a',status:'legacy',topic_category:'legacy'}],current,{topics});assert.equal(data[0].status,'Not recorded');assert.equal(data[0].topic,'Not recorded');assert.equal(data[0].attendees,'Not recorded');assert.equal(data[1].status,'legacy');assert.equal(data[1].topic,'legacy');
  assert.equal(r.api.project(rows,{companyId:''}).length,0);assert.equal(r.api.filters({search:'a'.repeat(400)}).search.length,300);
});
test('attendance handles legacy counts, named records, zero and malformed fields consistently',()=>{
  const r=runtime();for(const count of [0,'0',5,'5'])assert.equal(r.api.attendance({attendance_count:count}),Number(count));
  for(const count of [-1,'oops',null,'',undefined,1.5])assert.equal(r.api.attendance({attendance_count:count}),'Not recorded');
  assert.equal(r.api.attendance({attendees:[null,{}, {person_name:'Person'}],attendance_count:8}),1);assert.equal(r.api.attendance({attendees:[]}),0);
  const row=r.api.project([{id:'x',company_id:'co-a',actions_raised:{length:17}}],current)[0];assert.equal(row.actions,'Not recorded');
});
test('shared views expose required identity and read-only board with only the existing form handoff',()=>{
  const r=runtime();r.api.mount({},rows,{topics});const m=r.mounted();assert.equal(m.options.moduleKey,'toolbox-talks');assert.deepEqual(Array.from(m.options.actions,x=>x.key),['open']);assert.deepEqual(Array.from(r.api.definition().views),['list','card','board']);
  assert.deepEqual(Array.from(r.api.definition().fields.filter(x=>x.required),x=>x.key),['reference','title']);assert.equal(r.api.definition().fields.find(x=>x.key==='talk_date').type,'date');
});
test('only a matching projected record may open and callback failures propagate',async()=>{
  const r=runtime(),calls=[];r.api.mount({},rows,{openRecord:(...args)=>calls.push(args)});const m=r.mounted();await m.options.onAction('open',m.data[0]);assert.equal(calls[0][0],'a');assert.equal(calls[0][1].companyId,'co-a');
  for(const [key,row] of [['approve',m.data[0]],['open',{...m.data[0],source_table:'permits'}],['open',{...m.data[0],company_id:'co-b'}],['open',{...m.data[0],id:'foreign'}]])await assert.rejects(m.options.onAction(key,row),/outside/);
  r.api.mount({},rows,{openRecord:()=>{throw Error('Opening failed');}});await assert.rejects(r.mounted().options.onAction('open',r.mounted().data[0]),/Opening failed/);assert.equal(calls.length,1);
});
test('changed authentication, account, company, role, access and offline state block stale handoff',async()=>{
  for(const change of [r=>r.identity.company.id='co-b',r=>r.identity.profile.id='other',r=>r.identity.role='viewer',r=>r.deny(),r=>r.signOut()]){
    const r=runtime();r.api.mount({},rows,{openRecord:()=>assert.fail('stale'),onApplyFilters:()=>assert.fail('stale')});const m=r.mounted();change(r);await assert.rejects(m.options.onAction('open',m.data[0]),/changed|denied|Sign in/);assert.throws(()=>m.options.onApplyFilters({}),/changed|denied|Sign in/);
  }
  const r=runtime();r.api.mount({},rows,{openRecord:()=>assert.fail('offline')});r.window.navigator.onLine=false;await assert.rejects(r.mounted().options.onAction('open',r.mounted().data[0]),/Reconnect/);
});
function integration(){
  const r=runtime(),elements=new Map(),pending=[];let company='co-a',role='manager',allowed=true,opened;
  const context={tbtAllData:[],tbtListLoadGeneration:0,tbtListViewGeneration:0,tbtListContext:null,TBT_TOPIC_CFG:topics,window:r.window,navigator:r.window.navigator,ccid:()=>company,prof:{id:'user-a'},activeRole:()=>role,canAccessPage:()=>allowed,
    document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{value:'',style:{}});return elements.get(id);}},api:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject})),registerErrorHtml:(_,message)=>message,tbtEdit:id=>opened={id,record:context.tbtAllData.find(x=>x.id===id)}};
  vm.runInNewContext(core.slice(core.indexOf('async function tbtLoad(){'),core.indexOf('function tbtShowForm(){')),context);
  return {r,context,elements,pending,opened:()=>opened,switchCompany:()=>company='co-b',changeRole:()=>role='viewer',deny:()=>allowed=false,
    async load(){const p=context.tbtLoad();pending.at(-1).resolve(rows);await p;},open:()=>context.tbtOpenFromRegister('a',current,context.tbtListLoadGeneration,context.tbtListViewGeneration)};
}
test('register loader explicitly scopes requests, rejects foreign rows and resets stale metrics',async()=>{
  const r=integration();await r.load();assert.match(r.pending[0].url,/company_id=eq.co-a/);assert.equal(r.context.tbtAllData.length,3);assert.equal(r.elements.get('tbt-m3total').textContent,3);assert.equal(r.elements.get('tbt-m3attendees').textContent,9);assert.equal(r.elements.get('tbt-m3actions').textContent,1);
  const next=r.context.tbtLoad();assert.equal(r.context.tbtAllData.length,0);assert.equal(r.context.tbtListContext,null);assert.equal(r.elements.get('tbt-m3total').textContent,'0');r.pending.at(-1).resolve([]);await next;assert.equal(r.r.mounted().data.length,0);
});
test('restored saved filters update all controls, rows and summary metrics',async()=>{
  const r=integration();await r.load();r.r.mounted().options.onApplyFilters({category:'chemical',search:'factory',status:'planned'});
  assert.equal(r.elements.get('tbt-filter-cat').value,'chemical');assert.equal(r.elements.get('tbt-search').value,'factory');assert.equal(r.elements.get('tbt-filter-status').value,'planned');assert.equal(r.r.mounted().data.length,1);assert.equal(r.elements.get('tbt-m3attendees').textContent,2);
});
test('malformed, missing-table, network and permission failures are visible and do not fall back to stale rows',async()=>{
  for(const value of [null,{},Error('permission denied'),Error('Failed to fetch'),Error('relation toolbox_talks does not exist')]){const r=integration(),p=r.context.tbtLoad();if(value instanceof Error)r.pending[0].reject(value);else r.pending[0].resolve(value);await p;assert.equal(r.context.tbtAllData.length,0);assert.equal(r.context.tbtListContext,null);assert.match(r.elements.get('tbt-list').innerHTML,/invalid response|denied|fetch|does not exist/);assert.equal(r.pending.length,1);}
  const r=integration();r.deny();await r.context.tbtLoad();assert.equal(r.pending.length,0);assert.match(r.elements.get('tbt-list').innerHTML,/accessible company/);
});
test('obsolete or changed-context loads cannot replace current records or metrics',async()=>{
  for(const change of [r=>r.switchCompany(),r=>r.changeRole(),r=>r.context.prof.id='other',r=>r.deny()]){const r=integration(),p=r.context.tbtLoad();change(r);r.pending[0].resolve(rows);await p;assert.equal(r.context.tbtAllData.length,0);assert.equal(r.context.tbtListContext,null);assert.equal(r.r.mounted(),undefined);}
  const r=integration(),old=r.context.tbtLoad(),next=r.context.tbtLoad();r.pending[1].resolve([rows[1]]);await next;r.pending[0].reject(Error('Old error'));await old;assert.equal(r.context.tbtAllData[0].id,'b');assert.equal(r.r.mounted().data.length,1);
});
test('opening re-fetches exact company/id before handing fresh data to the existing editor',async()=>{
  const r=integration();await r.load();const p=r.open();assert.match(r.pending.at(-1).url,/company_id=eq.co-a&id=eq.a&limit=1/);r.pending.at(-1).resolve([{...rows[0],title:'Updated talk',status:'cancelled'}]);await p;assert.equal(r.opened().id,'a');assert.equal(r.opened().record.title,'Updated talk');assert.equal(r.opened().record.status,'cancelled');
});
test('missing, duplicate, mismatched and malformed fresh records never open or replace the editor',async()=>{
  for(const value of [[],[rows[0],rows[0]],{},[null],[{...rows[0],company_id:'co-b'}],[{...rows[0],id:'b'}],[{...rows[0],attendees:{}}],[{...rows[0],actions_raised:[null]}]]){const r=integration();await r.load();const p=r.open();r.pending.at(-1).resolve(value);await assert.rejects(p,/unavailable|outside|needs review/);assert.equal(r.opened(),undefined);assert.equal(r.context.tbtAllData[0].title,rows[0].title);}
  const r=integration();await r.load();await assert.rejects(r.context.tbtOpenFromRegister('foreign',current,1,r.context.tbtListViewGeneration),/outside/);assert.equal(r.pending.length,1);
});
test('in-flight opening is invalidated by new view, load, account, permission or connectivity',async()=>{
  for(const change of [r=>r.context.tbtListViewGeneration++,r=>r.context.tbtListLoadGeneration++,r=>r.switchCompany(),r=>r.changeRole(),r=>r.context.prof.id='other',r=>r.deny(),r=>r.context.navigator.onLine=false]){const r=integration();await r.load();const p=r.open();change(r);r.pending.at(-1).resolve([rows[0]]);await assert.rejects(p,/changed|Reconnect/);assert.equal(r.opened(),undefined);}
});
test('wiring preserves specialist writes, uses shared printing, and includes release gates',()=>{
  const html=read('index.html');assert.ok(html.indexOf('src="auris-toolbox-list-workspace.js?')<html.indexOf('src="auris-core.js?'));
  for(const file of ['sw-assets.js','scripts/verify-staging-acceptance.cjs','scripts/verify-production-smoke.cjs'])assert.match(read(file),/auris-toolbox-list-workspace\.js/);
  assert.doesNotMatch(read('auris-toolbox-list-workspace.js'),/\bfetch\(|\bapi\.request\(|\btbtAllData\b|m:'(?:POST|PATCH|DELETE)'/);
  for(const fn of ['tbtSave','tbtConfirmAttendee','tbtLoadWorkOptions','printToolboxTalk','tbtActionRow'])assert.ok(core.includes('function '+fn+'('),fn);
  assert.match(core,/function mtgSwitchTab\(tab, btn\)\{\s*tbtListViewGeneration\+\+/);assert.match(core,/function tbtShowForm\(\)\{\s*tbtListViewGeneration\+\+/);
  assert.ok(core.includes('AurisViewEngine.preparePrint(clone)'));
});
