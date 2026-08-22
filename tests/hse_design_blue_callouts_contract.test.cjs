const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const toolsCss = fs.readFileSync(path.join(root, 'tools-equipment-upgrade.css'), 'utf8');
const toolsJs = fs.readFileSync(path.join(root, 'tools-equipment-upgrade.js'), 'utf8');

test('tools navigation wraps into rows without horizontal scrolling', () => {
  assert.match(toolsCss, /\.teu-tabs\{flex-wrap:wrap;overflow:visible\}/);
  assert.match(toolsCss, /\.teu-tabs button\{flex:1 1 calc\(16\.666% - 7px\);min-width:150px\}/);
});

test('Fleet owns vehicles and Tools does not expose a duplicate Vehicles workspace', () => {
  const shellStart = toolsJs.indexOf('function ensureShell()');
  const shellEnd = toolsJs.indexOf('function ensureDrawer()', shellStart);
  const shell = toolsJs.slice(shellStart, shellEnd > shellStart ? shellEnd : toolsJs.length);
  assert.doesNotMatch(shell, /\['vehicles','ti-car','Vehicles'\]/);
  assert.match(core, /function fleetNewVehicle\(\)/);
});

test('inspection and ERT selectors use selected-company people only', () => {
  assert.match(core, /function tenantPeople\(\)/);
  assert.match(core, /function fillPersonSelect[\s\S]*?tenantPeople\(\)\.map/);
  assert.match(core, /Select inspector[\s\S]*?tenantPeople\(\)\.forEach/);
});

test('failed equipment inspections use an allowed MAP source and preserve the saved result', () => {
  assert.doesNotMatch(core, /source_module:'tools'/);
  assert.match(core, /source_module:'inspection'/);
  assert.match(core, /Inspection saved\. The MAP follow-up could not be created/);
});

test('inspection back navigation restores the actual originating tools tab', () => {
  assert.match(core, /activeToolsTab[\s\S]*?activeToolsTab==='register'\?'register':'inspection'/);
  assert.match(core, /function toolsInspFormBack\(\)[\s\S]*?teuSwitch\(target\)/);
});

test('issue equipment actions use standard icon buttons', () => {
  assert.match(toolsJs, /class="btn"[^>]*><i class="ti ti-arrow-left"><\/i>Cancel/);
  assert.match(toolsJs, /class="btn btn-primary"[^>]*><i class="ti ti-device-floppy"><\/i>Issue equipment/);
});

test('RCD records have a dedicated form and printed registers use the company logo header', () => {
  for (const label of ['Distribution board reference','RCD rating','Circuit protected']) assert.match(core, new RegExp(label));
  assert.match(core, /function toolsSaveRCDAsset/);
  assert.match(core, /function toolsPrintCurrentView[\s\S]*?RCD Monthly Testing Register/);
  assert.match(core, /function printRegisterView[\s\S]*?aurisHeader/);
  assert.match(core, /function aurisHeader[\s\S]*?companyLogo/);
});

test('contractor scoring, conditional recommendation and PPE selector are wired', () => {
  assert.doesNotMatch(core.slice(core.indexOf('function cevBuildScores'), core.indexOf('function cevSetScore')), /onclick=/);
  assert.match(core, /\.cev-score-btn'\)\.forEach[\s\S]*?addEventListener\('click'/);
  assert.match(index, /option value="conditional">Yes with conditions<\/option>/);
  assert.match(index, /id="catwf-ppe-select-btn"/);
  assert.match(core, /function catwOpenPPESelector/);
});
