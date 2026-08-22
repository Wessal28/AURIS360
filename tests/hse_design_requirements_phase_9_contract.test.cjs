const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('Tools register separates Fleet vehicles and RCD assets', () => {
  const html = read('index.html');
  const js = read('auris-core.js');
  assert.doesNotMatch(html, /id="tools-tab-vehicles"/);
  assert.doesNotMatch(html, /id="tools-m3veh"/);
  assert.match(js, /function toolsIsGeneralEquipment/);
  assert.match(js, /category!==['"]vehicle['"]/);
  assert.match(js, /function toolsIsRCD/);
});

test('Equipment details include searchable, printable inspection history', () => {
  const html = read('index.html');
  const js = read('auris-core.js');
  assert.match(html, /id="tools-insp-search"/);
  assert.match(js, /function toolsOpenEquipmentDetail/);
  assert.match(js, /tool_id=eq\./);
  assert.match(js, /Print this equipment/);
  assert.match(js, /Print this inspection/);
});

test('Lifting category is locked and six-month frequency is supported', () => {
  const html = read('index.html');
  const js = read('auris-core.js');
  assert.match(html, /value="six_monthly">Every 6 months/);
  assert.match(js, /toolsCategoryLocked=true/);
  assert.match(js, /cat\.disabled=true/);
  assert.match(js, /six_monthly:183/);
});

test('Fleet owns its add and edit vehicle workflow', () => {
  const js = read('auris-core.js');
  assert.match(js, /function fleetNewVehicle\(\)\{fleetOpenVehicleForm\(null\);\}/);
  assert.match(js, /function fleetOpenVehicleForm/);
  assert.match(js, /category:'vehicle',is_vehicle:true/);
  const start = js.indexOf('function fleetMonthlyCheck');
  const end = js.indexOf('function fleetFuelNew', start);
  const section = js.slice(start, end);
  assert.match(section, /inspection_type:'vehicle_monthly'/);
  assert.doesNotMatch(section, /showPage\('tools'/);
});

test('ATEX exposes a tenant zoning plan and Site Map de-duplicates matched incidents', () => {
  const html = read('index.html');
  const js = read('auris-core.js');
  assert.match(html, /id="atex-plan-btn"/);
  assert.match(html, /id="atex-zoning-plan"/);
  assert.match(js, /function atexRenderZoningPlan/);
  assert.match(js, /function smUniqueRows/);
  assert.match(js, /function smMappedRows/);
  assert.match(js, /openInc=smMappedRows\(siteMapState\.events\)/);
  assert.match(js, /openEvents=siteMapState\.showEvents\?smMappedRows\(siteMapState\.events\)/);
});

test('Contractor row click opens a read-only record detail', () => {
  const js = read('auris-core.js');
  const start = js.indexOf('function conOpenDetail');
  const end = js.indexOf('// -- CONTRACTOR FORM', start);
  const section = js.slice(start, end);
  assert.match(section, /aurisReadOnlyRecordModal/);
  assert.doesNotMatch(section, /conEdit\(/);
});

test('Emergency, occupational health and PPE rows expose read-only details', () => {
  const js = read('auris-core.js');
  assert.match(js, /aurisBindReadOnlyRows\('page-emergency'/);
  assert.match(js, /aurisBindReadOnlyRows\('page-ohealth'/);
  assert.match(js, /aurisBindReadOnlyRows\('page-ppe'/);
  assert.match(js, /function aurisReadOnlyRecordModal/);
});

test('Contractor work package and mobilisation actions are operational', () => {
  const js = read('contractor-management-upgrade.js');
  assert.match(js, /M\.tab==='packages'\|\|M\.tab==='mobilisation'/);
  assert.match(js, /x\.planned_start\|\|today\(\)/);
  assert.match(js, /Complete required field:/);
  assert.match(js, /api\('\/contractor_work_packages'/);
  assert.match(js, /function\(id\).*contractor_mobilisation_gates/s);
});

test('ordered production migrations include the complete Noise workspace schema', () => {
  const migration = read('supabase/migrations/20260822010000_noise_management_schema_completion.sql');
  for (const table of [
    'noise_mgmt_map_versions',
    'noise_mgmt_map_points',
    'noise_mgmt_map_layers',
    'noise_mgmt_map_surfaces',
    'noise_mgmt_map_reviews',
    'noise_mgmt_config_records'
  ]) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  const manifest = JSON.parse(read('supabase/migrations/manifest.json'));
  assert.ok(manifest.migrations.some((entry) => entry.file === '20260822010000_noise_management_schema_completion.sql'));
});
