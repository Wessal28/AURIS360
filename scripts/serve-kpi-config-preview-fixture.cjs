// Allowlisted, loopback-only synthetic QA. No real APIs or customer data.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),files={
  '/':'tests/fixtures/kpi-configuration-persistence.html',
  '/kpi-configuration.js':'kpi-configuration.js',
  '/kpi-module-upgrade.js':'kpi-module-upgrade.js',
  '/kpi-module-upgrade.css':'kpi-module-upgrade.css'
};
const server=http.createServer((req,res)=>{
  const file=files[new URL(req.url,'http://127.0.0.1').pathname];
  if(req.method!=='GET'||!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript','Cache-Control':'no-store'});
  res.end(fs.readFileSync(path.join(root,file)));
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+server.address().port,pid:process.pid})));
