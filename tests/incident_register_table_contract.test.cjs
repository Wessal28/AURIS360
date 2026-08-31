const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const upgrade = fs.readFileSync(path.join(root, 'incident-management-upgrade.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'incident-management-upgrade.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('Incident Register renders the complete filtered record table instead of dashboard analytics', () => {
  assert.match(core, /function imsFilterList\(\)\{\s*imsRenderIncidentRegister\(imsIncidentFiltered\(\)\);\s*\}/);
  assert.doesNotMatch(core, /function imsFilterList\(\)\{\s*imsRenderIncidentDashboard/);
  assert.match(core, /function imsRenderIncidentRegister\(data\)/);
  assert.match(core, /Incident reference[\s\S]*Actual severity[\s\S]*Potential severity[\s\S]*Investigation[\s\S]*Reported by/);
  assert.match(core, /data\.map\(function\(x\)/, 'the register must render every filtered record without a row slice');
  assert.match(css, /\.imx-incident-register-table\{min-width:1320px\}/);
});

test('Dashboard remains separate and the register defaults to all dates', () => {
  assert.match(upgrade, /\['dashboard','Dashboard'\][\s\S]*\['register','Incident Register'\]/);
  assert.match(upgrade, /function dashboardView\(\)/);
  assert.match(html, /<select id="ev-filter-range"[^>]*>\s*<option value="all">All dates<\/option>/);
  assert.match(html, /auris-core\.js\?v=20260831-1/);
  assert.match(html, /incident-management-upgrade\.css\?v=20260823-4/);
});
