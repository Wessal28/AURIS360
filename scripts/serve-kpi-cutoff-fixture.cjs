// Loopback-only, synthetic reporting-cutoff QA. No tenant/API services.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const assets={'/':['text/html',read('tests/fixtures/kpi-period-cutoff.html')]};
for(const f of ['kpi-module-upgrade.js','kpi-module-upgrade.css'])assets['/'+f]=[f.endsWith('.css')?'text/css':'text/javascript',read(f)];
http.createServer((req,res)=>{const asset=assets[req.url];if(req.method!=='GET'||!asset){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':asset[0]+'; charset=utf-8','Cache-Control':'no-store'});res.end(asset[1]);}).listen(0,'127.0.0.1',function(){console.log(JSON.stringify({url:'http://127.0.0.1:'+this.address().port,pid:process.pid}));});
