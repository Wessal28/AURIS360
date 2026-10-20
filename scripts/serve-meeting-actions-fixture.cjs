// Loopback-only verification of real Meetings markup and minutes reader.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
http.createServer((request,response)=>{
  response.setHeader('Cache-Control','no-store');if(request.method!=='GET'){response.writeHead(405).end();return;}
  const url=new URL(request.url,'http://127.0.0.1');
  if(url.pathname==='/'){
    const index=read('index.html'),start=index.indexOf('<div id="page-meetings"'),end=index.indexOf('<div id="page-training"',start),core=read('auris-core.js'),a=core.indexOf('async function mtgViewMomReadOnly(id){'),b=core.indexOf('async function mtgOpenMom(id){',a);
    const styles=[...index.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(match=>match[0]);
    response.setHeader('Content-Type','text/html; charset=utf-8');response.end(read('tests/fixtures/meeting-action-links.html').replace('<!-- APP_STYLES -->',styles.join('\n')).replace('<!-- MEETING_PAGE -->',index.slice(start,end)).replace('/* MINUTES_READER */',core.slice(a,b)));return;
  }
  const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)||!(/\.(js|css|png)$/.test(file))||!fs.existsSync(file)){response.writeHead(404).end();return;}
  response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'image/png');response.end(fs.readFileSync(file));
}).listen(30870,'127.0.0.1',()=>console.log('Synthetic Meetings: http://127.0.0.1:30870/'));
