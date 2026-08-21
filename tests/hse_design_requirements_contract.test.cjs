const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('KPI corrective actions stay inside Objectives and KPIs and retain their source relationship', () => {
  const js = read('kpi-module-upgrade.js');
  const start = js.indexOf('function kpiXCreateAction');
  const end = js.indexOf('function kpiXGoMonthly', start);
  const section = js.slice(start, end);
  assert.match(section, /kpi-x-action-modal/);
  assert.doesNotMatch(section, /showPage\(['"]actions/);
  assert.match(section, /source_module:'kpi'/);
  assert.match(section, /relationshipCreate/);
});

test('BBS Draft is permissive while Submit applies the governance validation gate', () => {
  const js = read('bbs-observations.js');
  assert.match(js, /function validateObservation\(responses,submit\)\{if\(!submit\)return;/);
  assert.match(js, /function observationCategory\(responses\)/);
  assert.match(js, /data-bbs-observe-back|bbsObserveBack/);
});

test('Audits started from category tabs lock their inspection type', () => {
  const js = read('auris-core.js');
  const css = read('auris-audits-inspections-static.css');
  assert.match(js, /dataset\.lockedType/);
  assert.match(js, /Inspection type is fixed by the selected/);
  assert.match(css, /audit-type-locked/);
});

test('Work Schedule exposes linked safety preparation and event records', () => {
  const js = read('auris-core.js');
  for (const relation of ['Toolbox talk', 'Pre-start check', 'Site inspection', 'Risk assessment', 'Permit to work', 'Incident / hazard']) {
    assert.ok(js.includes(relation), `missing ${relation} relationship`);
  }
  assert.match(js, /patch\.linked_event_ref/);
});

test('Incident learning supports anonymised AI drafting and compulsory distribution', () => {
  const js = read('incident-management-upgrade.js');
  assert.match(js, /imv2AIDraftLesson/);
  assert.match(js, /Do not invent facts/);
  assert.match(js, /imv2ShareLesson/);
  assert.match(js, /acknowledgement_required:true/);
  assert.match(js, /queueNotification/);
});

test('Incident and risk dashboards use colourful icon tiles and standard card height', () => {
  const incident = read('incident-management-upgrade.css');
  const risk = read('risk-assessment-upgrade.css');
  assert.match(incident, /\.imx-metric-icon/);
  assert.match(incident, /min-height:118px/);
  assert.match(risk, /\.rax-metric-icon/);
  assert.match(risk, /min-height:118px/);
});
