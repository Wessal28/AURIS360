const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = require('./application_source.cjs')(root);
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const icons = fs.readFileSync(path.join(root, 'auris-icon-system.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-mobile-responsive.css'), 'utf8');

test('mobile content retains a single vertical touch scroll container', () => {
  assert.match(css, /\.main\s*\{[\s\S]*overflow-y:\s*auto\s*!important[\s\S]*touch-action:\s*pan-y\s*!important/);
  assert.match(css, /\.page,\s*\.page\.active\s*\{[\s\S]*height:\s*auto\s*!important/);
});

test('mobile module drawer opens and closes through classes without stale transforms', () => {
  const open = core.slice(core.indexOf('function mobileOpenModules('), core.indexOf('function mobileCloseModules('));
  const close = core.slice(core.indexOf('function mobileCloseModules('), core.indexOf('function mobileRenderModulesGrid('));
  assert.match(open, /panel\.classList\.add\('open'\)/);
  assert.match(close, /panel\.classList\.remove\('open'\)/);
  assert.doesNotMatch(open + close, /style\.transform\s*=/);
  assert.match(css, /#mobile-modules-drawer\.open #mobile-modules-panel/);
  assert.match(html, /id="mobile-modules-drawer"[^>]+aria-hidden="true"/);
});

test('dynamic mobile navigation uses the shared colourful AURIS module artwork', () => {
  assert.match(core, /data-nav-key="' \+ m\.k/);
  assert.match(core, /auris-module-icon/);
  assert.match(icons, /\.mob-module-btn,\.mob-search-result/);
  assert.match(icons, /if\(el\.dataset\.page\)return el\.dataset\.page/);
});

test('phone typography is compact and the new layer is cache-busted', () => {
  assert.match(css, /font-size:\s*21px\s*!important/);
  assert.match(css, /font-size:\s*10\.5px\s*!important/);
  assert.match(css, /#app \.page \.page-title/);
  assert.match(css, /#app #page-kpi \.kpi-x-title/);
  assert.match(css, /\[role="tab"\]/);
  assert.match(html, /auris-mobile-responsive\.css\?v=20260816-5/);
  assert.match(html, /auris-icon-system\.js\?v=20260816-1/);
});

test('dense operational tables have dedicated touch-scroll containers', () => {
  assert.ok((html.match(/class="auris-mobile-table-scroll"/g) || []).length >= 5);
  assert.match(css, /\.auris-mobile-table-scroll[\s\S]*overflow-x:\s*auto\s*!important/);
  assert.match(css, /#page-esg \.card:has\(> table\.auris-esg-s-0ae64748d8\)/);
});

test('mobile forms and filters retain readable touch-friendly controls', () => {
  assert.match(css, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/);
  assert.match(css, /min-height:\s*42px\s*!important/);
  assert.match(css, /#app \.page input:not[\s\S]*#app \.page textarea[\s\S]*font-size:\s*16px\s*!important/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*\[class\*="-filters"\][\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)\s*!important/);
});
