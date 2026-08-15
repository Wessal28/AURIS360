const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-runtime-state.css'), 'utf8');

function section(startMarker, endMarker) {
  const start = core.indexOf(startMarker);
  const end = core.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing section ${startMarker}`);
  return core.slice(start, end);
}

test('dashboard role and alert visibility use the shared class state helper', () => {
  const loader = section('async function loadDash(options)', '// DASHBOARD REDESIGN HELPERS');
  const router = section('function dashRouteView()', 'function dashIsDoneStatus');
  assert.doesNotMatch(loader, /alertBar\.style\.display|banner\.style\.display|refreshIcon\.style\.animation/);
  assert.match(loader, /aurisSetDisplay\(alertBar,'flex'\)/);
  assert.match(loader, /aurisSetDisplay\(banner,'none'\)/);
  assert.match(loader, /classList\.add\('auris-runtime-spinner'\)/);
  assert.doesNotMatch(router, /\.style\.display/);
  assert.match(router, /aurisSetDisplay\(perView,'block'\)/);
});

test('dashboard modal containers are class-defined and class-toggled', () => {
  const control = section('function dashOpenControlCentreModal', 'function dashJs');
  const meeting = section('function dashOpenMeetingChecklist', 'function clientDemoSummaryText');
  const review = section('function dashOpenDemoReview', 'function copyClientDemoReview');
  for (const source of [control, meeting, review]) {
    assert.doesNotMatch(source, /modal\.style\.(display|cssText)/);
    assert.match(source, /aurisSetDisplay\(modal,'flex'\)/);
    assert.match(source, /aurisSetDisplay\(modal,'none'\)/);
  }
  assert.match(meeting, /modal\.className='auris-runtime-modal'/);
  assert.match(review, /auris-runtime-modal--review/);
  assert.match(css, /\.auris-runtime-modal\{display:none;position:fixed/);
});

test('dashboard panels and personal actions no longer write display styles', () => {
  const control = section('function dashRenderControlCentre(data)', 'function dashRenderDemoReadiness');
  const readiness = section('function dashRenderDemoReadiness(data)', 'function dashOpenMeetingChecklist');
  const personal = section('async function dashRenderPersonal', 'function renderPersonalList');
  assert.doesNotMatch(control, /(?:panel|oldReadiness)\.style\.display/);
  assert.doesNotMatch(readiness, /panel\.style\.display/);
  assert.doesNotMatch(personal, /(?:permitBtn|trainingBtn|incidentBtn|bbsBtn|permitSection)\.style\.display/);
  assert.match(control, /aurisSetDisplay\(panel,'block'\)/);
  assert.match(readiness, /aurisSetDisplay\(panel,visible\?'block':'none'\)/);
  assert.match(personal, /aurisSetDisplay\(permitSection,'none'\)/);
});

test('executive dashboard tab visibility uses the shared helper', () => {
  const tabs = section('function execTab(tab, btn)', 'function execRenderAnnualTrend');
  assert.doesNotMatch(tabs, /\.style\.display/);
  assert.match(tabs, /aurisSetDisplay\(el,t===tab\?'block':'none'\)/);
});
