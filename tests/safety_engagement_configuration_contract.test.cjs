const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'safety-engagement.js'), 'utf8');
const handlers = fs.readFileSync(path.join(root, 'auris-module-event-handlers-batch-5.js'), 'utf8');
const baseline = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260820000000_production_schema_baseline.sql'), 'utf8');

test('Safety Engagement configuration exposes only the workflow control used at runtime', () => {
  const start = source.indexOf('function renderConfiguration()');
  const end = source.indexOf('var mobileContent=', start);
  const view = source.slice(start, end);

  assert.match(view, /visibleRows\('reviewTemplates'\)/);
  assert.match(view, /Only settings that directly control the Safety Engagement workflow are shown here/);
  assert.match(view, /A published, effective template is required before a team review can start/);
  assert.doesNotMatch(view, /New configuration record|Configuration JSON|se-config-types/);
});

test('generic JSON configuration controls and display-only mobile settings are removed', () => {
  for (const marker of [
    'configRecords',
    'seConfigFilter',
    'sePreviewConfig',
    'seConfigAction',
    'se-f-payload',
    'se-f-record-type',
    'Published mobile controls'
  ]) {
    assert.doesNotMatch(source, new RegExp(marker));
  }
  assert.doesNotMatch(handlers, /seConfigFilter|sePreviewConfig|configRecords/);
  assert.doesNotMatch(source, /\['configuration','Configuration','ti-settings'\]/);
});

test('review templates retain the essential create edit publish archive and workflow gate', () => {
  assert.match(source, /function reviewTemplateForm\(row\)/);
  for (const field of ['Template code', 'Template name', 'Description', 'Effective from', 'Change reason']) {
    assert.match(source, new RegExp(field));
  }
  assert.doesNotMatch(source, /Submission rules \(JSON\)|field\('Sections'/);
  assert.match(source, /submission_rules:\{block_on_open_dispute:true,pending_validation:'warning'\}/);
  assert.match(source, /duplicable=\['programmes','assignments','reports','reviewTemplates'\]/);
  assert.match(source, /archiveable=\['programmes','assignments','reports','reviewTemplates'/);
  assert.match(source, /\['programmes','reports','reviewTemplates'\]\.includes\(list\)&&status==='published'/);
  assert.match(source, /filter\(function\(x\)\{return x\.status==='published'&&\(!x\.effective_from\|\|x\.effective_from<=SE\.period\+'-28'\);\}\)/);
  assert.match(source, /A published review template is required before a team review can start/);
});

test('legacy generic configuration data is retained without remaining an active UI control', () => {
  assert.match(baseline, /CREATE TABLE public\.engagement_configuration_records/);
  assert.doesNotMatch(source, /engagement_configuration_records/);
});
