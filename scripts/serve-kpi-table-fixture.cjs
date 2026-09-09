// Synthetic loopback-only module QA using the application's stylesheet order.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const index=read('index.html'),start=index.indexOf('<div id="page-kpi"'),end=index.indexOf('<div id="page-workschedule"',start);
if(start<0||end<0)throw new Error('KPI page boundaries not found');
const css=new Map();
for(const match of index.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)){
 const href=match[0].match(/href="([^"]+)"/)?.[1],file=href?.split('?')[0];
 if(file&&!file.includes('://')&&file.endsWith('.css'))css.set('/'+file.replace(/^\//,''),match[0]);
}
const scripts=['kpi-module-upgrade.js','auris-module-event-handlers-batch-3.js'];
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 if(req.method!=='GET'){res.writeHead(405);res.end();return;}
 let content,type;
 if(pathname==='/'){type='text/html';content=read('tests/fixtures/kpi-monthly-table.html').replace('<!-- APP_STYLES -->',[...css.values()].join('\n')).replace('<!-- KPI_PAGE -->',index.slice(start,end));}
 else if(css.has(pathname)){type='text/css';content=read(pathname.slice(1));}
 else if(scripts.includes(pathname.slice(1))){type='text/javascript';content=read(pathname.slice(1));}
 else {res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});res.end(content);
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+server.address().port,pid:process.pid,stylesheets:css.size})));
