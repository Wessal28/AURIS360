const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-dashboard-executive.css'), 'utf8');
const start = index.indexOf('<div id="page-executive"');
const end = index.indexOf('</div><!-- end page-executive -->', start);
const section = index.slice(start, end);

test('executive dashboard has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-dashboard-executive\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-exec-s-[a-f0-9]{10}/g) || []).length >= 154);
  assert.ok((css.match(/^\.auris-exec-s-[a-f0-9]{10}\{/gm) || []).length >= 73);
});

test('executive tabs, progress and reports remain runtime-controlled', () => {
  for (const id of ['page-executive', 'exec-compliance-prog-inner', 'exec-ai-output', 'exec-view-safety', 'exec-view-compliance', 'exec-view-esg', 'exec-view-reports', 'exec-report-output']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-exec-s-|<[^>]*class="[^"]*auris-exec-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-exec-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /width:0%/);
  assert.match(css, /transition:box-shadow \.15s/);
  assert.doesNotMatch(css, /!important/i);
});
