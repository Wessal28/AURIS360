const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('executive dashboard root is not born with a hidden utility class', () => {
  const html = read('index.html');
  assert.match(html, /<div id="page-executive" class="page auris-exec-s-a11ce00001">/);
  assert.doesNotMatch(html, /<div id="page-executive" class="[^"]*auris-exec-s-6aa34d7432/);
});

test('monthly KPI tab explicitly displays the selected legacy-hidden view', () => {
  const source = read('kpi-module-upgrade.js');
  assert.match(source, /view\.style\.display=active\?'block':'none'/);
});

test('Safety Engagement page has no persistent inline hidden state', () => {
  const source = read('safety-engagement.js');
  assert.doesNotMatch(source, /page\.id='page-engagement'.*page\.style\.display='none'/);
});

test('Document Control shell preserves router activation', () => {
  const source = read('document-control-upgrade.js');
  assert.match(source, /var wasActive=page\.classList\.contains\('active'\)/);
  assert.match(source, /page\.className='page dcx-page'\+\(wasActive\?' active':''\)/);
});

test('router reasserts visibility after dynamic module loading', () => {
  const source = read('auris-core.js');
  assert.match(source, /const activateRoutedPage=function\(\)/);
  assert.match(source, /if\(target\.style\.getPropertyValue\('display'\)==='none'\)target\.style\.removeProperty\('display'\)/);
  assert.match(source, /pageLoadResult\.then\(activateRoutedPage/);
});
