const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const source=fs.readFileSync('kpi-monthly-review.js','utf8');
const css=fs.readFileSync('kpi-monthly-review.css','utf8');

test('unavailable approval routes expose a governed configuration handoff',()=>{
  assert.match(source,/route\.error\?'<div class="kpi-mr-route-error" role="alert">/);
  assert.match(source,/data-mr-config/);
  assert.match(source,/Open KPI Configuration/);
  assert.match(source,/Update the published Approvals route, then reload this review/);
});

test('route handoff opens the workflow section without changing review data',()=>{
  const body=source.slice(source.indexOf('function openWorkflowConfig'),source.indexOf('async function open(options)'));
  assert.match(body,/kpiXSwitchTab\('configuration'\)/);
  assert.match(body,/kpiConfigLoad\(\)/);
  assert.match(body,/kpiConfigSection\('workflow'\)/);
  assert.doesNotMatch(body,/transition_kpi_monthly_review|api\(/);
});

test('route error styling keeps the remediation action visible on narrow screens',()=>{
  assert.match(css,/\.kpi-mr-route-error\{/);
  assert.match(css,/justify-self:start/);
});
