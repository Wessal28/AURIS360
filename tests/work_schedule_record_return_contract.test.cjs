const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-audits-inspections-static.css'), 'utf8');

test('work detail supports every linked inspection, risk assessment and permit', () => {
  assert.match(core, /\['tbt','prestart','site','ra','ptw'\]\.includes\(kind\)\?'multiple size="3"/);
  assert.match(core, /linked\('ra',x\.ra_ref,data\[3\]/);
  assert.match(core, /linked\('ptw',x\.permit_ref,data\[4\]/);
  assert.match(core, /\['tbt','prestart','site','ra','ptw','event'\]\.forEach\(wsRenderLinkedSummary\)/);
  assert.match(core, /work_schedule_links\?on_conflict=work_order_id,link_type,record_id/);
});

test('forms opened from a work order link back and return to that work', () => {
  for (const kind of ['prestart', 'site', 'ra', 'ptw']) {
    assert.match(core, new RegExp(`wsSetRecordReturnContext\\('${kind}'`));
    assert.match(core, new RegExp(`wsReturnToWork\\('${kind}'\\)`));
  }
  assert.match(core, /wsAttachSavedRecord\('prestart'/);
  assert.match(core, /wsAttachSavedRecord\('site'/);
  assert.match(core, /wsAttachSavedRecord\('ra'/);
  assert.match(core, /wsAttachSavedRecord\('ptw'/);
  assert.match(core, /showPage\('workschedule'/);
});

test('pre-start checklist uses compact, readable controls', () => {
  assert.match(css, /#ps-checklist-body legend\{[^}]*font-size:13px/);
  assert.match(css, /\.ps-check-answers label\{[^}]*min-height:36px[^}]*font-size:12px/);
  assert.match(css, /#ps-checklist-body textarea\{[^}]*min-height:52px[^}]*font-size:12px/);
});
