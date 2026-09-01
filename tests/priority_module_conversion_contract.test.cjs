const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

function registry(){const context={globalThis:null};context.globalThis=context;vm.runInNewContext(read('auris-module-registry.js'),context);return context.AurisModuleRegistry;}
const converted=['risk','permit','documents','moc','actions'];

test('five priority modules declare shared layout lifecycle and workflow contracts',()=>{
  const modules=registry();
  for(const key of converted){
    const manifest=modules.get(key);
    assert.equal(manifest.lifecycle.managed,true,key+' lifecycle');
    assert.ok(manifest.layout.views.length>=1,key+' views');
    assert.ok(manifest.workflow.states.length>=6,key+' states');
    assert.ok(manifest.workflow.transitions.length>=5,key+' transitions');
  }
});

test('dedicated decisions are declared as approval-gated workflow transitions',()=>{
  const modules=registry();
  for(const key of converted){
    const workflow=modules.workflowOf(key);
    for(const pair of workflow.approvalTransitions){
      assert.equal(modules.canTransition(key,pair[0],pair[1]),true,key+' '+pair.join(' -> '));
    }
  }
  assert.deepEqual(Array.from(modules.get('actions').layout.views),['all','mine','overdue','verify','closure']);
  assert.deepEqual(Array.from(modules.get('documents').layout.views),['all','approval','expiry','copies','ack']);
});

test('compatibility adapters route shared views back to established handlers',()=>{
  const source=read('auris-priority-module-adapters.js');
  for(const key of converted)assert.match(source,new RegExp('\\b'+key+':\\{'));
  for(const handler of ['raListTab','ptwFilterSet','dcSwitchTab','mocNew','mapSetView'])assert.match(source,new RegExp("call\\('"+handler+"'"));
  assert.match(source,/runtime\.register\(key,\{enter:function\(\)\{mount\(key\)/);
  assert.match(source,/layout\.mount\(key/);
});

test('deployment includes converted adapters and command-capable shared layout',()=>{
  const html=read('index.html'),layout=read('auris-module-layout.js'),manifest=read('sw-assets.js');
  assert.ok(html.indexOf('auris-priority-module-adapters.js?v=20260901-7')<html.indexOf('auris-core.js'));
  assert.match(layout,/options\.commands/);
  assert.match(layout,/data-layout-command/);
  assert.match(manifest,/auris-priority-module-adapters\.js/);
});
