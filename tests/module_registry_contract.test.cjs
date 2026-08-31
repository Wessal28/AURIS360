const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'auris-module-registry.js'),'utf8');
const context={globalThis:{}};
vm.runInNewContext(source,context);
const registry=context.globalThis.AurisModuleRegistry;

test('module registry exposes one canonical dependency-valid application catalogue',()=>{
  assert.ok(registry);
  assert.equal(registry.version,'1.0.0');
  const modules=registry.list();
  assert.ok(modules.length>=35);
  assert.equal(new Set(modules.map(module=>module.key)).size,modules.length);
  for(const module of modules){
    assert.ok(module.name&&module.icon&&module.category&&module.loader);
    for(const dependency of module.dependencies)assert.ok(registry.get(dependency),`${module.key} has unknown dependency ${dependency}`);
  }
});

test('company module catalogue excludes platform administration applications',()=>{
  const companyKeys=registry.keys({companyScoped:true});
  for(const key of ['events','risk','permit','documents','training'])assert.ok(companyKeys.includes(key));
  for(const key of ['settings','admin','users','audit'])assert.ok(!companyKeys.includes(key));
});

test('incident manifest establishes the first cross-module dependency contract',()=>{
  const incident=registry.get('events');
  assert.equal(incident.name,'Incident Management');
  assert.deepEqual(Array.from(registry.dependenciesOf('events')),['people','actions']);
  assert.equal(incident.loader,'loadEvents');
});

test('application loads registry before the core and includes the app launcher assets',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.ok(html.indexOf('auris-module-registry.js?v=20260831-1')<html.indexOf('auris-core.js?v=20260831-1'));
  assert.match(html,/auris-app-launcher\.css\?v=20260831-1/);
  assert.match(html,/<span>Apps<\/span>/);
});
