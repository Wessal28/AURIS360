const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'sw-assets.js'), 'utf8');

test('application markup has no static inline presentation or executable attributes', () => {
  assert.equal((index.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.equal((index.match(/<style\b/gi) || []).length, 0);
  assert.equal((index.match(/\son[a-z]+\s*=/gi) || []).length, 0);
});

test('every installed generated presentation stylesheet is offline-cached', () => {
  const links = [...index.matchAll(/<link rel="stylesheet" href="(auris-[^"]+-static\.css\?v=[^"]+)">/g)].map((match) => match[1]);
  assert.ok(links.length >= 30, `Expected the generated module stylesheets; found ${links.length}`);
  for (const link of links) {
    const file = link.split('?')[0];
    assert.ok(fs.existsSync(path.join(root, file)), `${file} must exist`);
    assert.match(manifest, new RegExp(`['"]/` + file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + `['"]`));
  }
});

test('the legacy investigation placeholder follows shared page visibility', () => {
  assert.match(index, /<div id="page-investigation" class="page"><\/div>/);
  const base = fs.readFileSync(path.join(root, 'auris-base.css'), 'utf8');
  assert.match(base, /\.page\{display:none;/);
  assert.match(base, /\.page\.active\s*\{\s*display:\s*block/);
});
