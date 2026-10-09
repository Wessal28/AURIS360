const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const form = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261009030000_training_authorisation_certificate.sql'), 'utf8');

function saveHarness({ file = null, existing = 'https://example.com/existing.pdf', typed = existing, saveError = null } = {}) {
  const values = {
    'authr-name': 'Worker', 'authr-type': 'First Aid Certificate', 'authr-status': 'active',
    'authr-cert-url': typed, 'authr-cert-file': '',
  };
  const calls = [];
  const messages = [];
  const context = {
    document: { getElementById: id => id === 'authr-cert-file' ? { files: file ? [file] : [] } : { value: values[id] || '' } },
    obNormText: value => String(value || '').trim(),
    authEditingId: 'authorisation-1',
    authAllData: [{ id: 'authorisation-1', certificate_url: existing, status: 'active' }],
    ccid: () => 'company-1', prof: { id: 'user-1' },
    authUploadCertificate: async () => ({ url: 'https://example.com/replacement.pdf', path: 'company-1/replacement.pdf' }),
    api: async (url, request) => { calls.push({ url, request }); if (saveError) throw saveError; return []; },
    trainingAudit: () => {}, toast: message => messages.push(message), authBack: () => {},
    actionErrorMessage: () => 'Save failed', console: { error() {} }, Date, fetch: async () => {},
    SB: 'https://example.com', DC_BUCKET: 'documents', tok: 'token', KEY: 'key',
  };
  const start = core.indexOf('async function authSave(){');
  const end = core.indexOf('\nasync function authDelete()', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(core.slice(start, end), context);
  return { save: context.authSave, calls, messages };
}

test('editing an authorisation preserves its existing certificate when no replacement is selected', async () => {
  const harness = saveHarness({ typed: '' });
  await harness.save();
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].request.b.certificate_url, 'https://example.com/existing.pdf');
  assert.equal(harness.calls[0].request.b.evidence_url, 'https://example.com/existing.pdf');
});

test('selecting a replacement persists its storage URL', async () => {
  const harness = saveHarness({ file: { name: 'renewal.pdf' }, typed: 'data:application/pdf;base64,JVBERi0=' });
  await harness.save();
  assert.equal(harness.calls[0].request.b.certificate_url, 'https://example.com/replacement.pdf');
});

test('missing certificate columns fail visibly without retrying a write that drops the file', async () => {
  const harness = saveHarness({ saveError: new Error('Could not find certificate_url in schema cache') });
  await harness.save();
  assert.equal(harness.calls.length, 1);
  assert.match(harness.messages[0], /migration/);
});

test('Training certificate schema and upload control exist', () => {
  for (const column of ['certificate_url', 'evidence_url', 'scope', 'restrictions']) {
    assert.match(migration, new RegExp(`add column if not exists ${column} text`));
  }
  assert.match(form, /id="authr-cert-file"/);
  assert.match(form, /id="authr-current-cert"/);
});
