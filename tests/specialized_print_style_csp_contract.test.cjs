const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const assets = [
  'auris-print-qr.css', 'auris-print-noise-survey.css', 'auris-print-sop-editor.css',
  'auris-print-sop-saved.css', 'auris-print-swms.css', 'auris-print-incident.css',
  'auris-print-legal-register.css', 'auris-print-legal-change.css',
  'auris-print-toolbox-talk.css', 'auris-print-risk-assessment.css',
  'auris-print-fire-layout.css', 'auris-print-site-map.css'
];

test('specialised print templates contain no inline style elements', () => {
  assert.doesNotMatch(core, /<style\b/i);
  for (const asset of assets) {
    assert.match(core, new RegExp(`href=["']/${asset.replace('.', '\\.')}`));
    assert.ok(fs.statSync(path.join(root, asset)).size > 0, `${asset} is empty`);
  }
});

test('all print windows wait for every linked stylesheet', () => {
  assert.match(core, /function aurisPrintWindowWhenReady\(/);
  assert.match(core, /querySelectorAll\('link\[rel="stylesheet"\]'\)/);
  assert.match(core, /function printHtmlDoc\(/);
  for (const name of ['noisePrintSurveyData','sopPrint','sopPrintById']) {
    const start=core.indexOf(`function ${name}(`);
    const end=core.indexOf('\n}',start);
    assert.ok(start>=0&&core.slice(start,end+2).includes('aurisPrintWindowWhenReady'),`${name} does not wait for styles`);
  }
});
