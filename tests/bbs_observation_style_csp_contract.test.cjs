const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-bbs-observation-static.css'), 'utf8');
const start = index.indexOf('<div id="page-observation"');
const end = index.indexOf('<div id="page-inspection"', start);
const section = index.slice(start, end);

test('BBS Observations has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-bbs-observation-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-bbs-s-[a-f0-9]{10}/g) || []).length >= 151);
  assert.ok((css.match(/^\.auris-bbs-s-[a-f0-9]{10}\{/gm) || []).length >= 88);
});

test('BBS observation views, AI analysis and corrective actions remain runtime-controlled', () => {
  for (const id of ['obs-view-positive', 'obs-view-unsafe', 'obs-view-trends', 'obs-ai-response', 'obs-form3view', 'obs-del-btn', 'obs-unsafe-section', 'obs-photo-input', 'obs-custom3fields-card', 'obs-action-fields']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-bbs-s-|<[^>]*class="[^"]*auris-bbs-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-bbs-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /background:linear-gradient\(135deg,#1a3a5c,#185FA5\)/);
  assert.match(css, /accent-color:var\(--red\)/);
  assert.doesNotMatch(css, /!important/i);
});
