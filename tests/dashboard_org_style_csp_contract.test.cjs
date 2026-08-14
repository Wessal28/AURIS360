const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-dashboard-org.css'), 'utf8');
const start = index.indexOf('     ORG VIEW');
const end = index.indexOf('</div><!-- end page-dashboard -->', start);
const section = index.slice(start, end);

test('organisation dashboard has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-dashboard-org\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-orgdash-s-[a-f0-9]{10}/g) || []).length >= 73);
  assert.ok((css.match(/^\.auris-orgdash-s-[a-f0-9]{10}\{/gm) || []).length >= 41);
});

test('organisation dashboard keeps controlled and data-driven states', () => {
  for (const id of ['dash-org-view', 'd-compliance-bar', 'd-compliance-bar-inner', 'dash-trend-chart', 'dash-dept-heatmap', 'dash-highrisk', 'ai-dash-insights']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-orgdash-s-|<[^>]*class="[^"]*auris-orgdash-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-orgdash-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /width:0%/);
  assert.doesNotMatch(css, /!important/i);
});
