const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = fs.readFileSync(path.join(__dirname, '../auris-core.js'), 'utf8');
const between = (a, b) => core.slice(core.indexOf(a), core.indexOf(b, core.indexOf(a)));
function harness() {
  const nodes = new Map();
  const calls = [], notices = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { id, value: '', checked: false, disabled: false, hidden: true, textContent: '', style: {},
      innerHTML: '', addEventListener() {}, focus() {}, scrollIntoView() {}, setAttribute() {},
      querySelectorAll() { return []; }, querySelector() { return null; } });
    return nodes.get(id);
  }
  const ctx = { window: {}, document: { getElementById: node, querySelectorAll: () => [], querySelector: () => ({value:'hold'}) },
    prof: {id:'actor',full_name:'Test Supervisor'}, auditAllData: [], AUDIT_DEFAULT_CHECKLISTS: {},
    fillPersonSelect: (id,v) => node(id).value=v, fillRiskAssessmentSelect: (id,v) => node(id).value=v,
    ccid: ()=>'company-a', cf: ()=>'&company_id=eq.company-a', isMgr:()=>true, workflowCanMutate:()=>true,
    buildChecklist: () => { node('if-checklist').innerHTML='WRONG TABLE'; }, updateScore() {},
    escH:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    toast:(s)=>notices.push(s), actionErrorMessage:(a,b,c)=>c, api:async(q,o)=>{calls.push({q,o});return [{id:'saved',company_id:'company-a'}];},
    wsRecordReturnMatches:()=>false, wsAttachSavedRecord:async()=>{}, wsReturnToWork:()=>false,
    console, URL, Date };
  vm.createContext(ctx);
  const start = core.includes('// Pre-start checklist helpers') ? '// Pre-start checklist helpers' : 'function psNew()';
  vm.runInContext(between(start, 'async function psDelete()'),ctx);
  vm.runInContext(between('function psDecisionChange()', '// -- Misc backward compat'),ctx);
  ctx.psShowList=()=>{ctx.listShown=true;};
  return {ctx,node,calls,notices};
}
test('new pre-start renders its own ten items without touching the audit draft',()=>{
  const h=harness();h.ctx.window.chkItems=[{item:'Unsaved audit item'}];h.ctx.psNew();
  assert.match(h.node('ps-checklist-body').innerHTML,/Emergency procedures are known/);
  assert.equal(h.node('if-checklist').innerHTML,'');
  assert.equal(h.ctx.window.chkItems[0].item,'Unsaved audit item');
});
test('unanswered pre-start items are not silently marked N/A',()=>{
  const h=harness();h.ctx.psNew();const items=h.ctx.psCollectChecklist();
  assert.equal(items.length,10);assert.ok(items.every(i=>i.result===''));
});
test('opening saved pre-start preserves duplicate prompts and independent answers',()=>{
  const h=harness();h.ctx.psOpenData({id:'saved',company_id:'company-a',items:[
    {category:'A',item:'Check',result:'good',observation:'First'},
    {category:'B',item_name:'Check',result:'insufficient',observation:'Second'}]});
  const html=h.node('ps-checklist-body').innerHTML;
  assert.match(html,/First/);assert.match(html,/Second/);assert.match(html,/ps-result-1/);
});
test('invalid checklist cannot save and leaves the form open',async()=>{
  const h=harness();h.ctx.psNew();h.node('ps-activity').value='Task';h.node('ps-location').value='Site';
  await h.ctx.psSave();assert.equal(h.calls.length,0);assert.ok(!h.ctx.listShown);
  assert.match(h.node('ps-form-error').textContent,/mark each/i);
});
test('site inspection report includes recorded checklist and observations',()=>{
  const ctx={auditAllData:[{id:'site',company_id:'company-a',items:[{item:'Guard',result:'insufficient',observation:'Repair guard'}]}],ccid:()=> 'company-a',
    aurisReadOnlyRecordModal:(...args)=>{ctx.summary=args;},escH:String};
  vm.createContext(ctx);
  vm.runInContext(between('function auditOpenReadOnly(', '// -- CONTRACTOR FORM'),ctx);
  assert.equal(typeof ctx.auditInspectionReportHTML,'function');
  assert.match(ctx.auditInspectionReportHTML(ctx.auditAllData[0]),/Repair guard/);
});
function complete(h) {
  h.ctx.psNew();h.node('ps-activity').value='Task';h.node('ps-location').value='Site';
  for(let i=0;i<10;i++)h.node('ps-good-'+i).checked=true;
}
test('successful save includes visible answers, comments, hazards and controls',async()=>{
  const h=harness();complete(h);h.node('ps-good-0').checked=false;h.node('ps-insufficient-0').checked=true;
  h.node('ps-good-1').checked=false;h.node('ps-na-1').checked=true;
  h.node('ps-observation-0').value='Guard needs repair';h.node('ps-hazards').value='Moving parts';h.node('ps-controls').value='Isolate';
  h.node('ps-ppe-extra').value='Face shield';h.node('ps-sign-datetime').value='2026-09-09T14:31';
  h.ctx.psScore();assert.equal(h.node('ps-score').textContent,'89% · 10/10 answered');
  await h.ctx.psSave();const b=h.calls[0].o.b;
  assert.equal(b.items[0].result,'insufficient');assert.equal(b.items[0].observation,'Guard needs repair');
  assert.equal(b.items[1].result,'na');assert.equal(b.score_good,8);assert.equal(b.score_insuf,1);
  assert.equal(b.hazards,'Moving parts');assert.equal(b.controls,'Isolate');assert.equal(b.ppe_extra,'Face shield');
  assert.equal(b.sign_date,'2026-09-09');assert.equal(b.prestart_signed_at,'2026-09-09T14:31');
  assert.equal(h.calls[0].o.p,'return=representation');assert.equal(h.ctx.listShown,true);
});
test('all N/A has no fabricated percentage and remains explicit',()=>{
  const h=harness();h.ctx.psNew();for(let i=0;i<10;i++)h.node('ps-na-'+i).checked=true;
  h.ctx.psScore();assert.equal(h.node('ps-score').textContent,'— · 10/10 answered');
});
test('new pre-start clears old supplementary values and sign date',()=>{
  const h=harness();h.ctx.psOpenData({id:'old',company_id:'company-a',sign_date:'2025-01-01',hazards:'Old hazard',controls:'Old controls',ppe_extra:'Old PPE'});
  h.ctx.psNew();assert.equal(h.node('ps-hazards').value,'');assert.equal(h.node('ps-controls').value,'');
  assert.equal(h.node('ps-ppe-extra').value,'');assert.equal(h.ctx.window.psLegacySignDate,null);
});
test('existing signed date and archived state are not overwritten during edits',async()=>{
  const h=harness();h.ctx.psOpenData({id:'saved',company_id:'company-a',status:'archived',inspection_date:'2026-09-09',site:'Task',location:'Site',inspector:'Inspector',sign_date:'2026-09-08'});
  for(let i=0;i<10;i++)h.node('ps-good-'+i).checked=true;
  await h.ctx.psSave();assert.match(h.calls[0].q,/id=eq.saved&company_id=eq.company-a/);
  assert.equal(h.calls[0].o.b.sign_date,'2026-09-08');assert.equal(h.calls[0].o.b.status,'archived');
});
test('failed save leaves answers intact, reports inline and supports retry',async()=>{
  const h=harness();complete(h);h.node('ps-observation-0').value='Do not lose me';
  const api=h.ctx.api;h.ctx.api=async()=>{throw new Error("Could not find the 'activity' column in the schema cache");};
  await h.ctx.psSave();assert.ok(!h.ctx.listShown);assert.equal(h.ctx.window.psSaving,false);
  assert.match(h.node('ps-form-error').textContent,/database setup is incomplete/);
  assert.equal(h.node('ps-observation-0').value,'Do not lose me');h.ctx.api=api;await h.ctx.psSave();assert.equal(h.ctx.listShown,true);
});
test('empty save acknowledgement never reports success',async()=>{
  const h=harness();complete(h);h.ctx.api=async()=>[];await h.ctx.psSave();
  assert.ok(!h.ctx.listShown);assert.match(h.node('ps-form-error').textContent,/not confirmed/);assert.equal(h.notices.length,0);
});
test('duplicate click issues only one request while pending',async()=>{
  const h=harness();complete(h);let resolve;h.ctx.api=()=>{h.calls.push({});return new Promise(r=>resolve=r);};
  const saving=h.ctx.psSave();await h.ctx.psSave();assert.equal(h.calls.length,1);
  resolve([{id:'saved',company_id:'company-a'}]);await saving;
});
test('switching company before saving blocks mutation',async()=>{
  const h=harness();complete(h);h.ctx.ccid=()=> 'company-b';await h.ctx.psSave();
  assert.equal(h.calls.length,0);assert.match(h.node('ps-form-error').textContent,/Company changed/);
});
test('switching company during save does not close or refresh the new view',async()=>{
  const h=harness();complete(h);let resolve;h.ctx.api=()=>new Promise(r=>resolve=r);
  const saving=h.ctx.psSave();h.ctx.ccid=()=> 'company-b';resolve([{id:'saved',company_id:'company-a'}]);await saving;
  assert.ok(!h.ctx.listShown);assert.equal(h.notices.length,0);
});
test('cross-company cached record cannot open for editing',()=>{
  const h=harness();h.ctx.psOpenData({id:'foreign',company_id:'company-b'});assert.equal(h.ctx.window.psEditId,undefined);
});
function reportContext() {
  const h=harness();vm.runInContext(between('function auditOpenReadOnly(', '// -- CONTRACTOR FORM'),h.ctx);return h.ctx;
}
test('report renders every duplicate prompt, multiline text, action and sign-off',()=>{
  const c=reportContext();const html=c.auditInspectionReportHTML({items:[{item:'Check',result:'good',observation:'First\nline'},{item_name:'Check',result:'insufficient',obs:'Second'}],positive_obs:'Positive',negative_obs:'Improve',action_items:[{description:'Repair',responsible:'Supervisor',target_date:'2026-09-10'}],sign_inspector:'Signed inspector',sign_reviewer:'Signed reviewer'});
  for(const text of ['First\nline','Second','Positive','Improve','Repair','Supervisor','Signed inspector','Signed reviewer'])assert.ok(html.includes(text));
});
test('report escapes stored text and rejects active evidence URLs',()=>{
  const c=reportContext();const html=c.auditInspectionReportHTML({items:[{item:'<img src=x onerror=alert(1)>',observation:'</dd><script>x</script>'}],photos:[{url:'javascript:alert(1)',file_name:'<svg>'},{url:'https://example.com/evidence?a=1&b=2',file_name:'Safe'}]});
  assert.doesNotMatch(html,/<script>|<img|<svg>|href="javascript:/);assert.match(html,/&lt;img/);assert.match(html,/noopener noreferrer/);
});
test('legacy summary-only record is disclosed instead of inventing checklist answers',()=>{
  const c=reportContext();assert.match(c.auditInspectionReportHTML({score_good:21,score_insuf:0}),/score alone cannot reconstruct/);
});
test('pre-start report includes all persisted supplemental data',()=>{
  const c=reportContext();const html=c.auditInspectionReportHTML({inspection_type:'prestart',hazards:'Hazard',controls:'Control',ppe_required:['Hard hat'],tbt_done:false,stop_work_briefed:true,decision:'hold',decision_notes:'Hold explanation'});
  for(const text of ['Hazard','Control','Hard hat','Hold explanation','No','Yes'])assert.ok(html.includes(text));
});
test('report includes structured audit findings with escaped evidence',()=>{
  const c=reportContext();assert.match(c.auditInspectionFindingsHTML([{description:'Finding',evidence:'<b>Evidence</b>',corrective_action:'Correct',clause:'6.1'}]),/&lt;b&gt;Evidence&lt;\/b&gt;/);
});
test('additive migration covers every field sent by the pre-start form',async()=>{
  const h=harness();complete(h);await h.ctx.psSave();
  const baseline=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260820000000_production_schema_baseline.sql'),'utf8');
  const table=baseline.slice(baseline.indexOf('CREATE TABLE public.inspections ('),baseline.indexOf('\n);',baseline.indexOf('CREATE TABLE public.inspections (')));
  const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260909180000_inspection_prestart_form_fields.sql'),'utf8');
  for(const field of Object.keys(h.calls[0].o.b))assert.match(table+'\n'+migration,new RegExp('\\b'+field+'\\s+(?:text|uuid|jsonb|date|time|timestamp|boolean|integer|numeric)\\b'));
  assert.doesNotMatch(migration,/^\s*(drop|delete|update|insert|grant|create policy)\b/im);
  assert.match(migration,/notify pgrst/);
});
