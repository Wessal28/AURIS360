const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-ai-insights-static.css'), 'utf8');
const start = index.indexOf('<div id="page-ai-insights"');
const end = index.indexOf('<div id="page-approvals"', start);
const section = index.slice(start, end);

test('AI Insights has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-ai-insights-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-ai-insights-s-[a-f0-9]{10}/g) || []).length >= 152);
  assert.ok((css.match(/^\.auris-ai-insights-s-[a-f0-9]{10}\{/gm) || []).length >= 92);
});

test('Insight generators, outputs, evidence actions and chat remain runtime-controlled', () => {
  for (const id of ['aitab-insights', 'aitab-safetyos', 'aitab-qr', 'aitab-rams', 'aitab-toolbox', 'aitab-compliance', 'aitab-risk', 'aitab-docs', 'aitab-chat', 'aiview-safetyos', 'safetyos-output', 'aiview-qr', 'qr-preview', 'aiview-rams', 'rams-history', 'rams-output', 'aiview-toolbox', 'tbt-output', 'aiview-compliance', 'comp-output', 'aiview-risk', 'scenario-output', 'heatmap-output', 'aiview-docs', 'doc-create-actions-btn', 'doc-output', 'ai-chat-messages', 'ai-chat-input']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-ai-insights-s-|<[^>]*class="[^"]*auris-ai-insights-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-ai-insights-s-[a-f0-9]{10}\\{`));
  }
  for (const id of ['ai-risk-score', 'ai-compliance-score', 'ai-rec-count', 'safetyos-task', 'qr-record', 'rams-hazards', 'tbt-incident', 'comp-check-standard', 'predictive-risk-output', 'doc-analysis-type']) {
    assert.match(section, new RegExp(`id="${id}"`));
  }
  assert.match(css, /display:none/);
  assert.match(css, /grid-template-columns:/);
  assert.doesNotMatch(css, /!important/i);
});
