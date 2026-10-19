const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function library(role = 'employee') {
  const source = fs.readFileSync(path.join(__dirname, '..', 'document-control-upgrade.js'), 'utf8')
    .replace(/\}\)\(\);\s*$/, 'window.__library = { D, authorisedRevision, filteredDocs, currentFile, previewFile, generatedRendition, renderDraftsAndReviews, documentTypeOptions, nav };})();');
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
  return { ...context.window.__library, window: context.window, document: context.document };
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

test('controller can preview an uploaded draft PDF without exposing it to employees', () => {
  const controller = library('document_controller');
  const employee = library();
  const draft = { id: 'draft-pdf', title: 'Site plan', status: 'draft' };
  const revision = { id: 'draft-rev', document_id: draft.id, status: 'draft', revision_code: '1.0' };
  const file = { document_id: draft.id, revision_id: revision.id, file_role: 'approved_rendition', status: 'draft', file_url: 'https://auris.example/site-plan.pdf' };
  for (const session of [controller, employee]) {
    session.D.data.documents = [draft];
    session.D.data.revisions = [revision];
    session.D.data.files = [file];
  }
  assert.equal(controller.filteredDocs().length, 1);
  assert.equal(controller.previewFile(draft, revision).file_url, file.file_url);
  assert.equal(employee.filteredDocs().length, 0);
  assert.equal(employee.previewFile(draft, revision), null);
});

test('shared header picker offers document sections and routes changes', () => {
  const session = library('document_controller');
  const source = { innerHTML: '', value: '', onchange: null };
  session.document.getElementById = id => id === 'dcx-page-select' ? source : null;
  session.D.selectedId = 'document-1';
  session.D.docTab = 'distribution';
  session.nav();
  assert.equal(source.value, 'doc:distribution');
  assert.match(source.innerHTML, /Document: Content &amp; Files/);
  assert.match(source.innerHTML, /Document Library/);
  let routed = null;
  session.window.dcxDocumentTab = tab => { routed = tab; };
  source.value = 'doc:content';
  source.onchange();
  assert.equal(routed, 'content');
});

test('controllers can review an exact generated draft while employees retain the released rendition',()=>{
  const controller=library('document_controller'),employee=library();
  for(const s of [controller,employee]){
    s.D.data.documents=[{id:'doc',current_revision_id:'draft',status:'under_revision'}];
    s.D.data.revisions=[{id:'draft',document_id:'doc',status:'draft',revision_code:'3.0',content_json:{rendition_html:'<p>New draft method</p>'}},{id:'released',document_id:'doc',status:'effective',revision_code:'2.0',content_json:{rendition_html:'<p>Released method</p>'}}];
    s.D.data.files=[{document_id:'doc',revision_id:'draft',file_role:'generated_rendition',status:'draft'},{document_id:'doc',revision_id:'released',file_role:'generated_rendition',status:'published'}];
  }
  assert.equal(controller.generatedRendition('doc','draft').revision.revision_code,'3.0');
  assert.equal(controller.generatedRendition('doc','draft').authorised,false);
  assert.equal(controller.generatedRendition('doc').revision.revision_code,'2.0');
  assert.equal(employee.generatedRendition('doc','draft').revision.revision_code,'2.0');
  assert.equal(employee.generatedRendition('doc','draft').authorised,true);
});
