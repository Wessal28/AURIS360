// Local-only synthetic acceptance fixture. No credentials, tenant data or remote API.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),core=fs.readFileSync(path.join(root,'auris-core.js'),'utf8');
const between=(a,b)=>core.slice(core.indexOf(a),core.indexOf(b,core.indexOf(a)));
const styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"?]+)[^"]*"/g)].map(m=>m[1]).filter(s=>!s.includes(':'));
const allow=new Set(styles);
for(const file of styles){for(const m of fs.readFileSync(path.join(root,file),'utf8').matchAll(/url\(["']?([^"')]+)["']?\)/g)){if(!/^(data:|https?:)/.test(m[1]))allow.add(path.posix.normalize(path.posix.join(path.posix.dirname(file),m[1].split('?')[0])));}}
const form=html.slice(html.indexOf('<div id="ps-form3view"'),html.indexOf('<!-- -- FINDINGS TAB -- -->'));
const script=`
var auditAllData=[],prof={id:'fixture-actor',company_id:'fixture-company',full_name:'Test Supervisor'},saved=null;
function ccid(){return 'fixture-company';} function isMgr(){return true;} function workflowCanMutate(){return true;}
function fillPersonSelect(id,value){var el=document.getElementById(id);el.innerHTML='<option>'+escH(value||'Test Supervisor')+'</option>';}
function fillRiskAssessmentSelect(id){document.getElementById(id).innerHTML='<option value="">No linked assessment</option>';}
function escH(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function toast(text){document.getElementById('qa-status').textContent=text;}
function actionErrorMessage(a,b,c){return c;}
async function api(url,opts){
  if(url.startsWith('/audit_findings')){if(document.getElementById('qa-fail').checked)throw Error('Fixture unavailable');return [{company_id:ccid(),inspection_id:'fixture-site',finding_ref:'F001',description:'Inspect guard before restart',evidence:'Inspection note',status:'open'}];}
  if(document.getElementById('qa-fail').checked)throw Error('Synthetic save failure. Your entries remain here.');
  saved=Object.assign({id:'fixture-saved'},opts.b);document.getElementById('qa-payload').textContent=JSON.stringify(saved,null,2);return [saved];
}
${between('function auditOpenReadOnly(', '// -- CONTRACTOR FORM')}
${between('// Pre-start checklist helpers', 'async function psDelete()')}
${between('function psDecisionChange()', '// -- Misc backward compat')}
function psShowList(){document.getElementById('qa-status').textContent='Saved synthetic record confirmed. Use Reopen saved to check it.';}
document.getElementById('qa-new').onclick=()=>psNew();
document.getElementById('qa-reopen').onclick=()=>{if(saved)psOpenData(saved);};
document.querySelector('[data-auris-onclick="h0306"]').onclick=()=>psSave();
document.querySelector('[data-auris-onclick="h0304"]').onclick=()=>toast('Back (fixture only)');
document.getElementById('qa-report').onclick=()=>{
  auditAllData=[{id:'fixture-site',company_id:ccid(),site:'Synthetic site inspection',inspection_type:'workplace',reference_no:'QA-001',score_good:20,score_insuf:1,
  items:Array.from({length:21},(_,i)=>({category:i<10?'Equipment':'Work area',item:'Site checklist '+(i+1),result:i===4?'insufficient':'good',observation:i===4?'Repair guard before restart.\\nSupervisor to confirm.':'Checked on site'})),
  positive_obs:'Good housekeeping',negative_obs:'Guard damaged',action_items:[{description:'Replace guard',responsible:'Test Supervisor',target_date:'2026-09-10'}],sign_inspector:'Test Inspector',sign_reviewer:'Test Reviewer',photos:[{url:'https://example.com/evidence',file_name:'Evidence reference'}]}];auditOpenReadOnly('fixture-site');
};
psNew();document.getElementById('qa-ready').textContent='Fixture ready';
`;
const page='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'+styles.map(s=>'<link rel="stylesheet" href="/'+s+'">').join('')+'<style>body{display:block;padding:12px;overflow:auto}#page-inspection{display:block;max-width:1200px;margin:auto}#qa-controls{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}#qa-payload{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere}#qa-controls button{min-height:44px}</style></head><body><div id="qa-controls"><button id="qa-new">New pre-start</button><button id="qa-reopen">Reopen saved</button><button id="qa-report">Open site report</button><label><input type="checkbox" id="qa-fail"> Simulate server error</label><span id="qa-ready">Loading</span></div><p id="qa-status" role="status"></p><div hidden><table><tbody id="if-checklist"><tr><td>Unchanged audit draft</td></tr></tbody></table></div><div id="ps-list-view" hidden></div><div id="page-inspection">'+form+'</div><h2>Saved synthetic payload</h2><pre id="qa-payload"></pre><script src="/qa.js"></script></body></html>';
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),file=url.pathname.slice(1);
  res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(page);}
  if(url.pathname==='/qa.js'){res.setHeader('Content-Type','text/javascript');return res.end(script);}
  if(allow.has(file)){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');return res.end(fs.readFileSync(path.join(root,file)));}
  res.writeHead(404);res.end('Not found');
});
server.listen(8766,'127.0.0.1',()=>console.log('Synthetic inspection QA: http://127.0.0.1:8766; PID '+process.pid));
