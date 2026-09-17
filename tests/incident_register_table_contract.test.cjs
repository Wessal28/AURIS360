const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const upgrade = fs.readFileSync(path.join(root, 'incident-management-upgrade.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'incident-management-upgrade.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('Incident Register renders the complete filtered record table instead of dashboard analytics', () => {
  const filterSource = core.slice(core.indexOf('function imsFilterList(){'), core.indexOf('// --- REPORT FORM', core.indexOf('function imsFilterList(){')));
  const records = [{id:'one'}, {id:'two'}];
  const host = {};
  let mounted, rendered;
  const context = {window:{AurisIncidentListWorkspace:{mount:(element,rows)=>{mounted={element,rows};}}}, document:{getElementById:id=>id==='ims-register-inner'?host:null}, imsAllData:records, imsIncidentFiltered:()=>records, imsRenderIncidentRegister:rows=>{rendered=rows;}};
  vm.runInNewContext(filterSource, context);
  context.imsFilterList();
  assert.equal(mounted.element, host);
  assert.equal(mounted.rows, records, 'shared register receives every record for scoped filtering');
  assert.equal(rendered, undefined);
  context.window.AurisIncidentListWorkspace = null;
  context.imsFilterList();
  assert.equal(rendered, records, 'legacy fallback retains every filtered record');
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
  assert.match(html, /auris-core\.js\?v=20260903-29/);
  assert.match(html, /incident-management-upgrade\.css\?v=20260831-4/);
});
