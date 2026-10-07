const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function library(role = 'employee') {
  const source = fs.readFileSync(path.join(__dirname, '..', 'document-control-upgrade.js'), 'utf8')
    .replace(/\}\)\(\);\s*$/, 'window.__library = { D, authorisedRevision, filteredDocs, currentFile, renderDraftsAndReviews, documentTypeOptions };})();');
  const context = {
    window: {},
    document: { readyState: 'loading', addEventListener() {} },
    location: { origin: 'https://auris.example' },
    activeRole: () => role,
    prof: { id: 'user-1', company_id: 'company-1' },
    co: { id: 'company-1' },
    localStorage: { getItem: () => null },
    URL,
    console,
  };
  vm.runInNewContext(source, context);
  return context.window.__library;
}

test('employee library shows only current authorised, unexpired, non-confidential documents', () => {
  const { D, filteredDocs } = library();
  D.data.documents = [
    { id: 'current', title: 'Current procedure', status: 'draft', department: 'Operations' },
    { id: 'draft', title: 'Draft procedure', status: 'draft' },
    { id: 'expired', title: 'Expired procedure', status: 'published', expiry_date: '2020-01-01' },
    { id: 'secret', title: 'Secret procedure', status: 'published', confidentiality: 'confidential' },
  ];
  D.data.revisions = [{ id: 'rev-current', document_id: 'current', status: 'effective', revision_code: '04', created_at: '2026-01-01' }];
  assert.deepEqual(Array.from(filteredDocs(), d => d.id), ['current']);
  D.filters.q = 'operations';
  assert.deepEqual(Array.from(filteredDocs(), d => d.id), ['current']);
});

test('document creation offers the operational library types', () => {
  const types = library('document_controller').documentTypeOptions().map(([code]) => code);
  for (const code of ['policy', 'sop', 'plan', 'checklist', 'drawing', 'certificate', 'external_standard', 'legal_document', 'safety_data_sheet']) {
    assert.ok(types.includes(code), `${code} is available`);
  }
});

test('a new draft revision does not replace the published revision or its file', () => {
  const { D, authorisedRevision, currentFile, renderDraftsAndReviews } = library('document_controller');
  const document = { id: 'doc-1', status: 'under_revision' };
  D.data.revisions = [
    { id: 'draft', document_id: 'doc-1', status: 'draft', revision_code: '05', created_at: '2026-10-01' },
    { id: 'current', document_id: 'doc-1', status: 'effective', revision_code: '04', created_at: '2026-01-01' },
  ];
  D.data.files = [
    { document_id: 'doc-1', revision_id: 'draft', file_role: 'approved_rendition', status: 'draft', file_url: 'https://auris.example/draft.pdf' },
    { document_id: 'doc-1', revision_id: 'current', file_role: 'approved_rendition', status: 'published', file_url: 'https://auris.example/current.pdf' },
  ];
  assert.equal(authorisedRevision(document).id, 'current');
  assert.equal(currentFile(document, authorisedRevision(document)).file_url, 'https://auris.example/current.pdf');
  D.data.documents = [document];
  assert.match(renderDraftsAndReviews(), /Revision/);
  assert.match(renderDraftsAndReviews(), /05/);
});
