const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const index = read('index.html');
const core = read('auris-core.js');
const incident = read('incident-management-upgrade.js');
const baseCss = read('auris-base.css');
const incidentCss = read('incident-management-upgrade.css');

test('company context presents the selected company identity without the redundant label', () => {
  assert.match(index, /id="sa-company-logo"/);
  assert.doesNotMatch(index, />Viewing:<\/span>/);
  assert.match(core, /aurisSafeMediaUrl\(selectedCompany\.logo_url,'image'\)/);
  assert.match(core, /class="sa-company-menu-logo"/);
});

test('floating AURIS AI control is draggable, bounded and persists its position', () => {
  assert.match(core, /function aiInitDrag\(\)/);
  assert.match(core, /setPointerCapture/);
  assert.match(core, /auris360_ai_position/);
  assert.match(core, /function aiClampPosition\(/);
  assert.match(baseCss, /\.ai-panel\.ai-dragging/);
});

test('work schedule team members are company-scoped employee multi-select choices', () => {
  assert.match(index, /<select id="wsf-team"[^>]*multiple/);
  assert.match(core, /function wsPopulateTeamSelect\(/);
  assert.match(core, /tenantPeople\(\)\.filter/);
  assert.match(core, /p\.person_type\|\|'employee'/);
  assert.match(core, /team_members:wsSelectedTeamNames\(\)/);
});

test('work schedule offers new, template and existing risk-assessment paths and links the result', () => {
  const start = core.indexOf('async function wsOpenRA()');
  const end = core.indexOf('function wsOpenPTW()', start);
  const section = core.slice(start, end);
  for (const choice of ['Create a new assessment', 'Create from a template', 'Choose an existing assessment']) {
    assert.ok(section.includes(choice), `missing ${choice}`);
  }
  assert.match(section, /appPrompt\(/);
  assert.match(section, /wsLinkedRecordChanged\('ra',selected\)/);
  const risk = read('risk-assessment-upgrade.js');
  assert.match(risk, /wsPendingRiskLink/);
  assert.match(risk, /risk_assessment_id:afterId/);
});

test('incident tabs wrap and dashboard attention opens a read-only incident view', () => {
  assert.match(incidentCss, /module-tabs\{display:flex;flex-wrap:wrap;overflow:visible/);
  assert.match(incident, /imv2OpenIncidentReadOnly/);
  assert.match(incident, /Read-only view/);
  assert.match(incident, /imx-attention-row/);
});

test('unsaved incident drawer changes use the internal confirmation dialog', () => {
  assert.match(incident, /appConfirm\(\{title:'Discard unsaved changes\?'/);
  assert.doesNotMatch(incident, /confirm\('Discard unsaved changes\?'/);
});
