const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const handlers = fs.readFileSync(path.join(root, 'auris-static-event-handlers.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-ai-insights-static.css'), 'utf8');

test('generated RAMS uses a branded controlled-document template', () => {
  assert.match(core, /function aiRamsBuildTemplateHtml\(record\)/);
  assert.match(core, /aurisHeader\('Risk Assessment & Method Statement'/);
  assert.match(core, /Document Control[\s\S]*Task Summary[\s\S]*RAMS Content — Review Before Approval[\s\S]*Control Notice/);
  assert.match(core, /function aiRamsContentHtml\(text\)/);
  assert.match(css, /#rams-output \.ai-rams-document/);
  assert.match(css, /\.ai-rams-table/);
});

test('RAMS can be saved as a controlled AURIS draft and reloaded after the session', () => {
  assert.match(core, /async function aiSaveRAMSToAuris\(\)/);
  assert.match(core, /doc_type:'swms',document_type:'swms'/);
  assert.match(core, /approval_status:'draft'/);
  assert.match(core, /category:'AI-generated RAMS'/);
  assert.match(core, /AURIS_AI_RAMS:/);
  assert.match(core, /async function aiLoadSavedRamsHistory\(\)/);
  assert.match(core, /Save RAMS in AURIS\?/);
  assert.match(html, /Save to AURIS/);
  assert.match(handlers, /"h1145s"[\s\S]*aiSaveRAMSToAuris\(\)/);
});

test('RAMS exports are formatted Word and print/PDF outputs rather than plain text', () => {
  assert.match(html, /Print \/ PDF/);
  assert.match(html, /Download Word/);
  assert.match(core, /function aiDownloadRAMSWord\(\)/);
  assert.match(core, /type:'application\/msword'/);
  assert.match(core, /\.doc'/);
  assert.match(core, /function aiPrintRAMS\(\)/);
  assert.match(handlers, /"h1145"[\s\S]*aiDownloadRAMSWord\(\)/);
  assert.doesNotMatch(handlers, /"h1145"[\s\S]{0,100}aiDownload\('rams-output','RAMS'\)/);
});

test('RAMS release assets are cache-busted', () => {
  assert.match(html, /auris-core\.js\?v=20260824-1/);
  assert.match(html, /auris-static-event-handlers\.js\?v=20260823-4/);
  assert.match(html, /auris-ai-insights-static\.css\?v=20260823-4/);
});
