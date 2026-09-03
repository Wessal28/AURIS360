const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'kpi-module-upgrade.js'),'utf8');
const css=fs.readFileSync(path.join(root,'kpi-module-upgrade.css'),'utf8');

test('objectives and KPIs expose role-protected edit actions through the existing editors',()=>{
  assert.match(js,/data-kpi-edit-objective/);
  assert.match(js,/function kpiXEditObjective\(objectiveId\)[\s\S]*openObjModal\(objectiveId\)/);
  assert.match(js,/data-kpi-edit-kpi/);
  assert.match(js,/function kpiXEditKpi\(kpiId\)[\s\S]*openKpiAddModal\(k\.id,k\.objective_id\)/);
  assert.match(js,/function kpiXCanManage\(\).*isMgr/);
});

test('the active KPI drawer ignores backdrop taps and closes only from explicit controls',()=>{
  const active=js.slice(js.lastIndexOf('function kpiXOpenDrawer(kpiId)'),js.indexOf('function kpiXCreateAction(kpiId)'));
  assert.doesNotMatch(active,/event\.target===drawer/);
  assert.match(active,/data-kpi-drawer-close/);
  assert.match(active,/if\(close\)\{drawer\.remove\(\)/);
  assert.match(active,/role="dialog" aria-modal="true"/);
});

test('scorecard column chooser persists only display preferences per company and user',()=>{
  assert.match(js,/KPI_X_COLUMNS/);
  assert.match(js,/data-kpi-column-toggle/);
  assert.match(js,/data-kpi-column-menu/);
  assert.match(js,/auris360:kpi-scorecard-columns:/);
  assert.match(js,/localStorage\.setItem\(kpiXColumnStorageKey\(\),JSON\.stringify\(preferences\)\)/);
  assert.match(js,/columnCount=columns\.length\+1/);
  assert.match(css,/\.kpi-x-column-menu/);
  assert.match(css,/@media \(max-width:760px\)[\s\S]*\.kpi-x-column-button\{width:44px;min-width:44px;height:44px\}/);
});
