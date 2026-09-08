// Local synthetic QA only; allowlisted files, no tenant API or external assets.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('index.html'),core=read('auris-core.js');
const start=html.indexOf('<div id="obj-modal"'),end=html.indexOf('<div id="kpi-edit-modal"',start);
if(start<0||end<0)throw new Error('Objective form markup unavailable');
const assets={
 '/':['text/html',read('tests/fixtures/kpi-objective-save.html').replace('<!-- OBJECTIVE_PANEL -->',html.slice(start,end))],
 '/fixture-core.js':['text/javascript',core.slice(core.indexOf('var kpiEditObjId = null'),core.indexOf('// -- Print the KPI scorecard'))+core.slice(core.indexOf('function kpiSelectColor('),core.indexOf('async function kpiDeleteObjective'))]
};
for(const file of ['auris-base.css','auris-kpi-legacy.css','kpi-module-upgrade.css','auris-static-event-handlers.js'])assets['/'+file]=[file.endsWith('.css')?'text/css':'text/javascript',read(file)];
http.createServer((req,res)=>{const asset=assets[req.url];if(req.method!=='GET'||!asset){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':asset[0]+'; charset=utf-8','Cache-Control':'no-store'});res.end(asset[1]);}).listen(0,'127.0.0.1',function(){console.log(JSON.stringify({url:'http://127.0.0.1:'+this.address().port,pid:process.pid}));});
