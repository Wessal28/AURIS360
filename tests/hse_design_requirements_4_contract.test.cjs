const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const core = read('auris-core.js');
const work = read('auris-runtime-event-handlers.js');
const generated = read('auris-generated-event-handlers.js');
const incidents = read('incident-management-upgrade.js');
const bbs = read('bbs-observations.js');
const risk = read('risk-assessment-upgrade.js');

test('AI document workflows accept office documents and offer module destinations', () => {
  assert.match(index, /id="comp-check-file"[^>]*accept="\.pdf,\.docx/);
  assert.match(index, /id="doc-analysis-file"[^>]*accept="\.pdf,\.docx/);
  assert.match(core, /async function aiExtractUploadedDocument/);
  assert.match(core, /function aiDocRenderSaveDestinations/);
  assert.match(core, /function aiDocSaveToModule/);
  assert.match(read('api/extract-document.js'), /pdf-parse/);
  assert.match(read('api/extract-document.js'), /mammoth/);
  assert.match(read('api/extract-document.js'), /Authentication required/);
  assert.match(core, /extract-document[\s\S]{0,180}'Authorization':'Bearer '/);
});

test('work scheduling supports deliberate team multi-selection and many linked records', () => {
  assert.match(core, /function wsInitTeamMultiSelect/);
  assert.match(core, /select\.addEventListener\('mousedown'/);
  assert.match(work, /Array\.from\(this\.selectedOptions/);
  assert.match(core, /\/work_schedule_links/);
  assert.match(read('supabase/migrations/20260823010000_requirements_4_work_schedule_links.sql'), /create table if not exists public\.work_schedule_links/i);
  assert.match(core, /function wsBackToDetail/);
});

test('register rows open read-only previews while explicit edit actions remain available', () => {
  assert.match(generated, /raOpenReadOnly/);
  assert.match(generated, /jsaOpenReadOnly/);
  assert.match(generated, /auditOpenReadOnly/);
  assert.match(generated, /imv2OpenIncidentReadOnly/);
  assert.match(incidents, /window\.imv2OpenInvestigationReadOnly/);
  assert.match(core, /function raOpenReadOnly/);
  assert.match(core, /function auditOpenReadOnly/);
});

test('incident lessons generate a validated, shareable safety communication', () => {
  assert.match(incidents, /window\.imv2GenerateSafetyCommunication/);
  assert.match(incidents, /linked investigation must be completed before communication is generated/i);
  assert.match(incidents, /window\.imv2ShareSafetyCommunication/);
  assert.match(incidents, /safety_communication/);
});

test('BBS navigation and persistence use the supported observation types', () => {
  assert.doesNotMatch(bbs, /\{id:'observe',label:'Observe'/);
  assert.match(bbs, /unsafe_behaviour/);
  assert.match(bbs, /positive_behaviour/);
  assert.match(bbs, /function acceptedObservations/);
});

test('duplicate navigation and print controls are removed', () => {
  assert.doesNotMatch(risk, /Assessment Types & Templates/);
  assert.equal((index.match(/id="audit-print-current-btn"/g) || []).length, 1);
});

test('KPI printing uses the shared landscape preview', () => {
  assert.match(core, /function kpiPrint/);
  assert.match(core, /aurisPrint\(html,'KPI Scorecard/);
  assert.match(core, /includes\('kpi scorecard'\)/);
  assert.match(core, /auris-print-landscape/);
});
