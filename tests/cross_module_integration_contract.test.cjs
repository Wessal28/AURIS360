const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const relationshipsSql = read('shared_record_relationships_schema.sql');
const results = [];

function scenario(id, priority, title, run) {
  run();
  results.push({ id, priority, title });
}

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, `function ${name} is missing`);
  const brace = html.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    if (html[i] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name} is incomplete`);
}

scenario('INT-001', 'P0', 'Source record creates an action that reopens the exact source', () => {
  const actionWrites = [...html.matchAll(/api\('\/action_tracker'[\s\S]{0,850}?source_module\s*:\s*['"][^'"]+['"][\s\S]{0,350}?source_id\s*:/g)];
  assert(actionWrites.length >= 12, 'expected canonical action producers with source IDs');
  assert.match(functionSource('mapOpenSourceRecord'), /mapSourceAdapter\(x\)[\s\S]*mapOpenExactSource\(adapter,x\)/);
  assert.match(functionSource('mapOpenExactSource'), /id=eq\.['"]?\+encodeURIComponent\(id\)/);
  assert.match(html, /source_module:req\.goto[\s\S]*source_id:req\.record[\s\S]*mapOpenExactSource\(adapter,source\)/);
});

scenario('INT-002', 'P0', 'Reciprocal relationships open from either endpoint', () => {
  assert.match(functionSource('relationshipCreate'), /rpc\/create_record_relationship/);
  assert.match(relationshipsSql, /create or replace view public\.record_relationships_bidirectional[\s\S]*union all/i);
  assert.match(relationshipsSql, /source_module as record_module[\s\S]*target_module,target_table,target_id/i);
  assert.match(functionSource('connectedRecordsOpen'), /related_module[\s\S]*related_table[\s\S]*related_id[\s\S]*mapOpenExactSource/);
  assert.match(relationshipsSql, /record_relationships_canonical_unique[\s\S]*endpoint_a,endpoint_b/i);
});

scenario('INT-003', 'P0', 'Archived and broken endpoints remain controlled and visible', () => {
  assert.match(relationshipsSql, /status in \('active','pending_verification','unresolved','broken','endpoint_archived','superseded','archived'\)/);
  assert.match(relationshipsSql, /lifecycle in \('archived','deleted','obsolete','withdrawn','superseded','retired','inactive','cancelled','out_of_service'\)/);
  assert.match(relationshipsSql, /new\.status := 'endpoint_archived'/);
  assert.match(functionSource('relationshipRepairStatus'), /endpoint_archived:[\s\S]*broken:[\s\S]*unresolved:/);
  assert.match(functionSource('relationshipRepairOpen'), /state!==['"]active['"]&&state!==['"]archived['"]/);
});

scenario('INT-004', 'P0', 'Approval Center preserves workflow-specific decisions and exact reopening', () => {
  const adapterBlock = html.slice(html.indexOf('var APPROVAL_SOURCE_ADAPTERS'), html.indexOf('function approvalsCanView'));
  for (const table of ['permits', 'documents', 'risk_assessments', 'investigations', 'legal_requirements', 'sop_video_projects', 'elearning_courses', 'moc_change_requests']) {
    assert(adapterBlock.includes(`table:'${table}'`), `approval adapter missing ${table}`);
  }
  assert.match(functionSource('loadApprovals'), /approvalsSafe\(api\(/);
  assert.match(functionSource('approvalsOpen'), /deepLinkStore\(deepLinkNormalise[\s\S]*deepLinkResume\('approval-center'\)/);
  assert.match(functionSource('deepLinkResume'), /mapOpenExactSource\(adapter,source\)/);
  assert.match(functionSource('auditSemanticAction'), /return 'approve'[\s\S]*return 'reject'/);
});

scenario('INT-005', 'P0', 'QR and email deep links survive authentication and retain record context', () => {
  const sandbox = {};
  vm.runInNewContext(`${functionSource('deepLinkNormalise')}; result = deepLinkNormalise({goto:'risk',record:'ra-123',ref:'RA-2026-001',table:'risk_assessments',company:'co-9'});`, sandbox);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.result)), {
    goto: 'risk', record: 'ra-123', ref: 'RA-2026-001', table: 'risk_assessments', company: 'co-9', captured_at: sandbox.result.captured_at
  });
  assert.match(sandbox.result.captured_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(html, /DEEP_LINK_STORAGE_KEY='auris360_pending_deep_link_v1'/);
  assert.match(functionSource('deepLinkCaptureRequest'), /deepLinkReadUrl\(\)\|\|pendingDeepLinkRequest\|\|deepLinkReadStored\(\)/);
  assert.match(functionSource('deepLinkRecordUrl'), /record[\s\S]*ref[\s\S]*table[\s\S]*company/);
  assert.match(functionSource('qrRecordUrl'), /deepLinkRecordUrl/);
  assert.match(functionSource('deepLinkScheduleResume'), /120[\s\S]*500[\s\S]*1200[\s\S]*2400[\s\S]*deepLinkResume/);
  assert.match(html, /deepLinkScheduleResume\('sign-in'\)/);
  assert.match(html, /deepLinkScheduleResume\('session-restore'\)/);
  assert.match(html, /deepLinkCaptureRequest\(\);[\s\S]*deepLinkScheduleResume\('page-load'\)/);
  const retryTimers = [];
  const retryState = { pending: { goto: 'events' }, calls: 0 };
  const retrySandbox = {
    prof: { id: 'user-1' }, pendingDeepLinkRequest: null, Promise,
    setTimeout: (fn, delay) => retryTimers.push({ fn, delay }),
    deepLinkReadUrl: () => retryState.pending,
    deepLinkReadStored: () => null,
    deepLinkResume: () => { retryState.calls += 1; retryState.pending = null; return true; }
  };
  vm.runInNewContext(`${functionSource('deepLinkScheduleResume')}; deepLinkScheduleResume('sign-in');`, retrySandbox);
  assert.deepStrictEqual(retryTimers.map((timer) => timer.delay), [120, 500, 1200, 2400]);
  retryTimers.forEach((timer) => timer.fn());
  assert.strictEqual(retryState.calls, 1, 'successful deep-link navigation must stop later retries');
});

scenario('INT-006', 'P0', 'Company and role switching cannot cross tenant boundaries', () => {
  assert.match(functionSource('apiCompanyScopeIssue'), /bodyCompany[\s\S]*pathCompany[\s\S]*prof\.company_id[\s\S]*Blocked cross-company/);
  assert.match(functionSource('deepLinkResume'), /canAccessPage\(page\)/);
  assert.match(functionSource('approvalsCompanyFilter'), /sephsCompanyContext[\s\S]*prof\?\.company_id/);
  assert.match(relationshipsSql, /record_relationships_tenant_read[\s\S]*p\.company_id=record_relationships\.company_id/);
  assert.match(relationshipsSql, /record_relationships_tenant_write[\s\S]*p\.company_id=record_relationships\.company_id/);
  assert.match(relationshipsSql, /confidentiality[\s\S]*compliance_manager/);
});

scenario('INT-007', 'P1', 'Missing optional tables degrade without blanking the module', () => {
  assert.match(functionSource('approvalsSafe'), /catch\(e\)[\s\S]*return \[\]/);
  assert.match(functionSource('loadApprovals'), /loads\.push\(approvalsSafe\(api/);
  assert.match(functionSource('relationshipRegistry'), /schema cache\|does not exist\|not found[\s\S]*return \[\]/);
  assert.match(functionSource('relationshipList'), /schema cache\|does not exist\|not found[\s\S]*return \[\]/);
  assert.match(html, /setupFriendlyMessage\(moduleName\|\|'Register'/);
});

scenario('INT-008', 'P1', 'Desktop, tablet and mobile layout contracts remain present', () => {
  const styles = ['index.html', 'auris-icon-system.css', 'kpi-module-upgrade.css', 'safety-engagement.css', 'bbs-observations.css',
    'noise-management.css', 'incident-management-upgrade.css', 'document-control-upgrade.css', 'swms-upgrade.css',
    'legal-compliance-upgrade.css', 'risk-assessment-upgrade.css', 'sop-video-upgrade.css', 'learning-competency-upgrade.css',
    'chemical-control-upgrade.css', 'contractor-management-upgrade.css', 'tools-equipment-upgrade.css'].map(read).join('\n');
  assert.match(styles, /@media\s*\(max-width:\s*(?:1280|1024|900|768)px\)/);
  assert.match(styles, /@media\s*\(max-width:\s*(?:760|640|600|520|480)px\)/);
  assert.match(styles, /overflow-x\s*:\s*auto/);
  assert.match(styles, /grid-template-columns\s*:\s*1fr/);
});

for (const item of results) console.log(`PASS ${item.priority} ${item.id} — ${item.title}`);
console.log(`Cross-module integration contract passed (${results.length} scenarios).`);
