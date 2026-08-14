const fs = require('fs');
const vm = require('vm');

const html = require('./application_source.cjs')();
const start = html.indexOf('var AUDIT_EVENT_CONTRACT');
const end = html.indexOf('function auditApiMutation', start);
if (start < 0 || end < 0) throw new Error('Shared audit contract was not found');

const context = { crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' } };
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

const required = ['create','update','submit','approve','reject','archive','link','unlink','open_sensitive','export'];
for (const event of required) {
  if (!context.AUDIT_EVENT_CONTRACT.mandatory.includes(event)) throw new Error(`Missing mandatory event: ${event}`);
}

const modules = context.AUDIT_EVENT_CONTRACT.modules;
if (Object.keys(modules).length < 15) throw new Error('Controlled module coverage is incomplete');
for (const [moduleName, contract] of Object.entries(modules)) {
  if (!Array.isArray(contract.tables) || !contract.tables.length) throw new Error(`${moduleName} has no authoritative table`);
}

const cases = [
  ['record_relationships','POST',{},'link'],
  ['record_relationships','PATCH',{status:'archived'},'unlink'],
  ['risk_assessments','PATCH',{status:'pending_approval'},'submit'],
  ['documents','PATCH',{approval_status:'approved'},'approve'],
  ['permits','PATCH',{status:'rejected'},'reject'],
  ['sop_video_projects','PATCH',{status:'archived'},'archive'],
  ['events','POST',{status:'open'},'create'],
  ['events','PATCH',{description:'updated'},'update']
];
for (const [table, method, body, expected] of cases) {
  const actual = context.auditSemanticAction(table, method, body);
  if (actual !== expected) throw new Error(`${table} ${method}: expected ${expected}, received ${actual}`);
}

if (!/relationship_id\s*:/.test(html.slice(html.indexOf('function auditLogEvent'), html.indexOf('// ===================================================================', html.indexOf('function auditLogEvent'))))) {
  throw new Error('Relationship IDs are not propagated by auditLogEvent');
}

console.log(`Audit contract: OK (${Object.keys(modules).length} controlled modules, ${required.length} mandatory events)`);
