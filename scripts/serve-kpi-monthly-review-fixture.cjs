const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),assets={
 '/':['text/html','tests/fixtures/kpi-monthly-review.html'],
 '/fixture-review.js':['text/javascript','tests/fixtures/kpi-monthly-review-fixture.js'],
 '/kpi-monthly-review.js':['text/javascript','kpi-monthly-review.js'],
 '/kpi-monthly-review.css':['text/css','kpi-monthly-review.css'],
 '/kpi-module-upgrade.css':['text/css','kpi-module-upgrade.css']
};
const server=http.createServer((req,res)=>{const asset=assets[req.url];if(req.method!=='GET'||!asset){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':asset[0]+'; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'none'"});res.end(fs.readFileSync(path.join(root,asset[1])));});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+server.address().port,pid:process.pid})));
