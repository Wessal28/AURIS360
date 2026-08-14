const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-legal-compliance-static.css'), 'utf8');
const start = index.indexOf('<div id="page-legal"');
const end = index.indexOf('<div id="page-fleet"', start);
const section = index.slice(start, end);

test('Legal Compliance has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-legal-compliance-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-legal-s-[a-f0-9]{10}/g) || []).length >= 263);
  assert.ok((css.match(/^\.auris-legal-s-[a-f0-9]{10}\{/gm) || []).length >= 144);
});

test('Register, change, assessment, remediation and calendar states remain runtime-controlled', () => {
  for (const id of ['legal-new-btn', 'lr-pdf-import-panel', 'legal-view-changes', 'legal-view-assessments', 'legal-view-gaps', 'legal-view-calendar', 'legal-view-dashboard', 'legal-ai-response', 'legal-req-form', 'lr-review-card', 'legal-chg-form', 'lca-form', 'gap-form', 'cal-form']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-legal-s-|<[^>]*class="[^"]*auris-legal-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-legal-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /transition:width \.5s/);
  assert.match(css, /#lr-gap\.auris-legal-s-[a-f0-9]{10}\{width:18px!important;height:18px!important;/);
  assert.equal((css.match(/!important/g) || []).length, 12);
  assert.doesNotMatch(css.replace(/(?:width|height):18px!important/g, ''), /!important/);
});
