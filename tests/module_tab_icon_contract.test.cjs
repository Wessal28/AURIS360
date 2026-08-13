const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'auris-icon-system.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-icon-system.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('shared decorator covers static and dynamically generated module tabs', () => {
  for (const selector of ['.module-tabs>button', '[class$="-tabs"]>button', '[role="tab"]', '.kpi-tab', '.mtg-tab']) {
    assert.ok(js.includes(selector), `missing tab selector ${selector}`);
  }
  assert.match(js, /new MutationObserver\(queue\)/);
  assert.match(js, /function applyTabs\(\)/);
});

test('tabs without icons receive a semantic glyph while existing icons are retained', () => {
  assert.match(js, /if\(!icon\)\{icon=document\.createElement\('i'\)/);
  assert.match(js, /tabGlyph\(text\)/);
  for (const concept of ['dashboard', 'incident', 'configuration', 'recognition', 'monthly']) assert.ok(js.includes(concept));
});

test('tab icons use the colourful AURIS visual language and active emphasis', () => {
  for (const tone of ['green', 'amber', 'red', 'purple', 'cyan']) assert.ok(css.includes(`data-tab-tone="${tone}"`));
  assert.match(css, /linear-gradient\(145deg/);
  assert.match(css, /auris-icon-tab\.active>i\.auris-tab-icon/);
});

test('new icon assets are cache-busted in the application shell', () => {
  assert.match(html, /auris-icon-system\.css\?v=20260813-6/);
  assert.match(html, /auris-icon-system\.js\?v=20260813-4/);
});
