const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('Phase 29 exposes a fixed AURIS module metric catalog and clear result controls',()=>{
  const feature=read('kpi-data-source.js'),css=read('kpi-data-source.css'),html=read('index.html');
  for(const marker of ['events.reported','events.lost_time','observations.reported','inspections.completed','toolbox.completed','training.completed','risk.high_open','actions.closed','actions.overdue_open','Configure','Refresh result','Controlled exception','Calculation evidence'])assert.match(feature,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(feature,/configure_kpi_indicator_source/);assert.match(feature,/refresh_kpi_indicator_month/);assert.match(feature,/override_kpi_monthly_result/);
  assert.match(feature,/function autoRefreshCurrent\(\)/);assert.match(feature,/refresh_frequency/);assert.match(feature,/automaticAttempts/);
  assert.match(feature,/if\(ind&&ind\.source_mode==='module'\)/);
  assert.doesNotMatch(feature,/e\.target===node/);
  assert.match(css,/@media\(max-width:900px\)/);assert.match(css,/min-height:44px/);
  assert.match(css,/\.kpi-x-drawer \.kpi-x-btn/);assert.match(css,/font-family:Inter/);assert.match(css,/\.kpi-ds-inline-error/);
  assert.match(feature,/function showFailure\(/);assert.match(feature,/20260901010000_modular_foundation_9_governance_persistence\.sql/);assert.match(feature,/KPI migrations 27–29/);assert.match(feature,/Source not saved/);
  assert.doesNotMatch(feature,/notify\('Source not saved:/);
  assert.match(html,/kpi-data-source\.css\?v=20260903-29-1/);assert.match(html,/kpi-data-source\.js\?v=20260903-29-5/);
  assert.ok(html.indexOf('kpi-workflow.js?v=20260904-locked-monthly-1')<html.indexOf('kpi-data-source.js?v=20260903-29-5'));
});

test('database calculations are tenant-scoped, fixed-catalog, revision-safe and audited',()=>{
  const sql=read('supabase/migrations/20260903090000_modular_foundation_29_kpi_data_sources.sql');
  for(const marker of ['configure_kpi_indicator_source','refresh_kpi_indicator_month','override_kpi_monthly_result','auris_can_access_company','AURIS_KPI_TENANT_MISMATCH','AURIS_KPI_SOURCE_METRIC_UNSUPPORTED','AURIS_KPI_SOURCE_REVISION_CONFLICT','AURIS_KPI_RESULT_REVISION_CONFLICT','AURIS_KPI_OVERRIDE_REASON_REQUIRED','kpi_config_versions','source_evidence','source_record_count','audit_events','auris.kpi_result_write'])assert.match(sql,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
  assert.doesNotMatch(sql,/execute\s+format|\beval\b/i);
  assert.match(sql,/company_id=p_company_id/g);
  assert.match(sql,/grant execute on function public\.refresh_kpi_indicator_month[\s\S]*to authenticated/);
  assert.match(sql,/actor_role not in \('hse_manager','admin','sephs_admin'\)/);
});

test('Phase 28 lifecycle freezing remains in force while governed service writes are explicit',()=>{
  const sql=read('supabase/migrations/20260903090000_modular_foundation_29_kpi_data_sources.sql');
  assert.match(sql,/parent_state in \('submitted','verified','approved','locked'\)[\s\S]*AURIS_KPI_DATA_FROZEN/);
  assert.match(sql,/current_setting\('auris\.kpi_result_write',true\)='allowed'/);
  assert.match(sql,/perform set_config\('auris\.kpi_result_write','allowed',true\)/);
});

test('Phase 29 build marker and offline assets are published',()=>{
  const html=read('index.html'),runtime=read('api/runtime-config.js'),manifest=read('sw-assets.js');
  assert.match(html,/modular-foundation-29/);assert.match(runtime,/modular-foundation-29/);
  assert.match(manifest,/kpi-data-source\.js/);assert.match(manifest,/kpi-data-source\.css/);
});
