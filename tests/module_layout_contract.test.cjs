const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('shared module layout publishes reusable view and active-state services',()=>{
  const manifest={key:'test',name:'Test App',category:'Operations',icon:'ti-test',dependencies:[],layout:{defaultView:'dashboard',views:['dashboard','register']}};
  const context={globalThis:{AurisModuleRegistry:{get:()=>manifest}}};
  vm.runInNewContext(read('auris-module-layout.js'),context);
  const layout=context.globalThis.AurisModuleLayout;
  assert.equal(layout.version,'1.0.0');
  assert.equal(typeof layout.mount,'function');
  assert.equal(typeof layout.setView,'function');
  assert.deepEqual(Array.from(layout.normaliseViews(manifest)).map(view=>view.id),['dashboard','register']);
});

test('Incident Management renders its manifest views through the shared layout',()=>{
  const registrySource=read('auris-module-registry.js'),incident=read('incident-management-upgrade.js');
  for(const view of ['dashboard','mywork','report','register','triage','investigate','actions','regulatory','lessons','reports','configuration'])assert.match(registrySource,new RegExp("'"+view+"'"));
  assert.match(incident,/AurisModuleLayout\.mount\('events'/);
  assert.match(incident,/AurisModuleLayout\.setView\('events',tab\)/);
  assert.match(incident,/group:index<2\?'Overview':index<9\?'Operations':'Insights & setup'/);
});

test('application loads the shared layout before Incident Management and caches it offline',()=>{
  const html=read('index.html'),manifest=read('sw-assets.js'),css=read('auris-module-layout.css');
  assert.ok(html.indexOf('auris-module-layout.js?v=20260831-4')<html.indexOf('incident-management-upgrade.js?v=20260831-4'));
  assert.match(html,/auris-module-layout\.css\?v=20260831-4/);
  assert.match(manifest,/auris-module-layout\.js/);
  assert.match(manifest,/auris-module-layout\.css/);
  assert.match(css,/\.auris-module-viewbar/);
  assert.match(css,/@media\(max-width:760px\)/);
});
