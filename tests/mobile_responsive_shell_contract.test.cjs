const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = require('./application_source.cjs')(root);
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const icons = fs.readFileSync(path.join(root, 'auris-icon-system.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-mobile-responsive.css'), 'utf8');

test('tablet content retains a vertical touch scroll container', () => {
  assert.match(css, /\.main\s*\{[\s\S]*overflow-y:\s*auto\s*!important[\s\S]*touch-action:\s*pan-y\s*!important/);
  assert.match(css, /\.page,\s*\.page\.active\s*\{[\s\S]*height:\s*auto\s*!important/);
});

test('phones restore native document scrolling below fixed navigation', () => {
  const phone = css.slice(css.lastIndexOf('@media (max-width: 480px)'));
  assert.match(phone, /html,\s*\n\s*body\s*\{[\s\S]*overflow-y:\s*auto\s*!important/);
  assert.match(phone, /#app\s*\{[\s\S]*position:\s*relative\s*!important[\s\S]*overflow:\s*visible\s*!important/);
  assert.match(phone, /#app \.main\s*\{[\s\S]*position:\s*relative\s*!important[\s\S]*overflow-x:\s*clip\s*!important[\s\S]*overflow-y:\s*visible\s*!important/);
  assert.match(phone, /padding-bottom:\s*calc\(74px \+ env\(safe-area-inset-bottom, 0px\)\)\s*!important/);
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

test('mobile sidebar and module drawer retain independent vertical touch scrolling', () => {
  const navigation = css.slice(css.lastIndexOf('/* Keep both mobile navigation surfaces'));
  assert.match(navigation, /#app \.sidebar,[\s\S]*#app \.sidebar\.open[\s\S]*height:\s*100dvh\s*!important[\s\S]*overflow-y:\s*auto\s*!important[\s\S]*touch-action:\s*pan-y\s*!important/);
  assert.match(navigation, /#app \.sidebar > :is\([\s\S]*\.nav-item,[\s\S]*\.sb-footer[\s\S]*flex-shrink:\s*0\s*!important/);
  assert.match(navigation, /#mobile-modules-panel\s*\{[\s\S]*display:\s*flex\s*!important[\s\S]*overflow:\s*hidden\s*!important/);
  assert.match(navigation, /#mobile-modules-grid\s*\{[\s\S]*flex:\s*1 1 auto\s*!important[\s\S]*overflow-y:\s*auto\s*!important[\s\S]*touch-action:\s*pan-y\s*!important/);
});

test('dynamic mobile navigation uses the shared colourful AURIS module artwork', () => {
  assert.match(core, /data-nav-key="' \+ m\.k/);
  assert.match(core, /auris-module-icon/);
  assert.match(icons, /\.mob-module-btn,\.mob-search-result/);
  assert.match(icons, /if\(el\.dataset\.page\)return el\.dataset\.page/);
});

test('CSP-safe sidebar handlers retain the previous colourful module artwork', () => {
  assert.match(icons, /sidebarHandlerKeys=\{h0027:'dashboard'[\s\S]*h0062:'settings'\}/);
  assert.match(icons, /getAttribute\('data-auris-onclick'\)/);
  assert.match(icons, /if\(id\.indexOf\('nav-'\)===0\)/);
  assert.match(core, /el\.dataset\.navKey = pageKey/);
});

test('phone typography is compact and the new layer is cache-busted', () => {
  assert.match(css, /font-size:\s*21px\s*!important/);
  assert.match(css, /font-size:\s*10\.5px\s*!important/);
  assert.match(css, /#app \.page \.page-title/);
  assert.match(css, /#app #page-kpi \.kpi-x-title/);
  assert.match(css, /\[role="tab"\]/);
  assert.match(html, /auris-mobile-responsive\.css\?v=20260818-1/);
  assert.match(html, /auris-icon-system\.js\?v=20260817-1/);
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

test('mobile dialogs and operational drawers stay inside a scrollable viewport', () => {
  assert.match(css, /#app :is\(\[id\$="-modal"\], \[id\$="modal"\]\)[\s\S]*max-height:\s*100dvh\s*!important[\s\S]*overflow-y:\s*auto\s*!important/);
  assert.match(css, /\[id\$="modal"\]\) > :first-child[\s\S]*max-width:\s*calc\(100vw - 20px\)\s*!important/);
  assert.match(css, /\.bbs-drawer,[\s\S]*\.imx-drawer[\s\S]*max-width:\s*100vw\s*!important/);
});

test('mobile interaction keeps named icon actions and visible keyboard focus', () => {
  for (const label of [
    'Previous week',
    'Next week',
    'Add attendee',
    'Add legal reference',
    'Previous meeting period',
    'Next meeting period',
    'Previous training year',
    'Next training year'
  ]) {
    assert.match(html, new RegExp(`aria-label="${label}"`));
  }
  assert.match(css, /:focus-visible[\s\S]*outline:\s*3px solid #2563eb\s*!important/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /scroll-padding-bottom:\s*calc\(82px \+ env\(safe-area-inset-bottom, 0px\)\)/);
});
