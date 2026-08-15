const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-site-map-static.css'), 'utf8');
const start = index.indexOf('<div id="page-sitemap"');
const end = index.indexOf('<div id="page-fire"', start);
const section = index.slice(start, end);

test('Site Map has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-site-map-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-site-map-s-[a-f0-9]{10}/g) || []).length >= 32);
  assert.ok((css.match(/^\.auris-site-map-s-[a-f0-9]{10}\{/gm) || []).length >= 24);
});

test('Site, plan, overlay, canvas and selected-marker states remain runtime-controlled', () => {
  for (const id of ['sitemap-summary', 'sitemap-search', 'sitemap-plan-status', 'sitemap-selected-title']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-site-map-s-|<[^>]*class="[^"]*auris-site-map-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-site-map-s-[a-f0-9]{10}\\{`));
  }
  for (const id of ['sitemap-site-list', 'sitemap-plan-title', 'sitemap-plan-list', 'sitemap-event-toggle', 'sitemap-risk-toggle', 'sitemap-canvas', 'sitemap-selected-card', 'sitemap-details']) {
    assert.match(section, new RegExp(`id="${id}"`));
  }
  assert.match(css, /display:none/);
  assert.match(css, /position:sticky;top:86px/);
  assert.doesNotMatch(css, /!important/i);
});
