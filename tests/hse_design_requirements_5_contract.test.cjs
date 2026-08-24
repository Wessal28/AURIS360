const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const core = read('auris-core.js');
const css = read('requirements-5.css');
const enhancements = read('requirements-5.js');
const chemical = read('chemical-control-upgrade.js');
const incidents = read('incident-management-upgrade.js');
const html = read('index.html');
const migration = read('supabase/migrations/20260824010000_requirements_5_rcd_fleet.sql');

test('RCD register separates devices from test instruments and supports make, DB reference and both print modes', () => {
  assert.match(core, /isTestInstrument=.*rcd/si);
  assert.match(core, /rcda-make/);
  assert.match(core, /distribution_board_reference/);
  assert.match(core, /function toolsPrintRCDHistory/);
  assert.match(core, /function toolsPrintRCDRegister/);
  assert.match(migration, /add column if not exists distribution_board_reference text/);
});

test('Fleet has a read-only four-tab vehicle viewer and persistent servicing records', () => {
  assert.match(core, /function fleetOpenVehicleDetail/);
  for (const label of ['Details','Inspection records','Fuel consumption','Servicing records']) assert.match(core, new RegExp(label));
  assert.match(core, /equipment_maintenance_events/);
  assert.match(core, /function fleetOpenServiceForm/);
});

test('Site Map is map-first, supports record positioning and opens incident/location details', () => {
  assert.match(css, /#page-sitemap \.auris-site-map-s-2b25fa4835\{display:flex;flex-direction:column/);
  assert.match(core, /data-sitemap-canvas="true"/);
  assert.match(core, /function smPositionRecord/);
  assert.match(core, /record_type==='event'/);
  assert.match(core, /imv2OpenIncidentReadOnly/);
  assert.match(core, /sitemap-location-modal/);
});

test('requested module records open read-only before explicit edit', () => {
  for (const id of ['fire-cert-tbody','fire-insp-tbody','fire-equip-tbody','fire-layout-plan-list','lca-list','swms-list','con-pa-list','con-ev-list','con-atw-list']) assert.match(enhancements, new RegExp(id));
  assert.match(enhancements, /Read-only record/);
  assert.match(enhancements, /bindDocumentCards/);
  assert.match(core, /function mtgViewMomReadOnly/);
});

test('chemical approvals are read-only first and emergency cards print by selection', () => {
  assert.match(chemical, /window\.ccuViewUse/);
  assert.match(chemical, /window\.ccuPrintSelectedEmergencyCards/);
  assert.match(chemical, /ccu-emergency-select:checked/);
  assert.match(chemical, /ccuCloseDrawer\(\);window\.chemEdit/);
});

test('incident lessons create a linked Safety Bulletin and e-learning uses visual cards', () => {
  assert.match(incidents, /safety_bulletins/);
  assert.match(incidents, /Safety Communication and linked Safety Bulletin/);
  assert.match(core, /lcu-course-grid/);
  assert.match(core, /thumbnail_url/);
  assert.match(core, /i\.ytimg\.com/);
});

test('requirements assets are cache-busted and Main Dashboard remains outside this override', () => {
  assert.match(html, /requirements-5\.css\?v=20260824-1/);
  assert.match(html, /requirements-5\.js\?v=20260824-1/);
  assert.doesNotMatch(css, /#page-dashboard/);
  assert.doesNotMatch(enhancements, /page-dashboard/);
});
