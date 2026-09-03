const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('KPI registry declares the governed lifecycle and two approval gates',()=>{
  const registry=read('auris-module-registry.js');
  assert.match(registry,/{key:'kpi'[\s\S]*lifecycle:{managed:true}/);
  for(const state of ['draft','submitted','verified','approved','locked','rejected','revision_requested'])assert.match(registry,new RegExp("'"+state+"'"));
  assert.match(registry,/approvalTransitions:\[\['submitted','verified'\],\['verified','approved'\]\]/);
  assert.match(registry,/from:'submitted',to:'verified'[\s\S]*role:'hse_officer'/);
  assert.match(registry,/from:'verified',to:'approved'[\s\S]*role:'hse_manager'/);
  assert.match(registry,/requiredFields:\['reviewer','approver','data_provider','data_source'\]/);
});

test('shared workflow service retains registry transition rules in its base policy',()=>{
  const service=read('auris-workflow-service.js');
  assert.match(service,/rules:Array\.from\(workflow\.rules\|\|\[\],[\s\S]*normaliseRule\(rule,allowed\)/);
});

test('KPI drawer exposes assigned review, approval, rejection, revision and locking controls',()=>{
  const feature=read('kpi-workflow.js'),css=read('kpi-module-upgrade.css'),html=read('index.html');
  for(const marker of ['AurisWorkflowService','AurisApprovalCentre','Submit for verification','Verify KPI','Approve KPI','Request KPI revision','Reject KPI','Lock approved KPI','Controlled and locked'])assert.match(feature,new RegExp(marker));
  assert.match(feature,/assigned\(kpi\.reviewer\)/);assert.match(feature,/assigned\(kpi\.approver\)/);
  assert.match(feature,/decide_kpi_workflow_approval/);assert.match(feature,/transition_kpi_lifecycle/);
  assert.match(feature,/if\(edit&&!canEdit\(kpi\)\)edit\.remove\(\)/);
  assert.match(feature,/version:'1\.0\.1'/);
  assert.match(feature,/services_loading/);assert.match(feature,/persistence_unavailable/);
  assert.match(feature,/Retry workflow/);assert.match(feature,/function retryWorkflow\(/);
  assert.match(feature,/setTimeout\(function\(\)\{enhanceDrawer\(kpiId\);\},0\)/);
  assert.match(css,/\.kpi-w-progress/);assert.match(css,/\.kpi-w-awaiting\.locked/);assert.match(css,/@media \(max-width:900px\)[\s\S]*min-height:44px/);
  assert.match(html,/kpi-workflow\.js\?v=20260903-29-2/);
  assert.ok(html.indexOf('kpi-module-upgrade.js?v=20260903-29')<html.indexOf('kpi-workflow.js?v=20260903-29-2'));
});

test('Approval Centre reopens the exact KPI source record',()=>{
  const core=read('auris-core.js');
  assert.match(core,/{key:'kpi',module:'Objectives & KPIs',table:'kpis_v2',page:'kpi'/);
  assert.match(core,/x\.opener==='kpi'[\s\S]*showPage\('kpi',null\)[\s\S]*kpiXOpenDrawer\(x\.open_id\)/);
  assert.match(core,/adapter\.key==='kpi'\?\(status==='submitted'\?row\.reviewer:row\.approver\)/);
});

test('database lifecycle is tenant-scoped, atomic, revision-safe and frozen after submission',()=>{
  const sql=read('supabase/migrations/20260903080000_modular_foundation_28_kpi_governance.sql');
  for(const marker of ['transition_kpi_lifecycle','decide_kpi_workflow_approval','auris_can_access_company','lifecycle_revision','for update','decide_workflow_approval_v2','AURIS_KPI_REVIEWER_MISMATCH','AURIS_KPI_APPROVER_MISMATCH','AURIS_KPI_DEFINITION_FROZEN','AURIS_KPI_DATA_FROZEN','audit_events'])assert.match(sql,new RegExp(marker));
  assert.match(sql,/module_name<>'kpi'/);assert.match(sql,/related_table<>'kpis_v2'/);
  assert.match(sql,/source_record_id::uuid/);assert.match(sql,/trg_protect_governed_kpi_monthly_data/);
  assert.match(sql,/grant execute on function public\.transition_kpi_lifecycle[\s\S]*to authenticated/);
});

test('current build markers and cache keys are published',()=>{
  const html=read('index.html'),runtime=read('api/runtime-config.js'),manifest=read('sw-assets.js');
  assert.match(html,/modular-foundation-29/);assert.match(runtime,/modular-foundation-29/);
  for(const asset of ['auris-module-registry.js','auris-workflow-service.js','auris-core.js','kpi-module-upgrade.css','kpi-module-upgrade.js'])assert.match(html,new RegExp(asset.replace('.', '\\.')+'\\?v=20260903-29'));
  assert.match(html,/kpi-workflow\.js\?v=20260903-29-2/);
  assert.match(manifest,/kpi-workflow\.js/);
});
