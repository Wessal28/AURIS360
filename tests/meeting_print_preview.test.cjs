const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(prepare){
  const events={},calls=[],messages=[];let company='company-a',user='user-a';
  const button={disabled:false,textContent:'Print minutes',addEventListener:(name,handler)=>events[name]=handler};
  const modal={isConnected:true,querySelector:()=>button};
  const c={Date,Intl,Map,Set,document:{addEventListener(){}},ccid:()=>company,prof:{id:user},toast:message=>messages.push(message)};
  c.AurisModuleExtraction={prepare:async(key,context)=>{calls.push(['prepare',key]);await prepare?.(c);}};
  c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('meeting-reliability.js','utf8'),c);
  return {c,button,modal,events,calls,messages,open:()=>c.mtgPreparePrint({id:'minutes-a'},modal,company,user),company:v=>company=v,user:v=>{user=v;c.prof.id=v;}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('minutes reader prepares preview tools before allowing exact saved-record printing',async()=>{
  let release;const wait=new Promise(done=>release=done),h=harness(async c=>{await wait;c.AurisModuleReports={minutes:async id=>h.calls.push(['minutes',id])};});
  h.open();assert.equal(h.button.disabled,true);assert.match(h.button.textContent,/Loading print preview/);release();await settle();
  assert.equal(h.button.disabled,false);assert.equal(h.button.textContent,'Preview / print minutes');h.events.click();await settle();
  assert.deepEqual(h.calls,[['prepare','meetings'],['minutes','minutes-a']]);
});
test('module loading failure is retryable without losing or printing the minutes',async()=>{
  let attempts=0;const h=harness(c=>{if(++attempts===1)throw Error('Temporary connection problem');c.AurisModuleReports={minutes:async id=>h.calls.push(['minutes',id])};});
  h.open();await settle();assert.equal(h.button.disabled,false);assert.equal(h.button.textContent,'Retry print preview');assert.match(h.messages[0],/Temporary/);
  h.events.click();await settle();assert.equal(h.button.textContent,'Preview / print minutes');assert.equal(h.calls.some(x=>x[0]==='minutes'),false);
  h.events.click();await settle();assert.deepEqual(h.calls.at(-1),['minutes','minutes-a']);
});
test('account, company and reader changes invalidate the old print action',async()=>{
  for(const change of [h=>h.company('company-b'),h=>h.user('user-b'),h=>h.modal.isConnected=false]){
    const h=harness();h.c.AurisModuleReports={minutes:async id=>h.calls.push(['minutes',id])};h.open();await settle();change(h);h.events.click();await settle();
    assert.equal(h.calls.some(x=>x[0]==='minutes'),false);assert.match(h.messages.at(-1),/Reopen these minutes/);
  }
});
test('reader routing and lazy module assets keep printing out of the generic metadata dialog',()=>{
  const core=fs.readFileSync('auris-core.js','utf8'),requirements=fs.readFileSync('requirements-5.js','utf8'),index=fs.readFileSync('index.html','utf8');
  assert.match(core,/mtgPreparePrint\(m,modal,companyId,userId\)/);
  assert.match(requirements,/if\(id==='lca-list'\)[\s\S]*?AurisLegalAssessmentViewer\.open\(rid\)/);
  assert.match(index,/id="legal-print-btn"[^\n]+Print preview \/ reports/);
  assert.match(index,/data-auris-onclick="h0797"[^\n]+Print preview \/ reports/);
  assert.match(index,/<link rel="prefetch" href="module-report-preview\.js/);
  assert.doesNotMatch(index,/<script[^>]+src="(?:module-report-preview|legal-assessment-viewer)\.js/);
});
