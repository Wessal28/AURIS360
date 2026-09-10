const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('chemical SDS upload is retained and previewable',()=>{
  const core=read('auris-core.js'),upgrade=read('chemical-control-upgrade.js'),html=read('index.html');
  assert.match(core,/function chemUploadPendingSds\(\)/);
  assert.match(core,/chemical-sds/);
  assert.match(core,/sds_file_url/);
  assert.match(core,/dcOpenViewer\(doc\)/);
  assert.match(upgrade,/Preview SDS/);
  assert.match(upgrade,/file_url:chemicalRecord\.sds_file_url/);
  assert.match(html,/id="chem3sds-preview"/);
});

test('chemical SDS storage migration retains document metadata',()=>{
  const sql=read('supabase/migrations/20260911020000_chemical_sds_document_storage.sql');
  assert.match(sql,/alter table public\.chemical_register[\s\S]*sds_file_url[\s\S]*sds_file_path[\s\S]*sds_file_mime/);
  assert.match(sql,/alter table public\.chemical_sds_versions[\s\S]*file_url[\s\S]*file_path[\s\S]*file_mime/);
  assert.match(sql,/notify pgrst, 'reload schema'/);
});
