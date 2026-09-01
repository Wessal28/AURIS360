const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const handlers = fs.readFileSync(path.join(root, 'auris-static-event-handlers.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-ai-insights-static.css'), 'utf8');

test('AI toolbox talks render in the governed toolbox-talk template', () => {
  assert.match(core, /function aiToolboxBuildTemplateHtml\(record\)/);
  assert.match(core, /aurisHeader\('Toolbox Talk \/ Safety Briefing'/);
  assert.match(core, /Talk Control[\s\S]*Toolbox Talk Content — Review Before Delivery[\s\S]*Attendance and Acknowledgement[\s\S]*Questions, Concerns and Actions Raised[\s\S]*Control Notice/);
  assert.match(css, /#tbt-output \.ai-toolbox-document/);
});

test('generator asks to save and persists a draft in the Toolbox Talks register', () => {
  assert.match(core, /Save in Toolbox Talks\?/);
  assert.match(core, /async function aiSaveToolboxTalkToAuris\(\)/);
  assert.match(core, /apiWriteWithMissingColumnFallback\('\/toolbox_talks'/);
  assert.match(core, /status:'draft'/);
  assert.match(core, /AURIS_AI_TBT:/);
  assert.match(html, /Save to Toolbox Talks/);
  assert.match(handlers, /"h1160s"[\s\S]*aiSaveToolboxTalkToAuris\(\)/);
});

test('toolbox talk download is formatted Word with a print/PDF option', () => {
  assert.match(core, /function aiDownloadToolboxWord\(\)/);
  assert.match(core, /auris-print-toolbox-talk\.css/);
  assert.match(core, /type:'application\/msword'/);
  assert.match(core, /function aiPrintToolboxTalk\(\)/);
  assert.match(html, /Print \/ PDF/);
  assert.match(html, /Download Word/);
  assert.match(handlers, /"h1160"[\s\S]*aiDownloadToolboxWord\(\)/);
  assert.doesNotMatch(handlers, /"h1160"[\s\S]{0,100}aiDownload\('tbt-output','ToolboxTalk'\)/);
});

test('general product release assets are cache-busted', () => {
  assert.match(html, /auris-core\.js\?v=20260901-10/);
  assert.match(html, /auris-static-event-handlers\.js\?v=20260823-4/);
  assert.match(html, /auris-ai-insights-static\.css\?v=20260823-4/);
});
