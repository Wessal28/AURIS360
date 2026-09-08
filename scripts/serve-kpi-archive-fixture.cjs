// Loopback-only synthetic archive QA; no external services or tenant records.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),html=read('index.html'),core=read('auris-core.js');
function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);if(a<0||b<0)throw new Error('Fixture boundary missing: '+start);return source.slice(a,b);}
const panels=between(html,'<div id="obj-modal"','<div id="kpi-entry-modal"')+between(html,'<div id="app-confirm3modal"','<div id="onboard-modal"');
const assets={
 '/':['text/html',read('tests/fixtures/kpi-archive-safety.html').replace('<!-- ARCHIVE_PANELS -->',panels)],
 '/fixture-core.js':['text/javascript',between(core,'function appConfirm(opts)','function appPrompt(opts)')+between(core,'function closeKpiModal(','function kpiCalcYTD(')]
};
for(const f of ['kpi-definition-editor.js','auris-base.css','auris-kpi-legacy.css','auris-settings-static.css','kpi-module-upgrade.css','kpi-module-upgrade.js','auris-static-event-handlers.js','auris-generated-event-handlers.js'])assets['/'+f]=[f.endsWith('.css')?'text/css':'text/javascript',read(f)];
http.createServer((req,res)=>{const asset=assets[req.url];if(req.method!=='GET'||!asset){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':asset[0]+'; charset=utf-8','Cache-Control':'no-store'});res.end(asset[1]);}).listen(0,'127.0.0.1',function(){console.log(JSON.stringify({url:'http://127.0.0.1:'+this.address().port,pid:process.pid}));});
