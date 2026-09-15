const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const source=fs.readFileSync('kpi-monthly-review.js','utf8');

test('monthly review offers an export-only JSON backup with exact period identity',()=>{
  assert.match(source,/function reviewBackup\(s,exportedAt\)/);
  assert.match(source,/format:'AURIS360 KPI monthly review backup'/);
  assert.match(source,/company_id:s\.company/);
  assert.match(source,/snapshot:s\.data&&Array\.isArray\(s\.data\.snapshot\)/);
  assert.match(source,/data-mr-export/);
  assert.match(source,/auris360-kpi-review-/);
  assert.match(source,/type:'application\/json'/);
});

test('backup download does not call a persistence API',()=>{
  const body=source.slice(source.indexOf('function exportReview'),source.indexOf('function render'));
  assert.doesNotMatch(body,/api\(/);
  assert.match(body,/createObjectURL/);
  assert.match(body,/revokeObjectURL/);
});

test('backup preview validates tenant and period before entering read-only mode',()=>{
  assert.match(source,/function validateBackup\(value,s\)/);
  assert.match(source,/value\.company_id===s\.company/);
  assert.match(source,/Number\(value\.year\)===s\.year/);
  assert.match(source,/Number\(value\.month\)===s\.month/);
  assert.match(source,/async function previewBackup\(s,file\)/);
  assert.match(source,/Local backup preview loaded\. It is read-only and not connected to the server\./);
  assert.match(source,/s\.localBackup=true/);
  assert.match(source,/data-mr-import/);
});

test('local backup preview cannot expose workflow decisions or persistence calls',()=>{
  const render=source.slice(source.indexOf('function render'),source.indexOf('async function load'));
  assert.match(render,/var local=s\.localBackup===true/);
  assert.match(render,/actions=local\?\[\]:available\(s\)/);
  assert.match(render,/Local backup preview is read-only/);
  const preview=source.slice(source.indexOf('async function previewBackup'),source.indexOf('function render'));
  assert.doesNotMatch(preview,/api\(/);
});
