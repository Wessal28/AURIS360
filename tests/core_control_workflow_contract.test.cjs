const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = require('./application_source.cjs')(root);

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, `function ${name} is missing`);
  const brace = html.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  throw new Error(`function ${name} is incomplete`);
}

const contractStart = html.indexOf('var CORE_WORKFLOW_TRANSITIONS=');
const contractEnd = html.indexOf('// DEDUP: aiOpen', contractStart);
assert(contractStart >= 0 && contractEnd > contractStart, 'Core Control workflow transition contract is missing');
const context = { toast: () => {}, auditLabel: (value) => value };
vm.createContext(context);
vm.runInContext(html.slice(contractStart, contractEnd), context);

const allowed = [
  ['actions', 'open', 'in_progress'],
  ['actions', 'in_progress', 'pending_verification'],
  ['actions', 'pending_verification', 'pending_closure'],
  ['actions', 'pending_closure', 'closed'],
  ['events', 'open', 'under_investigation'],
  ['events', 'under_investigation', 'action_required'],
  ['events', 'action_required', 'closed'],
  ['inspection', 'open', 'in_progress'],
  ['inspection', 'in_progress', 'completed'],
  ['inspection', 'completed', 'closed'],
  ['risk', 'draft', 'pending_review'],
  ['risk', 'pending_review', 'active'],
  ['risk', 'pending_review', 'rejected'],
  ['risk', 'active', 'draft']
];
for (const [moduleName, from, to] of allowed) {
  assert.strictEqual(context.coreWorkflowTransitionAllowed(moduleName, from, to), true, `${moduleName}: ${from} -> ${to} should be allowed`);
}

const blocked = [
  ['actions', 'open', 'closed'],
  ['actions', 'closed', 'in_progress'],
  ['events', 'closed', 'open'],
  ['events', 'cancelled', 'closed'],
  ['inspection', 'completed', 'in_progress'],
  ['inspection', 'archived', 'open'],
  ['risk', 'draft', 'active'],
  ['risk', 'archived', 'draft']
];
for (const [moduleName, from, to] of blocked) {
  assert.strictEqual(context.coreWorkflowTransitionAllowed(moduleName, from, to), false, `${moduleName}: ${from} -> ${to} should be blocked`);
}

for (const [moduleName, from, to] of [
  ['actions', 'pending_verification', 'pending_closure'],
  ['actions', 'pending_closure', 'closed'],
  ['risk', 'pending_review', 'active'],
  ['risk', 'pending_review', 'rejected'],
  ['risk', 'active', 'draft']
]) {
  assert.strictEqual(context.coreWorkflowTransitionAllowed(moduleName, from, to), true, `${moduleName}: ${from} -> ${to} remains a valid dedicated transition`);
  assert.strictEqual(context.coreWorkflowDirectEditAllowed(moduleName, from, to), false, `${moduleName}: ${from} -> ${to} must not be completed through a status dropdown`);
}

assert.match(functionSource('mapSave'), /coreWorkflowRequireDirectEdit\(['"]actions['"]/);
for (const name of ['mapChangeStatus', 'mapApproveVerification', 'mapFailVerification', 'mapApproveClosure', 'mapRejectClosure']) {
  assert.match(functionSource(name), /coreWorkflowRequireTransition\(['"]actions['"]/, `${name} must enforce the action workflow`);
}
for (const name of ['imsSave', 'imsDelete', 'evQuickClose']) {
  assert.match(functionSource(name), /coreWorkflowRequireTransition\(['"]events['"]/, `${name} must enforce the incident workflow`);
}
assert.match(functionSource('auditSave'), /workflowCanMutate\(['"]inspection['"]/);
assert.match(functionSource('auditSave'), /coreWorkflowRequireTransition\(['"]inspection['"]/);
assert.match(functionSource('raSave'), /coreWorkflowRequireDirectEdit\(['"]risk['"]/);
for (const name of ['raApproveCurrent', 'raRejectCurrent', 'raReleaseForEdit']) {
  assert.match(functionSource(name), /coreWorkflowRequireTransition\(['"]risk['"]/, `${name} must enforce the risk workflow`);
}

assert.match(functionSource('mapChangeStatus'), /map_activity_log[\s\S]*mapAudit[\s\S]*mapQueueActionNotice/);
assert.match(functionSource('mapApproveVerification'), /map_activity_log[\s\S]*mapAudit[\s\S]*mapQueueActionNotice/);
assert.match(functionSource('mapApproveClosure'), /map_activity_log[\s\S]*mapAudit[\s\S]*mapQueueActionNotice/);
assert.match(functionSource('evSave'), /source_module:['"]event['"][\s\S]*source_id:savedId/);
assert.match(functionSource('auditSave'), /source_module:['"]inspection['"][\s\S]*source_id:savedId/);
assert.match(functionSource('raApproveCurrent'), /raCloseApprovalRequest\(['"]approved['"]\)[\s\S]*raAudit\(['"]approve['"][\s\S]*raQueueStatusNotice/);
assert.match(functionSource('raRejectCurrent'), /raCloseApprovalRequest\(['"]rejected['"]\)[\s\S]*raAudit\(['"]reject['"][\s\S]*raQueueStatusNotice/);

console.log('Core Control workflow contract passed (14 allowed, 8 blocked transitions; audit, notification and action-link evidence).');
