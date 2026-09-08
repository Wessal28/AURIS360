const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const editor=read('kpi-definition-editor.js'),core=read('auris-core.js');
const functions=['openObjModal','kpiObjectiveCompany','kpiObjectiveViewYear','kpiObjectiveFeedback','kpiObjectiveCheckContext','kpiObjectiveMatches','kpiSaveObjective','kpiSelectColor','kpiAddIndicatorRow','openKpiAddModal','kpiStorageStatus','kpiDefinitionFeedback','kpiDefinitionCheckContext','kpiDefinitionRowsMatch','kpiSaveKPI'];

test('definition editing has one implementation owner outside the legacy core',()=>{
 for(const name of functions){
  const declaration=new RegExp('(?:async )?function '+name+'\\(','g');
  assert.equal([...editor.matchAll(declaration)].length,1,name);
  assert.doesNotMatch(core,declaration,name+' must not retain a competing implementation');
 }
 assert.doesNotMatch(core,/var kpiEditObjId\s*=/);
});

test('loading the whole feature is inert without a document, identity or services',()=>{
 const c={};vm.createContext(c);
 for(const name of ['document','api','prof','sessionStorage','localStorage'])Object.defineProperty(c,name,{get(){throw new Error('Unexpected startup dependency: '+name);}});
 vm.runInContext(editor,c,{filename:'kpi-definition-editor.js'});
 for(const name of functions)assert.equal(typeof c[name],'function',name);
 assert.equal(c.kpiEditObjId,null);
});

test('shared modal, archive and monthly calculation implementations stay in the core',()=>{
 for(const name of ['closeKpiModal','openKpiModal','kpiDeleteObjective','kpiDeleteKPI','kpiCalcYTD','kpiRecalcAllYTD','kpiSaveEntry','kpiClearEntry']){
  const declaration=new RegExp('(?:async )?function '+name+'\\(');
  assert.match(core,declaration);assert.doesNotMatch(editor,declaration);
 }
});

test('the shell loads the feature once, synchronously after core and before hooks',()=>{
 const tags=[...read('index.html').matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)];
 const names=tags.map(m=>m[1].split('?')[0]),index=names.indexOf('kpi-definition-editor.js');
 assert.equal(names.filter(n=>n==='kpi-definition-editor.js').length,1);
 assert.equal(index,names.indexOf('auris-core.js')+1);
 assert.doesNotMatch(tags[index][0],/\b(?:async|defer|type)\s*(?:=|>)/);
 for(const later of ['kpi-configuration.js','kpi-module-upgrade.js','kpi-workflow.js','kpi-data-source.js','kpi-pdf-import.js'])assert.ok(names.indexOf(later)>index,later);
 assert.match(tags[index][1],/\?v=20260909-indicator-navigation-1$/);
});

test('existing CSP buttons resolve the current feature handler, including later wrappers',()=>{
 const listeners={},c={document:{addEventListener(type,fn){listeners[type]=fn;}}};c.window=c;vm.createContext(c);
 vm.runInContext(editor,c);vm.runInContext(read('auris-static-event-handlers.js'),c);
 for(const [id,name]of [['h0125','openObjModal'],['h0138','kpiSaveObjective'],['h0140','kpiAddIndicatorFromButton'],['h0142','kpiSaveKPI']]){
  assert.equal(typeof c[name],'function');let calls=0;c[name]=()=>{calls++;};
  const button={nodeType:1,parentElement:null,getAttribute:key=>key==='data-auris-onclick'?id:null};
  listeners.click({target:button});assert.equal(calls,1,name);
 }
});

test('real upgrade hooks wrap the extracted editor without replacing its state',async()=>{
 const listeners={},modal={style:{display:'none'}},c={document:{readyState:'loading',getElementById:id=>id==='kpi-edit-modal'?modal:null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(type,fn){(listeners[type]??=[]).push(fn);}}};
 c.window=c;vm.createContext(c);vm.runInContext(editor,c);
 c.kpiEditObjId='retained-objective';
 const save=c.kpiSaveKPI,open=c.openKpiAddModal,add=c.kpiAddIndicatorRow;
 vm.runInContext(read('kpi-module-upgrade.js'),c);
 assert.equal(c.kpiSaveKPI,save,'deferred until DOM ready');
 for(const fn of listeners.DOMContentLoaded||[])fn();
 assert.notEqual(c.kpiSaveKPI,save);assert.notEqual(c.openKpiAddModal,open);assert.notEqual(c.kpiAddIndicatorRow,add);
 assert.equal(c.kpiEditObjId,'retained-objective');
 const outcome=await c.kpiSaveKPI();assert.equal(outcome.complete,false,'closed form remains non-writable');
});

test('offline, quality, syntax and deployed-release checks cover the feature asset',()=>{
 assert.match(read('sw-assets.js'),/\/kpi-definition-editor\.js/);
 assert.match(read('scripts/verify-platform-quality.cjs'),/'kpi-definition-editor\.js':40\*1024/);
 assert.match(read('tests/index_inline_syntax.test.cjs'),/'kpi-definition-editor\.js'/);
 for(const script of ['scripts/verify-production-smoke.cjs','scripts/verify-staging-acceptance.cjs']){
  const source=read(script);assert.match(source,/'kpi-definition-editor\.js'/);
  for(const name of ['openObjModal','kpiSaveObjective','openKpiAddModal','kpiSaveKPI','kpiDefinitionCheckContext'])assert.ok(source.includes('function '+name+'('));
 }
});

test('synthetic browser fixtures load the complete feature file in the shell order',()=>{
 for(const [server,fixture]of [['scripts/serve-kpi-indicator-fixture.cjs','tests/fixtures/kpi-indicator-identity.html'],['scripts/serve-kpi-objective-fixture.cjs','tests/fixtures/kpi-objective-save.html']]){
  assert.match(read(server),/\['kpi-definition-editor\.js'/);
  const html=read(fixture);assert.match(html,/<script src="\/fixture-core\.js"><\/script><script src="\/kpi-definition-editor\.js"><\/script>/);
  assert.doesNotMatch(read(server),/core\.indexOf\('function (?:openObjModal|kpiAddIndicatorRow)/);
 }
});
