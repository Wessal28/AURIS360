const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('chemical-print-reports.js','utf8'),projection=fs.readFileSync('auris-chemical-list-workspace.js','utf8');
function element(){return {events:{},value:'',disabled:false,hidden:false,textContent:'',isConnected:true,addEventListener(k,fn){this.events[k]=fn;},focus(){},setAttribute(){}};}
function dialogFixture(){
 const d=element(),fields={};for(const key of ['report','product','scope','format','selection','paper'])fields[key]=element();fields.product.options=[{textContent:''}];fields.scope.value='all';fields.format.value='summary';fields.selection.value='selected';fields.paper.value='A4';
 const form=element(),nodes={'form':form,'[data-cancel]':element(),'[data-scope]':element(),'[data-format]':element(),'[data-selection]':element(),'[data-error]':element(),'[type="submit"]':element()};form.elements=fields;form.querySelector=s=>nodes[s];d.querySelector=s=>nodes[s];d.close=()=>{};d.remove=()=>{d.isConnected=false;};d.showModal=()=>{};return {d,form,nodes,fields};
}
function runtime(){
 let current={company:'client',user:'user',role:'company_admin'},denied=new Set(),hook=null,popupBlocked=false;const requests=[],previews=[],windows=[],messages=[];
 const tables={chemical_register:[
  {id:'a',company_id:'client',chemical_ref:'CHEM-001',product_name:'Solvent <A>',status:'active',risk_level:'high',risk_score:0,review_date:'2001-01-01',sds_revision_date:'2026-01-01',sds_file_name:'source.pdf',location:'Workshop',existing_controls:'Ventilation',ppe_required:'Gloves',first_aid:'Consult saved SDS',quantity_stored:0},
  {id:'b',company_id:'client',chemical_ref:'CHEM-002',product_name:'Unassessed product',status:'active',risk_level:null,risk_score:null},
  {id:'deleted',company_id:'client',chemical_ref:'CHEM-DEL',product_name:'Deleted product',status:'deleted'}
 ],chemical_sds_versions:[{id:'s1',company_id:'client',chemical_id:'a',validation_status:'pending',extraction_status:'completed',file_name:'source.pdf',source_reference:'Manufacturer SDS',revision_date:'2026-01-01',created_at:'2026-02-01'}],chemical_use_approvals:[{id:'use',company_id:'client',chemical_id:'a',reference:'USE-1',task_name:'Decant',status:'proposed',conditions:'Review before use',maximum_quantity:0,quantity_unit:'litres',substitution_considered:false,sds_review_required:true}],chemical_inventory_events:[{id:'e1',company_id:'client',chemical_id:'a',reference:'EV-1',event_type:'receipt',event_date:'2026-10-20',quantity:2,unit:'litres'},{id:'e2',company_id:'client',chemical_id:'a',reference:'EV-2',event_type:'disposal',event_date:'2026-10-20',quantity:3,unit:'kg'},{id:'e3',company_id:'client',chemical_id:'a',reference:'EV-3',event_type:'adjustment',event_date:'2026-10-20',quantity:0,unit:'containers'}]};
 const dialogs=[],doc={activeElement:element(),getElementById:id=>dialogs.find(x=>x.d.id===id&&x.d.isConnected)?.d||null,body:{appendChild(){}},createElement:()=>{const d=dialogFixture();dialogs.push(d);return d.d;}};
 const c={console,Intl,Date,Set,Map,document:doc,toast:(v)=>messages.push(v),chemData:[{product_name:'Cached wrong-company product'}],AurisChemicalReportState:()=>({tab:'register',filters:{},selectedEmergencyIds:['a'],context:{...current}})};c.window=c;
 function check(ctx,moduleKey,section){assert.equal(moduleKey,'chemical');if(JSON.stringify(ctx)!==JSON.stringify(current))throw Error('Account or company changed');for(const s of [].concat(section||[]))if(denied.has(s))throw Error('Cannot view '+s);}
 c.AurisModuleReports={context:()=>({...current}),check,allowed:(m,s)=>!denied.has(s),company:()=>({name:'Selected Client',logo_url:'/client.png'}),ensureStyle(){},
  async read(table,ctx,m,s,id){check(ctx,m,s);requests.push({table,section:s,id,company:ctx.company});if(hook)await hook(table,ctx,s,id);let rows=structuredClone(tables[table]||[]);check(ctx,m,s);if(rows.some(r=>r.company_id!==ctx.company))throw Error('Response did not match company');if(id){rows=rows.filter(r=>r.id===id);if(rows.length!==1)throw Error('Record unavailable');}return rows;},
  reserve(){if(popupBlocked)throw Error('Allow pop-ups');const w={closed:false,close(){this.closed=true;}};windows.push(w);return w;},
  async preview(s){check(s.context,s.moduleKey,s.section);if(s.preparedWindow?.closed)throw Error('Preview cancelled');previews.push(s);return s;}
 };
 vm.createContext(c);vm.runInContext(projection,c);vm.runInContext(source,c);
 return {c,api:c.AurisChemicalPrint,tables,requests,previews,windows,dialogs,messages,context:()=>({...current}),deny:s=>denied.add(s),select:company=>{current={...current,company};},onRead:fn=>{hook=fn;},block:()=>{popupBlocked=true;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('company reports read fresh saved tables and exclude deleted and cached records',async()=>{
 const h=runtime();for(const key of ['register','approvals','inventory','reviews','emergency']){const s=await h.api.capture(key,{selection:'all'},h.context());assert.match(s.html,/<table>/);assert.equal(s.context.company,'client');assert.doesNotMatch(s.html,/Cached wrong-company|Deleted product/);}
 assert.ok(h.requests.every(r=>r.company==='client'));assert.ok(h.requests.some(r=>r.table==='chemical_sds_versions'));assert.equal(h.windows.length,0);assert.equal(h.previews.length,0);
});
test('register filter values use the actual chemical projection and clearly label the fresh scope',async()=>{
 const h=runtime(),s=await h.api.capture('register',{filtered:true,filters:{attention:'review_overdue',risk:'high',search:'solvent'},format:'summary'},h.context());assert.match(s.html,/CHEM-001/);assert.doesNotMatch(s.html,/CHEM-002/);assert.match(s.sourceLabel,/Current register filter values.*Review Overdue|Current register filter values.*review_overdue/);
 await assert.rejects(h.api.capture('register',{filters:{risk:'critical'}},h.context()),/No saved.*Adjust/);
});
test('formats preserve missing assessments and zero values without fabricating low risk or exposure defaults',async()=>{
 const h=runtime(),s=await h.api.capture('register',{format:'hazards'},h.context());assert.match(s.html,/High \/ 0/);assert.match(s.html,/Unassessed \/ Not scored/);assert.doesNotMatch(s.html,/Low \/ 4|occasional|short|closed_handling|undefined|\[object Object\]/);
 const storage=await h.api.capture('register',{format:'storage'},h.context());assert.match(storage.html,/<td>0<\/td>/);assert.match(storage.html,/Not Recorded|Not recorded/);
 h.tables.chemical_register[1].hazard_pictograms=['__auris_use_exposure__'+JSON.stringify({location:'Saved backup location',persons_exposed:0})];assert.equal(h.api.exposure(h.tables.chemical_register[1]).location,'Saved backup location');assert.equal(h.api.exposure(h.tables.chemical_register[1]).persons_exposed,0);
});
test('SDS availability, extraction and validation evidence remain distinct',async()=>{
 const h=runtime();h.tables.chemical_sds_versions[0].validation_status='current';const s=await h.api.capture('register',{format:'sds'},h.context());assert.match(s.html,/Reference only/);assert.match(s.html,/Recorded Current · Validation evidence incomplete/);assert.doesNotMatch(s.html,/Safe to proceed|All.*current|Current validated/);
 const full=await h.api.product('a');assert.match(full.html,/Completed/);assert.match(full.html,/Validation evidence incomplete/);assert.equal(h.previews.length,1);
});
test('emergency cards require deliberate selection and preserve draft and original-SDS warnings',async()=>{
 const h=runtime();await assert.rejects(h.api.capture('emergency',{selection:'selected',ids:[]},h.context()),/Select at least/);for(const id of ['foreign','deleted'])await assert.rejects(h.api.capture('emergency',{selection:'selected',ids:[id]},h.context()),/no longer active|another company/);
 h.tables.chemical_register[0].first_aid='Long extracted statement '.repeat(30);const s=await h.api.capture('emergency',{selection:'selected',ids:['a']},h.context());assert.match(s.html,/DRAFT/);assert.match(s.html,/incomplete excerpt; consult original SDS/);assert.match(s.html,/does not replace the official SDS/);assert.doesNotMatch(s.html,/Unassessed product/);assert.match(s.sourceLabel,/1 saved cards/);
});
test('only an evidenced current SDS with a reviewed complete summary is labelled reviewed',()=>{
 const h=runtime(),p=h.tables.chemical_register[0],s={...h.tables.chemical_sds_versions[0],validation_status:'current',reviewer_id:'reviewer',reviewer_name:'Reviewer',validated_at:'2026-02-01',language_code:'en',jurisdiction:'MU',emergency_summary_reviewed_at:'2026-02-02',emergency_summary_reviewed_by:'reviewer',emergency_summary:{hazards:'Reviewed hazards',first_aid:'Reviewed first aid',ppe:'Reviewed PPE',storage:'Reviewed storage'}};
 assert.match(h.api.emergencyCard(p,[s]),/Reviewed emergency summary recorded/);assert.match(h.api.emergencyCard(p,[s]),/Reviewed hazards/);assert.match(h.api.emergencyCard(p,[{...s,material_change:true}]),/DRAFT/);assert.match(h.api.emergencyCard(p,[s,{...s,id:'duplicate'}]),/Multiple current SDS/);assert.match(h.api.emergencyCard(p,[{...s,emergency_summary_reviewed_by:null}]),/DRAFT/);
});
test('inventory keeps recorded units separate and does not invent a stock balance',async()=>{
 const h=runtime(),s=await h.api.capture('inventory',{},h.context());assert.match(s.html,/2 litres/);assert.match(s.html,/3 kg/);assert.match(s.html,/0 containers/);assert.doesNotMatch(s.html,/5 kg|5 litres/);assert.match(s.note,/does not.*create a stock balance/);
});
test('approvals and review exceptions preserve status, conditions, substitution and changed-SDS warnings',async()=>{
 const h=runtime(),s=await h.api.capture('approvals',{},h.context());assert.match(s.html,/Proposed/);assert.match(s.html,/Review before use/);assert.match(s.html,/0 litres/);assert.match(s.html,/Not confirmed/);assert.match(s.html,/SDS change review required/);
 const queue=await h.api.capture('reviews',{},h.context());assert.deepEqual([...queue.section],['reviews','approvals']);assert.match(queue.html,/Competent SDS review required/);assert.match(queue.note,/exceptions, not confirmation/);
});
test('exact product includes saved scoped histories, preserves paper choice and never invokes a business save',async()=>{
 const h=runtime();h.c.chemSave=()=>{throw Error('No writes');};const result=await h.api.product('a',h.context(),{paper:'A3'});assert.equal(h.requests[0].id,'a');assert.equal(result.paper,'A3');assert.match(result.html,/USE-1|EV-1/);assert.match(result.html,/Solvent &lt;A&gt;/);assert.doesNotMatch(result.html,/CHEM-002/);assert.deepEqual([...result.section],['register','approvals','inventory']);assert.equal(h.windows.length,1);assert.equal(h.windows[0].closed,false);
});
test('inaccessible histories are explicitly identified and never fetched',async()=>{
 const h=runtime();h.deny('approvals');h.deny('inventory');const s=await h.api.product('a');assert.match(s.html,/Use approvals are not accessible/);assert.match(s.html,/Inventory events are not accessible/);assert.deepEqual([...s.section],['register']);assert.ok(!h.requests.some(r=>['chemical_use_approvals','chemical_inventory_events'].includes(r.table)));
 const queue=await h.api.capture('reviews',{},h.context());assert.match(queue.html,/not accessible to your account/);assert.equal(queue.section,'reviews');
});
test('context and included-history permission changes block preview and close the reserved window',async()=>{
 const h=runtime();h.onRead(table=>{if(table==='chemical_inventory_events')h.deny('approvals');});await assert.rejects(h.api.product('a'),/Cannot view approvals/);assert.equal(h.previews.length,0);assert.equal(h.windows[0].closed,true);
 const x=runtime();x.onRead(()=>x.select('other'));await assert.rejects(x.api.product('a'),/changed/);assert.equal(x.windows[0].closed,true);
 const y=runtime();y.tables.chemical_register.push({id:'foreign',company_id:'other'});await assert.rejects(y.api.capture('register',{},y.context()),/did not match/);
});
test('missing records, read errors and blocked popups remain recoverable without printing',async()=>{
 const h=runtime();await assert.rejects(h.api.product('missing'),/unavailable/);assert.equal(h.windows[0].closed,true);await assert.rejects(h.api.product(''),/Save or select/);assert.equal(h.windows.length,1);
 const x=runtime();x.onRead(()=>{throw Error('SDS service unavailable');});await assert.rejects(x.api.product('a'),/SDS service unavailable/);assert.equal(x.windows[0].closed,true);
 const y=runtime();y.block();await assert.rejects(y.api.product('a'),/Allow pop-ups/);assert.equal(y.requests.length,0);
});
test('chooser cancel during a fresh register load closes the reserved window and suppresses late preview',async()=>{
 const h=runtime();h.api.open('register');await tick();const d=h.dialogs[0];let release;h.onRead(()=>new Promise(resolve=>{release=resolve;}));const pending=d.form.events.submit({preventDefault(){}});assert.equal(h.windows.length,1);d.nodes['[data-cancel]'].events.click();assert.equal(h.windows[0].closed,true);h.onRead(null);release();await pending;assert.equal(h.previews.length,0);assert.equal(d.d.isConnected,false);
});
test('chooser Escape during a saved-product load cancels it, while success keeps its preview open',async()=>{
 const h=runtime();h.api.open('product');await tick();const d=h.dialogs[0];d.fields.product.value='a';let release;h.onRead(()=>new Promise(resolve=>{release=resolve;}));const pending=d.form.events.submit({preventDefault(){}});d.d.events.cancel({preventDefault(){}});h.onRead(null);release();await pending;assert.equal(h.previews.length,0);assert.equal(h.windows[0].closed,true);
 const x=runtime();x.api.open('product');await tick();const good=x.dialogs[0];good.fields.product.value='a';good.fields.paper.value='A3';await good.form.events.submit({preventDefault(){}});assert.equal(x.previews[0].paper,'A3');assert.equal(x.windows[0].closed,false);assert.equal(good.d.isConnected,false);
});
test('existing toolbar and selected-card hooks lead to preview without legacy automatic print',async()=>{
 const h=runtime();assert.equal(typeof h.c.ccuPrint,'function');assert.equal(typeof h.c.chemPrintRegister,'function');assert.equal(typeof h.c.ccuPrintSelectedEmergencyCards,'function');h.c.aurisPrint=()=>{throw Error('Do not automatically print');};await h.c.ccuPrintSelectedEmergencyCards();assert.equal(h.previews.length,1);assert.match(h.previews[0].title,/Emergency Cards/);assert.match(h.previews[0].html,/DRAFT/);
});
