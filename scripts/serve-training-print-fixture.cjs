// Loopback-only QA: real Training markup, styles and renderers with synthetic data.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
function fixture(){
  const index=read('index.html'),start=index.indexOf('<div id="page-training"'),marker='</div><!-- end page-training -->',end=index.indexOf(marker,start);
  if(start<0||end<0)throw Error('Training page boundaries were not found.');
  const styles=[...index.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(match=>match[0]).filter(tag=>!tag.includes('https:'));
  const iconStyle=[...index.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(match=>match[0]).find(tag=>tag.includes('@tabler/icons-webfont'))||'';
  const core=read('auris-core.js');
  function renderer(name,next){const a=core.indexOf(name),b=core.indexOf(next,a);if(a<0||b<0)throw Error('Training renderer was not found: '+name);return core.slice(a,b);}
  const renderers=[renderer('async function cmLoad(){','async function cmEditCell('),renderer('function tfRender(data){','function tfShowForm(){'),renderer('function authRender(data){','async function authUploadCertificate(')].join('\n');
  return read('tests/fixtures/training-print-reports.html').replace('<!-- APP_STYLES -->',iconStyle+'\n'+styles.join('\n')).replace('<!-- TRAINING_PAGE -->',index.slice(start,end+marker.length)).replace('/* TRAINING_RENDERERS */',renderers);
}
http.createServer((request,response)=>{
  response.setHeader('Cache-Control','no-store');
  if(request.method!=='GET'){response.writeHead(405).end();return;}
  const url=new URL(request.url,'http://127.0.0.1');
  if(url.pathname==='/'){
    try{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(fixture());}catch(error){response.writeHead(500,{'Content-Type':'text/plain'}).end(error.message);}
    return;
  }
  const file=path.resolve(root,'.'+url.pathname);
  if(!file.startsWith(root+path.sep)||!(/\.(js|css|png)$/.test(file))||!fs.existsSync(file)){response.writeHead(404).end();return;}
  response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'image/png');
  response.end(fs.readFileSync(file));
}).listen(30869,'127.0.0.1',()=>console.log('Synthetic Training prints: http://127.0.0.1:30869/'));
