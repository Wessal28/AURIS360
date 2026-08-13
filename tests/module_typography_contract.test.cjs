const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'auris-icon-system.css'), 'utf8');
const kpiCss = fs.readFileSync(path.join(root, 'kpi-module-upgrade.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('other module pages inherit the Objectives and KPIs system font without restyling the reference module', () => {
  assert.match(css, /--auris-module-font:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif/);
  assert.match(css, /\.page:not\(#page-kpi\),\.page:not\(#page-kpi\) button/);
  assert.doesNotMatch(css, /^\.page,\.page button/m);
  assert.match(css, /font-family:var\(--auris-module-font\)!important/);
});

test('the shared hierarchy matches the KPI reference dimensions', () => {
  assert.match(kpiCss, /kpi-x-title \{font-size:25px/);
  for (const token of [
    '--auris-type-title:25px', '--auris-type-description:12px', '--auris-type-kicker:10px',
    '--auris-type-tab:11px', '--auris-type-tab-active:13px', '--auris-type-control:12px',
    '--auris-type-panel:14px', '--auris-type-table:11px'
  ]) assert.ok(css.includes(token), `missing typography token ${token}`);
});

test('headings tabs controls panels tables and labels use the shared hierarchy', () => {
  for (const selector of ['-hero"] h1', '-kicker"]', '-tabs"]>button', '.form3label', '-panel-title', '.page:not(#page-kpi) table th']) {
    assert.ok(css.includes(selector), `missing typography coverage ${selector}`);
  }
});

test('typography stylesheet is cache-busted for deployment and offline refresh', () => {
  assert.match(html, /auris-icon-system\.css\?v=20260814-2/);
});

test('KPI header retains its functional subtitle rather than showing a company name', () => {
  const js = fs.readFileSync(path.join(root, 'kpi-module-upgrade.js'), 'utf8');
  assert.match(js, /label\.textContent='Company performance'/);
  assert.doesNotMatch(js, /label\.textContent=\(typeof co/);
});
