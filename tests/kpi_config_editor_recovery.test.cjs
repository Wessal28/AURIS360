const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'kpi-module-upgrade.js'),'utf8');
function harness(){
 let html='',button,heading;const outside={id:'outside'},page={hidden:false,style:{display:'block'}},doc={activeElement:outside,readyState:'loading',addEventListener(){}};
 const host={hidden:false,style:{display:'block'},get innerHTML(){return html;},set innerHTML(value){html=value;button=html.includes('data-kpi-config-retry')?{focus(){doc.activeElement=this;},addEventListener(type,fn){this[type]=fn;},disabled:false}:null;heading=/<h[23]/.test(html)?{focus(){doc.activeElement=this;},setAttribute(name,value){this[name]=value;}}:null;},querySelector(selector){return selector.includes('data-kpi-config-retry')?button:selector.includes('h2')?heading:null;},contains(node){return !!node&&(node===button||node===heading);}};
 doc.getElementById=id=>id==='kpi-x-config-view'?host:id==='page-kpi'?page:null;
 const calls=[];const c={document:doc,localStorage:{getItem:()=>null},kpiConfigPublished:{targets:{on_track_percent:95}},kpiKPIs:[],kpiObjectives:[],kpiIndicators:[],kpiMonthlyData:{},api:()=>{calls.push('api');throw Error('Unexpected network');},kpiConfigLoad:()=>calls.push('load'),kpiConfigSave:()=>calls.push('save'),kpiConfigValidate:()=>calls.push('validate'),kpiConfigPublish:()=>calls.push('publish')};
 c.window=c;vm.createContext(c);const boot="if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kpiXBoot);else kpiXBoot();";assert.ok(source.includes(boot));vm.runInContext(source.replace(boot,'window.qa={render:kpiXRenderConfig};'),c);
 return {c,host,page,doc,outside,calls,button:()=>button,heading:()=>heading};
}
test('missing renderer shows a genuine unavailable state instead of decorative configuration',()=>{
 const h=harness();h.c.qa.render();assert.match(h.host.innerHTML,/Configuration editor unavailable/);assert.match(h.host.innerHTML,/role="alert"/);assert.match(h.host.innerHTML,/data-kpi-config-retry/);assert.match(h.host.innerHTML,/Retry editor/);assert.doesNotMatch(h.host.innerHTML,/Rule Preview|Example KPI|within 10%|current deployed schema|Reporting Cycles<|Notifications</);assert.equal((h.host.innerHTML.match(/<button/g)||[]).length,1);
});
test('unavailable text explains retry limits without claiming settings or schema changed',()=>{
 const h=harness();h.c.qa.render();assert.match(h.host.innerHTML,/does not save, validate or publish/i);assert.match(h.host.innerHTML,/before reloading/i);assert.doesNotMatch(h.host.innerHTML,/default settings are active|Database setup required/i);
});
test('renderer errors replace partial markup with visible safe recovery text',()=>{
 const h=harness();h.c.kpiConfigRender=()=>{h.host.innerHTML='<div>partial editor</div>';throw Error('<b>secret server detail</b>');};assert.doesNotThrow(()=>h.c.qa.render());assert.match(h.host.innerHTML,/Configuration editor unavailable/);assert.doesNotMatch(h.host.innerHTML,/partial editor|secret server detail|<b>/);
});
test('normal renderer remains the sole authoritative editor and does not steal focus',()=>{
 const h=harness();let calls=0;h.c.kpiConfigRender=()=>{calls++;h.host.innerHTML='<h2>Real configuration</h2><input id="original-field">';};h.c.qa.render();assert.equal(calls,1);assert.match(h.host.innerHTML,/original-field/);assert.doesNotMatch(h.host.innerHTML,/Retry editor/);assert.equal(h.doc.activeElement,h.outside);
});
test('initial and background fallback rendering do not move keyboard focus',()=>{
 const h=harness();h.c.qa.render();assert.equal(h.doc.activeElement,h.outside);h.host.hidden=true;h.c.qa.render();assert.equal(h.doc.activeElement,h.outside);
});
test('retry uses the current renderer and focuses its real heading on recovery',()=>{
 const h=harness();h.c.qa.render();const old=h.button();assert.ok(old);old.focus();h.c.kpiConfigRender=()=>{h.host.innerHTML='<h2>Real configuration</h2>';};old.click();assert.match(h.host.innerHTML,/Real configuration/);assert.equal(h.doc.activeElement,h.heading());assert.equal(h.heading().tabindex,'-1');assert.deepEqual(h.calls,[]);
});
test('failed repeated retry remains visible and retains keyboard focus',()=>{
 const h=harness();h.c.qa.render();let previous=h.button();assert.ok(previous);previous.focus();for(let i=0;i<3;i++){previous.click();assert.notEqual(h.button(),previous);assert.equal(h.doc.activeElement,h.button());assert.match(h.host.innerHTML,/Configuration editor unavailable/);previous=h.button();}
});
test('recovery from a transient renderer exception reuses the existing editor',()=>{
 const h=harness();let fail=true;h.c.kpiConfigRender=()=>{if(fail)throw Error('temporary');h.host.innerHTML='<h2>Recovered</h2>';};assert.doesNotThrow(()=>h.c.qa.render());const retry=h.button();assert.ok(retry);fail=false;retry.focus();retry.click();assert.match(h.host.innerHTML,/Recovered/);
});
test('detached retry controls cannot trigger a newer editor render',()=>{
 const h=harness();h.c.qa.render();const old=h.button();assert.ok(old);h.c.qa.render();let calls=0;h.c.kpiConfigRender=()=>calls++;old.click();assert.equal(calls,0);
});
for(const target of ['host hidden','host display','page hidden','page display','replaced host'])test('stale or invisible retry is ignored: '+target,()=>{
 const h=harness();h.c.qa.render();const retry=h.button();assert.ok(retry);let calls=0;h.c.kpiConfigRender=()=>calls++;if(target==='host hidden')h.host.hidden=true;if(target==='host display')h.host.style.display='none';if(target==='page hidden')h.page.hidden=true;if(target==='page display')h.page.style.display='none';if(target==='replaced host')h.doc.getElementById=()=>null;retry.click();assert.equal(calls,0);
});
test('missing host returns without invoking the renderer',()=>{
 const h=harness();h.doc.getElementById=()=>null;let calls=0;h.c.kpiConfigRender=()=>calls++;assert.doesNotThrow(()=>h.c.qa.render());assert.equal(calls,0);
});
test('fallback and retry never load, save, publish, replace policy or rewrite records',()=>{
 const h=harness(),before=JSON.stringify({config:h.c.kpiConfigPublished,kpis:h.c.kpiKPIs,data:h.c.kpiMonthlyData});h.c.qa.render();const retry=h.button();assert.ok(retry);retry.click();assert.deepEqual(h.calls,[]);assert.equal(JSON.stringify({config:h.c.kpiConfigPublished,kpis:h.c.kpiKPIs,data:h.c.kpiMonthlyData}),before);
});
test('retry has a scoped touch-sized control without inline event handlers',()=>{
 const css=fs.readFileSync(path.join(root,'kpi-module-upgrade.css'),'utf8'),h=harness();h.c.qa.render();assert.match(css,/#page-kpi #kpi-x-config-view \.kpi-x-config-unavailable \.kpi-x-btn\{[^}]*min-height:44px!important/);assert.doesNotMatch(h.host.innerHTML,/onclick=/);
});
