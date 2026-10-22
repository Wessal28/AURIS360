// Loopback visual QA only. No credentials, real company data or business writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..');
http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');if(req.method!=='GET'){res.writeHead(405).end();return;}
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/fixture-company-logo.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect x="5" y="5" width="170" height="110" rx="15" fill="#086e52"/><text x="90" y="60" text-anchor="middle" font-family="Arial" font-size="38" fill="white">SE</text><text x="90" y="86" text-anchor="middle" font-family="Arial" font-size="11" fill="white">SYNTHETIC ENGINEERING</text></svg>');return;}
 const file=url.pathname==='/'?path.join(root,'tests/fixtures/remaining-module-print.html'):path.resolve(root,'.'+url.pathname);
 if(!file.startsWith(root+path.sep)||!(/\.(js|css|png|woff2?|html)$/.test(file))||!fs.existsSync(file)){res.writeHead(404).end();return;}
 const ext=path.extname(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.png':'image/png','.html':'text/html; charset=utf-8','.woff2':'font/woff2','.woff':'font/woff'})[ext]);res.end(fs.readFileSync(file));
}).listen(30876,'127.0.0.1',()=>console.log('Fictional company print verification: http://127.0.0.1:30876/'));
