// Local-only, allowlisted synthetic QA. Never connects to a tenant database.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const core=read('auris-core.js'),upgrade=read('kpi-module-upgrade.js'),html=read('index.html');
const panelStart=html.indexOf('<div id="kpi-entry-modal"'),panelEnd=html.indexOf('</div></div></div></div>',panelStart);
if(panelStart<0||panelEnd<0)throw new Error('Monthly entry panel not found');
const panel=html.slice(panelStart,panelEnd+'</div></div></div></div>'.length);
const confirmStart=html.indexOf('<div id="app-confirm3modal"'),confirmEnd=html.indexOf('<div id="onboard-modal"',confirmStart);
if(confirmStart<0||confirmEnd<0)throw new Error('Confirmation panel not found');
const confirmation=html.slice(confirmStart,confirmEnd);
const boot="if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kpiXBoot);else kpiXBoot();";
if(!upgrade.includes(boot))throw new Error('Module boot not found');
const assets={
  '/':['text/html',read('tests/fixtures/kpi-monthly-save.html').replace('<!-- MONTHLY_PANEL -->',panel+confirmation)],
  '/fixture-core.js':['text/javascript',core.slice(core.indexOf('function appConfirm(opts)'),core.indexOf('function appPrompt(opts)'))+core.slice(core.indexOf('async function kpiLoadAll('),core.indexOf('function kpiUpdateMetrics()'))+core.slice(core.indexOf('function closeKpiModal(id)'),core.indexOf('async function kpiDeleteObjective'))+core.slice(core.indexOf('function kpiCalcYTD(indicatorId'),core.indexOf('// -- SOP MODULE HELPERS'))],
  '/fixture-module.js':['text/javascript',upgrade.replace(boot,"function fixtureBoot(){kpiXEnhanceEntryModal();kpiXInstallHooks();window.kpiRenderOverview=function(){};window.kpiRenderMonthly=function(){};window.kpiUpdateMetrics=function(){};kpiXRenderAll=function(){};}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fixtureBoot);else fixtureBoot();")]
};
for(const file of ['auris-base.css','auris-kpi-legacy.css','auris-settings-static.css','kpi-module-upgrade.css','auris-static-event-handlers.js'])assets['/'+file]=[file.endsWith('.css')?'text/css':'text/javascript',read(file)];
const server=http.createServer((request,response)=>{const asset=assets[request.url];if(request.method!=='GET'||!asset){response.writeHead(404);response.end();return;}response.writeHead(200,{'Content-Type':asset[0]+'; charset=utf-8','Cache-Control':'no-store'});response.end(asset[1]);});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+server.address().port,pid:process.pid})));
