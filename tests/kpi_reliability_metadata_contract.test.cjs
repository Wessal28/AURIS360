const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('KPI writes persist editable details while storing only durable status values',()=>{
  const core=read('auris-core.js');
  assert.match(core,/function kpiStorageStatus\(value\)[\s\S]*'archived'[\s\S]*'not_started'/);
  for(const field of ['description','data_provider','data_source','reviewer','approver','approval_status'])assert.match(core,new RegExp(field+':'));
  assert.match(core,/existingKpi\?\.approval_status\|\|'draft'/);
  assert.match(core,/kpis_v2_status_check[\s\S]*entered information is still open/);
});

test('KPI editor exposes metadata, restores browser drafts and keeps approval state read-only',()=>{
  const upgrade=read('kpi-module-upgrade.js');
  for(const id of ['kpi-description','kpi-data-provider','kpi-data-source','kpi-reviewer','kpi-approver','kpi-approval-status'])assert.match(upgrade,new RegExp(id));
  assert.match(upgrade,/kpi-approval-status" value="draft" readonly/);
  assert.match(upgrade,/Data source<select id="kpi-data-source" required>/);
  for(const option of ['Manual entry','AURIS module','Evidence / document'])assert.match(upgrade,new RegExp(option));
  assert.match(upgrade,/function kpiXCaptureEditorDraft\(\)/);
  assert.match(upgrade,/function kpiXRestoreEditorDraft\(kpiId\)/);
  assert.match(upgrade,/sessionStorage\.setItem\(kpiXEditorDraftKey/);
  assert.match(upgrade,/\['data_missing','in_progress','not_due'\][\s\S]*'not_started'/);
  assert.match(upgrade,/\['not_started','on_track','at_risk','off_track'\]\.indexOf\(derived\)>=0/);
});

test('scorecard management controls are compact, labelled icon buttons',()=>{
  const upgrade=read('kpi-module-upgrade.js'),css=read('kpi-module-upgrade.css');
  assert.match(upgrade,/aria-label="Choose scorecard columns" title="Choose scorecard columns"[\s\S]*ti-adjustments-horizontal/);
  assert.doesNotMatch(upgrade,/ti-adjustments-horizontal"><\/i><span>Columns<\/span>/);
  assert.match(upgrade,/title="Edit objective"><i class="ti ti-pencil"><\/i><\/button>/);
  assert.match(css,/\.kpi-x-column-button \{width:38px;min-width:38px;height:38px/);
  assert.match(css,/\.kpi-x-row-edit \{width:34px;min-width:34px;height:34px;margin-left:auto/);
  assert.match(css,/\.kpi-x-editor-meta \{display:grid;grid-template-columns:1fr 1fr/);
  assert.match(css,/\.kpi-x-editor-meta input,\.kpi-x-editor-meta select,\.kpi-x-editor-meta textarea[^}]*font-size:13px;font-weight:400/);
});

test('Phase 27 migration adds KPI metadata and permits controlled archiving',()=>{
  const sql=read('supabase/migrations/20260903070000_modular_foundation_27_kpi_reliability.sql');
  for(const column of ['description','data_provider','data_source','reviewer','approver','approval_status'])assert.match(sql,new RegExp('add column if not exists '+column));
  assert.match(sql,/kpis_v2_status_check[\s\S]*'archived'/);
  assert.match(sql,/kpis_v2_approval_status_check[\s\S]*'revision_requested'/);
});

test('KPI assets are cache-busted and identify the current build',()=>{
  const html=read('index.html'),runtime=read('api/runtime-config.js');
  assert.match(html,/modular-foundation-29/);
  assert.match(runtime,/modular-foundation-29/);
  assert.match(html,/kpi-module-upgrade\.js\?v=20260903-29/);
  assert.match(html,/kpi-module-upgrade\.css\?v=20260903-29/);
});
