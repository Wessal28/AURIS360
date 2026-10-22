// Loopback-only visual QA using real module markup, list workspaces and reports.
// All business data is fictional and all business writes are rejected.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
function fixture(){
 const index=read('index.html');
 function slice(start,end){const a=index.indexOf(start),b=index.indexOf(end,a);if(a<0||b<0)throw Error('Fixture page boundary missing: '+start);return index.slice(a,b);}
 const styles=[...index.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(m=>m[0]);
 const tools=slice('<div id="page-tools"','</div><!-- end page-tools -->')+'</div><!-- end page-tools -->';
 const fleet=slice('<div id="page-fleet"','<div id="page-atex"');
 const moduleBar=slice('<div class="auris-module-bar"','<!-- ------------------------------------------------------ -->');
 return read('tests/fixtures/tools-fleet-print-reports.html').replace('<!-- APP_STYLES -->',styles.join('\n')).replace('<!-- MODULE_BAR -->',moduleBar).replace('<!-- TOOLS_PAGE -->',tools).replace('<!-- FLEET_PAGE -->',fleet);
}
http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');if(req.method!=='GET'){res.writeHead(405).end();return;}
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/'){try{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture());}catch(error){res.writeHead(500,{'Content-Type':'text/plain'}).end(error.message);}return;}
 if(url.pathname==='/fixture-company-logo.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect x="5" y="5" width="170" height="110" rx="15" fill="#086e52"/><text x="90" y="58" text-anchor="middle" font-family="Arial" font-size="38" font-weight="bold" fill="white">SE</text><text x="90" y="85" text-anchor="middle" font-family="Arial" font-size="11" fill="white">SYNTHETIC ENGINEERING</text></svg>');return;}
 const file=path.resolve(root,'.'+url.pathname),artifact=url.pathname.startsWith('/outputs/')&&file.endsWith('.html');if(!file.startsWith(root+path.sep)||!(/\.(js|css|png)$/.test(file)||artifact)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html; charset=utf-8':'image/png');res.end(fs.readFileSync(file));
}).listen(30874,'127.0.0.1',()=>console.log('Synthetic Tools / Fleet prints: http://127.0.0.1:30874/'));
