const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('KPI editor refreshes every person selector from the active company',()=>{
  const upgrade=read('kpi-module-upgrade.js');
  assert.match(upgrade,/function kpiXRefreshEditorPeople\(\)/);
  for(const id of ['kpi-resp','kpi-data-provider','kpi-reviewer','kpi-approver'])assert.match(upgrade,new RegExp("'"+id+"'"));
  assert.match(upgrade,/await loadPeopleCache\(\)/);
  assert.match(upgrade,/kpiXRestoreEditorDraft\(kpiId\);kpiXRefreshEditorPeople\(\)/);
  assert.match(upgrade,/No active people available for this company/);
});

test('company context changes refresh shared people and location caches',()=>{
  const core=read('auris-core.js');
  assert.match(core,/async function saCompanyPick\(companyId\)[\s\S]*Promise\.all\(\[loadPeopleCache\(\),loadLocationSitesCache\(\)\]\)/);
  assert.match(core,/Could not refresh active people/);
});
