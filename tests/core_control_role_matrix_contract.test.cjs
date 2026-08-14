const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = require('./application_source.cjs')(root);
const corePages = ['actions', 'events', 'inspection', 'risk'];

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

const matrixStart = html.indexOf('var ROLE_ALLOWED =');
const matrixEnd = html.indexOf('// Controlled rollout cohorts', matrixStart);
assert(matrixStart >= 0 && matrixEnd > matrixStart, 'ROLE_ALLOWED matrix is missing');
const context = {};
vm.createContext(context);
vm.runInContext(html.slice(matrixStart, matrixEnd), context);

const expected = {
  hse_manager: { actions: true, events: true, inspection: true, risk: true },
  hse_officer: { actions: true, events: true, inspection: true, risk: true },
  supervisor: { actions: true, events: true, inspection: true, risk: true },
  auditor: { actions: true, events: true, inspection: true, risk: true },
  employee: { actions: false, events: true, inspection: false, risk: false },
  contractor: { actions: false, events: true, inspection: false, risk: false },
  sephs_admin: { actions: true, events: true, inspection: true, risk: true }
};

for (const [role, access] of Object.entries(expected)) {
  assert(Object.prototype.hasOwnProperty.call(context.ROLE_ALLOWED, role), `${role} is missing from ROLE_ALLOWED`);
  const allowed = context.ROLE_ALLOWED[role];
  for (const page of corePages) {
    assert.strictEqual(
      allowed === null || allowed.includes(page),
      access[page],
      `${role} access to ${page} does not match the Core Control role matrix`
    );
  }
}

const rolePreviewMarkup = html.slice(html.indexOf('id="sb-role-changer"'), html.indexOf('<span class="nav-section">Main'));
for (const role of Object.keys(expected)) {
  assert.match(rolePreviewMarkup, new RegExp(`<option value=["']${role}["']`, 'i'), `role preview option missing ${role}`);
}

assert.match(functionSource('applyRoles'), /el\.style\.display\s*=\s*canAccessPage\(pageKey\)\s*\?\s*['"]flex['"]\s*:\s*['"]none['"]/);
assert.match(functionSource('sbChangeRole'), /if\(!canAccessPage\(activeId\)\) showPage\(['"]dashboard['"]/);
assert.match(functionSource('showPage'), /if\(!canAccessPage\(name\)\)/);
assert.match(functionSource('showPage'), /permission to access this module/);

console.log('Core Control role matrix contract passed (7 roles x 4 modules, sidebar and route enforcement).');
