const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-audits-inspections-static.css'), 'utf8');
const start = index.indexOf('<div id="page-inspection"');
const end = index.indexOf('<div id="page-risk"', start);
const section = index.slice(start, end);

test('Audits & Inspections has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-audits-inspections-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-audit-s-[a-f0-9]{10}/g) || []).length >= 188);
  assert.ok((css.match(/^\.auris-audit-s-[a-f0-9]{10}\{/gm) || []).length >= 104);
});

test('Audit, pre-start, finding and evidence states remain runtime-controlled', () => {
  for (const id of ['audit-view-prestart', 'ps-add-btn', 'ps-form3view', 'ps-delete-btn', 'audit-view-findings', 'audit-form3view', 'audit-delete-btn', 'audit-standard-row', 'audit-ai-output', 'audit-offline-banner']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-audit-s-|<[^>]*class="[^"]*auris-audit-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-audit-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /transition:width \.8s/);
  assert.match(css, /accent-color:var\(--green\)/);
  assert.doesNotMatch(css, /!important/i);
});
