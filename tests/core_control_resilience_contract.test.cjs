const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

// Incident Management keeps its authoritative register independent from
// investigations, evidence, statistics and corrective-action tabs.
assert.match(functionSource('loadEvents'), /imsSwitchTab\(['"]register['"]/);
assert.match(functionSource('imsLoadRegister'), /api\(['"]\/events\?select=/);
assert.match(functionSource('imsLoadRegister'), /catch\(e\)[\s\S]*el\.innerHTML/);
assert.match(functionSource('imsLoadInlineEvidence'), /catch\(e\)[\s\S]*Could not load evidence/);

// Audits & Inspections renders the primary register even when templates or
// findings are unavailable. Built-in templates remain available as fallback.
assert.match(functionSource('auditLoad'), /api\(q\)[\s\S]*catch\(e\)[\s\S]*el\.innerHTML/);
assert.match(functionSource('auditLoad'), /Load findings count separately/);
assert.match(functionSource('auditLoad'), /catch\(ex\) \{\}/);
assert.match(functionSource('auditLoadTemplates'), /Use built-in default templates if DB not available/);
assert.match(functionSource('auditLoadTemplates'), /AUDIT_DEFAULT_CHECKLISTS|auditBuiltinTemplateOptions/);

// Risk Assessment separates the core assessment register from optional JSA
// data; failure of the latter resolves to an empty optional data set.
assert.match(functionSource('raShowList'), /raLoadList\(\);[\s\S]*raLoadJSAList\(\)/);
assert.match(functionSource('raLoadList'), /registerErrorHtml\(['"]Risk Assessment register/);
assert.match(functionSource('raLoadJSAList'), /catch\(e\)\{raAllJSA=\[\];\}/);

// Master Action Plan protects the core list with a visible controlled error,
// while the cosmetic legacy-reference backfill is non-blocking.
assert.match(functionSource('mapLoadList'), /api\(['"]\/action_tracker\?select=/);
assert.match(functionSource('mapLoadList'), /Master Action Plan could not be loaded/);
assert.match(functionSource('mapQueueRefBackfill'), /api\(['"]\/action_tracker\?id=eq\.[\s\S]*\.catch\(function\(\)\{\}\)/);

// The landing dashboard also isolates each source and retries transient login
// failures, preventing a single unavailable optional source from blanking it.
assert.match(functionSource('loadDash'), /var safe = async function\(p\)[\s\S]*return \[\]/);
assert.match(functionSource('loadDash'), /safe\(api\(['"]\/events/);
assert.match(functionSource('loadDash'), /safe\(api\(['"]\/chemical_register/);
assert.match(functionSource('loadDash'), /options\.initial&&hadApiFailure[\s\S]*attempt[\s\S]*1500/);

console.log('Core Control resilience contract passed (dashboard plus four primary registers and optional dependencies).');
