const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function environment(){
  const values=new Map();
  const window={console,Date,localStorage:{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,value)},document:null};
  window.globalThis=window;
  vm.runInNewContext(read('auris-module-registry.js'),window);
  window.AurisModuleRuntime={readiness:key=>({ready:key!=='risk',reason:key==='risk'?'service_unavailable':''})};
  vm.runInNewContext(read('auris-command-centre.js'),window);
  return {window,values};
}

test('catalogue respects access and readiness before navigation',()=>{
  const {window}=environment(),opened=[];
  window.AurisCommandCentre.configure({context:()=>({companyId:'co-a',userId:'user-a'}),canAccess:key=>key!=='audit',readiness:key=>window.AurisModuleRuntime.readiness(key),navigate:req=>opened.push(req)});
  assert.equal(window.AurisCommandCentre.catalogue('').some(item=>item.key==='audit'),false);
  assert.equal(window.AurisCommandCentre.execute('risk').ok,false);
  assert.equal(window.AurisCommandCentre.execute('events').ok,true);
  assert.deepEqual(opened.map(item=>item.moduleKey),['events']);
});

test('favourites and recents are isolated by company and user',()=>{
  const {window,values}=environment();let scope={companyId:'co-a',userId:'user-a'};
  window.AurisCommandCentre.configure({context:()=>scope,canAccess:()=>true,navigate:()=>{}});
  window.AurisCommandCentre.toggleFavourite('events');window.AurisCommandCentre.recordOpen('events');
  assert.deepEqual(Array.from(window.AurisCommandCentre.favourites()),['events']);
  scope={companyId:'co-b',userId:'user-a'};
  assert.deepEqual(Array.from(window.AurisCommandCentre.favourites()),[]);
  assert.equal(window.AurisCommandCentre.diagnostics().recents,0);
  assert.equal(values.size,1);
});

test('deep links fail closed across company boundaries',()=>{
  const {window}=environment(),opened=[];
  window.AurisCommandCentre.configure({context:()=>({companyId:'co-a',userId:'user-a'}),canAccess:()=>true,canOpenCompany:()=>false,navigate:req=>opened.push(req)});
  const blocked=window.AurisCommandCentre.execute({moduleKey:'events',record:'ev-1',table:'events',companyId:'co-b'});
  assert.equal(blocked.ok,false);assert.match(blocked.reason,/another company/i);assert.equal(opened.length,0);
});

test('deployment loads an accessible responsive command centre before core',()=>{
  const html=read('index.html'),core=read('auris-core.js'),css=read('auris-command-centre.css'),runtime=read('api/runtime-config.js');
  assert.ok(html.indexOf('auris-command-centre.js?v=20260901-14')<html.indexOf('auris-core.js?v=20260901-11'));
  assert.match(html,/id="auris-command-trigger"/);assert.match(html,/auris-command-centre\.css\?v=20260901-14/);
  assert.match(core,/commandCentreSetup/);assert.match(core,/deepLinkResume\('command-centre'\)/);assert.match(core,/AurisCommandCentre\.recordOpen\(name\)/);
  assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/focus-visible/);assert.match(runtime,/modular-foundation-16/);
});
