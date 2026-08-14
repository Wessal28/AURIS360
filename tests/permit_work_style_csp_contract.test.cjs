const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-permit-work-static.css'), 'utf8');
const start = index.indexOf('<div id="page-permit"');
const end = index.indexOf('<div id="page-contractor"', start);
const section = index.slice(start, end);

test('Permit to Work has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-permit-work-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-ptw-s-[a-f0-9]{10}/g) || []).length >= 203);
  assert.ok((css.match(/^\.auris-ptw-s-[a-f0-9]{10}\{/gm) || []).length >= 109);
});

test('Permit, isolation, approval, suspension and close-out states remain runtime-controlled', () => {
  for (const id of ['ptw-new-btn', 'ptw-simops-banner', 'ptw-detail-view', 'ptw-blocks-panel', 'ptw-dtab-view-checks', 'ptw-dtab-view-gas', 'ptw-dtab-view-isolation', 'ptw-dtab-view-approval', 'ptw-dtab-view-log', 'ptw-form3view', 'ptw-form3body', 'ptw-gas-panel', 'ptw-isolation-panel', 'ptw-approval-panel', 'ptw-closure-panel', 'ptw-suspension-panel']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-ptw-s-|<[^>]*class="[^"]*auris-ptw-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-ptw-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /background:#FCEBEB;border:2px solid #E24B4A/);
  assert.match(css, /grid-template-columns:repeat\(6,1fr\)/);
  assert.doesNotMatch(css, /!important/i);
});
