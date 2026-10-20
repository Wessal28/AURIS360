// Loopback-only QA of real page markup, layout builders and print options.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const index=read('index.html'),start=index.indexOf('<div id="page-kpi"'),end=index.indexOf('<div id="page-workschedule"',start);
const styles=[...index.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(m=>m[0]).filter(tag=>!tag.includes('https:'));
http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 const url=new URL(req.url,'http://127.0.0.1');if(req.method!=='GET'){res.writeHead(405).end();return;}
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(read('tests/fixtures/kpi-print-reports.html').replace('<!-- APP_STYLES -->',styles.join('\n')).replace('<!-- KPI_PAGE -->',index.slice(start,end)));return;}
 const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)||!(/\.(js|css|png)$/.test(file))||!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'image/png');res.end(fs.readFileSync(file));
}).listen(30868,'127.0.0.1',()=>console.log('Synthetic KPI prints: http://127.0.0.1:30868/'));
