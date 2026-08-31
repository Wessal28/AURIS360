const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

function runtime(){
  const context={console,globalThis:null};context.globalThis=context;
  vm.runInNewContext(read('auris-module-registry.js'),context);
  vm.runInNewContext(read('auris-module-runtime.js'),context);
  vm.runInNewContext(read('auris-applications-admin.js'),context);
  return context.AurisApplicationsAdmin;
}

test('install plans include the full dependency closure and preserve dashboard',()=>{
  const admin=runtime(),plan=admin.planEnable('permit',['dashboard'],{launchedKeys:['dashboard','permit','risk','swms','people','actions','documents']});
  assert.deepEqual(Array.from(plan.blocked),[]);
  for(const key of ['dashboard','people','actions','risk','documents','swms','permit'])assert.ok(plan.next.includes(key),key);
});

test('uninstall plans remove recursive dependants without leaving broken modules',()=>{
  const admin=runtime(),enabled=['dashboard','people','actions','risk','documents','swms','permit','moc'];
  const plan=admin.planDisable('risk',enabled);
  for(const key of ['risk','swms','permit','moc'])assert.ok(plan.remove.includes(key),key);
  assert.ok(plan.next.includes('dashboard'));
  assert.equal(plan.next.includes('risk'),false);
});

test('catalogue distinguishes installed available and blocked release states',()=>{
  const admin=runtime(),apps=admin.catalogue(['dashboard','people','actions','risk'],{launchedKeys:['dashboard','people','actions','risk','documents']});
  assert.equal(apps.find(app=>app.key==='risk').state,'installed');
  assert.equal(apps.find(app=>app.key==='documents').state,'available');
  assert.equal(apps.find(app=>app.key==='permit').state,'blocked');
});

test('production administration uses existing company access persistence and direct listeners',()=>{
  const core=read('auris-core.js'),source=read('auris-applications-admin.js'),html=read('index.html'),css=read('auris-applications-admin.css'),manifest=read('sw-assets.js');
  assert.match(core,/AurisApplicationsAdmin\.renderPortfolio/);
  assert.match(core,/adminModSave\(company\.id,impact\.next\)/);
  assert.match(source,/addEventListener\('click'/);
  assert.doesNotMatch(source,/onclick=/);
  assert.ok(html.indexOf('auris-applications-admin.js?v=20260901-8')<html.indexOf('auris-core.js'));
  assert.match(html,/auris-applications-admin\.css\?v=20260901-8/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(manifest,/auris-applications-admin\.js/);
  assert.match(manifest,/auris-applications-admin\.css/);
});
