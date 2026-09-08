// Local, synthetic KPI editor QA: real markup and code, no tenant API or external services.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),html=read('index.html'),core=read('auris-core.js');
const start=html.indexOf('<div id="kpi-edit-modal"'),end=html.indexOf('<div id="kpi-entry-modal"',start);
if(start<0||end<0)throw new Error('KPI form markup unavailable');
const assets={
 '/':['text/html',read('tests/fixtures/kpi-indicator-identity.html').replace('<!-- KPI_PANEL -->',html.slice(start,end))],
 '/fixture-core.js':['text/javascript',core.slice(core.indexOf('function closeKpiModal('),core.indexOf('async function kpiDeleteObjective('))+core.slice(core.indexOf('function kpiCalcYTDFromRows('),core.indexOf('async function kpiClearEntry('))]
};
for(const f of ['kpi-definition-editor.js','auris-base.css','auris-kpi-legacy.css','kpi-module-upgrade.css','kpi-module-upgrade.js','auris-static-event-handlers.js','auris-generated-event-handlers.js'])assets['/'+f]=[f.endsWith('.css')?'text/css':'text/javascript',read(f)];
http.createServer((req,res)=>{const asset=assets[req.url];if(req.method!=='GET'||!asset){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':asset[0]+'; charset=utf-8','Cache-Control':'no-store'});res.end(asset[1]);}).listen(0,'127.0.0.1',function(){console.log(JSON.stringify({url:'http://127.0.0.1:'+this.address().port,pid:process.pid}));});
