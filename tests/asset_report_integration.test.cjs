const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('auris-core.js','utf8');
const start=core.indexOf('function assetPrintSaved('),end=core.indexOf('\nfunction printRegisterView(',start);
function harness(reports){const messages=[],c={window:reports,Promise,toast:message=>messages.push(message)};vm.createContext(c);vm.runInContext(core.slice(start,end),c);return {c,messages};}

test('saved asset printing invokes the exact builder synchronously while user activation is available',async()=>{
 const calls=[],h=harness({AurisFleetPrint:{service:(id,vehicle)=>{calls.push([id,vehicle]);return Promise.resolve('preview');}}});
 const result=h.c.assetPrintSaved('fleet','service','saved-service','saved-vehicle');
 assert.deepEqual(calls,[['saved-service','saved-vehicle']]);assert.equal(await result,'preview');assert.deepEqual(h.messages,[]);
});

test('saved asset printing reports unavailable builders and fresh read errors without falling back to screen content',async()=>{
 const h=harness({});assert.equal(await h.c.assetPrintSaved('tools','inspection','saved-inspection'),null);assert.match(h.messages[0],/loading/);
 h.c.window.AurisToolsPrint={inspection:async()=>{throw Error('The saved inspection is unavailable.');}};
 assert.equal(await h.c.assetPrintSaved('tools','inspection','saved-inspection'),null);assert.equal(h.messages.at(-1),'The saved inspection is unavailable.');
});

test('asset readers and lazy loaders route to the intended saved reports',()=>{
 assert.match(core,/assetPrintSaved\('tools','inspection',x.id\)/);
 assert.match(core,/assetPrintSaved\('tools','record',x.id\)/);
 assert.match(core,/assetPrintSaved\('fleet','inspection',record.id\)/);
 assert.match(core,/assetPrintSaved\('fleet','service',service.id,vehicle.id\)/);
 const registry=fs.readFileSync('auris-module-registry.js','utf8'),index=fs.readFileSync('index.html','utf8');
 for(const key of ['tools','fleet']){
  const entry=registry.split('\n').find(line=>line.trim().startsWith(key+':{group:'));
  assert.match(entry,/module-report-preview.js/);assert.ok(entry.includes(key+'-print-reports.js'));assert.ok(index.includes('href="'+key+'-print-reports.js?'));
 }
 assert.match(index,/id="fleet-print-btn"[^\n]+Print preview \/ reports/);
});
