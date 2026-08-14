const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-occupational-health-static.css'), 'utf8');
const start = index.indexOf('<div id="page-ohealth"');
const end = index.indexOf('<div id="page-ppe"', start);
const section = index.slice(start, end);

test('Occupational Health has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-occupational-health-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-ohealth-s-[a-f0-9]{10}/g) || []).length >= 398);
  assert.ok((css.match(/^\.auris-ohealth-s-[a-f0-9]{10}\{/gm) || []).length >= 137);
});

test('Surveillance, exposure, diagnostic and vaccination states remain runtime-controlled', () => {
  for (const id of ['oh-view-surveillance', 'oh-view-exposure', 'oh-view-audiometry', 'oh-view-spirometry', 'oh-view-vaccination', 'oh-view-disease', 'oh-ms-form', 'oh-exp-form', 'oh-aud-form', 'oh-spi-form', 'oh-vax-form', 'oh-od-form']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-ohealth-s-|<[^>]*class="[^"]*auris-ohealth-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-ohealth-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /grid-template-columns:repeat\(6,1fr\)/);
  assert.match(css, /accent-color:var\(--green\)/);
  assert.doesNotMatch(css, /!important/i);
});
