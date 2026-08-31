const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');

function runtimeContext(){
  const context={globalThis:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'auris-module-registry.js'),'utf8'),context);
  vm.runInNewContext(fs.readFileSync(path.join(root,'auris-module-runtime.js'),'utf8'),context);
  return context.globalThis;
}

test('runtime reports missing dependencies without changing legacy route access',()=>{
  const window=runtimeContext();
  const status=window.AurisModuleRuntime.readiness('events',['dashboard','events']);
  assert.equal(status.ready,false);
  assert.deepEqual(Array.from(status.missing),['actions','people'].sort(function(a,b){return window.AurisModuleRegistry.keys().indexOf(a)-window.AurisModuleRegistry.keys().indexOf(b);}));
  assert.equal(window.AurisModuleRuntime.readiness('events',window.AurisModuleRegistry.dependencyClosure(['events'])).ready,true);
});

test('runtime executes registered lifecycle hooks around the existing loader',async()=>{
  const window=runtimeContext(),calls=[];
  window.loadDash=function(){calls.push('load:dashboard');};
  window.loadEvents=async function(){calls.push('load:events');};
  window.AurisModuleRuntime.register('dashboard',{leave:function(){calls.push('leave:dashboard');}});
  window.AurisModuleRuntime.register('events',{beforeEnter:function(){calls.push('before:events');},enter:function(){calls.push('enter:events');}});
  window.AurisModuleRuntime.activate('dashboard',{activateView:function(){calls.push('view:dashboard');}});
  await window.AurisModuleRuntime.activate('events',{activateView:function(){calls.push('view:events');}});
  assert.deepEqual(calls,['view:dashboard','load:dashboard','before:events','view:events','leave:dashboard','load:events','enter:events']);
  assert.equal(window.AurisModuleRuntime.current(),'events');
});

test('runtime cancellation leaves the active module unchanged',()=>{
  const window=runtimeContext();
  window.loadDash=function(){};
  window.loadEvents=function(){throw new Error('cancelled loader must not run');};
  window.AurisModuleRuntime.activate('dashboard');
  window.AurisModuleRuntime.register('events',{beforeEnter:function(){return false;}});
  const result=window.AurisModuleRuntime.activate('events');
  assert.equal(result.cancelled,true);
  assert.equal(window.AurisModuleRuntime.current(),'dashboard');
});
