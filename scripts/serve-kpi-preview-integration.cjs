// Combined preview QA: allowlisted loopback resources, actual page and stylesheet order.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),html=read('index.html');
const start=html.indexOf('<div id="page-kpi"'),end=html.indexOf('<div id="page-workschedule"',start);
if(start<0||end<0)throw new Error('KPI markup not found');
const styles=new Map();
for(const tag of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)){
 const href=tag[0].match(/href="([^"]+)"/)?.[1],file=href?.split('?')[0];
 if(file&&!file.includes('://')&&file.endsWith('.css'))styles.set('/'+file.replace(/^\//,''),tag[0]);
}
const scripts=new Set(['kpi-configuration.js','kpi-module-upgrade.js','auris-module-event-handlers-batch-1.js','auris-module-event-handlers-batch-3.js']);
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 if(req.method!=='GET'){res.writeHead(405);res.end();return;}
 let content,type;
 if(pathname==='/'||pathname==='/reporting'||pathname==='/csv-safety'){type='text/html';content=read('tests/fixtures/kpi-preview-integration.html').replace('<!-- APP_STYLES -->',[...styles.values()].join('\n')).replace('<!-- KPI_PAGE -->',html.slice(start,end));if(pathname!=='/')content=content.replace('</body>','<script src="/fixture-reporting.js"></script>'+(pathname==='/csv-safety'?'<script src="/fixture-csv-safety.js"></script>':'')+'</body>');}
 else if(styles.has(pathname)){type='text/css';content=read(pathname.slice(1));}
 else if(pathname==='/fixture-configuration.js'){type='text/javascript';content=read('tests/fixtures/kpi-preview-configuration.js');}
 else if(pathname==='/fixture-reporting.js'){type='text/javascript';content=read('tests/fixtures/kpi-reporting-preview.js');}
 else if(pathname==='/fixture-csv-safety.js'){type='text/javascript';content=read('tests/fixtures/kpi-csv-safety-preview.js');}
 else if(scripts.has(pathname.slice(1))){type='text/javascript';content=read(pathname.slice(1));}
 else{res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});res.end(content);
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+server.address().port,pid:process.pid,styles:styles.size})));
