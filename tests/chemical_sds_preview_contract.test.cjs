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

const vm=require('node:vm');
function sdsHarness(){
 const core=read('auris-core.js'),start=core.indexOf('var chemPendingSdsFile=null;'),end=core.indexOf('function chemShowForm()',start),c={tok:'session',ccid:()=> 'company-a',SB:'https://storage.example',KEY:'public-key',DC_BUCKET:'documents',dcSanitiseName:n=>n,chemEditId:'chemical-1',chemData:[{id:'chemical-1',sds_file_url:'https://storage.example/saved.pdf',sds_file_name:'saved.pdf'}],URL:{createObjectURL:()=> 'blob:preview'}};
 vm.createContext(c);vm.runInContext(core.slice(start,end),c);return c;
}
test('saved SDS preview survives reopening without a selected file',()=>{const c=sdsHarness();assert.equal(c.chemCurrentSdsDocument(false).file_url,'https://storage.example/saved.pdf');c.chemEditId=null;assert.equal(c.chemCurrentSdsDocument(false),null);});
test('SDS upload uses the company path and returns retained metadata',async()=>{const c=sdsHarness();const file={name:'sheet.pdf',type:'application/pdf'};c.chemPendingSdsFile=file;let request;c.fetch=async(url,options)=>{request={url,options};return {ok:true};};const result=await c.chemUploadPendingSds();assert.ok(request.url.includes("documents/company-a/chemical-sds/"));assert.equal(request.options.body,file);assert.equal(request.options.headers.Authorization,'Bearer session');assert.ok(result.sds_file_path.startsWith("company-a/chemical-sds/"));assert.equal(result.sds_file_mime,'application/pdf');});
test('failed or unauthenticated SDS upload cannot produce a saved document reference',async()=>{const c=sdsHarness();c.chemPendingSdsFile={name:'sheet.pdf',type:'application/pdf'};c.fetch=async()=>({ok:false,status:403,text:async()=> 'Denied'});await assert.rejects(c.chemUploadPendingSds(),/SDS upload failed/);c.tok='';await assert.rejects(c.chemUploadPendingSds(),/Sign in/);});
