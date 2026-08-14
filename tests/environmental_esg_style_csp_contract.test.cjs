const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-environmental-esg-static.css'), 'utf8');
const start = index.indexOf('<div id="page-esg"');
const end = index.indexOf('<div id="page-emergency"', start);
const section = index.slice(start, end);

test('Environmental / ESG has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-environmental-esg-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-esg-s-[a-f0-9]{10}/g) || []).length >= 170);
  assert.ok((css.match(/^\.auris-esg-s-[a-f0-9]{10}\{/gm) || []).length >= 76);
});

test('Waste, resource, spill and inspection states remain runtime-controlled', () => {
  for (const id of ['esg-view-waste', 'esg-waste-add-btn', 'esg-view-hazwaste', 'esg-hw-add-btn', 'esg-view-fuel', 'esg-fuel-add-btn', 'esg-view-water', 'esg-water-add-btn', 'esg-view-spills', 'esg-spill-add-btn', 'esg-view-inspections', 'esg-insp-add-btn', 'esg-waste-form', 'esg-hw-form', 'esg-fuel-form', 'esg-water-form', 'esg-spill-form', 'esg-insp-form']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-esg-s-|<[^>]*class="[^"]*auris-esg-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-esg-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /grid-template-columns:repeat\(4,1fr\)/);
  assert.match(css, /accent-color:var\(--red\)/);
  assert.doesNotMatch(css, /!important/i);
});
