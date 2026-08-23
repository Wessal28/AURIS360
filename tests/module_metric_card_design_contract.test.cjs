const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('metric-card decorator excludes only the Main Dashboard', () => {
  const script = read('auris-icon-system.js');

  assert.match(script, /if\(card\.closest\('#page-dashboard'\)\)return/);
  assert.doesNotMatch(script, /#page-dashboard,#page-kpi/);
  assert.match(script, /\.page \.kpi-x-metric/);
});

test('module metric cards use pictorial artwork and a coloured left border', () => {
  const css = read('auris-icon-system.css');

  assert.match(css, /border-left:5px solid var\(--indicator\)!important/);
  assert.match(css, /\.auris-indicator-icon\{[\s\S]*background-image:var\(--auris-icon-atlas\)!important/);
  assert.match(css, /\.auris-indicator-icon>i\{content:none!important;display:none!important\}/);
  assert.match(css, /data-indicator-icon="incident"/);
  assert.match(css, /data-indicator-icon="training"/);
});

test('Main Dashboard artwork mappings remain present and unchanged by module decoration', () => {
  const css = read('auris-icon-system.css');

  assert.match(css, /#page-dashboard \.kpi-card \.kpi-icon/);
  assert.match(css, /#page-dashboard :is\(\[data-id="dp-days"\],\[data-id="d-events"\]/);
  assert.match(css, /#page-dashboard \[data-id="d-permits"\] \.kpi-icon/);
});
