const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('KPI approval configuration uses tenant people selectors',()=>{
  const config=read('kpi-configuration.js');
  assert.match(config,/function workflowPeople\(path\)[\s\S]*tenantPeople/);
  for(const marker of ['Stage 1 · KPI owner / data provider','Stage 2 · Reviewer','Stage 3 · Approver'])assert.match(config,new RegExp(marker));
  assert.doesNotMatch(config,/input\('workflow\.stage1','Stage 1','text'/);
});

test('self approval synchronises all three configured people',()=>{
  const config=read('kpi-configuration.js');
  assert.match(config,/path==='workflow\.self_approval'&&raw[\s\S]*stage2=cfg\(\)\.workflow\.stage1[\s\S]*stage3=cfg\(\)\.workflow\.stage1/);
  assert.match(config,/path==='workflow\.stage1'&&cfg\(\)\.workflow\.self_approval[\s\S]*stage2=raw[\s\S]*stage3=raw/);
});

test('published routing becomes the default on new KPI records',()=>{
  const core=read('auris-core.js');
  assert.match(core,/kpi-resp',publishedWorkflow\.stage1/);
  assert.match(core,/kpi-data-provider',publishedWorkflow\.stage1/);
  assert.match(core,/kpi-reviewer',publishedWorkflow\.stage2/);
  assert.match(core,/kpi-approver',publishedWorkflow\.stage3/);
});

test('workflow feedback renders above drawer and modal layers',()=>{
  assert.match(read('kpi-module-upgrade.css'),/\.toast\{z-index:30000!important\}/);
});
