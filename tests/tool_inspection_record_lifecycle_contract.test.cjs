const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const core=fs.readFileSync(path.join(root,'auris-core.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sql=fs.readFileSync(path.join(root,'supabase','migrations','20260911030000_tool_inspection_record_lifecycle.sql'),'utf8');

test('equipment inspection register exposes active, archived and all record views',()=>{
  assert.match(html,/id="tools-insp-status-filter"/);
  assert.match(html,/value="active">Active records/);
  assert.match(html,/value="archived">Archived records/);
  assert.match(core,/statusMatches=status==='all'\|\|recordStatus===status/);
});

test('inspection removal follows archive-first lifecycle',()=>{
  assert.match(core,/async function toolsArchiveInspection\(id\)/);
  assert.match(core,/archive_reason:String\(reason\)\.trim\(\)/);
  assert.match(core,/async function toolsDeleteInspectionPermanently\(id\)/);
  assert.match(core,/Archive the inspection before permanently deleting it/);
  assert.match(core,/appConfirmDelete\('archived equipment inspection'/);
  assert.match(core,/status=eq\.archived/);
});

test('only administrator roles receive permanent-delete UI access',()=>{
  const helper=core.match(/function toolsCanPermanentlyDeleteInspection\(\)\{[\s\S]*?\n\}/)?.[0]||'';
  assert.match(helper,/sephs_admin/);
  assert.match(helper,/company_admin/);
  assert.doesNotMatch(helper,/supervisor|auditor|inspector/);
});

test('archived inspections cannot drive operational due state',()=>{
  const activeReads=core.match(/\/tool_inspections\?[^'\n]*status=eq\.active/g)||[];
  assert.ok(activeReads.length>=4,`expected operational active filters, found ${activeReads.length}`);
  assert.match(core,/tool_id=eq.'\+v\.id\+'\&status=eq\.active/);
  assert.match(core,/optional\(api\('\/tool_inspections\?select=\*\&status=eq\.active/);
});

test('database policy restricts permanent deletion to archived records and administrators',()=>{
  assert.match(sql,/add column if not exists status text not null default 'active'/i);
  assert.match(sql,/add column if not exists archive_reason text/i);
  assert.match(sql,/drop policy if exists tenant_all on public\.tool_inspections/i);
  assert.match(sql,/create policy tool_inspections_admin_delete_archived[\s\S]*for delete[\s\S]*status='archived'/i);
  const deletePolicy=sql.match(/create policy tool_inspections_admin_delete_archived[\s\S]*?\n\);/i)?.[0]||'';
  assert.match(deletePolicy,/sephs_admin/);
  assert.match(deletePolicy,/company_admin/);
  assert.doesNotMatch(deletePolicy,/supervisor|auditor|inspector/);
});
