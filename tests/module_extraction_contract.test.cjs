const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

function registryContext(){const c={globalThis:{}};vm.runInNewContext(read('auris-module-registry.js'),c);return c.globalThis;}

test('all remaining extraction groups publish immutable service and asset contracts',()=>{
  const w=registryContext();
  const expected=['inspection','training','contractor','people','chemical','tools','atex','emergency','fire','esg','legal','fleet','ohealth'];
  const actual=w.AurisModuleRegistry.list().filter(m=>m.extraction).map(m=>m.key);
  assert.deepEqual(Array.from(actual).sort(),expected.slice().sort());
  for(const key of expected){const x=w.AurisModuleRegistry.get(key).extraction;assert.equal(x.mode,'extracted');assert.ok(x.services.includes('api'));assert.ok(x.services.includes('rbac'));assert.equal(Object.isFrozen(x),true);}
});

test('large optional module upgrades are lazy rather than part of initial script execution',()=>{
  const html=read('index.html'),registry=read('auris-module-registry.js'),generator=read('scripts/generate-sw-manifest.cjs');
  const lazy=['learning-competency-upgrade.js','elearning-course-path.js','contractor-management-upgrade.js','chemical-control-upgrade.js','tools-equipment-upgrade.js','legal-compliance-upgrade.js'];
  for(const asset of lazy){assert.doesNotMatch(html,new RegExp('<script[^>]+src="'+asset.replaceAll('.','\\.')+'(?:\\?|\")'));assert.match(registry,new RegExp(asset.replaceAll('.','\\.')));assert.match(generator,new RegExp(asset.replaceAll('.','\\.')));}
});

test('extraction boundary allowlists assets, requires services and isolates failure',()=>{
  const source=read('auris-module-extraction.js'),runtime=read('auris-module-runtime.js'),adapter=read('auris-extracted-module-adapters.js');
  assert.match(source,/Required platform services are unavailable/);assert.match(source,/Unsafe module asset/);assert.match(source,/temporarily unavailable/);assert.match(source,/Retry module/);
  assert.match(runtime,/AurisModuleExtraction\.prepare/);assert.match(runtime,/activeKey=previous/);assert.match(runtime,/recoverable:true/);
  assert.doesNotMatch(adapter,/\bprof\b|\btok\b|\bsephsCompanyContext\b|\bcf\s*\(/);assert.match(adapter,/platform\.rbac\.requireAccess/);assert.match(adapter,/platform\.auth\.current/);
});

test('lazy preparation loads each local asset once and reports readiness',async()=>{
  let appended=0;const page={dataset:{}},context={globalThis:null,queueMicrotask,Promise,Error};context.globalThis=context;
  context.AurisModuleRegistry={get:()=>({name:'Demo',extraction:{group:'test',services:['api'],assets:['demo-upgrade.js']}})};
  context.AurisPlatformServices={api:{isReady:()=>true}};
  context.document={createElement:()=>({dataset:{}}),head:{appendChild(script){appended++;queueMicrotask(()=>script.onload());}},getElementById:()=>page,querySelector:()=>null};
  vm.runInNewContext(read('auris-module-extraction.js'),context);
  await context.AurisModuleExtraction.prepare('demo',{services:context.AurisPlatformServices});
  await context.AurisModuleExtraction.prepare('demo',{services:context.AurisPlatformServices});
  assert.equal(appended,1);assert.equal(page.dataset.aurisExtracted,'true');assert.equal(context.AurisModuleExtraction.status('demo').assets[0].loaded,true);
  assert.throws(()=>context.AurisModuleExtraction.safeAsset('../escape.js'),/Unsafe module asset/);
});

test('deployment loads extraction before adapters and preserves responsive recovery',()=>{
  const html=read('index.html'),css=read('auris-module-extraction.css'),manifest=read('sw-assets.js');
  assert.match(html,/modular-foundation-(?:12|13|14|15|16|17|18|19|20|21)/);
  assert.ok(html.indexOf('auris-module-extraction.js?v=20260901-12')<html.indexOf('auris-extracted-module-adapters.js?v=20260901-12'));
  assert.ok(html.indexOf('auris-extracted-module-adapters.js?v=20260901-12')<html.indexOf('auris-core.js?v=20260901-11'));
  assert.match(css,/@media\(max-width:600px\)/);assert.match(manifest,/auris-module-extraction\.js/);assert.match(manifest,/contractor-management-upgrade\.js/);
});
