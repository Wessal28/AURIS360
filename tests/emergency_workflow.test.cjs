const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'auris-emergency-workflow.js'),'utf8');
function harness(){
  const fields=new Map(),calls=[],messages=[];
  const doc={getElementById(id){return fields.get(id)||null;},addEventListener(){},querySelectorAll(){return [];}};
  const context={document:doc,console,Date,Option:function(label,value){this.text=label;this.value=value;this.dataset={};},emPlansData:[],emBcpData:[],emDrillsData:[],emEqData:[],emActEditId:null,emPlanEditId:null,emBcpEditId:null,
    api:async(url,options)=>{calls.push({url,options});return [];},ccid:()=> 'company-1',cf:()=> '&company_id=eq.company-1',prof:{id:'person-1'},isMgr:()=>true,toast:(message)=>messages.push(message),appConfirmAction:async()=>true,
    emPlansLoad:async()=>{},bcpLoad:async()=>{},emPlanSave:async()=>{calls.push({save:'plan'});},bcpSave:async()=>{calls.push({save:'bcp'});},drillNew(){},drillEdit:async()=>{},drillSave:async()=>{},activationNew(){},activationEdit:async()=>{},musterNew(){},musterEdit(){},emLoadDash:async()=>{}};
  context.window=context;vm.createContext(context);vm.runInContext(source,context);
  return {context,fields,calls,messages};
}
function field(h,id,value){h.fields.set(id,{value});}

test('an incomplete active plan cannot save; a draft remains saveable',async()=>{
  const h=harness();field(h,'epf-status','active');await h.context.emPlanSave();assert.equal(h.calls.filter(c=>c.save).length,0);assert.match(h.messages[0],/Review before activation/);
  field(h,'epf-status','draft');await h.context.emPlanSave();assert.equal(h.calls.filter(c=>c.save==='plan').length,1);
});
test('activation of a reviewed plan requires a deliberate confirmation',async()=>{
  const h=harness();for(const [id,value] of Object.entries({'epf-status':'active','epf-approved-by':'Manager','epf-approved-date':'2026-10-13','epf-review-date':'2027-10-13','epf-activation':'Alarm','epf-immediate':'Evacuate','epf-title':'Fire plan','epf-version':'1.0'}))field(h,id,value);
  h.context.appConfirmAction=async()=>false;await h.context.emPlanSave();assert.equal(h.calls.filter(c=>c.save).length,0);
  h.context.appConfirmAction=async()=>true;await h.context.emPlanSave();assert.equal(h.calls.filter(c=>c.save==='plan').length,1);
});
test('plan-review follow-up is created once for an activation that requests it',async()=>{
  const h=harness();h.context.api=async(url,options)=>{h.calls.push({url,options});return [];};
  await h.context.emEnsurePlanReviewAction('activation-1','ACT-1',{plan_update_required:true,plan_id:null});
  assert.equal(h.calls.filter(c=>c.options?.m==='POST').length,1);
  const body=h.calls.find(c=>c.options?.m==='POST').options.b;assert.equal(body.source_id,'activation-1');assert.equal(body.status,'open');assert.match(body.description,/Review emergency plan/);
});
test('completed drill findings create distinct linked actions with owner and deadline',async()=>{
  const h=harness();field(h,'drf-action-owner','ERT lead');field(h,'drf-action-due','2026-11-01');
  h.fields.set('drf-additional-actions',{querySelectorAll:()=>[{querySelectorAll:()=>[{value:'Check alarm sounders'},{value:'Maintenance lead'},{value:'2026-11-05'}]}]});
  h.context.api=async(url,options)=>{h.calls.push({url,options});return url.startsWith('/action_tracker?')?[]:[];};
  await h.context.emEnsureDrillAction('drill-1','DRILL-1',{status:'completed',overall_rating:'needs_improvement',corrective_actions:'Update evacuation signs'});
  const created=h.calls.filter(c=>c.options?.m==='POST').map(c=>c.options.b);
  assert.equal(created.length,2);assert.equal(created[0].responsible,'ERT lead');assert.equal(created[0].target_date,'2026-11-01');assert.equal(created[1].responsible,'Maintenance lead');assert.equal(created[1].source_id,'drill-1');
});
test('safe defaults are set in both UI and database',()=>{
  const core=fs.readFileSync(path.join(root,'auris-core.js'),'utf8');
  const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261013000000_emergency_safe_defaults.sql'),'utf8');
  assert.match(core,/getElementById\('epf-status'\)\.value='draft'/);
  assert.match(core,/getElementById\('bcpf-status'\)\.value='draft'/);
  assert.match(core,/getElementById\('drf-rating'\)\.value=''/);
  assert.match(migration,/emergency_drills ALTER COLUMN overall_rating DROP DEFAULT/);
});
