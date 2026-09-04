const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=(name)=>fs.readFileSync(path.join(root,name),'utf8');

test('monthly KPI cells use CSP-safe delegated mouse, touch and keyboard activation',()=>{
  const js=read('kpi-module-upgrade.js');
  assert.doesNotMatch(js,/onclick="kpiOpenEntry/);
  assert.match(js,/data-kpi-month-entry="true"/);
  assert.match(js,/table\.addEventListener\('click',kpiXActivateMonthlyEntry\)/);
  assert.match(js,/table\.addEventListener\('keydown',kpiXActivateMonthlyEntry\)/);
  assert.match(js,/kpiOpenEntry\(cell\.getAttribute\('data-indicator-id'\)/);
});

test('monthly KPI table keeps both scrollbars inside a bounded visible viewport',()=>{
  const js=read('kpi-module-upgrade.js');
  const css=read('kpi-module-upgrade.css');
  assert.match(js,/classList\.add\('kpi-x-month-scroll'\)/);
  assert.match(css,/\.kpi-x-month-scroll \{[^}]*height:clamp\([^}]*overflow:auto!important/);
  assert.match(css,/scrollbar-gutter:stable both-edges/);
  assert.match(css,/touch-action:manipulation/);
});
