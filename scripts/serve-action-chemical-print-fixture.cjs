// Loopback-only browser QA with production list, record and report scripts.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
function fixture(){
  const index=read('index.html'),core=read('auris-core.js');
  function slice(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a);if(a<0||b<0)throw Error('Fixture source boundary missing: '+start);return text.slice(a,b);}
  const styles=[...index.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(match=>match[0]);
  const actionPage=slice(index,'<div id="page-actions"','<!-- -- DETAIL / FORM VIEW -- -->')+'</div>';
  const chemicalPage=slice(index,'<div id="page-chemical"','<div id="page-legal"');
  const actual=[slice(core,'const MAP_STATUS_CFG=','// -- Entry'),slice(core,'function chemRenderMetrics(){','function chemClearAIReview(){'),slice(core,"const CHEM_EXPOSURE_BACKUP_PREFIX=",'async function loadChemical(')].join('\n');
  return read('tests/fixtures/action-chemical-print-reports.html').replace('<!-- APP_STYLES -->',styles.join('\n')).replace('<!-- ACTION_PAGE -->',actionPage).replace('<!-- CHEMICAL_PAGE -->',chemicalPage).replace('/* ACTUAL_RENDERERS */',actual);
}
http.createServer((request,response)=>{
  response.setHeader('Cache-Control','no-store');if(request.method!=='GET'){response.writeHead(405).end();return;}
  const url=new URL(request.url,'http://127.0.0.1');
  if(url.pathname==='/'){try{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(fixture());}catch(error){response.writeHead(500,{'Content-Type':'text/plain'}).end(error.message);}return;}
  if(url.pathname==='/fixture-company-logo.svg'){response.setHeader('Content-Type','image/svg+xml');response.end('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect x="5" y="5" width="170" height="110" rx="15" fill="#086e52"/><text x="90" y="58" text-anchor="middle" font-family="Arial" font-size="38" font-weight="bold" fill="white">SE</text><text x="90" y="85" text-anchor="middle" font-family="Arial" font-size="11" fill="white">SYNTHETIC ENGINEERING</text></svg>');return;}
  const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)||!(/\.(js|css|png)$/.test(file))||!fs.existsSync(file)){response.writeHead(404).end();return;}
  response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'image/png');response.end(fs.readFileSync(file));
}).listen(30872,'127.0.0.1',()=>console.log('Synthetic Actions / Chemical prints: http://127.0.0.1:30872/'));
