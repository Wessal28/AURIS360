const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-risk-assessment-static.css'), 'utf8');
const start = index.indexOf('<div id="page-risk"');
const end = index.indexOf('<div id="page-investigation"', start);
const section = index.slice(start, end);

test('Risk Assessment has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-risk-assessment-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-risk-s-[a-f0-9]{10}/g) || []).length >= 427);
  assert.ok((css.match(/^\.auris-risk-s-[a-f0-9]{10}\{/gm) || []).length >= 212);
});

test('Assessment, hazard, approval and library states remain runtime-controlled', () => {
  for (const id of ['ra-new-main-btn', 'ra-jsa-list', 'ra-hira-list', 'ra-new-panel', 'ra-manual-form', 'ra-specific-form', 'ra-form3view', 'ra-approval-route-note', 'ra-ftview-hazards', 'ra-task-form', 'ra-ftview-approval', 'ra-ftview-rams', 'ra-library-view', 'lib-view-controls']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-risk-s-|<[^>]*class="[^"]*auris-risk-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-risk-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /grid-template-columns:repeat\(auto-fill,minmax\(260px,1fr\)\)/);
  assert.match(css, /background:linear-gradient\(135deg,#185FA5,#1D9E75\)/);
  assert.doesNotMatch(css, /!important/i);
});
