













const SB='https://iarfxjhahzbhncsaohbg.supabase.co';
const KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhcmZ4amhhaHpiaG5jc2FvaGJnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2OTM1MzAsImV4cCI6MjA5NDI2OTUzMH0.qSjahuX-RwnjWEDmo-LkcorAxpsmyVoaXt4AO4_A9BM';
let tok=null,prof=null,co=null,chkItems=[],people=[];
const RL={inspector:1,manager:2,admin:3,sephs_admin:4};
function rlv(){return RL[prof?.role]||0;}
function can(r){return rlv()>=RL[r];}
function isInsp(){return prof?.role==='inspector';}
function isMgr(){return can('manager');}
function isAdm(){return can('admin');}
function isSA(){return prof?.role==='sephs_admin';}
async function api(path,o={}){
const headers={'Content-Type':'application/json','apikey':KEY,'Authorization':'Bearer '+(tok||KEY),'Accept':'application/json'};
if(o.p)headers['Prefer']=o.p;
const r=await fetch(SB+'/rest/v1'+path,{method:o.m||'GET',headers:headers,body:o.b?JSON.stringify(o.b):undefined});
if(r.status===204||r.status===205)return null;
const txt=await r.text();
if(!txt||txt.trim()==='')return null;
let d;
try{d=JSON.parse(txt);}catch(e){console.error('JSON parse error:',txt.slice(0,200));throw new Error('Invalid server response');}
if(!r.ok){const msg=(Array.isArray(d)?d[0]?.message:d.message)||d.error_description||d.hint||r.statusText;console.error('API error '+r.status+':',msg,path);throw new Error(msg);}
return d;
}
async function authQ(path,body){
const r=await fetch(SB+'/auth/v1'+path,{method:'POST',headers:{'Content-Type':'application/json','apikey':KEY},body:JSON.stringify(body)});
const d=await r.json();if(!r.ok)throw new Error(d.error_description||d.msg||'Auth error');return d;
}
function cf(){return isSA()?'':(prof?.company_id?'&company_id=eq.'+prof.company_id:'&company_id=is.null');}
function toast(m,ok=true){const t=document.getElementById('toast');if(!t){console.log('Toast:',m);return;}t.textContent=m;t.className='toast '+(ok?'toast-ok':'toast-err');t.style.display='block';setTimeout(()=>t.style.display='none',3500);}
function fmt(d){return d?new Date(d).toLocaleDateString('en-GB'):'--';}
function sev(s){const m={low:'bb',medium:'ba',high:'br',critical:'br'};return '<span class="badge '+(m[s]||'bb')+'">'+( s||'--')+'</span>';}
function stat(s){const c={open:'ba',in_progress:'ba',closed:'bg',on_track:'bg',at_risk:'ba',off_track:'br',completed:'bb',approved:'bg',active:'bg',draft:'bgr',pending_approval:'ba',cancelled:'br',review:'ba',current:'bg',superseded:'br',valid:'bg',expired:'br',pending:'ba',active:'bg',inactive:'bgr',suspended:'br'};return '<span class="badge '+(c[s]||'bgr')+'">'+( s||'').replace(/_/g,' ')+'</span>';}
function prio(p){const c={critical:'br',high:'ba',medium:'bb',low:'bg'};return '<span class="badge '+(c[p]||'bgr')+'">'+(p||'--')+'</span>';}
function denied(){return '<div class="access-denied"><i class="ti ti-lock"></i><h3>Access restricted</h3><p>Your role does not have permission to view this section.</p></div>';}
function pname(id){const p=people.find(x=>x.id===id);return p?p.first_name+' '+p.last_name:'--';}
async function doLogin(){
const em=document.getElementById('login-email').value.trim(),pw=document.getElementById('login-pw').value;
const err=document.getElementById('login-err'),btn=document.getElementById('login-btn');
err.style.display='none';btn.innerHTML='<i class="ti ti-loader-2"></i>Signing in...';btn.disabled=true;
try{
const d=await authQ('/token?grant_type=password',{email:em,password:pw});
tok=d.access_token;await loadProf(d.user.id);
document.getElementById('login-screen').style.display='none';
document.getElementById('app').style.display='block';
document.getElementById('ai-panel').style.display='block';
// Ensure dashboard is visible with inline style
document.getElementById('page-dashboard').style.display='block';
applyRoles();await loadPeopleCache();loadDash();
setTimeout(()=>genDashAI(),3000);

}catch(e){err.textContent=e.message;err.style.display='block';}
btn.innerHTML='<i class="ti ti-login"></i>Sign In';btn.disabled=false;
}
async function doRegister(){
const em=document.getElementById('login-email').value.trim(),pw=document.getElementById('login-pw').value;
const name=document.getElementById('reg-name').value.trim(),role=document.getElementById('reg-role').value,cid=document.getElementById('reg-company').value;
const err=document.getElementById('login-err');err.style.display='none';
if(!em||!pw||!name){err.textContent='Please fill email, password and name.';err.style.display='block';return;}
try{
const d=await authQ('/signup',{email:em,password:pw});tok=d.access_token;
await api('/profiles',{m:'POST',p:'return=minimal',b:{id:d.user.id,full_name:name,role,email:em,company_id:cid||null}});
await loadProf(d.user.id);
document.getElementById('login-screen').style.display='none';
document.getElementById('app').style.display='block';
document.getElementById('ai-panel').style.display='block';
// Ensure dashboard is visible with inline style
document.getElementById('page-dashboard').style.display='block';
applyRoles();await loadPeopleCache();loadDash();
}catch(e){err.textContent=e.message;err.style.display='block';}
}
async function loadProf(uid){
try{
const d=await api('/profiles?id=eq.'+uid+'&select=*,companies(*)');
if(d&&d[0]){
prof=d[0];co=d[0].companies;
document.getElementById('sb-company').textContent=co?.name||'AURIS360';
document.getElementById('sb-user').textContent=prof.full_name||prof.email||'--';
document.getElementById('sb-role').textContent=(prof.role||'user').replace(/_/g,' ');
document.getElementById('dash-label').textContent=co?.name||'';
if(co?.logo_url){document.getElementById('co-logo-img').src=co.logo_url;document.getElementById('co-logo-img').style.display='block';document.getElementById('co-initials-div').style.display='none';}
else{document.getElementById('co-initials-div').textContent=(co?.name||'A').charAt(0).toUpperCase();}
}
}catch(e){console.error(e);}
}
function doLogout(){tok=null;prof=null;co=null;people=[];document.getElementById('login-screen').style.display='flex';document.getElementById('app').style.display='none';document.getElementById('ai-panel').style.display='none';}
function applyRoles(){
if(isInsp()){
['nav-ai','nav-inv','nav-mtg','nav-docs','nav-users','nav-settings'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none';});
const b=document.getElementById('role-banner-dash');
if(b)b.innerHTML='<div class="role-banner"><i class="ti ti-info-circle"></i>You are logged in as <strong>Inspector</strong>. You can submit events, inspections and noise surveys.</div>';
}
if(!isAdm())['nav-settings'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none';});
if(isSA())document.getElementById('nav-admin').style.display='flex';
if(isMgr()||isSA()){const u=document.getElementById('nav-users');if(u)u.style.display='flex';}
}
async function loadPeopleCache(){
try{
const d=await api('/people?select=id,first_name,last_name,job_title,person_type'+cf()+'&status=eq.active&order=last_name');
people=d||[];fillPplDrops();
}catch(e){people=[];}
}
function fillPplDrops(){
const opts='<option value="">Select person...</option>'+people.map(p=>'<option value="'+p.id+'">'+p.last_name+', '+p.first_name+(p.job_title?' -- '+p.job_title:'')+'</option>').join('');
['ef-person','ef-by','ef-assigned','if-by','rf-by','invf-by','invf-persons','pf-contractor','pf-issued','pf-approved','nf-by','mf-chair','kf-resp','af-resp','df-owner'].forEach(id=>{const el=document.getElementById(id);if(el&&!el.multiple)el.innerHTML=opts;});
const ms=document.getElementById('tf-attendees');
if(ms)ms.innerHTML=people.map(p=>'<option value="'+p.id+'">'+p.last_name+', '+p.first_name+'</option>').join('');
}
function showPage(name,el){

// Hide all pages using inline style
document.querySelectorAll('.page').forEach(p=>{
  p.style.display='none';
  p.classList.remove('active');
});
document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
['obj-modal','kpi-edit-modal','kpi-entry-modal'].forEach(id=>{
  const m=document.getElementById(id);if(m)m.style.display='none';
});
// Show target page using inline style  
const target=document.getElementById('page-'+name);
if(target){
  target.style.display='block';
  target.classList.add('active');
}
if(el&&el.classList)el.classList.add('active');
const L={dashboard:loadDash,kpi:kpiLoadAll,events:loadEvents,inspection:()=>{buildChecklist();loadInsps();},risk:loadRA,investigation:loadInvs,legal:loadLegal,sop:loadSOP,permit:loadPermits,noise:loadNoise,meetings:loadMtgs,training:loadTraining,actions:loadActions,documents:loadDocs,people:loadPeople,users:loadUsers,admin:loadAdmin,'ai-insights':genFullAI,settings:loadSettings};
if(L[name])L[name]();
}
function toggleForm(id){const el=document.getElementById(id);el.style.display=el.style.display==='none'?'block':'none';}
function toggleContractor(){document.getElementById('contractor-fields').style.display=document.getElementById('pef-type').value!=='employee'?'block':'none';}
async function loadDash(){
try{
const safe=async(p)=>{try{return await p;}catch(e){console.warn('API:',e.message);return [];}};
const[k,e,a,pe,pt,certs,insps]=await Promise.all([
safe(api('/kpis_v2?select=*'+cf())),
safe(api('/events?select=*'+cf()+'&order=event_date.desc&limit=5')),
safe(api('/action_tracker?select=*'+cf()+'&status=neq.closed')),
safe(api('/people?select=id'+cf()+'&status=eq.active')),
safe(api('/permits?select=*'+cf()+'&status=eq.active')),
safe(api('/people_certifications?select=*'+cf())),
safe(api('/inspections?select=*'+cf()+'&order=inspection_date.desc&limit=5')),
]);
const soon=new Date();soon.setDate(soon.getDate()+30);
const ec=(certs||[]).filter(x=>x.expiry_date&&new Date(x.expiry_date)<soon);
const setEl=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
setEl('d-kpis',(k||[]).filter(x=>x.status==='on_track').length+'/'+(k||[]).length);
setEl('d-events',(e||[]).filter(x=>x.status==='open').length);
setEl('d-actions',(a||[]).length);
setEl('d-people',(pe||[]).length);
setEl('d-permits',(pt||[]).length);
setEl('d-certs',ec.length);
const de=document.getElementById('dash-events');
if(de)de.innerHTML=!(e||[]).length?'<div class="empty">No events yet</div>':'<table><thead><tr><th>Date</th><th>Type</th><th>Severity</th><th>Status</th></tr></thead><tbody>'+(e||[]).map(x=>'<tr><td>'+fmt(x.event_date||x.created_at)+'</td><td>'+(x.event_type||'--')+'</td><td>'+sev(x.severity)+'</td><td>'+stat(x.status)+'</td></tr>').join('')+'</tbody></table>';
const top5=(a||[]).sort((x,y)=>{const po={critical:4,high:3,medium:2,low:1};return(po[y.priority]||0)-(po[x.priority]||0);}).slice(0,5);
const da=document.getElementById('dash-actions');
if(da)da.innerHTML=!top5.length?'<div class="empty">No open actions</div>':'<table><thead><tr><th>Action</th><th>Responsible</th><th>Due</th><th>Priority</th></tr></thead><tbody>'+top5.map(x=>'<tr><td>'+x.description+'</td><td>'+(x.responsible||'--')+'</td><td>'+fmt(x.target_date)+'</td><td>'+prio(x.priority)+'</td></tr>').join('')+'</tbody></table>';
const di=document.getElementById('dash-inspections-tbl');
if(di)di.innerHTML=!(insps||[]).length?'<div class="empty">No inspections yet</div>':'<table><thead><tr><th>Date</th><th>Site</th><th>Good</th><th>Insuf.</th></tr></thead><tbody>'+(insps||[]).map(x=>'<tr><td>'+fmt(x.inspection_date)+'</td><td>'+(x.site||'--')+'</td><td><span class="badge bg">'+x.score_good+'</span></td><td><span class="badge '+(x.score_insuf>3?'br':'ba')+'">'+x.score_insuf+'</span></td></tr>').join('')+'</tbody></table>';
const dc=document.getElementById('dash-certs');
if(dc)dc.innerHTML=!ec.length?'<div class="empty">No certifications expiring soon</div>':'<table><thead><tr><th>Certification</th><th>Expiry</th><th>Status</th></tr></thead><tbody>'+ec.slice(0,5).map(x=>'<tr><td>'+x.certification+'</td><td>'+fmt(x.expiry_date)+'</td><td>'+stat(x.status)+'</td></tr>').join('')+'</tbody></table>';
}catch(e){console.error('Dashboard error:',e);}
}

let aiOpen=false,aiHist=[];
function toggleAI(){aiOpen=!aiOpen;document.getElementById('ai-window').className='ai-window'+(aiOpen?' open':'');}
const SYS='You are AURIS, an expert HSE AI assistant for AURIS360 by SEPHS Consulting (Mauritius). Analyse real HSE data and give specific, actionable recommendations. Be concise and professional.';
async function getCtx(){
try{
const[k,e,i,a,pe,certs]=await Promise.all([api('/kpis?select=*'+cf()),api('/events?select=*'+cf()+'&limit=20'),api('/inspections?select=*'+cf()+'&limit=10'),api('/action_tracker?select=*'+cf()),api('/people?select=*'+cf()),api('/people_certifications?select=*'+cf())]);
const soon=new Date();soon.setDate(soon.getDate()+30);
return `Company: ${co?.name||'Unknown'} | Industry: ${co?.industry||'Unknown'}
KPIs: ${(k||[]).length} total, ${(k||[]).filter(x=>x.status==='on_track').length} on track, ${(k||[]).filter(x=>x.status==='at_risk').length} at risk
Events: ${(e||[]).length} total, ${(e||[]).filter(x=>x.severity==='high'||x.severity==='critical').length} high/critical
Inspections: ${(i||[]).length}, avg good: ${i?.length?Math.round((i||[]).reduce((s,x)=>s+x.score_good,0)/(i||[]).length):0}/24
Actions: ${(a||[]).length} total, ${(a||[]).filter(x=>x.status==='open').length} open, ${(a||[]).filter(x=>x.priority==='critical').length} critical
People: ${(pe||[]).length} active (${(pe||[]).filter(x=>x.person_type==='employee').length} employees, ${(pe||[]).filter(x=>x.person_type==='contractor').length} contractors)
Expiring certs (30d): ${(certs||[]).filter(x=>x.expiry_date&&new Date(x.expiry_date)<soon).length}`;
}catch(e){return 'Unable to load data.';}
}
async function callAI(msgs){
return 'AI features require configuration. Please contact your system administrator.';
}
async function sendAI(){
const inp=document.getElementById('ai-input');const msg=inp.value.trim();if(!msg)return;
inp.value='';addMsg(msg,'user');const th=addMsg('Analysing your HSE data...','assistant');
try{
const ctx=await getCtx();
aiHist.push({role:'user',content:'HSE Data:\n'+ctx+'\n\nQuestion: '+msg});
const rep=await callAI(aiHist);aiHist.push({role:'assistant',content:rep});th.textContent=rep;
}catch(e){th.textContent='Error: '+e.message;}
}
async function askAI(q){if(!aiOpen)toggleAI();document.getElementById('ai-input').value=q;sendAI();}
function addMsg(text,cls){const m=document.getElementById('ai-messages');const d=document.createElement('div');d.className='ai-msg '+cls;d.textContent=text;m.appendChild(d);m.scrollTop=m.scrollHeight;return d;}
async function genDashAI(){
const el=document.getElementById('ai-dash-insights');if(!el)return;
try{
const ctx=await getCtx();
const rep=await callAI([{role:'user',content:'HSE Data:\n'+ctx+'\n\nProvide exactly 3 brief dashboard insights (1-2 sentences). JSON array: [{"type":"info|warn|danger","title":"...","body":"..."}]'}]);
const ins=JSON.parse(rep.replace(/```json|```/g,'').trim());
el.innerHTML=ins.map(i=>'<div class="insight-card '+(i.type==='warn'?'warn':i.type==='danger'?'danger':'')+'"><div class="insight-title">'+i.title+'</div><div class="insight-body">'+i.body+'</div></div>').join('');
}catch(e){el.innerHTML='';}
}
async function genFullAI(){
document.getElementById('ai-insights-content').innerHTML='<div class="loading-msg">Generating analysis...</div>';
document.getElementById('ai-insights-date').textContent='Updated: '+new Date().toLocaleString('en-GB');
try{
const ctx=await getCtx();
const[main,kpir,hot]=await Promise.all([
callAI([{role:'user',content:'HSE Data:\n'+ctx+'\n\nComprehensive HSE performance analysis with trends, top concerns, and recommendations.'}]),
callAI([{role:'user',content:'HSE Data:\n'+ctx+'\n\nKPI analysis with specific improvement recommendations for each status.'}]),
callAI([{role:'user',content:'HSE Data:\n'+ctx+'\n\nTop risk hotspots ranked by severity with mitigation steps.'}]),
]);
document.getElementById('ai-insights-content').innerHTML='<div style="white-space:pre-wrap;font-size:13px;line-height:1.7">'+main+'</div>';
document.getElementById('ai-kpi-recs').innerHTML='<div style="white-space:pre-wrap;font-size:12px;line-height:1.7">'+kpir+'</div>';
document.getElementById('ai-risk-hotspots').innerHTML='<div style="white-space:pre-wrap;font-size:12px;line-height:1.7">'+hot+'</div>';
}catch(e){document.getElementById('ai-insights-content').innerHTML='<div class="empty" style="color:var(--red)">'+e.message+'</div>';}
}


async function loadEvents(){
const el=document.getElementById('events-list');
if(!el)return;
el.innerHTML='<div class="loading-msg">Loading events...</div>';
try{
let path='/events?select=*'+cf()+'&order=event_date.desc';
const ft=document.getElementById('ev-filter-type')?.value;
const fs=document.getElementById('ev-filter-severity')?.value;
const fst=document.getElementById('ev-filter-status')?.value;
const fm=document.getElementById('ev-filter-month')?.value;
if(ft)path+='&event_type=eq.'+encodeURIComponent(ft);
if(fs)path+='&severity=eq.'+fs;
if(fst)path+='&status=eq.'+fst;
if(fm){const pts=fm.split('-');const y=pts[0];const m=pts[1];path+='&event_date=gte.'+y+'-'+m+'-01&event_date=lt.'+y+'-'+String(parseInt(m)+1).padStart(2,'0')+'-01';}
const d=await api(path);
evAllData=d||[];
evUpdateMetrics(evAllData);
const cntEl=document.getElementById('ev-count');
if(cntEl)cntEl.textContent=evAllData.length+' event'+(evAllData.length!==1?'s':'');
if(!evAllData.length){el.innerHTML='<div class="empty" style="padding:50px">No events found — click Report event to log one.</div>';return;}
const byMonth={};
evAllData.forEach(function(e){
const dt=e.event_date?new Date(e.event_date):new Date(e.created_at);
const key=dt.toLocaleString('en-GB',{month:'long',year:'numeric'});
if(!byMonth[key])byMonth[key]=[];
byMonth[key].push(e);
});
el.innerHTML='';
Object.entries(byMonth).forEach(function(entry){
const month=entry[0];const events=entry[1];
const hdr=document.createElement('div');
hdr.style.cssText='padding:10px 20px 4px;background:#f9fafb;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.05em';
hdr.textContent=month;el.appendChild(hdr);
events.forEach(function(e){
const isSerious=e.severity==='high'||e.severity==='critical';
const overdue=e.action_due_date&&new Date(e.action_due_date)<new Date()&&e.status!=='closed';
const row=document.createElement('div');
row.style.cssText='padding:16px 20px;border-bottom:1px solid var(--border);cursor:pointer'+(isSerious&&e.status!=='closed'?';border-left:3px solid var(--red)':'');
row.onmouseover=function(){this.style.background='#f9fafb';};
row.onmouseout=function(){this.style.background='';};
row.onclick=function(){evOpenDetail(e.id);};
row.innerHTML='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">'
+'<div style="flex:1;min-width:0">'
+'<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">'
+(e.event_ref?'<span style="font-size:11px;font-weight:700;color:var(--text3)">'+e.event_ref+'</span>':'')
+evTypeBadge(e.event_type)
+evSevBadge(e.severity)
+evStatBadge(e.status)
+(overdue?'<span style="font-size:10px;font-weight:700;color:var(--red);background:#FEF2F2;padding:2px 7px;border-radius:99px">OVERDUE</span>':'')
+'</div>'
+'<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">'+(e.description?e.description.slice(0,120)+(e.description.length>120?'...':''):'No description')+'</div>'
+'<div style="display:flex;gap:16px;flex-wrap:wrap">'
+'<span style="font-size:12px;color:var(--text2)">'+( e.location||'—')+'</span>'
+'<span style="font-size:12px;color:var(--text2)">'+evFmt(e.event_date)+'</span>'
+(e.person_involved?'<span style="font-size:12px;color:var(--text2)">'+e.person_involved+'</span>':'')
+(e.assigned_to?'<span style="font-size:12px;color:var(--text2)">Assigned: '+e.assigned_to+'</span>':'')
+'</div></div>'
+'<div style="flex-shrink:0;text-align:right">'
+(e.action_due_date?'<div style="font-size:11px;color:'+(overdue?'var(--red)':'var(--text3)')+'">Due '+evFmtDate(e.action_due_date)+'</div>':'')
+'<div style="font-size:11px;color:var(--text3);margin-top:4px">By '+(e.reported_by||'—')+'</div>'
+'</div></div>';
el.appendChild(row);
});
});
}catch(e){el.innerHTML='<div class="empty" style="color:var(--red)">'+e.message+'</div>';}
}
let evEditingId=null,evAllData=[];
function evTypeBadge(t){const colors={'Near Miss':{bg:'#FAEEDA',c:'#854F0B'},'Incident':{bg:'#FCEBEB',c:'#A32D2D'},'Hazard Observation':{bg:'#E6F1FB',c:'#185FA5'},'Dangerous Occurrence':{bg:'#F3E8FF',c:'#6B21A8'},'Environmental':{bg:'#EAF3DE',c:'#3B6D11'}};const co=colors[t]||{bg:'#f3f4f6',c:'#374151'};return '<span style="display:inline-flex;align-items:center;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:600;background:'+co.bg+';color:'+co.c+'">'+( t||'—')+'</span>';}
function evSevBadge(s){const colors={low:{bg:'#E6F1FB',c:'#185FA5'},medium:{bg:'#FAEEDA',c:'#854F0B'},high:{bg:'#FCEBEB',c:'#A32D2D'},critical:{bg:'#4A0000',c:'#fff'}};const co=colors[s]||{bg:'#f3f4f6',c:'#374151'};return '<span style="display:inline-flex;align-items:center;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700;background:'+co.bg+';color:'+co.c+'">'+(s||'').toUpperCase()+'</span>';}
function evStatBadge(s){const m={open:{bg:'#FAEEDA',c:'#854F0B',l:'Open'},under_investigation:{bg:'#E6F1FB',c:'#185FA5',l:'Under investigation'},action_required:{bg:'#FCEBEB',c:'#A32D2D',l:'Action required'},closed:{bg:'#EAF3DE',c:'#3B6D11',l:'Closed'}};const co=m[s]||{bg:'#f3f4f6',c:'#374151',l:s||'—'};return '<span style="display:inline-flex;align-items:center;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:600;background:'+co.bg+';color:'+co.c+'">'+co.l+'</span>';}
function evFmt(d){return d?new Date(d).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';}
function evFmtDate(d){return d?new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):'—';}
function evUpdateMetrics(data){
const now=new Date();
const thisMonth=data.filter(function(e){const d=new Date(e.event_date||e.created_at);return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();});
const setEl=function(id,val){const el=document.getElementById(id);if(el)el.textContent=val;};
setEl('ev-m-total',data.length);
setEl('ev-m-open',data.filter(function(e){return e.status==='open'||e.status==='action_required';}).length);
setEl('ev-m-high',data.filter(function(e){return e.severity==='high'||e.severity==='critical';}).length);
setEl('ev-m-month',thisMonth.length);
setEl('ev-m-closed',data.filter(function(e){return e.status==='closed';}).length);
}
function evClearFilters(){['ev-filter-type','ev-filter-severity','ev-filter-status','ev-filter-month'].forEach(function(id){const el=document.getElementById(id);if(el)el.value='';});loadEvents();}
function evOpenModal(){document.getElementById('ev-modal').style.display='flex';}
function evCloseModal(){document.getElementById('ev-modal').style.display='none';evEditingId=null;}
function evFillPeopleDrops(){
const opts='<option value="">Select from register...</option>'+people.map(function(p){return '<option value="'+p.id+'">'+p.last_name+', '+p.first_name+(p.job_title?' — '+p.job_title:'')+'</option>';}).join('');
['ev-person','ev-reported-by','ev-assigned-to'].forEach(function(id){const el=document.getElementById(id);if(el)el.innerHTML=opts;});
}
function evOpenNew(){
evEditingId=null;
document.getElementById('ev-modal-title').textContent='Report new event';
document.getElementById('ev-modal-ref').textContent='';
document.getElementById('ev-view-mode').style.display='none';
document.getElementById('ev-edit-mode').style.display='block';
document.getElementById('ev-delete-btn').style.display='none';
document.getElementById('ev-serious-warning').style.display='none';
document.getElementById('ev-type').value='';
document.getElementById('ev-severity').value='medium';
document.getElementById('ev-date').value=new Date().toISOString().slice(0,16);
document.getElementById('ev-location').value='';
document.getElementById('ev-description').value='';
document.getElementById('ev-immediate').value='';
document.getElementById('ev-department').value='';
document.getElementById('ev-due-date').value='';
document.getElementById('ev-status').value='open';
evFillPeopleDrops();
document.getElementById('ev-severity').onchange=function(){document.getElementById('ev-serious-warning').style.display=(this.value==='high'||this.value==='critical')?'block':'none';};
evOpenModal();
}
function evOpenDetail(id){
const e=evAllData.find(function(x){return x.id===id;});if(!e)return;
evEditingId=id;
document.getElementById('ev-modal-title').textContent=e.event_type||'Event detail';
document.getElementById('ev-modal-ref').textContent=e.event_ref||'';
document.getElementById('ev-view-mode').style.display='block';
document.getElementById('ev-edit-mode').style.display='none';
const isSerious=e.severity==='high'||e.severity==='critical';
const overdue=e.action_due_date&&new Date(e.action_due_date)<new Date()&&e.status!=='closed';
document.getElementById('ev-view-content').innerHTML=''
+'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">'+evTypeBadge(e.event_type)+evSevBadge(e.severity)+evStatBadge(e.status)+(overdue?'<span style="font-size:10px;font-weight:700;color:var(--red);background:#FEF2F2;padding:3px 9px;border-radius:99px">OVERDUE</span>':'')+'</div>'
+'<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">'
+'<div><div style="font-size:11px;color:var(--text2);font-weight:600;margin-bottom:3px">DATE & TIME</div><div style="font-size:13px">'+evFmt(e.event_date)+'</div></div>'
+'<div><div style="font-size:11px;color:var(--text2);font-weight:600;margin-bottom:3px">LOCATION</div><div style="font-size:13px">'+(e.location||'—')+'</div></div>'
+'<div><div style="font-size:11px;color:var(--text2);font-weight:600;margin-bottom:3px">PERSON INVOLVED</div><div style="font-size:13px">'+(e.person_involved||'—')+'</div></div>'
+'<div><div style="font-size:11px;color:var(--text2);font-weight:600;margin-bottom:3px">DEPARTMENT</div><div style="font-size:13px">'+(e.department||'—')+'</div></div>'
+'<div><div style="font-size:11px;color:var(--text2);font-weight:600;margin-bottom:3px">REPORTED BY</div><div style="font-size:13px">'+(e.reported_by||'—')+'</div></div>'
+'<div><div style="font-size:11px;color:var(--text2);font-weight:600;margin-bottom:3px">ASSIGNED TO</div><div style="font-size:13px">'+(e.assigned_to||'—')+'</div></div>'
+(e.action_due_date?'<div><div style="font-size:11px;color:var(--text2);font-weight:600;margin-bottom:3px">ACTION DUE</div><div style="font-size:13px;color:'+(overdue?'var(--red)':'var(--text)')+'">'+evFmtDate(e.action_due_date)+'</div></div>':'')
+'</div>'
+'<div style="background:#f9fafb;border-radius:8px;padding:14px;margin-bottom:12px"><div style="font-size:11px;color:var(--text2);font-weight:600;margin-bottom:6px">DESCRIPTION</div><div style="font-size:13px;line-height:1.6">'+(e.description||'—')+'</div></div>'
+(e.immediate_action?'<div style="background:#f9fafb;border-radius:8px;padding:14px"><div style="font-size:11px;color:var(--text2);font-weight:600;margin-bottom:6px">IMMEDIATE ACTION TAKEN</div><div style="font-size:13px;line-height:1.6">'+e.immediate_action+'</div></div>':'')
+(isSerious&&!e.investigation_id?'<div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;padding:12px 14px;margin-top:12px"><div style="font-size:12px;font-weight:600;color:var(--red)">High/critical event — investigation recommended</div></div>':'');
const actEl=document.getElementById('ev-view-actions');
let btns='';
if(isMgr())btns+='<button class="btn btn-primary" onclick="evSwitchToEdit()"><i class="ti ti-edit"></i>Edit</button>';
if(isMgr()&&e.status!=='closed')btns+='<button class="btn" onclick="evQuickClose(\''+e.id+'\')"><i class="ti ti-check"></i>Mark closed</button>';
if(isMgr()&&!e.investigation_id)btns+='<button class="btn" style="background:#E6F1FB;color:#185FA5;border-color:#93C5FD;font-weight:600" onclick="evStartInvestigation(\''+e.id+'\')"><i class="ti ti-search"></i>Investigate</button>';
if(e.investigation_id)btns+='<span style="font-size:12px;color:var(--green);display:flex;align-items:center;gap:6px"><i class="ti ti-check-circle"></i>Investigation linked</span>';
actEl.innerHTML=btns;
evOpenModal();
}
function evSwitchToEdit(){
const e=evAllData.find(function(x){return x.id===evEditingId;});if(!e)return;
document.getElementById('ev-view-mode').style.display='none';
document.getElementById('ev-edit-mode').style.display='block';
document.getElementById('ev-delete-btn').style.display=isMgr()?'flex':'none';
evFillPeopleDrops();
document.getElementById('ev-type').value=e.event_type||'';
document.getElementById('ev-severity').value=e.severity||'medium';
document.getElementById('ev-date').value=e.event_date?new Date(e.event_date).toISOString().slice(0,16):'';
document.getElementById('ev-location').value=e.location||'';
document.getElementById('ev-description').value=e.description||'';
document.getElementById('ev-immediate').value=e.immediate_action||'';
document.getElementById('ev-department').value=e.department||'';
document.getElementById('ev-due-date').value=e.action_due_date||'';
document.getElementById('ev-status').value=e.status||'open';
document.getElementById('ev-person').value=e.person_id||'';
document.getElementById('ev-reported-by').value=e.reported_by_id||'';
document.getElementById('ev-assigned-to').value=e.assigned_to_id||'';
document.getElementById('ev-serious-warning').style.display=(e.severity==='high'||e.severity==='critical')?'block':'none';
document.getElementById('ev-severity').onchange=function(){document.getElementById('ev-serious-warning').style.display=(this.value==='high'||this.value==='critical')?'block':'none';};
}
async function evSave(){
const evType=document.getElementById('ev-type').value;
const sev=document.getElementById('ev-severity').value;
const date=document.getElementById('ev-date').value;
const loc=document.getElementById('ev-location').value.trim();
const desc=document.getElementById('ev-description').value.trim();
if(!evType){toast('Please select an event type',false);return;}
if(!date){toast('Please enter a date and time',false);return;}
if(!loc){toast('Please enter a location',false);return;}
if(!desc){toast('Please enter a description',false);return;}
const personId=document.getElementById('ev-person').value||null;
const repId=document.getElementById('ev-reported-by').value||null;
const assId=document.getElementById('ev-assigned-to').value||null;
const personName=personId?pname(personId):null;
const repName=repId?pname(repId):prof?.full_name||null;
const assName=assId?pname(assId):null;
const body={company_id:prof?.company_id,event_type:evType,severity:sev,event_date:date||null,location:loc,description:desc,immediate_action:document.getElementById('ev-immediate').value||null,person_involved:personName,person_id:personId,department:document.getElementById('ev-department').value||null,reported_by:repName,reported_by_id:repId,assigned_to:assName,assigned_to_id:assId,action_due_date:document.getElementById('ev-due-date').value||null,status:document.getElementById('ev-status').value,created_by:prof?.id,updated_at:new Date().toISOString()};
try{
let savedId=evEditingId;
if(evEditingId){
await api('/events?id=eq.'+evEditingId,{m:'PATCH',p:'return=representation',b:body});
toast('Event updated!');
}else{
const yr=new Date().getFullYear();
body.event_ref=await evGenRef(yr);
const res=await api('/events',{m:'POST',p:'return=representation',b:body});
savedId=res?.[0]?.id;
toast('Event reported!');
if(savedId&&assName){
await api('/action_tracker',{m:'POST',p:'return=minimal',b:{company_id:prof?.company_id,source_module:'event',source_id:savedId,source_ref:(body.event_ref||'EVT')+' — '+evType,description:'Follow-up: '+evType+' at '+loc,responsible:assName,target_date:body.action_due_date||null,priority:sev==='critical'?'critical':sev==='high'?'high':'medium',status:'open',created_by:prof?.id}});
}
}
evCloseModal();await loadEvents();
// Investigation can be started from the event detail view
}catch(e){toast(e.message,false);}
}
async function evGenRef(yr){
try{
const cid=prof?.company_id;if(!cid)return 'EVT-'+yr+'-XXX';
const seq=await api('/event_sequence?company_id=eq.'+cid+'&year=eq.'+yr);
let next=1;
if(seq&&seq.length){next=seq[0].last_seq+1;await api('/event_sequence?company_id=eq.'+cid+'&year=eq.'+yr,{m:'PATCH',p:'return=minimal',b:{last_seq:next}});}
else{await api('/event_sequence',{m:'POST',p:'return=minimal',b:{company_id:cid,year:yr,last_seq:1}});}
return 'EVT-'+yr+'-'+String(next).padStart(3,'0');
}catch(e){return 'EVT-'+yr+'-'+Date.now().toString().slice(-3);}
}
async function evQuickClose(id){
try{await api('/events?id=eq.'+id,{m:'PATCH',p:'return=minimal',b:{status:'closed',closed_date:new Date().toISOString().slice(0,10),updated_at:new Date().toISOString()}});toast('Event closed!');evCloseModal();await loadEvents();}catch(e){toast(e.message,false);}
}
async function evDelete(){
if(!evEditingId||!confirm('Delete this event?'))return;
try{await api('/events?id=eq.'+evEditingId,{m:'DELETE'});toast('Event deleted!');evCloseModal();await loadEvents();}catch(e){toast(e.message,false);}
}
async function evStartInvestigation(eventId){
const e=evAllData.find(function(x){return x.id===eventId;});
if(!e)return;
// Guard: check if investigation already exists for this event
try{
const existing=await api('/investigations?event_id=eq.'+eventId+'&select=id,inv_ref'+cf());
if(existing&&existing.length){
toast('Investigation '+existing[0].inv_ref+' already exists for this event');
// Open the existing investigation
await loadInvs();
setTimeout(function(){
showPage('investigation',document.querySelector('.nav-item[onclick*="investigation"]'));
setTimeout(function(){invOpen(existing[0].id);},200);
},300);
return;
}
}catch(ex){console.warn('Could not check existing investigation',ex);}
try{
// Determine investigation type based on severity
const invType=(e.severity==='high'||e.severity==='critical')?'full':'basic';
// Generate ref
const yr=new Date().getFullYear();
const invRef=await invGenRef(yr);
// Build investigation body pre-filled from event
const invBody={
company_id:prof?.company_id,
inv_ref:invRef,
title:(e.event_type||'Incident')+' — '+(e.location||'site')+' ('+new Date().toLocaleDateString('en-GB')+')',
inv_type:invType,
status:'open',
event_id:e.id,
reported_by:e.reported_by||prof?.full_name||null,
incident_date:e.event_date?e.event_date.slice(0,10):null,
incident_time:e.event_date?new Date(e.event_date).toTimeString().slice(0,5):null,
incident_location:e.location||null,
incident_description:e.description||null,
person_name:e.person_involved||null,
first_aid_details:e.immediate_action||null,
immediate_actions:e.immediate_action||null,
class_hs:(e.event_type==='Incident'||e.event_type==='Near Miss'||e.event_type==='Dangerous Occurrence'),
class_env:(e.event_type==='Environmental'),
class_site:false,
investigated_by:prof?.full_name||null,
further_analyses:invType==='full',
created_by:prof?.id,
updated_at:new Date().toISOString()
};
const res=await api('/investigations',{m:'POST',p:'return=representation',b:invBody});
const invId=res&&res.length?res[0].id:res?.id;
if(!invId)throw new Error('Could not create investigation');
// Link event to investigation
await api('/events?id=eq.'+eventId,{m:'PATCH',p:'return=minimal',b:{
investigation_id:invId,
status:'open',
updated_at:new Date().toISOString()
}});
// Update local evAllData
const ev=evAllData.find(function(x){return x.id===eventId;});
if(ev){ev.investigation_id=invId;ev.status='under_investigation';}
evCloseModal();
toast('Investigation '+invRef+' created!');
// Navigate to investigation page and open the form
await loadInvs();
// Wait for loadInvs to complete then open the form
setTimeout(async function(){
invAllData=invAllData||[];
// Reload if needed
if(!invAllData.find(function(x){return x.id===invId;})){
try{const d=await api('/investigations?id=eq.'+invId);if(d&&d[0])invAllData.push(d[0]);}catch(err){}
}
showPage('investigation',document.querySelector('.nav-item[onclick*="investigation"]'));
setTimeout(function(){invOpen(invId);},200);
},300);
}catch(err){toast('Error: '+err.message,false);console.error(err);}
}


const CATS=[
{cat:'Safety equipment & signage',items:['First aid kit','Fire extinguishers','Safety signages','Means of communication']},
{cat:'Personnel & behaviour',items:['First aiders','Knowledge of safety rules','Working postures','Attitude']},
{cat:'Compliance & documentation',items:['Permits & Authorisations','Safety training','Respect of work methods']},
{cat:'Site conditions',items:['Cleanliness of work site','Site marking','Waste control','Scaffolding','Ladders / step ladders']},
{cat:'Equipment & tools',items:['Tools','Portable electrical tools','Collective protection']},
{cat:'PPE',items:['Wearing of PPEs','Safety goggles','Gloves','Safety shoes','Safety harness']},
];
// Build flat checklist items from CATS
chkItems=CATS.flatMap(function(c){
  var rows=[{cat:c.cat,item:null}]; // category header row
  c.items.forEach(function(it){rows.push({cat:c.cat,item:it});});
  return rows;
});

function buildChecklist(preloadedItems){
var preMap={};
(preloadedItems||[]).forEach(function(item){preMap[item.item_name]=item;});
const tbody=document.getElementById('if-checklist');
if(!tbody)return;
tbody.innerHTML='';
chkItems.forEach(function(c,i){
var pre=preMap[c.item]||{};
var isGood=pre.result==='good';
var isInsuf=pre.result==='insufficient';
var isNA=pre.result==='na';
var obs=pre.observation||'';
var isHdr=!c.item;
if(isHdr){
tbody.innerHTML+='<tr><td colspan="5" style="padding:8px 16px;background:#f3f4f6;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text2);letter-spacing:.05em">'+c.cat+'</td></tr>';
return;
}
tbody.innerHTML+='<tr style="border-bottom:1px solid #f9fafb">'
+'<td style="padding:8px 16px;font-size:12px">'+c.item+'</td>'
+'<td style="padding:6px;text-align:center"><input type="radio" name="chk-'+i+'" id="cg-'+i+'" value="good" onchange="inspScore()"'+(isGood?' checked':'')+' style="width:16px;height:16px;accent-color:var(--green)"></td>'
+'<td style="padding:6px;text-align:center"><input type="radio" name="chk-'+i+'" id="ci-'+i+'" value="insufficient" onchange="inspScore()"'+(isInsuf?' checked':'')+' style="width:16px;height:16px;accent-color:var(--amber)"></td>'
+'<td style="padding:6px;text-align:center"><input type="radio" name="chk-'+i+'" id="cn-'+i+'" value="na" onchange="inspScore()"'+(isNA?' checked':'')+' style="width:16px;height:16px;accent-color:var(--text2)"></td>'
+'<td style="padding:6px 16px"><input type="text" id="co-'+i+'" value="'+obs+'" placeholder="Observation..." style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:11px"></td>'
+'</tr>';
});
inspScore();
}

function syncChk(i,t){
if(t==='g'){const e=document.getElementById('ci-'+i);if(e)e.checked=false;}
else{const e=document.getElementById('cg-'+i);if(e)e.checked=false;}
var g=0,ins=0;
chkItems.forEach(function(_,n){if(document.getElementById('cg-'+n)&&document.getElementById('cg-'+n).checked)g++;if(document.getElementById('ci-'+n)&&document.getElementById('ci-'+n).checked)ins++;});
const sc=document.getElementById('if-score');
if(sc)sc.textContent=g+' Good / '+ins+' Insufficient';
}

function saveEvent(){evSave();}
// ===== INSPECTION HELPERS =====
let inspEditingId=null, inspAllData=[];

function inspShowList(){
  var lv=document.getElementById('insp-list-view');
  var fv=document.getElementById('insp-form-view');
  if(lv)lv.style.display='block';
  if(fv)fv.style.display='none';
  loadInsps();
}

function inspNew(){
  inspEditingId=null;
  var fv=document.getElementById('insp-form-view');
  var lv=document.getElementById('insp-list-view');
  if(lv)lv.style.display='none';
  if(fv)fv.style.display='block';
  var ftitle=document.getElementById('insp-form-title');
  if(ftitle)ftitle.textContent='New Inspection';
  var delbtn=document.getElementById('insp-delete-btn');
  if(delbtn)delbtn.style.display='none';
  var fields=['if-site','if-emp','if-pos','if-neg','if-sign-inspector','if-sign-reviewer','if-sign-reviewer-date'];
  fields.forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  var dt=document.getElementById('if-date');if(dt)dt.value=new Date().toISOString().slice(0,10);
  var si=document.getElementById('if-sign-inspector');if(si)si.value=prof?.full_name||'';
  var sd=document.getElementById('if-sign-date');if(sd)sd.value=new Date().toISOString().slice(0,10);
  buildChecklist([]);
  var ab=document.getElementById('if-actions-body');if(ab)ab.innerHTML='';
  var ae=document.getElementById('if-actions-empty');if(ae)ae.style.display='block';
  var ai=document.getElementById('if-actions-info');if(ai)ai.style.display='none';
}

async function inspOpen(id){
  inspEditingId=id;
  var rec=inspAllData.find(function(x){return x.id===id;});
  if(!rec){
    try{var d=await api('/inspections?id=eq.'+id+'&select=*');rec=d&&d[0];}
    catch(e){toast(e.message,false);return;}
  }
  if(!rec)return;
  var lv=document.getElementById('insp-list-view');
  var fv=document.getElementById('insp-form-view');
  if(lv)lv.style.display='none';
  if(fv)fv.style.display='block';
  var ftitle=document.getElementById('insp-form-title');
  if(ftitle)ftitle.textContent='Inspection — '+new Date(rec.inspection_date||rec.created_at).toLocaleDateString('en-GB');
  var delbtn=document.getElementById('insp-delete-btn');
  if(delbtn)delbtn.style.display=isMgr()?'inline-flex':'none';
  var flds={
    'if-site':'site','if-emp':'employees_present',
    'if-pos':'positive_obs','if-neg':'negative_obs',
    'if-sign-inspector':'performed_by','if-sign-reviewer':'reviewed_by'
  };
  Object.entries(flds).forEach(function(e){
    var el=document.getElementById(e[0]);
    if(el)el.value=rec[e[1]]||'';
  });
  var dt=document.getElementById('if-date');
  if(dt)dt.value=rec.inspection_date?rec.inspection_date.slice(0,10):'';
  var sd=document.getElementById('if-sign-date');
  if(sd)sd.value=rec.inspection_date?rec.inspection_date.slice(0,10):'';
  var srd=document.getElementById('if-sign-reviewer-date');
  if(srd)srd.value=rec.reviewed_date?rec.reviewed_date.slice(0,10):'';
  // Load checklist items
  try{
    var items=await api('/inspection_items?inspection_id=eq.'+id);
    (items||[]).forEach(function(it){if(!it.item_name&&it.item)it.item_name=it.item;});
    buildChecklist(items||[]);
  }catch(e){buildChecklist([]);}
  // Load saved actions from MAP
  var ab=document.getElementById('if-actions-body');
  var ae=document.getElementById('if-actions-empty');
  var ai=document.getElementById('if-actions-info');
  if(ab){
    ab.innerHTML='';
    try{
      var mapActions=await api('/action_tracker?source_module=eq.inspection&source_id=eq.'+id+cf());
      if(mapActions&&mapActions.length){
        if(ae)ae.style.display='none';
        if(ai)ai.style.display='none';
        mapActions.forEach(function(a){
          var tr=document.createElement('tr');
          tr.dataset.manual='true';
          tr.dataset.mapId=a.id;
          tr.innerHTML=inspActionRowHTML({
            desc:a.description||'',
            resp:a.responsible||'',
            date:a.target_date||'',
            prio:a.priority||'medium'
          });
          ab.appendChild(tr);
        });
      }else{
        if(ae)ae.style.display='block';
        if(ai)ai.style.display='none';
      }
    }catch(ex){if(ae)ae.style.display='block';}
  }
}


async function inspDelete(){
  if(!inspEditingId)return;
  if(!confirm('Delete this inspection? This cannot be undone.'))return;
  try{
    await api('/inspection_items?inspection_id=eq.'+inspEditingId,{m:'DELETE'});
    await api('/inspections?id=eq.'+inspEditingId,{m:'DELETE'});
    toast('Inspection deleted!');
    inspShowList();
  }catch(e){toast(e.message,false);console.error(e);}
}

async function inspDeleteFromList(id){
  if(!confirm('Delete this inspection? This cannot be undone.'))return;
  try{
    await api('/inspection_items?inspection_id=eq.'+id,{m:'DELETE'});
    await api('/inspections?id=eq.'+id,{m:'DELETE'});
    toast('Inspection deleted!');
    loadInsps();
  }catch(e){toast(e.message,false);console.error(e);}
}

function inspScore(){
  var g=0,ins=0;
  var insufItems=[];
  (chkItems||[]).forEach(function(c,i){
    if(!c.item)return;
    var gEl=document.getElementById('cg-'+i);
    var iEl=document.getElementById('ci-'+i);
    if(gEl&&gEl.checked)g++;
    if(iEl&&iEl.checked){ins++;insufItems.push(c.item);}
  });
  var el=document.getElementById('if-score');
  if(el)el.textContent=g+' Good / '+ins+' Insufficient';
  inspSyncActions(insufItems);
}
function updateScore(){inspScore();}

function inspSyncActions(insufItems){
  var body=document.getElementById('if-actions-body');
  var empty=document.getElementById('if-actions-empty');
  var info=document.getElementById('if-actions-info');
  if(!body)return;
  // Get current manual actions (those NOT auto-generated from checklist)
  var manualRows=Array.from(body.querySelectorAll('tr[data-manual="true"]'));
  // Get existing auto rows and their item names
  var existingAuto={};
  body.querySelectorAll('tr[data-auto="true"]').forEach(function(tr){
    existingAuto[tr.dataset.item]=tr;
  });
  // Remove auto rows for items no longer insufficient
  Object.keys(existingAuto).forEach(function(item){
    if(insufItems.indexOf(item)===-1)existingAuto[item].remove();
  });
  // Add auto rows for new insufficient items
  insufItems.forEach(function(item){
    if(!existingAuto[item]){
      var tr=document.createElement('tr');
      tr.dataset.auto='true';
      tr.dataset.item=item;
      tr.innerHTML=inspActionRowHTML({desc:item,auto:true});
      body.insertBefore(tr,body.firstChild);
    }
  });
  var total=body.querySelectorAll('tr').length;
  if(empty)empty.style.display=total?'none':'block';
  if(info)info.style.display=insufItems.length?'flex':'none';
}

function inspActionRowHTML(a){
  a=a||{};
  return '<td style="padding:4px 8px;border-bottom:1px solid #f3f4f6">'
    +'<input type="text" class="ia-desc" value="'+(a.desc||'')+'" placeholder="Describe action required..." style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px'+(a.auto?';color:var(--amber)':'')+'"/>'
    +(a.auto?'<div style="font-size:10px;color:var(--amber);margin-top:2px"><i class="ti ti-alert-triangle"></i> Auto-generated from insufficient item</div>':'')
    +'</td>'
    +'<td style="padding:4px 6px;border-bottom:1px solid #f3f4f6"><input type="text" class="ia-resp" value="'+(a.resp||'')+'" placeholder="Name..." style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"/></td>'
    +'<td style="padding:4px 6px;border-bottom:1px solid #f3f4f6"><input type="date" class="ia-date" value="'+(a.date||'')+'" style="width:100%;padding:5px 6px;border:1px solid var(--border);border-radius:6px;font-size:12px"/></td>'
    +'<td style="padding:4px 6px;border-bottom:1px solid #f3f4f6"><select class="ia-prio" style="width:100%;padding:5px 6px;border:1px solid var(--border);border-radius:6px;font-size:12px">'
    +'<option value="low"'+(a.prio==='low'?' selected':'')+'>Low</option>'
    +'<option value="medium"'+((!a.prio||a.prio==='medium')?' selected':'')+'>Medium</option>'
    +'<option value="high"'+(a.prio==='high'?' selected':'')+'>High</option>'
    +'<option value="critical"'+(a.prio==='critical'?' selected':'')+'>Critical</option>'
    +'</select></td>'
    +'<td style="padding:4px;text-align:center;border-bottom:1px solid #f3f4f6"><button onclick="this.parentNode.parentNode.remove();inspScore()" style="background:none;border:none;cursor:pointer;color:var(--red)"><i class="ti ti-x"></i></button></td>';
}

function inspAddAction(){
  var body=document.getElementById('if-actions-body');
  var empty=document.getElementById('if-actions-empty');
  if(!body)return;
  if(empty)empty.style.display='none';
  var tr=document.createElement('tr');
  tr.dataset.manual='true';
  tr.innerHTML=inspActionRowHTML({});
  body.appendChild(tr);
}


async function loadInsps(){
  const el=document.getElementById('inspections-list');
  if(!el)return;
  try{
    const d=await api('/inspections?select=*'+cf()+'&order=inspection_date.desc');
    inspAllData=d||[];
    if(!d||!d.length){
      el.innerHTML='<p style="padding:20px;color:#666">No inspections yet — click <strong>New inspection</strong> to start.</p>';
      return;
    }
    let h='<table style="width:100%;border-collapse:collapse">'
      +'<thead><tr style="background:#f9fafb">'
      +'<th style="padding:10px 16px;text-align:left;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">Date</th>'
      +'<th style="padding:10px;text-align:left;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">Site</th>'
      +'<th style="padding:10px;text-align:left;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">Inspector</th>'
      +'<th style="padding:10px;text-align:center;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--green)">Good</th>'
      +'<th style="padding:10px;text-align:center;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--amber)">Insuf.</th>'
      +'<th style="padding:10px;text-align:center;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">Score</th>'
      +'<th style="padding:10px;width:100px;border-bottom:1px solid var(--border)"></th>'
      +'</tr></thead><tbody>';
    d.forEach(function(x){
      var dt=x.inspection_date?new Date(x.inspection_date).toLocaleDateString('en-GB'):'--';
      var total=(x.score_good||0)+(x.score_insuf||0);
      var pct=total>0?Math.round((x.score_good||0)/total*100):null;
      var pctCol=pct===null?'var(--text2)':pct>=80?'var(--green)':pct>=60?'var(--amber)':'var(--red)';
      var pctStr=pct===null?'--':pct+'%';
      h+='<tr style="border-bottom:1px solid #f3f4f6">'
        +'<td style="padding:10px 16px;font-weight:600">'+dt+'</td>'
        +'<td style="padding:10px;cursor:pointer;color:var(--green);font-weight:600" data-id="'+x.id+'" onclick="inspOpen(this.dataset.id)">'+(x.site||'—')+'</td>'
        +'<td style="padding:10px">'+(x.performed_by||'—')+'</td>'
        +'<td style="padding:10px;text-align:center;color:var(--green);font-weight:600">'+(x.score_good||0)+'</td>'
        +'<td style="padding:10px;text-align:center;color:var(--amber);font-weight:600">'+(x.score_insuf||0)+'</td>'
        +'<td style="padding:10px;text-align:center;font-weight:700;color:'+pctCol+'">'+pctStr+'</td>'
        +'<td style="padding:10px">'
        +'<div style="display:flex;gap:4px">'
        +'<button class="btn btn-sm" title="Open" data-id="'+x.id+'" onclick="inspOpen(this.dataset.id)" style="color:var(--green)"><i class="ti ti-eye"></i> Open</button>'
        +(isMgr()?'<button class="btn btn-sm" title="Delete" style="color:var(--red)" data-id="'+x.id+'" onclick="inspDeleteFromList(this.dataset.id)"><i class="ti ti-trash"></i></button>':'')
        +'</div>'
        +'</td>'
        +'</tr>';
    });
    h+='</tbody></table>';
    if(el)el.innerHTML=h;
  }catch(e){if(el)el.innerHTML='<p style="padding:20px;color:red">'+e.message+'</p>';console.error(e);}
}


async function saveInspection(){
try{
  let g=0, ins=0;
  const items=chkItems.map((c,i)=>{
    if(!c.item)return null;
    const gv=document.getElementById('cg-'+i)?.checked;
    const iv=document.getElementById('ci-'+i)?.checked;
    const nav=document.getElementById('cn-'+i)?.checked;
    const ov=document.getElementById('co-'+i)?.value||'';
    if(gv)g++; if(iv)ins++;
    return{category:c.cat,item_name:c.item,result:gv?'good':iv?'insufficient':nav?'na':null,observation:ov};
  }).filter(x=>x);

  const bid=document.getElementById('if-by')?.value||'';
  const inspector=document.getElementById('if-sign-inspector')?.value||(bid?pname(bid):prof?.full_name)||'';

  const body={
    company_id:prof?.company_id,
    site:document.getElementById('if-site')?.value||null,
    inspection_date:document.getElementById('if-date')?.value||null,
    performed_by:inspector,
    employees_present:document.getElementById('if-emp')?.value||null,
    score_good:g, score_insuf:ins,
    positive_obs:document.getElementById('if-pos')?.value||null,
    negative_obs:document.getElementById('if-neg')?.value||null,
    reviewed_by:document.getElementById('if-sign-reviewer')?.value||null,
    reviewed_date:document.getElementById('if-sign-reviewer-date')?.value||null,
    updated_at:new Date().toISOString()
  };

  let savedId=inspEditingId;

  if(inspEditingId){
    // UPDATE existing inspection
    await api('/inspections?id=eq.'+inspEditingId,{m:'PATCH',p:'return=minimal',b:body});
    // Delete old items and re-insert
    await api('/inspection_items?inspection_id=eq.'+inspEditingId,{m:'DELETE'});
    const sc=items.filter(x=>x.result);
    if(sc.length)await api('/inspection_items',{m:'POST',p:'return=minimal',b:sc.map(x=>({...x,inspection_id:inspEditingId}))});
    toast('Inspection updated!');
  }else{
    // CREATE new inspection
    body.created_by=prof?.id;
    const res=await api('/inspections',{m:'POST',p:'return=representation',b:body});
    savedId=res?.[0]?.id;
    if(savedId){
      const sc=items.filter(x=>x.result);
      if(sc.length)await api('/inspection_items',{m:'POST',p:'return=minimal',b:sc.map(x=>({...x,inspection_id:savedId}))});
      // Add MAP action for insufficient items
      const insuf=items.filter(x=>x.result==='insufficient');
      if(insuf.length){
        await api('/action_tracker',{m:'POST',p:'return=minimal',b:{
          company_id:prof?.company_id,
          source_module:'inspection',source_id:savedId,
          source_ref:'Inspection: '+(body.site||'site'),
          description:'Address '+insuf.length+' insufficient item(s): '+insuf.map(x=>x.item_name).slice(0,3).join(', ')+(insuf.length>3?'...':''),
          responsible:inspector||null,
          priority:ins>5?'high':'medium',
          status:'open',created_by:prof?.id
        }});
        toast('Inspection saved! '+insuf.length+' action(s) added to MAP.');
      }else{
        toast('Inspection saved!');
      }
    }
  }
  // Collect and save action plan to MAP
  var actionRows=document.querySelectorAll('#if-actions-body tr');
  if(actionRows.length){
    // Delete old MAP entries for this inspection
    if(savedId){
      try{await api('/action_tracker?source_module=eq.inspection&source_id=eq.'+savedId,{m:'DELETE'});}catch(ex){}
    }
    var actionsAdded=0;
    for(var i=0;i<actionRows.length;i++){
      var tr=actionRows[i];
      var desc=tr.querySelector('.ia-desc')?.value||'';
      if(!desc.trim())continue;
      var resp=tr.querySelector('.ia-resp')?.value||null;
      var dueDate=tr.querySelector('.ia-date')?.value||null;
      var prio=tr.querySelector('.ia-prio')?.value||'medium';
      await api('/action_tracker',{m:'POST',p:'return=minimal',b:{
        company_id:prof?.company_id,
        source_module:'inspection',
        source_id:savedId,
        source_ref:'Inspection: '+(body.site||'site')+' ('+(body.inspection_date||'')+' )',
        description:desc,
        responsible:resp,
        target_date:dueDate,
        priority:prio,
        status:'open',
        created_by:prof?.id
      }});
      actionsAdded++;
    }
    if(actionsAdded>0)toast('Inspection saved! '+actionsAdded+' action(s) synced to Master Action Plan.');
    else toast(inspEditingId?'Inspection updated!':'Inspection saved!');
  }else{
    toast(inspEditingId?'Inspection updated!':'Inspection saved!');
  }
  // Go back to list
  inspShowList();
  loadDash();
}catch(e){toast(e.message,false);console.error(e);}
}


async function loadRA(){
  const btn=document.getElementById('risk-add-btn');
  if(btn&&isMgr())btn.innerHTML='<button class="btn btn-primary" onclick="raShowNewPanel()"><i class="ti ti-plus"></i>New RA</button>';
  const el=document.getElementById('ra-list');
  if(!el)return;
  try{
    var path='/risk_assessments?select=*'+cf()+'&order=created_at.desc';
    var ft=document.getElementById('ra-filter-type')?.value;
    var fs=document.getElementById('ra-filter-status')?.value;
    if(ft)path+='&ra_type=eq.'+ft;
    if(fs)path+='&status=eq.'+fs;
    const d=await api(path);
    raAllData=d||[];
    // Update metrics
    const today=new Date(); const soon=new Date(); soon.setDate(soon.getDate()+30);
    var setEl=function(id,v){var e=document.getElementById(id);if(e)e.textContent=v;};
    setEl('ra-m-total',raAllData.length);
    setEl('ra-m-active',raAllData.filter(function(x){return x.status==='active';}).length);
    setEl('ra-m-review',raAllData.filter(function(x){return x.review_date&&new Date(x.review_date)<soon&&x.status!=='closed';}).length);
    setEl('ra-m-draft',raAllData.filter(function(x){return x.status==='draft';}).length);
    if(!raAllData.length){el.innerHTML='<p style="padding:20px;color:#666">No risk assessments yet. Click <strong>New RA</strong> to create one.</p>';return;}
    var typeBadge=function(t){var m={baseline:{bg:'#E1F5EE',col:'#0F6E56',l:'Baseline/Generic'},task:{bg:'#E6F1FB',col:'#185FA5',l:'Task-Based'},dynamic:{bg:'#FEF9EC',col:'#854F0B',l:'Dynamic'}};var c=m[t]||{bg:'#f3f4f6',col:'#374151',l:t};return '<span style="background:'+c.bg+';color:'+c.col+';padding:3px 9px;border-radius:99px;font-size:11px;font-weight:600">'+c.l+'</span>';};
    var h='<table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f9fafb"><th style="padding:10px;text-align:left;border-bottom:1px solid var(--border)">Ref</th><th style="padding:10px;text-align:left;border-bottom:1px solid var(--border)">Title</th><th style="padding:10px;text-align:left;border-bottom:1px solid var(--border)">Type</th><th style="padding:10px;text-align:left;border-bottom:1px solid var(--border)">Assessed by</th><th style="padding:10px;text-align:left;border-bottom:1px solid var(--border)">Date</th><th style="padding:10px;text-align:left;border-bottom:1px solid var(--border)">Review</th><th style="padding:10px;text-align:left;border-bottom:1px solid var(--border)">Status</th><th style="padding:10px;width:80px;border-bottom:1px solid var(--border)"></th></tr></thead><tbody>';
    raAllData.forEach(function(x){
      var dt=x.assessment_date?new Date(x.assessment_date).toLocaleDateString('en-GB'):'--';
      var rv=x.review_date?new Date(x.review_date).toLocaleDateString('en-GB'):'--';
      var overdue=x.review_date&&new Date(x.review_date)<today&&x.status!=='closed';
      h+='<tr style="border-bottom:1px solid #f3f4f6" data-id="'+x.id+'">'
        +'<td style="padding:10px"><strong>'+(x.ra_ref||'—')+'</strong></td>'
        +'<td style="padding:10px;cursor:pointer" onclick="raOpen(\''+x.id+'\')"><span style="color:var(--green);font-weight:600">'+(x.title||'—')+'</span></td>'
        +'<td style="padding:10px">'+typeBadge(x.ra_type||'baseline')+'</td>'
        +'<td style="padding:10px">'+(x.assessed_by||'—')+'</td>'
        +'<td style="padding:10px">'+dt+'</td>'
        +'<td style="padding:10px;'+(overdue?'color:var(--red);font-weight:700':'')+'">'+rv+(overdue?' ⚠':'')+'</td>'
        +'<td style="padding:10px">'+stat(x.status)+'</td>'
        +'<td style="padding:10px">'
        +'<div style="display:flex;gap:4px">'
        +'<button class="btn btn-sm" title="Edit" data-id="'+x.id+'" onclick="event.stopPropagation();raOpen(this.dataset.id)"><i class="ti ti-edit"></i></button>'
        +(isMgr()?'<button class="btn btn-sm" title="Delete" style="color:var(--red)" data-id="'+x.id+'" onclick="event.stopPropagation();raDelete(this.dataset.id)"><i class="ti ti-trash"></i></button>':'')
        +'</div>'
        +'</td>'
        +'</tr>';
    });
    h+='</tbody></table>';
    if(el)el.innerHTML=h;
  }catch(e){if(el)el.innerHTML='<p style="padding:20px;color:red">'+e.message+'</p>';console.error(e);}
}

function raShowList(){
  document.getElementById('ra-list-view').style.display='block';
  document.getElementById('ra-new-panel').style.display='none';
  document.getElementById('ra-form-view').style.display='none';
  loadRA();
}

function raShowNewPanel(){
  document.getElementById('ra-list-view').style.display='none';
  document.getElementById('ra-new-panel').style.display='block';
  document.getElementById('ra-form-view').style.display='none';
}

function raShowForm(){
  document.getElementById('ra-list-view').style.display='none';
  document.getElementById('ra-new-panel').style.display='none';
  document.getElementById('ra-form-view').style.display='block';
}

async function raGenRef(type,yr){
  try{
    var pfx={baseline:'GRA',task:'TRA',dynamic:'DRA'}[type]||'RA';
    var cid=prof?.company_id;if(!cid)return pfx+'-'+yr+'-XXX';
    var seq=await api('/ra_sequence?company_id=eq.'+cid+'&ra_type=eq.'+type+'&year=eq.'+yr);
    var next=1;
    if(seq&&seq.length){next=seq[0].last_seq+1;await api('/ra_sequence?company_id=eq.'+cid+'&ra_type=eq.'+type+'&year=eq.'+yr,{m:'PATCH',p:'return=minimal',b:{last_seq:next}});}
    else{await api('/ra_sequence',{m:'POST',p:'return=minimal',b:{company_id:cid,ra_type:type,year:yr,last_seq:1}});}
    return pfx+'-'+yr+'-'+String(next).padStart(3,'0');
  }catch(e){return 'RA-'+yr+'-'+Date.now().toString().slice(-3);}
}

function raClearForm(){
  // Common
  ['ra-title','ra-dept','ra-workshop','ra-job-seg','ra-assessed-by','ra-date','ra-review-date','ra-approved-by',
   'ra-sign-assessor','ra-sign-assessor-date','ra-sign-reviewer','ra-sign-reviewer-date','ra-sign-approver','ra-sign-approver-date'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  // Task
  ['rat-title','rat-location','rat-dept','rat-assessed-by','rat-date','rat-review-date','rat-approved-by','rat-team','rat-desc','rat-ppe-other',
   'rat-sign-assessor','rat-sign-assessor-date','rat-sign-reviewer','rat-sign-reviewer-date','rat-sign-approver','rat-sign-approver-date'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  document.querySelectorAll('.ra-ppe').forEach(function(el){el.checked=false;});
  // Dynamic
  ['rad-title','rad-location','rad-date','rad-assessed-by','rad-team','rad-valid-until','rad-conditions','rad-proceed','rad-acknowledgement',
   'rad-sign-assessor','rad-sign-assessor-date','rad-sign-reviewer','rad-sign-reviewer-date'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  ['rad-stop-critical','rad-stop-resources','rad-stop-competence'].forEach(function(id){var el=document.getElementById(id);if(el)el.checked=false;});
  // Clear row bodies
  var bodies=['ra-baseline-body','ra-task-body','ra-dynamic-body'];
  bodies.forEach(function(id){var el=document.getElementById(id);if(el)el.innerHTML='';});
  // Set defaults
  var raDate=document.getElementById('ra-date');if(raDate)raDate.value=new Date().toISOString().slice(0,10);
  var ratDate=document.getElementById('rat-date');if(ratDate)ratDate.value=new Date().toISOString().slice(0,10);
  var radDate=document.getElementById('rad-date');if(radDate)radDate.value=new Date().toISOString().slice(0,16);
  var raAssessor=document.getElementById('ra-assessed-by');if(raAssessor)raAssessor.value=prof?.full_name||'';
  var ratAssessor=document.getElementById('rat-assessed-by');if(ratAssessor)ratAssessor.value=prof?.full_name||'';
  var radAssessor=document.getElementById('rad-assessed-by');if(radAssessor)radAssessor.value=prof?.full_name||'';
}

function raNew(type){
  raEditingId=null; raEditingType=type;
  raClearForm();
  document.getElementById('ra-form-title').textContent={baseline:'Baseline / Generic RA',task:'Task-Based RA',dynamic:'Dynamic RA'}[type]||'Risk Assessment';
  document.getElementById('ra-form-ref').textContent='New — ref will be assigned on save';
  document.getElementById('ra-status-sel').value='draft';
  document.getElementById('ra-baseline-form').style.display=type==='baseline'?'block':'none';
  document.getElementById('ra-task-form').style.display=type==='task'?'block':'none';
  document.getElementById('ra-dynamic-form').style.display=type==='dynamic'?'block':'none';
  var delBtn=document.getElementById('ra-delete-btn');
  if(delBtn)delBtn.style.display='none';
  // Hide delete btn for new RA
  var delBtn=document.getElementById('ra-delete-btn');
  if(delBtn)delBtn.style.display='none';
  // Add 3 default rows
  if(type==='baseline'){raBaselineAddRow();raBaselineAddRow();raBaselineAddRow();}
  if(type==='task'){raTaskAddRow();raTaskAddRow();raTaskAddRow();}
  if(type==='dynamic'){raDynamicAddRow();raDynamicAddRow();raDynamicAddRow();}
  raShowForm();
}

function raOpen(id){
  var ra=raAllData.find(function(x){return x.id===id;});
  if(!ra)return;
  raEditingId=id; raEditingType=ra.ra_type||'baseline';
  raClearForm();
  document.getElementById('ra-form-title').textContent={baseline:'Baseline / Generic RA',task:'Task-Based RA',dynamic:'Dynamic RA'}[ra.ra_type]||'Risk Assessment';
  document.getElementById('ra-form-ref').textContent=ra.ra_ref||'';
  document.getElementById('ra-status-sel').value=ra.status||'draft';
  document.getElementById('ra-baseline-form').style.display=ra.ra_type==='baseline'?'block':'none';
  document.getElementById('ra-task-form').style.display=ra.ra_type==='task'?'block':'none';
  document.getElementById('ra-dynamic-form').style.display=ra.ra_type==='dynamic'?'block':'none';
  // Fill fields based on type
  if(ra.ra_type==='baseline'){
    var flds={'ra-title':'title','ra-dept':'department','ra-workshop':'workshop','ra-job-seg':'job_seg','ra-assessed-by':'assessed_by','ra-date':'assessment_date','ra-review-date':'review_date','ra-approved-by':'approved_by','ra-sign-assessor':'sign_assessor','ra-sign-assessor-date':'sign_assessor_date','ra-sign-reviewer':'sign_reviewer','ra-sign-reviewer-date':'sign_reviewer_date','ra-sign-approver':'sign_approver','ra-sign-approver-date':'sign_approver_date'};
    Object.entries(flds).forEach(function(e){var el=document.getElementById(e[0]);if(el&&ra[e[1]])el.value=ra[e[1]];});
    raBaselineRender(ra.rows||[]);
  }else if(ra.ra_type==='task'){
    var flds2={'rat-title':'title','rat-location':'location','rat-dept':'department','rat-assessed-by':'assessed_by','rat-date':'assessment_date','rat-review-date':'review_date','rat-approved-by':'approved_by','rat-team':'team_members','rat-desc':'task_description','rat-ppe-other':'ppe_required','rat-sign-assessor':'sign_assessor','rat-sign-assessor-date':'sign_assessor_date','rat-sign-reviewer':'sign_reviewer','rat-sign-reviewer-date':'sign_reviewer_date','rat-sign-approver':'sign_approver','rat-sign-approver-date':'sign_approver_date'};
    Object.entries(flds2).forEach(function(e){var el=document.getElementById(e[0]);if(el&&ra[e[1]])el.value=ra[e[1]];});
    if(ra.ppe_required){var ppes=ra.ppe_required.split(',');document.querySelectorAll('.ra-ppe').forEach(function(cb){cb.checked=ppes.indexOf(cb.value)>-1;});}
    raTaskRender(ra.rows||[]);
  }else if(ra.ra_type==='dynamic'){
    var flds3={'rad-title':'title','rad-location':'location','rad-assessed-by':'assessed_by','rad-date':'assessment_date','rad-team':'team_members','rad-conditions':'site_conditions','rad-proceed':'work_description','rad-acknowledgement':'sign_assessor','rad-sign-assessor':'sign_assessor','rad-sign-assessor-date':'sign_assessor_date','rad-sign-reviewer':'sign_reviewer','rad-sign-reviewer-date':'sign_reviewer_date'};
    Object.entries(flds3).forEach(function(e){var el=document.getElementById(e[0]);if(el&&ra[e[1]])el.value=ra[e[1]];});
    raDynamicRender(ra.rows||[]);
  }
  // Show delete button for existing RA
  var delBtn=document.getElementById('ra-delete-btn');
  if(delBtn)delBtn.style.display=isMgr()?'inline-flex':'none';
  raShowForm();
}

// ── Row builders ─────────────────────────────────────────────────────────────
function raRopSelect(cls,val){
  var opts=[10,8,6,4,1].map(function(v){return '<option value="'+v+'"'+(parseInt(val)===v?' selected':'')+'>'+v+' ('+RA_ROP[v]+')</option>';}).join('');
  return '<select class="'+cls+'" onchange="raCalcRL(this)" style="width:100%;padding:3px 4px;border:1px solid var(--border);border-radius:4px;font-size:11px">'+opts+'</select>';
}
function raRsSelect(cls,val){
  var opts=[100,40,21,8,2].map(function(v){return '<option value="'+v+'"'+(parseInt(val)===v?' selected':'')+'>'+v+' ('+RA_RS[v]+')</option>';}).join('');
  return '<select class="'+cls+'" onchange="raCalcRL(this)" style="width:100%;padding:3px 4px;border:1px solid var(--border);border-radius:4px;font-size:11px">'+opts+'</select>';
}
function raCalcRL(el){
  var row=el.closest('tr');
  if(!row)return;
  var rop_b=row.querySelector('.ra-rop-b');
  var rs_b=row.querySelector('.ra-rs-b');
  var rl_b=row.querySelector('.ra-rl-b');
  if(rop_b&&rs_b&&rl_b){var v=parseInt(rop_b.value)*parseInt(rs_b.value);rl_b.innerHTML=raRLBadge(v);}
  var rop_a=row.querySelector('.ra-rop-a');
  var rs_a=row.querySelector('.ra-rs-a');
  var rl_a=row.querySelector('.ra-rl-a');
  if(rop_a&&rs_a&&rl_a){var v2=parseInt(rop_a.value)*parseInt(rs_a.value);rl_a.innerHTML=raRLBadge(v2);}
}

function raBaselineAddRow(r){
  r=r||{};
  var body=document.getElementById('ra-baseline-body');if(!body)return;
  var num=body.querySelectorAll('tr').length+1;
  var inp=function(cls,val,ph){return '<input type="text" class="'+cls+'" value="'+(val||'')+'" placeholder="'+(ph||'')+'" style="width:100%;padding:3px 5px;border:1px solid var(--border);border-radius:4px;font-size:11px"/>';};
  var chk=function(cls,val){return '<input type="checkbox" class="'+cls+'"'+(val?' checked':'')+' style="width:14px;height:14px">';};
  var tr='<tr>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('ra-b-task',r.task,'Task...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('ra-b-hazard',r.hazard,'Hazard...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('ra-b-gen-hazard',r.generic_hazard,'Category...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('ra-b-risk',r.risk,'Risk...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)"><select class="ra-b-activity" style="width:80px;padding:3px;border:1px solid var(--border);border-radius:4px;font-size:11px"><option'+(r.activity==='Routine'?' selected':'')+'>Routine</option><option'+(r.activity==='Non-Routine'?' selected':'')+'>Non-Routine</option><option'+(r.activity==='Emergency'?' selected':'')+'>Emergency</option></select></td>'
    +'<td style="padding:3px;text-align:center;border:1px solid var(--border)">'+chk('ra-b-lact',r.lact)+'</td>'
    +'<td style="padding:3px;text-align:center;border:1px solid var(--border)">'+chk('ra-b-preg',r.preg)+'</td>'
    +'<td style="padding:3px;text-align:center;border:1px solid var(--border)">'+chk('ra-b-intern',r.intern)+'</td>'
    +'<td style="padding:3px;text-align:center;border:1px solid var(--border)">'+chk('ra-b-young',r.young)+'</td>'
    +'<td style="padding:3px;text-align:center;border:1px solid var(--border)">'+chk('ra-b-temp',r.temp)+'</td>'
    +'<td style="padding:3px;text-align:center;border:1px solid var(--border)">'+chk('ra-b-disabled',r.disabled)+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+raRopSelect('ra-rop-b',r.rop_b||6)+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+raRsSelect('ra-rs-b',r.rs_b||8)+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)" class="ra-rl-b">'+raRLBadge((r.rop_b||6)*(r.rs_b||8))+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('ra-b-controls',r.controls,'Controls...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)"><select class="ra-b-hierarchy" style="width:100px;padding:3px;border:1px solid var(--border);border-radius:4px;font-size:11px"><option>Elimination</option><option>Substitution</option><option>Engineering</option><option>Administrative</option><option>PPE</option></select></td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+raRopSelect('ra-rop-a',r.rop_a||4)+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+raRsSelect('ra-rs-a',r.rs_a||2)+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)" class="ra-rl-a">'+raRLBadge((r.rop_a||4)*(r.rs_a||2))+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('ra-b-action',r.action,'Action...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('ra-b-responsible',r.responsible,'Responsible...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)"><input type="date" class="ra-b-due" value="'+(r.due_date||'')+'" style="width:100%;padding:3px;border:1px solid var(--border);border-radius:4px;font-size:11px"/></td>'
    +'<td style="padding:3px;text-align:center;border:1px solid var(--border)"><button onclick="this.parentNode.parentNode.remove()" style="background:none;border:none;cursor:pointer;color:var(--red)"><i class="ti ti-x"></i></button></td>'
    +'</tr>';
  body.innerHTML+=tr;
}

function raBaselineRender(rows){var body=document.getElementById('ra-baseline-body');if(!body)return;body.innerHTML='';rows.forEach(function(r){raBaselineAddRow(r);});}

function raTaskAddRow(r){
  r=r||{};
  var body=document.getElementById('ra-task-body');if(!body)return;
  var num=body.querySelectorAll('tr').length+1;
  var inp=function(cls,val,ph){return '<input type="text" class="'+cls+'" value="'+(val||'')+'" placeholder="'+(ph||'')+'" style="width:100%;padding:3px 5px;border:1px solid var(--border);border-radius:4px;font-size:11px"/>';};
  var tr='<tr>'
    +'<td style="padding:3px;text-align:center;border:1px solid var(--border);font-weight:700;font-size:12px">'+num+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('rat-step',r.step_desc,'Describe step...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('rat-hazards',r.hazards,'Hazards...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('rat-risks',r.risks,'Risks...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('rat-people',r.people,'Who...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+raRopSelect('ra-rop-b',r.rop_b||6)+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+raRsSelect('ra-rs-b',r.rs_b||8)+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)" class="ra-rl-b">'+raRLBadge((r.rop_b||6)*(r.rs_b||8))+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('rat-controls',r.controls,'Controls...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+raRopSelect('ra-rop-a',r.rop_a||4)+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+raRsSelect('ra-rs-a',r.rs_a||2)+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)" class="ra-rl-a">'+raRLBadge((r.rop_a||4)*(r.rs_a||2))+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('rat-responsible',r.responsible,'Responsible...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)"><input type="date" class="rat-due" value="'+(r.due_date||'')+'" style="width:100%;padding:3px;border:1px solid var(--border);border-radius:4px;font-size:11px"/></td>'
    +'<td style="padding:3px;text-align:center;border:1px solid var(--border)"><button onclick="this.parentNode.parentNode.remove()" style="background:none;border:none;cursor:pointer;color:var(--red)"><i class="ti ti-x"></i></button></td>'
    +'</tr>';
  body.innerHTML+=tr;
}

function raTaskRender(rows){var body=document.getElementById('ra-task-body');if(!body)return;body.innerHTML='';rows.forEach(function(r){raTaskAddRow(r);});}

function raDynamicAddRow(r){
  r=r||{};
  var body=document.getElementById('ra-dynamic-body');if(!body)return;
  var num=body.querySelectorAll('tr').length+1;
  var inp=function(cls,val,ph){return '<input type="text" class="'+cls+'" value="'+(val||'')+'" placeholder="'+(ph||'')+'" style="width:100%;padding:3px 5px;border:1px solid var(--border);border-radius:4px;font-size:11px"/>';};
  var tr='<tr>'
    +'<td style="padding:3px;text-align:center;border:1px solid var(--border);font-weight:700;font-size:12px">'+num+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('rad-hazard',r.hazard,'Hazard...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('rad-risk',r.risk,'Risk/consequence...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('rad-who',r.who,'Who is at risk...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('rad-controls',r.controls,'Existing controls...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border);text-align:center"><select class="rad-level" style="width:80px;padding:3px;border:1px solid var(--border);border-radius:4px;font-size:11px"><option value="low"'+(r.level==='low'?' selected':'')+'>Low</option><option value="medium"'+(r.level==='medium'?' selected':'')+'>Medium</option><option value="high"'+(r.level==='high'?' selected':'')+'>High</option><option value="critical"'+(r.level==='critical'?' selected':'')+'>Critical</option></select></td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('rad-additional',r.additional,'Additional controls...')+'</td>'
    +'<td style="padding:3px;border:1px solid var(--border);text-align:center"><select class="rad-acceptable" style="width:70px;padding:3px;border:1px solid var(--border);border-radius:4px;font-size:11px"><option value="yes"'+(r.acceptable==='yes'?' selected':'')+'>Yes</option><option value="no"'+(r.acceptable==='no'?' selected':'')+'>No</option></select></td>'
    +'<td style="padding:3px;border:1px solid var(--border)">'+inp('rad-responsible',r.responsible,'Responsible...')+'</td>'
    +'<td style="padding:3px;text-align:center;border:1px solid var(--border)"><button onclick="this.parentNode.parentNode.remove()" style="background:none;border:none;cursor:pointer;color:var(--red)"><i class="ti ti-x"></i></button></td>'
    +'</tr>';
  body.innerHTML+=tr;
}

function raDynamicRender(rows){var body=document.getElementById('ra-dynamic-body');if(!body)return;body.innerHTML='';rows.forEach(function(r){raDynamicAddRow(r);});}

function raCollectRows(type){
  var rows=[];
  if(type==='baseline'){
    document.querySelectorAll('#ra-baseline-body tr').forEach(function(tr){
      rows.push({
        task:tr.querySelector('.ra-b-task')?.value||'',
        hazard:tr.querySelector('.ra-b-hazard')?.value||'',
        generic_hazard:tr.querySelector('.ra-b-gen-hazard')?.value||'',
        risk:tr.querySelector('.ra-b-risk')?.value||'',
        activity:tr.querySelector('.ra-b-activity')?.value||'',
        lact:tr.querySelector('.ra-b-lact')?.checked||false,
        preg:tr.querySelector('.ra-b-preg')?.checked||false,
        intern:tr.querySelector('.ra-b-intern')?.checked||false,
        young:tr.querySelector('.ra-b-young')?.checked||false,
        temp:tr.querySelector('.ra-b-temp')?.checked||false,
        disabled:tr.querySelector('.ra-b-disabled')?.checked||false,
        rop_b:parseInt(tr.querySelector('.ra-rop-b')?.value||6),
        rs_b:parseInt(tr.querySelector('.ra-rs-b')?.value||8),
        rl_b:(parseInt(tr.querySelector('.ra-rop-b')?.value||6))*(parseInt(tr.querySelector('.ra-rs-b')?.value||8)),
        controls:tr.querySelector('.ra-b-controls')?.value||'',
        hierarchy:tr.querySelector('.ra-b-hierarchy')?.value||'',
        rop_a:parseInt(tr.querySelector('.ra-rop-a')?.value||4),
        rs_a:parseInt(tr.querySelector('.ra-rs-a')?.value||2),
        rl_a:(parseInt(tr.querySelector('.ra-rop-a')?.value||4))*(parseInt(tr.querySelector('.ra-rs-a')?.value||2)),
        action:tr.querySelector('.ra-b-action')?.value||'',
        responsible:tr.querySelector('.ra-b-responsible')?.value||'',
        due_date:tr.querySelector('.ra-b-due')?.value||''
      });
    });
  }else if(type==='task'){
    document.querySelectorAll('#ra-task-body tr').forEach(function(tr){
      rows.push({
        step_desc:tr.querySelector('.rat-step')?.value||'',
        hazards:tr.querySelector('.rat-hazards')?.value||'',
        risks:tr.querySelector('.rat-risks')?.value||'',
        people:tr.querySelector('.rat-people')?.value||'',
        rop_b:parseInt(tr.querySelector('.ra-rop-b')?.value||6),
        rs_b:parseInt(tr.querySelector('.ra-rs-b')?.value||8),
        rl_b:(parseInt(tr.querySelector('.ra-rop-b')?.value||6))*(parseInt(tr.querySelector('.ra-rs-b')?.value||8)),
        controls:tr.querySelector('.rat-controls')?.value||'',
        rop_a:parseInt(tr.querySelector('.ra-rop-a')?.value||4),
        rs_a:parseInt(tr.querySelector('.ra-rs-a')?.value||2),
        rl_a:(parseInt(tr.querySelector('.ra-rop-a')?.value||4))*(parseInt(tr.querySelector('.ra-rs-a')?.value||2)),
        responsible:tr.querySelector('.rat-responsible')?.value||'',
        due_date:tr.querySelector('.rat-due')?.value||''
      });
    });
  }else if(type==='dynamic'){
    document.querySelectorAll('#ra-dynamic-body tr').forEach(function(tr){
      rows.push({
        hazard:tr.querySelector('.rad-hazard')?.value||'',
        risk:tr.querySelector('.rad-risk')?.value||'',
        who:tr.querySelector('.rad-who')?.value||'',
        controls:tr.querySelector('.rad-controls')?.value||'',
        level:tr.querySelector('.rad-level')?.value||'medium',
        additional:tr.querySelector('.rad-additional')?.value||'',
        acceptable:tr.querySelector('.rad-acceptable')?.value||'yes',
        responsible:tr.querySelector('.rad-responsible')?.value||''
      });
    });
  }
  return rows;
}

async function raSave(){
  var type=raEditingType||'baseline';
  var g=function(id){var el=document.getElementById(id);return el?el.value||null:null;};
  var body={
    company_id:prof?.company_id,
    ra_type:type,
    status:document.getElementById('ra-status-sel')?.value||'draft',
    rows:raCollectRows(type),
    updated_at:new Date().toISOString()
  };
  // Type-specific fields
  if(type==='baseline'){
    Object.assign(body,{title:g('ra-title'),department:g('ra-dept'),workshop:g('ra-workshop'),job_seg:g('ra-job-seg'),assessed_by:g('ra-assessed-by'),assessment_date:g('ra-date'),review_date:g('ra-review-date'),approved_by:g('ra-approved-by'),sign_assessor:g('ra-sign-assessor'),sign_assessor_date:g('ra-sign-assessor-date'),sign_reviewer:g('ra-sign-reviewer'),sign_reviewer_date:g('ra-sign-reviewer-date'),sign_approver:g('ra-sign-approver'),sign_approver_date:g('ra-sign-approver-date')});
  }else if(type==='task'){
    var ppes=[];document.querySelectorAll('.ra-ppe:checked').forEach(function(el){ppes.push(el.value);});
    if(g('rat-ppe-other'))ppes.push(g('rat-ppe-other'));
    Object.assign(body,{title:g('rat-title'),location:g('rat-location'),department:g('rat-dept'),assessed_by:g('rat-assessed-by'),assessment_date:g('rat-date'),review_date:g('rat-review-date'),approved_by:g('rat-approved-by'),team_members:g('rat-team'),task_description:g('rat-desc'),ppe_required:ppes.join(','),sign_assessor:g('rat-sign-assessor'),sign_assessor_date:g('rat-sign-assessor-date'),sign_reviewer:g('rat-sign-reviewer'),sign_reviewer_date:g('rat-sign-reviewer-date'),sign_approver:g('rat-sign-approver'),sign_approver_date:g('rat-sign-approver-date')});
  }else if(type==='dynamic'){
    Object.assign(body,{title:g('rad-title'),location:g('rad-location'),assessed_by:g('rad-assessed-by'),assessment_date:g('rad-date')?g('rad-date').slice(0,10):null,team_members:g('rad-team'),site_conditions:g('rad-conditions'),work_description:g('rad-proceed'),validity_period:g('rad-valid-until'),sign_assessor:g('rad-acknowledgement'),sign_assessor_date:g('rad-sign-assessor-date'),sign_reviewer:g('rad-sign-reviewer'),sign_reviewer_date:g('rad-sign-reviewer-date')});
  }
  if(!body.title){toast('Please enter a title',false);return;}
  try{
    var savedId=raEditingId;
    if(raEditingId){
      await api('/risk_assessments?id=eq.'+raEditingId,{m:'PATCH',p:'return=representation',b:body});
      toast('RA updated!');
    }else{
      var yr=new Date().getFullYear();
      body.ra_ref=await raGenRef(type,yr);
      body.created_by=prof?.id;
      var res=await api('/risk_assessments',{m:'POST',p:'return=representation',b:body});
      savedId=res?.[0]?.id||res?.id;
      toast('RA created — '+body.ra_ref+'!');
      // Auto-create MAP entries for residual risks
      if(savedId)await raSyncToMAP(savedId,body,type);
    }
  }catch(e){toast(e.message,false);console.error(e);}
}

async function raSyncToMAP(raId,body,type){
  try{
    var rows=body.rows||[];
    var highRiskRows=rows.filter(function(r){
      if(type==='dynamic')return r.acceptable==='no'||r.level==='critical'||r.level==='high';
      return(r.rl_a||0)>=210;
    });
    for(var i=0;i<highRiskRows.length;i++){
      var r=highRiskRows[i];
      var desc=type==='dynamic'?r.hazard:r.hazard||r.step_desc;
      if(!desc)continue;
      await api('/action_tracker',{m:'POST',p:'return=minimal',b:{
        company_id:prof?.company_id,
        source_module:'risk_assessment',source_id:raId,
        source_ref:body.ra_ref+' — '+(type==='baseline'?'Baseline':type==='task'?'Task-Based':'Dynamic')+' RA',
        description:'Residual risk action: '+(r.action||desc),
        responsible:r.responsible||null,
        target_date:r.due_date||null,
        priority:(r.rl_a||0)>=600||(r.level==='critical')?'critical':(r.rl_a||0)>=210||(r.level==='high')?'high':'medium',
        status:'open',created_by:prof?.id
      }});
    }
    if(highRiskRows.length)toast(''+highRiskRows.length+' residual risk action(s) added to Master Action Plan');
  }catch(e){console.error('MAP sync:',e);}
}

async function saveRA(){raSave();}

async function raDelete(id){
  if(!confirm('Delete this risk assessment? This cannot be undone.'))return;
  try{
    await api('/risk_assessments?id=eq.'+id,{m:'DELETE'});
    raAllData=raAllData.filter(function(x){return x.id!==id;});
    toast('Risk assessment deleted!');
    loadRA();
  }catch(e){toast(e.message,false);console.error(e);}
}

async function raDeleteCurrent(){
  if(!raEditingId)return;
  if(!confirm('Delete this risk assessment? This cannot be undone.'))return;
  try{
    await api('/risk_assessments?id=eq.'+raEditingId,{m:'DELETE'});
    toast('Risk assessment deleted!');
    raEditingId=null;
    raShowList();
  }catch(e){toast(e.message,false);console.error(e);}
}

// ===== SAFETY COMMUNICATION GENERATOR =====
function generateSafetyComm(invId){
  var inv=invAllData.find(function(x){return x.id===invId;})||{};
  
  // Collect data
  var title=inv.inv_ref?inv.inv_ref+' — ':'';
  var incType=inv.class_hs?'H&S Incident':inv.class_env?'Environmental Incident':'Site Risk Incident';
  title+=inv.incident_description?inv.incident_description.split('.')[0]:incType;
  
  var what=inv.incident_description||'—';
  
  var causes=(inv.immediate_causes||[]).filter(function(c){return c&&c.trim();});
  var rc=(inv.ws2_root_causes||[]).filter(function(c){return c&&c.trim();});
  var allCauses=causes.concat(rc).filter(Boolean);
  
  var actions=(inv.corrective_actions||[]).filter(function(a){return a.desc;});
  
  // Shared learning - build from causes and actions
  var learning=[];
  if(allCauses.length)learning.push('Identified causes: '+allCauses.slice(0,3).join('; ')+'.');
  if(actions.length)learning.push('Key actions: '+actions.map(function(a){return a.desc;}).slice(0,3).join('; ')+'.');
  if(!learning.length)learning.push('Review risk assessments and safe work procedures related to this incident.');

  var severity=inv.inv_type==='full'?'LTA / Serious':'Near Miss / First Aid';
  try{
    var e=evAllData.find(function(x){return x.id===inv.event_id;});
    if(e){
      var smap={critical:'Fatal / Critical',high:'LTA / Serious',medium:'Non-LTA',low:'Near Miss / First Aid'};
      severity=smap[e.severity]||severity;
    }
  }catch(ex){}

  var dt=inv.incident_date?new Date(inv.incident_date).toLocaleDateString('en-GB',{month:'short',year:'numeric'}):'—';
  var classification=(inv.class_hs?'H&S ':'')+(inv.class_env?'Environmental ':'')+(inv.class_site?'Site Risk ':'');
  var company=prof?.company_name||'Company';
  var contact=inv.investigated_by||prof?.full_name||'HSE Department';
  
  var causeHtml=allCauses.length?'<ul style="margin:0;padding-left:16px">'+allCauses.map(function(c){return '<li>'+c+'</li>';}).join('')+'</ul>':'No causes recorded yet.';
  var actionHtml=actions.length?'<ul style="margin:0;padding-left:16px">'+actions.map(function(a){return '<li><strong>'+a.desc+'</strong>'+(a.resp?' ('+a.resp+')':(a.responsible?' ('+a.responsible+')':''))+(a.date||a.due_date?' — '+(a.date||a.due_date):'')+'</li>';}).join('')+'</ul>':'No actions recorded yet.';
  var learningHtml='<ul style="margin:0;padding-left:16px">'+learning.map(function(l){return '<li><strong>'+l+'</strong></li>';}).join('')+'</ul>';

  var html=`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Safety Communication — ${escH(inv.inv_ref||'')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;font-family:Arial,sans-serif}
  body{background:#f0f0f0;padding:20px}
  .comm-page{width:1040px;margin:0 auto;background:#fff;box-shadow:0 2px 20px rgba(0,0,0,.15)}
  .comm-header{display:grid;grid-template-columns:1fr auto auto auto auto;border-bottom:3px solid #EC6607}
  .comm-header-cell{padding:8px 14px;font-size:15px;border-right:1px solid #ccc}
  .comm-header-cell:last-child{border-right:none}
  .comm-header-cell.bold{font-weight:700;background:#EC6607;color:#fff}
  .comm-title{padding:12px 16px;font-size:22px;font-weight:700;color:#1a1a1a;border-bottom:2px solid #EC6607;line-height:1.3}
  .comm-body{display:grid;grid-template-columns:1fr 1fr;border-top:none}
  .comm-row{display:contents}
  .comm-cell{padding:10px 14px;border:1px solid #ddd;font-size:12px;line-height:1.6;vertical-align:top}
  .comm-cell.full{grid-column:span 2}
  .comm-cell.orange{background:#EC6607;color:#fff;font-size:15px;font-weight:700;padding:8px 14px}
  .comm-cell.orange.full{grid-column:span 2}
  .comm-cell.pink{background:#F6E7E8}
  .comm-cell.pink.full{grid-column:span 2}
  .comm-section{display:grid;grid-template-columns:2fr 1fr;width:100%}
  .comm-section-3{display:grid;grid-template-columns:1fr;width:100%}
  .comm-table{width:100%;border-collapse:collapse}
  .comm-table td{padding:10px 14px;border:1px solid #ddd;font-size:12px;line-height:1.6;vertical-align:top}
  .comm-table tr.orange td{background:#EC6607;color:#fff;font-size:15px;font-weight:700;padding:8px 14px;border-color:#c45500}
  .comm-table tr.pink td{background:#F6E7E8}
  .photo-box{border:2px dashed #ccc;background:#f9f9f9;min-height:200px;display:flex;align-items:center;justify-content:center;color:#999;font-size:13px;flex-direction:column;gap:8px;padding:20px}
  .comm-footer{padding:8px 14px;background:#1a1a1a;color:#fff;font-size:11px;display:flex;justify-content:space-between;align-items:center}
  .print-btn{position:fixed;top:20px;right:20px;background:#EC6607;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.2);display:flex;align-items:center;gap:6px}
  @media print{.print-btn{display:none}body{background:#fff;padding:0}.comm-page{box-shadow:none;width:100%}}
  ul li{margin-bottom:4px}
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">🖨️ Print / Save PDF</button>
<div class="comm-page">

<!-- Header bar -->
<div class="comm-header">
  <div class="comm-header-cell">${escH(company)}</div>
  <div class="comm-header-cell">Ref: ${escH(inv.inv_ref||'—')}</div>
  <div class="comm-header-cell bold">${escH(dt)}</div>
  <div class="comm-header-cell bold">${escH(severity)}</div>
  <div class="comm-header-cell bold">${escH(classification||'H&S')}</div>
</div>

<!-- Title -->
<div class="comm-title">${escH(title)}</div>

<!-- Main content table -->
<table class="comm-table">
  <!-- What happened -->
  <tr class="pink">
    <td colspan="2" style="font-size:13px">${escH(what)}</td>
  </tr>
  <!-- Causes / Actions headers -->
  <tr class="orange">
    <td style="width:50%">Immediate &amp; Root Causes</td>
    <td>Actions Taken / Planned</td>
  </tr>
  <!-- Causes / Actions content -->
  <tr>
    <td>${causeHtml}</td>
    <td>${actionHtml}</td>
  </tr>
  <!-- Shared learning -->
  <tr class="orange">
    <td colspan="2" style="font-size:14px">Shared Learning</td>
  </tr>
  <tr>
    <td colspan="2">${learningHtml}</td>
  </tr>
  <!-- Standards -->
  <tr class="orange">
    <td colspan="2">Relevant Standards &amp; References</td>
  </tr>
  <tr class="pink">
    <td colspan="2">Risk Assessment, Incident Investigation, Safe Work Procedures, PPE Policy</td>
  </tr>
  <!-- Contact / Photos -->
  <tr class="orange">
    <td>Contact</td>
    <td>Photos / Evidence</td>
  </tr>
  <tr>
    <td style="font-size:12px"><strong>${escH(contact)}</strong><br>HSE Department<br>${escH(company)}<br><br>
    <em>This communication was generated from Investigation ${escH(inv.inv_ref||'—')} on ${new Date().toLocaleDateString('en-GB')}</em></td>
    <td><div class="photo-box"><span style="font-size:30px">📷</span><span>Photos to be added when printing</span><span style="font-size:11px;color:#aaa">Attach relevant images of the incident scene, equipment or corrective actions</span></div></td>
  </tr>
</table>

<div class="comm-footer">
  <span>⚠️ SAFETY COMMUNICATION — FOR IMMEDIATE DISTRIBUTION TO ALL RELEVANT TEAMS</span>
  <span>Generated by AURIS360 HSE Platform</span>
</div>

</div>
</body>
</html>`;

  // Open in new window
  var w=window.open('','_blank','width=1100,height=900,scrollbars=yes');
  w.document.write(html);
  w.document.close();
}

function escH(str){
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadInvs(){
  var el=document.getElementById('inv-list');
  if(!el)return;
  try{
    var d=await api('/investigations?select=*'+cf()+'&order=created_at.desc');
    invAllData=d||[];
    if(!d||!d.length){el.innerHTML='<p style="padding:20px;color:#666">No investigations yet</p>';return;}
    var h='<table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f9fafb">'
      +'<th style="padding:10px;text-align:left;border-bottom:1px solid var(--border)">Ref</th>'
      +'<th style="padding:10px;text-align:left;border-bottom:1px solid var(--border)">Date</th>'
      +'<th style="padding:10px;text-align:left;border-bottom:1px solid var(--border)">Location</th>'
      +'<th style="padding:10px;text-align:left;border-bottom:1px solid var(--border)">Type</th>'
      +'<th style="padding:10px;text-align:left;border-bottom:1px solid var(--border)">Investigated by</th>'
      +'<th style="padding:10px;text-align:left;border-bottom:1px solid var(--border)">Status</th>'
      +'<th style="padding:10px;width:90px;border-bottom:1px solid var(--border)"></th>'
      +'</tr></thead><tbody>';
    for(var i=0;i<d.length;i++){
      var x=d[i];
      var dt=x.incident_date?new Date(x.incident_date).toLocaleDateString('en-GB'):'--';
      var typeBadge=x.inv_type==='full'
        ?'<span style="background:#F3E8FF;color:#6B21A8;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600">Full</span>'
        :'<span style="background:#E6F1FB;color:#185FA5;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600">Basic</span>';
      var delBtn=isMgr()
        ?'<button class="btn btn-sm" style="color:var(--red)" title="Delete" onclick="invDelete(this.getAttribute(\'data-id\'))" data-id="'+x.id+'"><i class="ti ti-trash"></i></button>'
        :'';
      h+='<tr style="border-bottom:1px solid #f3f4f6">'
        +'<td style="padding:10px"><strong>'+(x.inv_ref||'--')+'</strong></td>'
        +'<td style="padding:10px">'+dt+'</td>'
        +'<td style="padding:10px">'+(x.incident_location||'--')+'</td>'
        +'<td style="padding:10px">'+typeBadge+'</td>'
        +'<td style="padding:10px">'+(x.investigated_by||'--')+'</td>'
        +'<td style="padding:10px">'+stat(x.status)+'</td>'
        +'<td style="padding:10px"><div style="display:flex;gap:4px">'
        +'<button class="btn btn-sm" title="Open" onclick="invOpen(this.getAttribute(\'data-id\'))" data-id="'+x.id+'"><i class="ti ti-edit"></i></button>'
        +delBtn
        +'</div></td>'
        +'</tr>';
    }
    h+='</tbody></table>';
    if(el)el.innerHTML=h;
  }catch(e){if(el)el.innerHTML='<p style="padding:20px;color:red">'+e.message+'</p>';console.error(e);}
}



function invShowList(){
  document.getElementById('inv-list-view').style.display='block';
  document.getElementById('inv-form-view').style.display='none';
  loadInvs();
}

function invShowForm(){
  document.getElementById('inv-list-view').style.display='none';
  document.getElementById('inv-form-view').style.display='block';
}

function invShowTab(tab){
  // Don't switch to disabled tabs
  var btn=document.getElementById('inv-tab-'+tab);
  if(btn&&btn.classList.contains('disabled'))return;
  document.querySelectorAll('.inv-tab-content').forEach(t=>t.style.display='none');
  document.querySelectorAll('.inv-tab').forEach(t=>t.classList.remove('active'));
  var content=document.getElementById('inv-'+tab);
  if(content)content.style.display='block';
  if(btn)btn.classList.add('active');
}

function invTypeChange(){
  var type=document.getElementById('inv-type-sel').value;
  var isFull=type==='full';
  var ws2btn=document.getElementById('inv-tab-ws2');
  var ws3btn=document.getElementById('inv-tab-ws3');
  if(ws2btn){ws2btn.className='inv-tab'+(isFull?'':' disabled');ws2btn.style.opacity=isFull?'1':'0.4';}
  if(ws3btn){ws3btn.className='inv-tab'+(isFull?'':' disabled');ws3btn.style.opacity=isFull?'1':'0.4';}
  if(!isFull){
    var active=document.querySelector('.inv-tab.active');
    if(active&&(active.id==='inv-tab-ws2'||active.id==='inv-tab-ws3'))invShowTab('ws1');
  }
}

async function invGenRef(yr){
  try{
    var cid=prof?.company_id;if(!cid)return 'INV-'+yr+'-XXX';
    var seq=await api('/inv_sequence?company_id=eq.'+cid+'&year=eq.'+yr);
    var next=1;
    if(seq&&seq.length){next=seq[0].last_seq+1;await api('/inv_sequence?company_id=eq.'+cid+'&year=eq.'+yr,{m:'PATCH',p:'return=minimal',b:{last_seq:next}});}
    else{await api('/inv_sequence',{m:'POST',p:'return=minimal',b:{company_id:cid,year:yr,last_seq:1}});}
    return 'INV-'+yr+'-'+String(next).padStart(3,'0');
  }catch(e){return 'INV-'+yr+'-'+Date.now().toString().slice(-3);}
}

function invClearForm(){
  // WS1
  ['ws1-reported-by','ws1-reported-title','ws1-inc-date','ws1-inc-time',
   'ws1-location','ws1-description','ws1-nature-hs','ws1-conseq-hs',
   'ws1-nature-env','ws1-conseq-env','ws1-nature-site','ws1-conseq-site',
   'ws1-person-name','ws1-person-function','ws1-person-start',
   'ws1-witnesses','ws1-task-freq','ws1-work-type','ws1-recurring-details',
   'ws1-first-aid-details','ws1-immediate-actions','ws1-ws2-resp',
   'ws2-interviewer','ws2-interviewer-title','ws2-interviewee',
   'ws2-interviewee-title','ws2-date',
   'ws3-completed-by','ws3-completed-title','ws3-participants','ws3-date',
   'ws3-machines-explain','ws3-materials-explain','ws3-environment-explain',
   'inv-sign-investigator','inv-sign-reviewer','inv-sign-approver',
   'inv-sign-inv-date','inv-sign-rev-date','inv-sign-app-date'
  ].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  ['ws1-class-hs','ws1-class-env','ws1-class-site','ws1-recurring',
   'ws1-first-aid','ws1-further','ws3-machines','ws3-materials','ws3-environment'
  ].forEach(function(id){var el=document.getElementById(id);if(el)el.checked=false;});
  document.querySelectorAll('.ws1-cause').forEach(function(el){el.value='';});
  document.querySelectorAll('.ws2-q-resp').forEach(function(el){el.value='';});
  document.querySelectorAll('.ws2-rc').forEach(function(el){el.value='';});
  document.querySelectorAll('[name^="ws2-q"]').forEach(function(el){el.checked=false;});
  // Reset WS1 CA table
  var caBody=document.getElementById('ws1-ca-body');
  if(caBody)caBody.querySelectorAll('input').forEach(function(el){el.value='';});
  // Clear inv CA
  var invCaBody=document.getElementById('inv-ca-body');
  if(invCaBody)invCaBody.innerHTML='';
  var invCaEmpty=document.getElementById('inv-ca-empty');
  if(invCaEmpty)invCaEmpty.style.display='block';
  // Reset WS3 5-why
  var ws3Body=document.getElementById('ws3-five-why-body');
  if(ws3Body)ws3Body.querySelectorAll('input').forEach(function(el){if(el.type==='checkbox')el.checked=false;else el.value='';});
  // Load events for link dropdown
  invLoadEventsDrop();
}

async function invLoadEventsDrop(){
  try{
    var d=await api('/events?select=id,event_ref,event_type,event_date'+cf()+'&order=event_date.desc&limit=50');
    var sel=document.getElementById('ws1-event-link');
    if(!sel)return;
    var opts='<option value="">None</option>';
    (d||[]).forEach(function(e){
      var dt=e.event_date?new Date(e.event_date).toLocaleDateString('en-GB'):'';
      opts+='<option value="'+e.id+'">'+(e.event_ref||'?')+' — '+(e.event_type||'Event')+' ('+dt+')</option>';
    });
    sel.innerHTML=opts;
  }catch(e){}
}

async function invNew(){
  invEditingId=null;
  invClearForm();
  document.getElementById('inv-form-title').textContent='New Investigation';
  document.getElementById('inv-form-ref').textContent='';
  document.getElementById('inv-type-sel').value='basic';
  document.getElementById('inv-status-sel').value='draft';
  document.getElementById('ws1-date-completion').value=new Date().toISOString().slice(0,10);
  document.getElementById('ws1-reported-by').value=prof?.full_name||'';
  invTypeChange();
  invShowTab('ws1');
  var dBtn2=document.getElementById('inv-delete-btn');
  var sBtn2=document.getElementById('inv-safety-comm-btn');
  if(dBtn2)dBtn2.style.display='none';
  if(sBtn2)sBtn2.style.display='none';
  invShowForm();
}

async function invOpen(id){
  var inv=invAllData.find(function(x){return x.id===id;});
  if(!inv){
    // Reload
    try{var d=await api('/investigations?id=eq.'+id);inv=d&&d[0];}catch(e){}
  }
  if(!inv)return;
  invEditingId=id;
  invClearForm();
  document.getElementById('inv-form-title').textContent=inv.inv_ref||'Investigation';
  document.getElementById('inv-form-ref').textContent=inv.event_id?'Linked to event':'';
  document.getElementById('inv-type-sel').value=inv.inv_type||'basic';
  document.getElementById('inv-status-sel').value=inv.status||'draft';
  // Fill WS1 fields
  var flds={
    'ws1-reported-by':'reported_by','ws1-reported-title':'reported_by_title',
    'ws1-date-completion':'date_completion','ws1-inc-date':'incident_date',
    'ws1-inc-time':'incident_time','ws1-location':'incident_location',
    'ws1-description':'incident_description','ws1-nature-hs':'nature_hs',
    'ws1-conseq-hs':'consequences_hs','ws1-nature-env':'nature_env',
    'ws1-conseq-env':'consequences_env','ws1-nature-site':'nature_site',
    'ws1-conseq-site':'consequences_site','ws1-person-name':'person_name',
    'ws1-person-function':'person_function','ws1-person-start':'person_start_date',
    'ws1-witnesses':'witnesses','ws1-task-freq':'task_frequency',
    'ws1-work-type':'work_type','ws1-recurring-details':'recurring_details',
    'ws1-first-aid-details':'first_aid_details','ws1-immediate-actions':'immediate_actions',
    'ws1-ws2-resp':'ws2_resp_person',
    'ws2-interviewer':'ws2_interviewer','ws2-interviewer-title':'ws2_interviewer_title',
    'ws2-interviewee':'ws2_interviewee','ws2-interviewee-title':'ws2_interviewee_title',
    'ws2-date':'ws2_date','ws3-completed-by':'ws3_completed_by',
    'ws3-completed-title':'ws3_completed_title','ws3-participants':'ws3_participants',
    'ws3-date':'ws3_date','ws3-machines-explain':'ws3_machines_explain',
    'ws3-materials-explain':'ws3_materials_explain','ws3-environment-explain':'ws3_environment_explain',
    'inv-sign-investigator':'investigated_by','inv-sign-reviewer':'reviewed_by',
    'inv-sign-approver':'approved_by','inv-sign-inv-date':'investigated_date',
    'inv-sign-rev-date':'reviewed_date','inv-sign-app-date':'approved_date'
  };
  Object.entries(flds).forEach(function(e){
    var el=document.getElementById(e[0]);
    if(el&&inv[e[1]]!==null&&inv[e[1]]!==undefined)el.value=inv[e[1]];
  });
  var chks={'ws1-class-hs':'class_hs','ws1-class-env':'class_env','ws1-class-site':'class_site',
    'ws1-recurring':'recurring_event','ws1-first-aid':'first_aid_given','ws1-further':'further_analyses',
    'ws3-machines':'ws3_machines','ws3-materials':'ws3_materials','ws3-environment':'ws3_environment'};
  Object.entries(chks).forEach(function(e){
    var el=document.getElementById(e[0]);
    if(el)el.checked=!!inv[e[1]];
  });
  // Fill causes
  var causes=inv.immediate_causes||[];
  document.querySelectorAll('.ws1-cause').forEach(function(el,i){
    el.value=causes[i]||'';
  });
  // Fill WS1 CA
  var ws1cas=inv.ws1_corrective_actions||[];
  var ws1Body=document.getElementById('ws1-ca-body');
  if(ws1Body&&ws1cas.length){
    ws1Body.innerHTML='';
    ws1cas.forEach(function(ca,i){ws1Body.innerHTML+=invWS1CARow(i+1,ca);});
  }
  // Fill WS2 root causes
  var rcs=inv.ws2_root_causes||[];
  document.querySelectorAll('.ws2-rc').forEach(function(el,i){el.value=rcs[i]||'';});
  // Fill inv CA
  var cas=inv.corrective_actions||[];
  invRenderCA(cas);
  // Fill event link
  await invLoadEventsDrop();
  if(inv.event_id){var evSel=document.getElementById('ws1-event-link');if(evSel)evSel.value=inv.event_id;}
  invTypeChange();
  invShowTab('ws1');
  var dBtn=document.getElementById('inv-delete-btn');
  var sBtn=document.getElementById('inv-safety-comm-btn');
  if(dBtn)dBtn.style.display=isMgr()?'inline-flex':'none';
  if(sBtn)sBtn.style.display='inline-flex';
  invShowForm();
}

function invWS1CARow(num,ca){
  ca=ca||{};
  return '<tr><td style="padding:6px;color:var(--text2);font-weight:700;font-size:12px">'+num+'</td>'
    +'<td style="padding:4px"><input type="text" class="ws1-ca-desc" value="'+(ca.desc||'')+'" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"/></td>'
    +'<td style="padding:4px"><input type="text" class="ws1-ca-resp" value="'+(ca.resp||'')+'" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"/></td>'
    +'<td style="padding:4px"><input type="date" class="ws1-ca-date" value="'+(ca.date||'')+'" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"/></td>'
    +'<td style="padding:4px;text-align:center"><button onclick=\"this.parentNode.parentNode.remove()\" style="background:none;border:none;cursor:pointer;color:var(--red)"><i class="ti ti-x"></i></button></td></tr>';
}

function ws1AddCA(){
  var body=document.getElementById('ws1-ca-body');
  if(!body)return;
  var num=body.querySelectorAll('tr').length+1;
  body.innerHTML+=invWS1CARow(num,{});
}

function ws3AddRow(){
  var body=document.getElementById('ws3-five-why-body');
  if(!body)return;
  var num=body.querySelectorAll('tr').length+1;
  var cell='<td style="padding:4px;text-align:center;border:1px solid var(--border)"><input type="checkbox" class="ws3-v"></td><td style="padding:4px;border:1px solid var(--border)"><input type="text" class="ws3-why" style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px" placeholder="Why?"/></td>';
  var row='<tr class="ws3-why-row">'
    +'<td style="padding:6px;text-align:center;border:1px solid var(--border);font-weight:700;font-size:12px;color:var(--text2)">'+num+'</td>'
    +'<td style="padding:4px;border:1px solid var(--border)"><input type="text" class="ws3-cause-input" style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px" placeholder="Contributory cause..."/></td>'
    +cell+cell+cell+cell+cell
    +'<td style="padding:4px;text-align:center;border:1px solid var(--border)"><button onclick="this.parentNode.parentNode.remove()" style="background:none;border:none;cursor:pointer;color:var(--red)"><i class="ti ti-x"></i></button></td></tr>';
  body.innerHTML+=row;
}

function invAddCA(){
  var body=document.getElementById('inv-ca-body');
  var empty=document.getElementById('inv-ca-empty');
  if(!body)return;
  if(empty)empty.style.display='none';
  var num=body.querySelectorAll('tr').length+1;
  body.innerHTML+='<tr>'
    +'<td style="padding:6px;text-align:center;border:1px solid var(--border);font-weight:700;font-size:12px;color:var(--text2)">'+num+'</td>'
    +'<td style="padding:4px;border:1px solid var(--border)"><input type="text" class="ca-desc" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px" placeholder="Action description..."/></td>'
    +'<td style="padding:4px;border:1px solid var(--border)"><select class="ca-src" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"><option value="WS1">WS1</option><option value="WS2">WS2</option><option value="WS3">WS3</option><option value="General">General</option></select></td>'
    +'<td style="padding:4px;border:1px solid var(--border)"><input type="text" class="ca-resp" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px" placeholder="Responsible person..."/></td>'
    +'<td style="padding:4px;border:1px solid var(--border)"><input type="date" class="ca-date" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"/></td>'
    +'<td style="padding:4px;border:1px solid var(--border)"><select class="ca-prio" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select></td>'
    +'<td style="padding:4px;border:1px solid var(--border)"><select class="ca-status" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"><option value="open">Open</option><option value="in_progress">In progress</option><option value="closed">Closed</option></select></td>'
    +'<td style="padding:4px;text-align:center;border:1px solid var(--border)"><button onclick=\"this.parentNode.parentNode.remove()\" style="background:none;border:none;cursor:pointer;color:var(--red)"><i class="ti ti-x"></i></button></td></tr>';
}

function invRenderCA(cas){
  var body=document.getElementById('inv-ca-body');
  var empty=document.getElementById('inv-ca-empty');
  if(!body)return;
  body.innerHTML='';
  if(!cas||!cas.length){if(empty)empty.style.display='block';return;}
  if(empty)empty.style.display='none';
  cas.forEach(function(ca,i){
    body.innerHTML+='<tr>'
      +'<td style="padding:6px;text-align:center;border:1px solid var(--border);font-weight:700;font-size:12px;color:var(--text2)">'+(i+1)+'</td>'
      +'<td style="padding:4px;border:1px solid var(--border)"><input type="text" class="ca-desc" value="'+(ca.desc||'')+'" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"/></td>'
      +'<td style="padding:4px;border:1px solid var(--border)"><select class="ca-src" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"><option value="WS1"'+(ca.src==='WS1'?' selected':'')+'>WS1</option><option value="WS2"'+(ca.src==='WS2'?' selected':'')+'>WS2</option><option value="WS3"'+(ca.src==='WS3'?' selected':'')+'>WS3</option><option value="General"'+(ca.src==='General'?' selected':'')+'>General</option></select></td>'
      +'<td style="padding:4px;border:1px solid var(--border)"><input type="text" class="ca-resp" value="'+(ca.resp||'')+'" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"/></td>'
      +'<td style="padding:4px;border:1px solid var(--border)"><input type="date" class="ca-date" value="'+(ca.date||'')+'" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"/></td>'
      +'<td style="padding:4px;border:1px solid var(--border)"><select class="ca-prio" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"><option value="low"'+(ca.prio==='low'?' selected':'')+'>Low</option><option value="medium"'+(ca.prio==='medium'?' selected':'')+'>Medium</option><option value="high"'+(ca.prio==='high'?' selected':'')+'>High</option><option value="critical"'+(ca.prio==='critical'?' selected':'')+'>Critical</option></select></td>'
      +'<td style="padding:4px;border:1px solid var(--border)"><select class="ca-status" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"><option value="open"'+(ca.status==='open'?' selected':'')+'>Open</option><option value="in_progress"'+(ca.status==='in_progress'?' selected':'')+'>In progress</option><option value="closed"'+(ca.status==='closed'?' selected':'')+'>Closed</option></select></td>'
      +'<td style="padding:4px;text-align:center;border:1px solid var(--border)"><button onclick=\"this.parentNode.parentNode.remove()\" style="background:none;border:none;cursor:pointer;color:var(--red)"><i class="ti ti-x"></i></button></td></tr>';
  });
}

function invCollectData(){
  var g=function(id){var el=document.getElementById(id);return el?el.value||null:null;};
  var ch=function(id){var el=document.getElementById(id);return el?el.checked:false;};
  var causes=[];document.querySelectorAll('.ws1-cause').forEach(function(el){causes.push(el.value||'');});
  var ws1cas=[];document.querySelectorAll('#ws1-ca-body tr').forEach(function(tr){
    var desc=tr.querySelector('.ws1-ca-desc')?.value;
    if(desc)ws1cas.push({desc:desc,resp:tr.querySelector('.ws1-ca-resp')?.value||'',date:tr.querySelector('.ws1-ca-date')?.value||''});
  });
  var ws2qs=[];document.querySelectorAll('.ws2-q-row').forEach(function(row,i){
    var resp=row.querySelector('.ws2-q-resp')?.value||'';
    var cl=row.querySelector('input[type=radio]:checked')?.value||'';
    ws2qs.push({response:resp,classification:cl});
  });
  var rcs=[];document.querySelectorAll('.ws2-rc').forEach(function(el){rcs.push(el.value||'');});
  var cas=[];document.querySelectorAll('#inv-ca-body tr').forEach(function(tr){
    var desc=tr.querySelector('.ca-desc')?.value;
    if(desc)cas.push({desc:desc,src:tr.querySelector('.ca-src')?.value||'General',resp:tr.querySelector('.ca-resp')?.value||'',date:tr.querySelector('.ca-date')?.value||'',prio:tr.querySelector('.ca-prio')?.value||'medium',status:tr.querySelector('.ca-status')?.value||'open'});
  });
  var ws3rows=[];document.querySelectorAll('.ws3-why-row').forEach(function(tr){
    var cause=tr.querySelector('.ws3-cause-input')?.value||'';
    var whys=[];tr.querySelectorAll('.ws3-why').forEach(function(el){whys.push(el.value||'');});
    var vs=[];tr.querySelectorAll('.ws3-v').forEach(function(el){vs.push(el.checked);});
    if(cause||whys.some(function(w){return w;}))ws3rows.push({cause:cause,whys:whys,verify:vs});
  });
  return {
    company_id:prof?.company_id,
    inv_type:document.getElementById('inv-type-sel')?.value||'basic',
    status:document.getElementById('inv-status-sel')?.value||'draft',
    event_id:g('ws1-event-link')||null,
    reported_by:g('ws1-reported-by'),reported_by_title:g('ws1-reported-title'),
    date_completion:g('ws1-date-completion'),incident_date:g('ws1-inc-date'),
    incident_time:g('ws1-inc-time'),incident_location:g('ws1-location'),
    incident_description:g('ws1-description'),
    class_hs:ch('ws1-class-hs'),class_env:ch('ws1-class-env'),class_site:ch('ws1-class-site'),
    nature_hs:g('ws1-nature-hs'),consequences_hs:g('ws1-conseq-hs'),
    nature_env:g('ws1-nature-env'),consequences_env:g('ws1-conseq-env'),
    nature_site:g('ws1-nature-site'),consequences_site:g('ws1-conseq-site'),
    person_name:g('ws1-person-name'),person_function:g('ws1-person-function'),
    person_start_date:g('ws1-person-start'),contract_type:g('ws1-contract-type'),
    witnesses:g('ws1-witnesses'),task_frequency:g('ws1-task-freq'),
    work_type:g('ws1-work-type'),recurring_event:ch('ws1-recurring'),
    recurring_details:g('ws1-recurring-details'),first_aid_given:ch('ws1-first-aid'),
    first_aid_details:g('ws1-first-aid-details'),immediate_actions:g('ws1-immediate-actions'),
    immediate_causes:causes,ws1_corrective_actions:ws1cas,
    further_analyses:ch('ws1-further'),
    ws2_interviewer:g('ws2-interviewer'),ws2_interviewer_title:g('ws2-interviewer-title'),
    ws2_interviewee:g('ws2-interviewee'),ws2_interviewee_title:g('ws2-interviewee-title'),
    ws2_date:g('ws2-date'),ws2_questions:ws2qs,ws2_root_causes:rcs,
    ws3_completed_by:g('ws3-completed-by'),ws3_completed_title:g('ws3-completed-title'),
    ws3_participants:g('ws3-participants'),ws3_date:g('ws3-date'),
    ws3_machines:ch('ws3-machines'),ws3_machines_explain:g('ws3-machines-explain'),
    ws3_materials:ch('ws3-materials'),ws3_materials_explain:g('ws3-materials-explain'),
    ws3_environment:ch('ws3-environment'),ws3_environment_explain:g('ws3-environment-explain'),
    ws3_five_why:ws3rows,corrective_actions:cas,
    investigated_by:g('inv-sign-investigator'),reviewed_by:g('inv-sign-reviewer'),
    approved_by:g('inv-sign-approver'),investigated_date:g('inv-sign-inv-date'),
    reviewed_date:g('inv-sign-rev-date'),approved_date:g('inv-sign-app-date'),
    updated_at:new Date().toISOString()
  };
}

async function invDeleteCurrent(){
  if(!invEditingId)return;
  if(!confirm('Delete this investigation? This cannot be undone.'))return;
  try{
    await api('/investigations?id=eq.'+invEditingId,{m:'DELETE'});
    toast('Investigation deleted!');
    invEditingId=null;
    invShowList();
  }catch(e){toast(e.message,false);console.error(e);}
}

async function invDelete(id){
  if(!confirm('Delete this investigation? This cannot be undone.'))return;
  try{
    await api('/investigations?id=eq.'+id,{m:'DELETE'});
    invAllData=invAllData.filter(function(x){return x.id!==id;});
    toast('Investigation deleted!');
    loadInvs();
  }catch(e){toast(e.message,false);console.error(e);}
}


async function invSave(){
  var body=invCollectData();
  try{
    var savedId=invEditingId;
    if(invEditingId){
      await api('/investigations?id=eq.'+invEditingId,{m:'PATCH',p:'return=representation',b:body});
      toast('Investigation saved!');
    }else{
      var yr=new Date().getFullYear();
      body.inv_ref=await invGenRef(yr);
      body.created_by=prof?.id;
      var res=await api('/investigations',{m:'POST',p:'return=representation',b:body});
      savedId=res?.[0]?.id;
      toast('Investigation created!');
    }
    // Sync corrective actions to Master Action Plan
    if(savedId&&body.corrective_actions&&body.corrective_actions.length){
      await invSyncToMAP(savedId,body);
    }
  }catch(e){toast(e.message,false);console.error(e);}
}

async function invSyncToMAP(invId,body){
  try{
    // Delete old MAP entries for this investigation
    await api('/action_tracker?source_id=eq.'+invId+'&source_module=eq.investigation',{m:'DELETE'});
    // Re-create from current corrective actions
    var invRef=document.getElementById('inv-form-ref')?.textContent||'INV';
    var title=body.incident_location||body.incident_description||'Investigation';
    for(var i=0;i<body.corrective_actions.length;i++){
      var ca=body.corrective_actions[i];
      if(!ca.desc)continue;
      await api('/action_tracker',{m:'POST',p:'return=minimal',b:{
        company_id:prof?.company_id,
        source_module:'investigation',source_id:invId,
        source_ref:invRef+' ('+ca.src+')',
        description:ca.desc,
        responsible:ca.resp||null,
        target_date:ca.date||null,
        priority:ca.prio||'medium',
        status:ca.status||'open',
        created_by:prof?.id
      }});
    }
    toast('Corrective actions synced to Master Action Plan!');
  }catch(e){console.error('MAP sync error:',e);}
}

async function saveInv(){invSave();}


async function loadPermits(){
const el=document.getElementById('permits-list');
if(!el)return;
try{
const d=await api('/permits?select=*'+cf()+'&order=created_at.desc');
if(!d||!d.length){el.innerHTML='<p style="padding:20px;color:#666">No permits yet</p>';return;}
let h='<table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f9fafb"><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Permit No</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Type</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Location</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Status</th></tr></thead><tbody>';
for(var i=0;i<d.length;i++){var x=d[i];h+='<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:10px"><strong>'+(x.permit_number||'--')+'</strong></td><td style="padding:10px">'+(x.permit_type||'--')+'</td><td style="padding:10px">'+(x.location||'--')+'</td><td style="padding:10px">'+stat(x.status)+'</td></tr>';}
h+='</tbody></table>';if(el)el.innerHTML=h;
}catch(e){if(el)el.innerHTML='<p style="padding:20px;color:red">'+e.message+'</p>';console.error(e);}
}

async function savePermit(){
if(!isMgr()){toast('Access denied',false);return;}
try{
const cid=document.getElementById('pf-contractor').value,iid=document.getElementById('pf-issued').value,aid=document.getElementById('pf-approved').value;
await api('/permits',{m:'POST',p:'return=minimal',b:{company_id:prof?.company_id,permit_number:document.getElementById('pf-no').value,permit_type:document.getElementById('pf-type').value,work_description:document.getElementById('pf-desc').value,location:document.getElementById('pf-loc').value,contractor:cid?pname(cid):null,start_datetime:document.getElementById('pf-start').value||null,end_datetime:document.getElementById('pf-end').value||null,issued_by:iid?pname(iid):prof?.full_name,approved_by:aid?pname(aid):null,precautions:document.getElementById('pf-precautions').value,ppe_required:document.getElementById('pf-ppe').value,status:document.getElementById('pf-status').value,created_by:prof?.id}});
toggleForm('permit-form');toast('Permit saved!');loadPermits();loadDash();
}catch(e){toast(e.message,false);}
}
async function loadNoise(){
const el=document.getElementById('noise-list');
if(!el)return;
try{
const d=await api('/noise_surveys?select=*'+cf()+'&order=survey_date.desc');
if(!d||!d.length){el.innerHTML='<p style="padding:20px;color:#666">No noise surveys yet</p>';return;}
let h='<table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f9fafb"><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Date</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Type</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Site</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Conducted by</th></tr></thead><tbody>';
for(var i=0;i<d.length;i++){var x=d[i];var dt=x.survey_date?new Date(x.survey_date).toLocaleDateString('en-GB'):'--';h+='<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:10px">'+dt+'</td><td style="padding:10px">'+(x.survey_type||'--')+'</td><td style="padding:10px">'+(x.site||'--')+'</td><td style="padding:10px">'+(x.conducted_by||'--')+'</td></tr>';}
h+='</tbody></table>';if(el)el.innerHTML=h;
}catch(e){if(el)el.innerHTML='<p style="padding:20px;color:red">'+e.message+'</p>';console.error(e);}
}

async function saveNoise(){
try{
const bid=document.getElementById('nf-by').value;
await api('/noise_surveys',{m:'POST',p:'return=minimal',b:{company_id:prof?.company_id,survey_type:document.getElementById('nf-type').value,site:document.getElementById('nf-site').value,survey_date:document.getElementById('nf-date').value||null,conducted_by:bid?pname(bid):prof?.full_name,instrument_used:document.getElementById('nf-instrument').value,calibration_date:document.getElementById('nf-cal').value||null,weather_conditions:document.getElementById('nf-weather').value,notes:document.getElementById('nf-notes').value,created_by:prof?.id}});
toggleForm('noise-form');toast('Noise survey saved!');loadNoise();
}catch(e){toast(e.message,false);}
}
// ===== HSE MEETINGS MODULE =====
let mtgSeriesData=[], mtgMinutesData=[], mtgEditingSeriesId=null, mtgEditingMomId=null;

const MTG_TYPES={'management_review':'HSE Management Review','hse_committee':'HSE Committee Meeting','other':'Other Meeting'};
const MTG_RECURRENCE={'monthly':'Monthly','bimonthly':'Every 2 months','quarterly':'Quarterly','triannual':'Every 4 months','biannual':'Every 6 months','annual':'Annual'};

function mtgSwitchTab(tab, btn){
  document.querySelectorAll('[id^="mtg-tab-"]').forEach(function(t){t.classList.remove('active');});
  if(btn)btn.classList.add('active');
  document.getElementById('mtg-view-schedule').style.display=tab==='schedule'?'block':'none';
  document.getElementById('mtg-view-minutes').style.display=tab==='minutes'?'block':'none';
  if(tab==='schedule'){
    var c=document.getElementById('mtg-roadmap-container');
    if(c)c.innerHTML='<div class="loading-msg">Loading roadmap...</div>';
    mtgLoadSeries();
    setTimeout(function(){var c2=document.getElementById('mtg-roadmap-container');if(c2&&/Loading roadmap/i.test(c2.textContent||''))mtgLoadSeries();},300);
  }
  else mtgLoadMinutes();
}

// ── SCHEDULE (Series) ──────────────────────────────────────────────────────
// ===== LEGAL COMPLIANCE MODULE =====
let lrAllData=[], lcAllData=[], lrEditingId=null, lcEditingId=null;

const COMPLIANCE_STATUS={
  compliant:{label:'Compliant',bg:'#EAF3DE',col:'#3B6D11'},
  partial:{label:'Partial',bg:'#FEF9EC',col:'#854F0B'},
  non_compliant:{label:'Non-Compliant',bg:'#FCEBEB',col:'#A32D2D'},
  not_applicable:{label:'N/A',bg:'#f3f4f6',col:'#6B7280'}
};

function legalStatusBadge(s){
  var c=COMPLIANCE_STATUS[s]||COMPLIANCE_STATUS.partial;
  return '<span style="background:'+c.bg+';color:'+c.col+';padding:3px 9px;border-radius:99px;font-size:11px;font-weight:600">'+c.label+'</span>';
}

function legalSwitchTab(tab,btn){
  document.querySelectorAll('.mtg-tab').forEach(function(t){t.classList.remove('active');});
  btn.classList.add('active');
  document.getElementById('legal-view-register').style.display=tab==='register'?'block':'none';
  document.getElementById('legal-view-changes').style.display=tab==='changes'?'block':'none';
  document.getElementById('legal-view-dashboard').style.display=tab==='dashboard'?'block':'none';
  if(tab==='register')legalLoadRegister();
  else if(tab==='changes')legalLoadChanges();
  else legalRenderDashboard();
}

// ===== SOP GENERATOR MODULE =====
let sopVideo=null, sopFrames=[], sopEditingId=null, sopCurrentStep=1, sopAllData=[];
const ANTHROPIC_URL='https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL='claude-sonnet-4-20250514';

function sopSwitchTab(tab,btn){
  document.querySelectorAll('.mtg-tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('sop-view-list').style.display=tab==='list'?'block':'none';
  document.getElementById('sop-view-create').style.display=tab==='create'?'block':'none';
  if(tab==='list')sopLoadList();
}

async function loadSOP(){sopLoadList();}

async function sopLoadList(){
  var el=document.getElementById('sop-list-container');
  if(!el)return;
  try{
    var d=await api('/sop_documents?select=*'+cf()+'&order=created_at.desc');
    sopAllData=d||[];
    if(!d||!d.length){
      el.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--text2)">'
        +'<div style="font-size:48px;margin-bottom:16px">📄</div>'
        +'<div style="font-size:16px;font-weight:700;margin-bottom:8px">No SOPs yet</div>'
        +'<div style="font-size:13px;margin-bottom:20px">Create your first SOP by uploading a task demonstration video</div>'
        +'<button class="btn btn-primary" onclick="sopNew()"><i class="ti ti-plus"></i>Create first SOP</button>'
        +'</div>';
      return;
    }
    var h='<table style="width:100%;border-collapse:collapse">'
      +'<thead><tr style="background:#f9fafb">'
      +'<th style="padding:10px 16px;text-align:left;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">SOP Title</th>'
      +'<th style="padding:10px;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">Department</th>'
      +'<th style="padding:10px;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">Risk</th>'
      +'<th style="padding:10px;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">Version</th>'
      +'<th style="padding:10px;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">Author</th>'
      +'<th style="padding:10px;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">Status</th>'
      +'<th style="padding:10px;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">Date</th>'
      +'<th style="padding:10px;width:100px;border-bottom:1px solid var(--border)"></th>'
      +'</tr></thead><tbody>';
    d.forEach(function(x){
      var riskCol={Low:'var(--green)',Medium:'var(--amber)',High:'var(--red)',Critical:'#6B21A8'}[x.risk_level]||'var(--text2)';
      var stBadge=x.status==='Approved'?'<span class="badge bg">Approved</span>':x.status==='Review'?'<span class="badge ba">In Review</span>':'<span class="badge bgr">Draft</span>';
      var dt=x.created_at?new Date(x.created_at).toLocaleDateString('en-GB'):'—';
      h+='<tr style="border-bottom:1px solid #f3f4f6">'
        +'<td style="padding:10px 16px;font-weight:600">'+escH(x.title||'—')+'</td>'
        +'<td style="padding:10px;font-size:12px">'+escH(x.department||'—')+'</td>'
        +'<td style="padding:10px"><span style="color:'+riskCol+';font-weight:600;font-size:12px">'+escH(x.risk_level||'—')+'</span></td>'
        +'<td style="padding:10px;font-size:12px">'+escH(x.version||'Rev 00')+'</td>'
        +'<td style="padding:10px;font-size:12px">'+escH(x.author||'—')+'</td>'
        +'<td style="padding:10px">'+stBadge+'</td>'
        +'<td style="padding:10px;font-size:12px">'+dt+'</td>'
        +'<td style="padding:10px"><div style="display:flex;gap:4px">'
        +'<button class="btn btn-sm" title="View" data-id="'+x.id+'" onclick="sopView(this.getAttribute(\'data-id\'))"><i class="ti ti-eye"></i></button>'
        +'<button class="btn btn-sm" title="Print" data-id="'+x.id+'" onclick="sopPrintById(this.getAttribute(\'data-id\'))"><i class="ti ti-printer"></i></button>'
        +(isMgr()?'<button class="btn btn-sm" style="color:var(--red)" title="Delete" data-id="'+x.id+'" onclick="sopDelete(this.getAttribute(\'data-id\'))"><i class="ti ti-trash"></i></button>':'')
        +'</div></td></tr>';
    });
    h+='</tbody></table>';
    if(el)el.innerHTML=h;
  }catch(e){if(el)el.innerHTML='<p style="padding:20px;color:red">'+e.message+'</p>';console.error(e);}
}

function sopNew(){
  sopVideo=null; sopFrames=[]; sopEditingId=null; sopCurrentStep=1;
  // Reset form
  ['sop-title','sop-dept','sop-author','sop-desc','sop-ppe-extra'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('sop-revision').value='Rev 00';
  document.getElementById('sop-risk').value='Medium';
  document.getElementById('sop-date').value='';
  document.querySelectorAll('#sop-ppe-list input[type=checkbox]').forEach(function(c){c.checked=false;});
  var vp=document.getElementById('sop-video-preview');if(vp){vp.style.display='none';vp.src='';}
  var vi=document.getElementById('sop-video-info');if(vi)vi.textContent='';
  var fb=document.getElementById('sop-to-frames-btn');if(fb)fb.style.display='none';
  var dz=document.getElementById('sop-drop-zone');if(dz)dz.style.borderColor='var(--border)';
  document.getElementById('sop-frames-container').innerHTML='';
  document.getElementById('sop-preview-container').innerHTML='';
  // Auto-fill author
  var au=document.getElementById('sop-author');if(au&&prof)au.value=prof.full_name||'';
  sopGoStep(1);
  // Switch to create tab
  sopSwitchTab('create', document.getElementById('sop-tab-create'));
}

function sopGoStep(n){
  for(var i=1;i<=5;i++){
    var panel=document.getElementById('sop-step-'+i);
    if(panel)panel.style.display=i===n?'block':'none';
    var dot=document.getElementById('sop-dot-'+i);
    if(dot){
      dot.className='sop-step-dot'+(i<n?' done':i===n?' active':'');
    }
  }
  sopCurrentStep=n;
  // Update progress bar
  var bar=document.getElementById('sop-step-bar');
  if(bar)bar.style.width=((n-1)/4*80)+'%';
}

function sopNextStep(from){
  if(from===1){
    if(!document.getElementById('sop-title').value.trim()){toast('Please enter an SOP title',false);return;}
    sopGoStep(2);
  }else if(from===3){
    var steps=document.querySelectorAll('.sop-frame-narration');
    var hasNarration=false;
    steps.forEach(function(el){if(el.value.trim())hasNarration=true;});
    if(!hasNarration){toast('Please add narration for at least one step',false);return;}
    sopGoStep(4);
    sopGenerate();
  }
}

// ── VIDEO HANDLING ────────────────────────────────────────────────────────────
function sopHandleDrop(e){
  e.preventDefault();
  var file=e.dataTransfer.files[0];
  if(file&&file.type.startsWith('video/'))sopLoadVideo(file);
}

function sopLoadVideo(file){
  if(!file)return;
  sopVideo=file;
  var url=URL.createObjectURL(file);
  var vp=document.getElementById('sop-video-preview');
  vp.src=url; vp.style.display='block';
  document.getElementById('sop-video-info').textContent=file.name+' ('+Math.round(file.size/1024/1024*10)/10+'MB)';
  document.getElementById('sop-to-frames-btn').style.display='inline-flex';
  var dz=document.getElementById('sop-drop-zone');
  dz.style.borderColor='var(--green)';
  document.getElementById('sop-drop-label').innerHTML='<i class="ti ti-check" style="font-size:24px;color:var(--green)"></i><div style="margin-top:6px;font-weight:600;color:var(--green)">Video loaded!</div>';
}

async function sopExtractFrames(){
  if(!sopVideo){toast('Please upload a video first',false);return;}
  sopGoStep(3);
  var container=document.getElementById('sop-frames-container');
  container.innerHTML='<div style="text-align:center;padding:30px;color:var(--text2)"><i class="ti ti-loader" style="font-size:24px"></i><br>Extracting frames...</div>';

  var video=document.createElement('video');
  video.src=URL.createObjectURL(sopVideo);
  video.muted=true;

  await new Promise(function(resolve){
    video.onloadedmetadata=function(){resolve();};
  });

  var duration=video.duration;
  // Extract up to 12 frames evenly spaced — but skip first and last 2 seconds
  var start=Math.min(2,duration*0.05);
  var end=Math.max(duration-2,duration*0.95);
  var numFrames=Math.min(12,Math.max(4,Math.floor(duration/15)));
  var times=[];
  for(var i=0;i<numFrames;i++){
    times.push(start+(end-start)*i/(numFrames-1));
  }

  sopFrames=[];
  var canvas=document.createElement('canvas');
  canvas.width=640; canvas.height=360;
  var ctx=canvas.getContext('2d');

  for(var ti=0;ti<times.length;ti++){
    var t=times[ti];
    await new Promise(function(resolve){
      video.currentTime=t;
      video.onseeked=function(){
        ctx.drawImage(video,0,0,640,360);
        var dataUrl=canvas.toDataURL('image/jpeg',0.7);
        sopFrames.push({time:t,dataUrl:dataUrl,narration:''});
        resolve();
      };
    });
  }

  sopRenderFrames();
  document.getElementById('sop-frame-count').textContent=sopFrames.length+' frames extracted';
}

function sopRenderFrames(){
  var container=document.getElementById('sop-frames-container');
  if(!container)return;
  container.innerHTML='';
  if(!sopFrames.length){
    container.innerHTML='<div style="padding:20px;text-align:center;color:var(--text2);font-size:13px">No frames yet. Upload a video to extract frames automatically.</div>';
    return;
  }
  sopFrames.forEach(function(frame,i){
    var mins=frame.time?Math.floor(frame.time/60):0;
    var secs=frame.time?Math.floor(frame.time%60):0;
    var timeStr=frame.time?(mins+'m '+secs+'s'):'Manual step';
    var card=document.createElement('div');
    card.style.cssText='display:grid;grid-template-columns:220px 1fr;gap:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:12px;background:#fff';
    // Left: image
    var imgWrap=document.createElement('div');
    imgWrap.style.cssText='position:relative;background:#000';
    if(frame.dataUrl){
      var img=document.createElement('img');
      img.src=frame.dataUrl;
      img.style.cssText='width:100%;height:140px;object-fit:cover;display:block';
      imgWrap.appendChild(img);
    }else{
      var noImg=document.createElement('div');
      noImg.style.cssText='width:100%;height:140px;display:flex;align-items:center;justify-content:center;color:#666;font-size:12px;background:#f3f4f6';
      noImg.textContent='No image';
      imgWrap.appendChild(noImg);
    }
    var timeBadge=document.createElement('span');
    timeBadge.style.cssText='position:absolute;bottom:6px;left:6px;background:rgba(0,0,0,.7);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px';
    timeBadge.textContent=timeStr;
    imgWrap.appendChild(timeBadge);
    var numBadge=document.createElement('span');
    numBadge.style.cssText='position:absolute;top:6px;left:6px;background:var(--green);color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px';
    numBadge.textContent='Step '+(i+1);
    imgWrap.appendChild(numBadge);
    var delBtn=document.createElement('button');
    delBtn.style.cssText='position:absolute;top:6px;right:6px;background:rgba(220,38,38,.85);border:none;color:#fff;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px';
    delBtn.innerHTML='<i class="ti ti-x"></i>';
    delBtn.onclick=function(){sopRemoveFrame(i);};
    imgWrap.appendChild(delBtn);
    card.appendChild(imgWrap);
    // Right: narration
    var right=document.createElement('div');
    right.style.cssText='padding:12px 16px;display:flex;flex-direction:column;gap:8px';
    var label=document.createElement('label');
    label.style.cssText='font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text2);display:block';
    label.textContent='Step '+(i+1)+' — What are you doing in this step?';
    var ta=document.createElement('textarea');
    ta.className='sop-frame-narration';
    ta.setAttribute('data-idx', i);
    ta.style.cssText='width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;min-height:90px;resize:vertical;font-family:inherit';
    ta.placeholder='Describe this step: what you are doing, how to do it safely, key points to watch out for...';
    ta.value=frame.narration||'';
    ta.oninput=function(){sopFrames[parseInt(this.getAttribute('data-idx'))].narration=this.value;};
    var hazardLabel=document.createElement('label');
    hazardLabel.style.cssText='font-size:11px;font-weight:700;text-transform:uppercase;color:var(--red);display:block';
    hazardLabel.textContent='Hazards & risks';
    var hazardInput=document.createElement('input');
    hazardInput.type='text';
    hazardInput.className='sop-frame-hazard';
    hazardInput.setAttribute('data-idx', i);
    hazardInput.style.cssText='width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px';
    hazardInput.placeholder='e.g. Flying debris, crush injury, electrical hazard...';
    hazardInput.value=frame.hazard||'';
    hazardInput.oninput=function(){sopFrames[parseInt(this.getAttribute('data-idx'))].hazard=this.value;};
    right.appendChild(label);
    right.appendChild(ta);
    right.appendChild(hazardLabel);
    right.appendChild(hazardInput);
    card.appendChild(right);
    container.appendChild(card);
  });
}


function sopRemoveFrame(idx){
  sopFrames.splice(idx,1);
  sopRenderFrames();
  document.getElementById('sop-frame-count').textContent=sopFrames.length+' frames';
}

function sopAddManualStep(){
  sopFrames.push({time:null,dataUrl:null,narration:''});
  sopRenderFrames();
}

// ── AI GENERATION ─────────────────────────────────────────────────────────────
async function sopGenerate(){
  var setStatus=function(pct,msg){
    var bar=document.getElementById('sop-gen-bar');
    var stat=document.getElementById('sop-gen-status');
    if(bar)bar.style.width=pct+'%';
    if(stat)stat.textContent=msg;
  };

  // Collect narrations from DOM
  document.querySelectorAll('.sop-frame-narration').forEach(function(el){
    var idx=parseInt(el.dataset.idx);
    if(sopFrames[idx])sopFrames[idx].narration=el.value;
  });

  var title=document.getElementById('sop-title').value;
  var dept=document.getElementById('sop-dept').value;
  var risk=document.getElementById('sop-risk').value;
  var desc=document.getElementById('sop-description').value;
  var author=document.getElementById('sop-author').value;
  var version=document.getElementById('sop-revision').value;
  var reviewDate=document.getElementById('sop-date').value;
  var ppeChecked=Array.from(document.querySelectorAll('#sop-ppe-checks input:checked')).map(function(c){return c.value;});
  var ppeExtra=document.getElementById('sop-ppe-extra').value;
  var allPPE=ppeChecked.concat(ppeExtra?[ppeExtra]:[]).join(', ')||'As per risk assessment';

  setStatus(10,'Preparing content for AI...');

  // Build messages with images + narrations
  var stepsContent=[];
  sopFrames.forEach(function(f,i){
    if(f.narration){
      stepsContent.push({type:'text',text:'STEP '+(i+1)+' NARRATION: '+f.narration});
    }
    if(f.dataUrl){
      var b64=f.dataUrl.split(',')[1];
      stepsContent.push({type:'image',source:{type:'base64',media_type:'image/jpeg',data:b64}});
    }
  });

  var systemPrompt='You are an expert HSE professional writing a Standard Operating Procedure (SOP). Write a complete, professional SOP document based on the task video frames and narrations provided. Return ONLY a valid JSON object with this exact structure (no markdown, no code blocks, no preamble): {"purpose":"string","responsibilities":[{"role":"string","duty":"string"}],"hazards":[{"hazard":"string","risk":"string","control":"string"}],"steps":[{"step_number":1,"title":"string","description":"string","safety_notes":"string","has_image":true}],"emergency":"string","related_docs":["string"],"definitions":[{"term":"string","definition":"string"}]}';

  var taskIntro='Generate a complete SOP for the following task:\n\nTitle: '+title+'\nDepartment: '+dept+'\nRisk Level: '+risk+'\nDescription: '+desc+'\nPPE Required: '+allPPE+'\n\nBelow are the video frames with narrations from the person demonstrating the task:';
  var userContent=[{type:'text',text:taskIntro}].concat(stepsContent).concat([{type:'text',text:'Write a professional, detailed SOP. Each step should align with the frame image and narration provided. Include all safety warnings. Be specific and practical.'}]);

  setStatus(30,'Sending to Claude AI...');

  try{
    var response=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'claude-sonnet-4-20250514',
        max_tokens:4000,
        system:systemPrompt,
        messages:[{role:'user',content:userContent}]
      })
    });

    setStatus(70,'Processing AI response...');

    var data=await response.json();
    if(data.error){throw new Error(data.error.message||'API error');}

    var text=data.content&&data.content[0]&&data.content[0].text;
    if(!text)throw new Error('No response from AI');

    // Parse JSON - strip any markdown fences
    text=text.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim();
    var parsed=JSON.parse(text);

    setStatus(90,'Building SOP document...');

    // Build the SOP with embedded images
    sopBuildPreview(parsed,{title,dept,risk,author,version,reviewDate,ppe:allPPE});

    setStatus(100,'Done!');
    document.getElementById('sop-gen-icon').textContent='✅';
    document.getElementById('sop-gen-title').textContent='SOP Generated!';
    document.getElementById('sop-gen-subtitle').textContent='Your SOP is ready to review and edit.';

    setTimeout(function(){sopShowPreview();},1000);

  }catch(e){
    console.error(e);
    document.getElementById('sop-gen-icon').textContent='❌';
    document.getElementById('sop-gen-title').textContent='Generation failed';
    document.getElementById('sop-gen-subtitle').textContent=e.message;
    toast('AI generation failed: '+e.message,false);
  }
}

function sopBuildPreview(data,meta){
  var container=document.getElementById('sop-preview-container');
  var today=new Date().toLocaleDateString('en-GB');
  var reviewDt=meta.reviewDate?new Date(meta.reviewDate).toLocaleDateString('en-GB'):'—';
  var riskCol={Low:'#1D9E75',Medium:'#EF9F27',High:'#E24B4A',Critical:'#6B21A8'}[meta.risk]||'#EF9F27';

  var stepsHtml='';
  (data.steps||[]).forEach(function(step,i){
    var frame=sopFrames[i];
    var imgHtml='';
    if(frame&&frame.dataUrl){
      imgHtml='<div style="margin:10px 0"><img src="'+frame.dataUrl+'" style="max-width:100%;border-radius:8px;border:1px solid #e5e7eb;box-shadow:0 1px 4px rgba(0,0,0,.1)"/><div style="font-size:10px;color:#6b7280;margin-top:4px;text-align:center;font-style:italic">Figure '+(i+1)+' — '+escH(step.title||'')+'</div></div>';
    }
    stepsHtml+='<div style="margin-bottom:20px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">'
      +'<div style="background:#1a3a5c;color:#fff;padding:10px 16px;display:flex;align-items:center;gap:12px">'
      +'<span style="background:rgba(255,255,255,.2);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0">'+(step.step_number||i+1)+'</span>'
      +'<span style="font-weight:700;font-size:14px">'+escH(step.title||'')+'</span>'
      +'</div>'
      +'<div style="padding:14px 16px">'
      +imgHtml
      +'<p style="margin:0 0 10px;font-size:13px;line-height:1.7;color:#374151">'+escH(step.description||'')+'</p>'
      +(step.safety_notes?'<div style="background:#FEF9EC;border-left:3px solid #EF9F27;padding:8px 12px;border-radius:0 6px 6px 0;font-size:12px;color:#854F0B"><i class="ti ti-alert-triangle"></i> <strong>Safety note:</strong> '+escH(step.safety_notes)+'</div>':'')
      +'</div></div>';
  });

  var hazardsHtml='';
  (data.hazards||[]).forEach(function(h){
    hazardsHtml+='<tr><td style="padding:8px 12px;border:1px solid #e5e7eb">'+escH(h.hazard||'')+'</td>'
      +'<td style="padding:8px 12px;border:1px solid #e5e7eb;color:#E24B4A">'+escH(h.risk||'')+'</td>'
      +'<td style="padding:8px 12px;border:1px solid #e5e7eb;color:#1D9E75">'+escH(h.control||'')+'</td></tr>';
  });

  var responsibilitiesHtml=(data.responsibilities||[]).map(function(r){
    return '<li style="margin-bottom:6px"><strong>'+escH(r.role||'')+':</strong> '+escH(r.duty||'')+'</li>';
  }).join('');

  var html='<div id="sop-printable" style="font-family:Arial,sans-serif;color:#1a1a1a;max-width:900px;margin:0 auto;padding:0">'

    // Header banner
    +'<div style="background:#1a3a5c;color:#fff;padding:24px 32px;display:flex;align-items:center;justify-content:space-between">'
    +'<div><div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;opacity:.7;margin-bottom:4px">Standard Operating Procedure</div>'
    +'<div style="font-size:22px;font-weight:800;line-height:1.2" contenteditable="true" id="sop-edit-title">'+escH(meta.title||'')+'</div></div>'
    +'<div style="text-align:right;font-size:11px;opacity:.8">'
    +'<div>Version: '+escH(meta.version||'Rev 00')+'</div>'
    +'<div>Date: '+today+'</div>'
    +'<div>Review: '+reviewDt+'</div>'
    +'</div></div>'

    // Info bar
    +'<div style="display:grid;grid-template-columns:repeat(4,1fr);background:#f0f4f8;border-bottom:2px solid #dde3ea">'
    +'<div style="padding:12px 16px;border-right:1px solid #dde3ea"><div style="font-size:10px;text-transform:uppercase;color:#6b7280;font-weight:600">Department</div><div style="font-size:13px;font-weight:600;margin-top:2px">'+escH(meta.dept||'—')+'</div></div>'
    +'<div style="padding:12px 16px;border-right:1px solid #dde3ea"><div style="font-size:10px;text-transform:uppercase;color:#6b7280;font-weight:600">Risk Level</div><div style="font-size:13px;font-weight:700;margin-top:2px;color:'+riskCol+'">'+escH(meta.risk||'—')+'</div></div>'
    +'<div style="padding:12px 16px;border-right:1px solid #dde3ea"><div style="font-size:10px;text-transform:uppercase;color:#6b7280;font-weight:600">Prepared by</div><div style="font-size:13px;font-weight:600;margin-top:2px">'+escH(meta.author||'—')+'</div></div>'
    +'<div style="padding:12px 16px"><div style="font-size:10px;text-transform:uppercase;color:#6b7280;font-weight:600">PPE Required</div><div style="font-size:12px;font-weight:600;margin-top:2px;color:#E24B4A">'+escH(meta.ppe||'See risk assessment')+'</div></div>'
    +'</div>'

    +'<div style="padding:24px 32px">'

    // Purpose
    +'<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#1a3a5c;border-bottom:2px solid #1a3a5c;padding-bottom:6px;margin:0 0 12px">1. Purpose & Scope</h3>'
    +'<p style="font-size:13px;line-height:1.7;margin:0 0 20px;color:#374151" contenteditable="true">'+escH(data.purpose||'')+'</p>'

    // Responsibilities
    +(responsibilitiesHtml?'<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#1a3a5c;border-bottom:2px solid #1a3a5c;padding-bottom:6px;margin:0 0 12px">2. Responsibilities</h3>'
    +'<ul style="font-size:13px;line-height:1.7;margin:0 0 20px;padding-left:20px;color:#374151">'+responsibilitiesHtml+'</ul>':'')

    // Hazard summary
    +(hazardsHtml?'<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#1a3a5c;border-bottom:2px solid #1a3a5c;padding-bottom:6px;margin:0 0 12px">3. Key Hazards & Controls</h3>'
    +'<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px"><thead><tr style="background:#f0f4f8"><th style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left">Hazard</th><th style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left">Risk</th><th style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left">Control</th></tr></thead><tbody>'+hazardsHtml+'</tbody></table>':'')

    // Steps
    +'<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#1a3a5c;border-bottom:2px solid #1a3a5c;padding-bottom:6px;margin:0 0 16px">4. Step-by-Step Procedure</h3>'
    +stepsHtml

    // Emergency
    +(data.emergency?'<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#E24B4A;border-bottom:2px solid #E24B4A;padding-bottom:6px;margin:20px 0 12px">5. Emergency Procedures</h3>'
    +'<div style="background:#FCEBEB;border-left:4px solid #E24B4A;padding:12px 16px;border-radius:0 8px 8px 0;font-size:13px;color:#374151;margin-bottom:20px">'+escH(data.emergency)+'</div>':'')

    // Sign-off
    +'<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#1a3a5c;border-bottom:2px solid #1a3a5c;padding-bottom:6px;margin:20px 0 12px">6. Sign-off & Approval</h3>'
    +'<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px"><thead><tr style="background:#f0f4f8"><th style="padding:10px 14px;border:1px solid #e5e7eb;text-align:left">Role</th><th style="padding:10px 14px;border:1px solid #e5e7eb;text-align:left">Name</th><th style="padding:10px 14px;border:1px solid #e5e7eb;text-align:left">Signature</th><th style="padding:10px 14px;border:1px solid #e5e7eb;text-align:left">Date</th></tr></thead>'
    +'<tbody><tr><td style="padding:16px 14px;border:1px solid #e5e7eb">Prepared by</td><td style="padding:16px 14px;border:1px solid #e5e7eb">'+escH(meta.author||'')+'</td><td style="padding:16px 14px;border:1px solid #e5e7eb"></td><td style="padding:16px 14px;border:1px solid #e5e7eb">'+today+'</td></tr>'
    +'<tr><td style="padding:16px 14px;border:1px solid #e5e7eb">Reviewed by</td><td style="padding:16px 14px;border:1px solid #e5e7eb"></td><td style="padding:16px 14px;border:1px solid #e5e7eb"></td><td style="padding:16px 14px;border:1px solid #e5e7eb"></td></tr>'
    +'<tr><td style="padding:16px 14px;border:1px solid #e5e7eb">Approved by</td><td style="padding:16px 14px;border:1px solid #e5e7eb"></td><td style="padding:16px 14px;border:1px solid #e5e7eb"></td><td style="padding:16px 14px;border:1px solid #e5e7eb"></td></tr></tbody></table>'

    +'</div></div>';

  container.innerHTML=html;

  // Store generated data for saving
  window.sopGeneratedData={meta,aiData:data,framesCount:sopFrames.length};
}

// ── PRINT ──────────────────────────────────────────────────────────────────
function sopPrint(){
  var el=document.getElementById('sop-printable');
  if(!el){toast('No SOP to print',false);return;}
  var w=window.open('','_blank');
  w.document.write('<!DOCTYPE html><html><head><title>SOP — '+(window.sopGeneratedData?.meta?.title||'')+'</title>'
    +'<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css">'
    +'<style>body{margin:0;padding:20px;font-family:Arial,sans-serif}@media print{body{padding:0}}[contenteditable]{outline:none}</style>'
    +'</head><body>'+el.outerHTML
    +'<scr'+'ipt>window.onload=function(){window.print();}<'+'/scr'+'ipt>'
    +'</body></html>');
  w.document.close();
}

async function sopPrintById(id){
  var sop=sopAllData.find(function(x){return x.id===id;});
  if(!sop||!sop.html_content){toast('SOP content not found',false);return;}
  var w=window.open('','_blank');
  w.document.write('<!DOCTYPE html><html><head><title>SOP</title>'
    +'<style>body{margin:20px;font-family:Arial,sans-serif}@media print{body{margin:0}}</style>'
    +'</head><body>'+sop.html_content
    +'<scr'+'ipt>window.onload=function(){window.print();}<'+'/scr'+'ipt></body></html>');
  w.document.close();
}

async function sopView(id){
  var sop=sopAllData.find(function(x){return x.id===id;});
  if(!sop){return;}
  // Restore to step 5
  sopSwitchTab('create',document.getElementById('sop-tab-create'));
  sopGoStep(5);
  var el=document.getElementById('sop-preview-container');
  if(el)el.innerHTML=sop.html_content||'<p style="padding:20px;color:var(--text2)">No preview available</p>';
  window.sopGeneratedData={meta:{title:sop.title}};
}

// ── SAVE ──────────────────────────────────────────────────────────────────
async function sopSaveDocument(){
  if(!window.sopGeneratedData){toast('Generate an SOP first',false);return;}
  var el=document.getElementById('sop-printable');
  if(!el){toast('No SOP content to save',false);return;}
  var meta=window.sopGeneratedData.meta;
  var body={
    company_id:prof?.company_id,
    title:meta.title,
    department:meta.dept,
    risk_level:meta.risk,
    author:meta.author,
    version:meta.version,
    review_date:meta.reviewDate||null,
    status:'Draft',
    html_content:el.outerHTML,
    created_by:prof?.id,
    updated_at:new Date().toISOString()
  };
  try{
    await api('/sop_documents',{m:'POST',p:'return=minimal',b:body});
    toast('SOP saved to Document Control!');
    sopSwitchTab('list',document.getElementById('sop-tab-list'));
  }catch(e){toast(e.message,false);console.error(e);}
}

async function sopDelete(id){
  if(!confirm('Delete this SOP?'))return;
  try{
    await api('/sop_documents?id=eq.'+id,{m:'DELETE'});
    toast('SOP deleted!');
    sopLoadList();
  }catch(e){toast(e.message,false);}
}

async function loadLegal(){
  var addBtn=document.getElementById('lr-add-btn');
  var lcBtn=document.getElementById('lc-add-btn');
  if(addBtn)addBtn.style.display=isMgr()?'inline-flex':'none';
  if(lcBtn)lcBtn.style.display=isMgr()?'inline-flex':'none';
  legalLoadRegister();
}

// ── LEGAL REGISTER ──────────────────────────────────────────────────────────
async function legalLoadRegister(){
  var el=document.getElementById('lr-table');
  if(!el)return;
  try{
    var d=await api('/legal_register?select=*'+cf()+'&order=no_order,legislation_main,section');
    lrAllData=d||[];
    // Update metrics
    var setEl=function(id,v){var e=document.getElementById(id);if(e)e.textContent=v;};
    setEl('lr-m-total',lrAllData.length);
    setEl('lr-m-compliant',lrAllData.filter(function(x){return x.compliance_status==='compliant';}).length);
    setEl('lr-m-partial',lrAllData.filter(function(x){return x.compliance_status==='partial';}).length);
    setEl('lr-m-noncompliant',lrAllData.filter(function(x){return x.compliance_status==='non_compliant';}).length);
    // Populate legislation filter
    var legSel=document.getElementById('lr-filter-leg');
    if(legSel){
      var legs=[...new Set(lrAllData.map(function(x){return x.legislation_main;}).filter(Boolean))];
      legSel.innerHTML='<option value="">All legislation</option>'+legs.map(function(l){return '<option value="'+escH(l)+'">'+escH(l)+'</option>';}).join('');
    }
    legalFilterRegister();
  }catch(e){if(el)el.innerHTML='<p style="padding:20px;color:red">'+e.message+'</p>';console.error(e);}
}

function legalFilterRegister(){
  var search=(document.getElementById('lr-search')?.value||'').toLowerCase();
  var filterStatus=document.getElementById('lr-filter-status')?.value||'';
  var filterLeg=document.getElementById('lr-filter-leg')?.value||'';
  var el=document.getElementById('lr-table');
  if(!el)return;

  var filtered=lrAllData.filter(function(x){
    var matchSearch=!search||
      (x.legislation_main||'').toLowerCase().includes(search)||
      (x.requirement||'').toLowerCase().includes(search)||
      (x.legislation_title||'').toLowerCase().includes(search);
    var matchStatus=!filterStatus||x.compliance_status===filterStatus;
    var matchLeg=!filterLeg||x.legislation_main===filterLeg;
    return matchSearch&&matchStatus&&matchLeg;
  });

  if(!filtered.length){
    el.innerHTML='<p style="padding:20px;color:var(--text2)">No requirements found.'+(isMgr()?' <button class="btn btn-sm btn-primary" onclick="legalNewRequirement()"><i class="ti ti-plus"></i>Add first requirement</button>':'')+'</p>';
    return;
  }

  // Group by legislation
  var byLeg={};
  filtered.forEach(function(x){
    var key=x.legislation_main||'Other';
    if(!byLeg[key])byLeg[key]=[];
    byLeg[key].push(x);
  });

  var html='<table style="width:100%;border-collapse:collapse;font-size:12px">';
  html+='<thead><tr style="background:#1a3a5c;color:#fff">';
  html+='<th style="padding:8px 10px;text-align:left;width:40px">No.</th>';
  html+='<th style="padding:8px 10px;text-align:left;width:80px">Section</th>';
  html+='<th style="padding:8px 10px;text-align:left">Requirement</th>';
  html+='<th style="padding:8px 10px;text-align:left;width:120px">Controls in place</th>';
  html+='<th style="padding:8px 10px;text-align:center;width:80px">App.</th>';
  html+='<th style="padding:8px 10px;text-align:left;width:130px">Status</th>';
  html+='<th style="padding:8px 10px;text-align:left;width:120px">Responsibility</th>';
  html+='<th style="padding:8px 10px;width:70px"></th>';
  html+='</tr></thead><tbody>';

  Object.entries(byLeg).forEach(function(e){
    var leg=e[0], reqs=e[1];
    html+='<tr><td colspan="8" style="padding:8px 12px;background:#f0f4f8;font-weight:700;font-size:11px;color:#1a3a5c;border-bottom:2px solid #dde3ea;text-transform:uppercase;letter-spacing:.04em">'+escH(leg)+'</td></tr>';
    reqs.forEach(function(x,i){
      var hasGap=x.gap_identified?'<span style="background:#FCEBEB;color:#A32D2D;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:4px">GAP</span>':'';
      var rowBg=i%2===0?'#fff':'#f9fafb';
      var req=(x.requirement||'').substring(0,120)+(x.requirement&&x.requirement.length>120?'...':'');
      html+='<tr style="border-bottom:1px solid #f0f0f0;background:'+rowBg+'">';
      html+='<td style="padding:8px 10px;color:var(--text2);font-weight:600">'+(x.no_order||'')+'</td>';
      html+='<td style="padding:8px 10px;font-weight:600">'+(x.section||'')+(x.sub_section?'.'+x.sub_section:'')+'</td>';
      html+='<td style="padding:8px 10px"><div style="font-weight:600;margin-bottom:2px">'+escH(x.legislation_title||'')+hasGap+'</div><div style="color:var(--text2);font-size:11px;line-height:1.4">'+escH(req)+'</div></td>';
      html+='<td style="padding:8px 10px;font-size:11px;color:var(--text2)">'+escH((x.controls_in_place||'').substring(0,80))+'</td>';
      html+='<td style="padding:8px 10px;text-align:center">'+(x.applicable?'<span style="color:var(--green);font-weight:700">Y</span>':'<span style="color:var(--text2)">N</span>')+'</td>';
      html+='<td style="padding:8px 10px">'+legalStatusBadge(x.compliance_status)+'</td>';
      html+='<td style="padding:8px 10px;font-size:11px">'+(x.responsibility||'—')+'</td>';
      html+='<td style="padding:8px 10px"><div style="display:flex;gap:4px">';
      html+='<button class="btn btn-sm" title="Edit" data-id="'+x.id+'" onclick="legalOpenReq(this.getAttribute(\'data-id\'))"><i class="ti ti-edit"></i></button>';
      if(isMgr())html+='<button class="btn btn-sm" title="Delete" style="color:var(--red)" data-id="'+x.id+'" onclick="legalDeleteReqFromList(this.getAttribute(\'data-id\'))"><i class="ti ti-trash"></i></button>';
      html+='</div></td>';
      html+='</tr>';
    });
  });
  html+='</tbody></table>';
  el.innerHTML=html;
}

// ── REQUIREMENT FORM ─────────────────────────────────────────────────────────
function legalShowReqForm(){
  document.getElementById('legal-view-register').style.display='none';
  document.getElementById('legal-view-changes').style.display='none';
  document.getElementById('legal-view-dashboard').style.display='none';
  document.getElementById('legal-req-form').style.display='block';
  document.getElementById('legal-chg-form').style.display='none';
}
function legalReqBack(){
  document.getElementById('legal-req-form').style.display='none';
  document.getElementById('legal-view-register').style.display='block';
  legalLoadRegister();
}

function legalNewRequirement(){
  lrEditingId=null;
  document.getElementById('lr-form-title').textContent='New Legal Requirement';
  document.getElementById('lr-del-btn').style.display='none';
  ['lr-leg-main','lr-leg-title','lr-section','lr-subsection','lr-requirement','lr-controls','lr-further-controls','lr-notes','lr-responsibility'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  var td=document.getElementById('lr-target-date');if(td)td.value='';
  var st=document.getElementById('lr-status');if(st)st.value='partial';
  var ap=document.getElementById('lr-applicable');if(ap)ap.value='true';
  var gp=document.getElementById('lr-gap');if(gp)gp.checked=false;
  legalShowReqForm();
}

function legalOpenReq(id){
  var x=lrAllData.find(function(r){return r.id===id;});
  if(!x)return;
  lrEditingId=id;
  document.getElementById('lr-form-title').textContent='Edit Legal Requirement';
  document.getElementById('lr-del-btn').style.display=isMgr()?'inline-flex':'none';
  var flds={'lr-leg-main':'legislation_main','lr-leg-title':'legislation_title','lr-section':'section','lr-subsection':'sub_section','lr-requirement':'requirement','lr-controls':'controls_in_place','lr-further-controls':'further_controls','lr-notes':'notes','lr-responsibility':'responsibility'};
  Object.entries(flds).forEach(function(e){var el=document.getElementById(e[0]);if(el)el.value=x[e[1]]||'';});
  var td=document.getElementById('lr-target-date');if(td)td.value=x.target_date||'';
  var st=document.getElementById('lr-status');if(st)st.value=x.compliance_status||'partial';
  var ap=document.getElementById('lr-applicable');if(ap)ap.value=String(x.applicable!==false);
  var gp=document.getElementById('lr-gap');if(gp)gp.checked=!!x.gap_identified;
  legalShowReqForm();
}

async function legalSaveReq(){
  var req=document.getElementById('lr-requirement')?.value?.trim();
  if(!req){toast('Please enter the requirement text',false);return;}
  var g=function(id){var el=document.getElementById(id);return el?el.value||null:null;};
  var body={
    company_id:prof?.company_id,
    legislation_main:g('lr-leg-main'),
    legislation_title:g('lr-leg-title'),
    section:g('lr-section'),
    sub_section:g('lr-subsection'),
    requirement:req,
    applicable:document.getElementById('lr-applicable')?.value!=='false',
    compliance_status:g('lr-status')||'partial',
    controls_in_place:g('lr-controls'),
    gap_identified:document.getElementById('lr-gap')?.checked||false,
    further_controls:g('lr-further-controls'),
    responsibility:g('lr-responsibility'),
    target_date:g('lr-target-date'),
    notes:g('lr-notes'),
    updated_at:new Date().toISOString()
  };
  try{
    if(lrEditingId){
      await api('/legal_register?id=eq.'+lrEditingId,{m:'PATCH',p:'return=minimal',b:body});
      // If non-compliant or partial with gap, add to MAP
      if((body.compliance_status==='non_compliant'||body.gap_identified)&&body.further_controls){
        try{await api('/action_tracker?source_module=eq.legal&source_id=eq.'+lrEditingId,{m:'DELETE'});}catch(ex){}
        await api('/action_tracker',{m:'POST',p:'return=minimal',b:{
          company_id:prof?.company_id,source_module:'legal',source_id:lrEditingId,
          source_ref:(body.legislation_main||'Legal')+(body.section?' s.'+body.section:''),
          description:body.further_controls,responsible:body.responsibility||null,
          target_date:body.target_date||null,
          priority:body.compliance_status==='non_compliant'?'high':'medium',
          status:'open',created_by:prof?.id
        }});
        toast('Saved! Action added to Master Action Plan.');
      }else{toast('Saved!');}
    }else{
      body.created_by=prof?.id;
      var res=await api('/legal_register',{m:'POST',p:'return=representation',b:body});
      var newId=res?.[0]?.id;
      if(newId&&(body.compliance_status==='non_compliant'||body.gap_identified)&&body.further_controls){
        await api('/action_tracker',{m:'POST',p:'return=minimal',b:{
          company_id:prof?.company_id,source_module:'legal',source_id:newId,
          source_ref:(body.legislation_main||'Legal')+(body.section?' s.'+body.section:''),
          description:body.further_controls,responsible:body.responsibility||null,
          target_date:body.target_date||null,
          priority:body.compliance_status==='non_compliant'?'high':'medium',
          status:'open',created_by:prof?.id
        }});
        toast('Requirement added! Action added to MAP.');
      }else{toast('Requirement added!');}
    }
    legalReqBack();
  }catch(e){toast(e.message,false);console.error(e);}
}

async function legalDeleteReq(){
  if(!lrEditingId)return;
  if(!confirm('Delete this requirement?'))return;
  try{
    await api('/legal_register?id=eq.'+lrEditingId,{m:'DELETE'});
    toast('Deleted!');
    legalReqBack();
  }catch(e){toast(e.message,false);}
}

async function legalDeleteReqFromList(id){
  if(!confirm('Delete this requirement?'))return;
  try{
    await api('/legal_register?id=eq.'+id,{m:'DELETE'});
    lrAllData=lrAllData.filter(function(x){return x.id!==id;});
    toast('Deleted!');
    legalFilterRegister();
  }catch(e){toast(e.message,false);}
}

// ── LEGISLATIVE CHANGES ──────────────────────────────────────────────────────
async function legalLoadChanges(){
  var el=document.getElementById('lc-table');
  if(!el)return;
  try{
    var d=await api('/legislative_changes?select=*'+cf()+'&order=date_received.desc');
    lcAllData=d||[];
    if(!d||!d.length){
      el.innerHTML='<p style="padding:20px;color:var(--text2)">No changes recorded yet.'+(isMgr()?' <button class="btn btn-sm btn-primary" onclick="legalNewChange()"><i class="ti ti-plus"></i>Add first change</button>':'')+'</p>';
      return;
    }
    var h='<table style="width:100%;border-collapse:collapse;font-size:12px">';
    h+='<thead><tr style="background:#1a3a5c;color:#fff">';
    h+='<th style="padding:8px 10px;text-align:left">Date</th>';
    h+='<th style="padding:8px 10px;text-align:left">Source</th>';
    h+='<th style="padding:8px 10px;text-align:left">Jurisdiction</th>';
    h+='<th style="padding:8px 10px;text-align:left">Legislation</th>';
    h+='<th style="padding:8px 10px;text-align:left">Change identified</th>';
    h+='<th style="padding:8px 10px;text-align:center">App.</th>';
    h+='<th style="padding:8px 10px;text-align:left">Action required</th>';
    h+='<th style="padding:8px 10px;text-align:center">Done</th>';
    h+='<th style="padding:8px 10px;width:70px"></th>';
    h+='</tr></thead><tbody>';
    d.forEach(function(x,i){
      var dt=x.date_received?new Date(x.date_received).toLocaleDateString('en-GB'):'—';
      var rowBg=i%2===0?'#fff':'#f9fafb';
      h+='<tr style="border-bottom:1px solid #f0f0f0;background:'+rowBg+'">';
      h+='<td style="padding:8px 10px;font-weight:600">'+dt+'</td>';
      h+='<td style="padding:8px 10px">'+escH(x.source_material||'—')+'</td>';
      h+='<td style="padding:8px 10px">'+escH(x.jurisdiction||'—')+'</td>';
      h+='<td style="padding:8px 10px;font-weight:600">'+escH(x.applicable_legislation||'—')+'</td>';
      h+='<td style="padding:8px 10px;font-size:11px;color:var(--text2)">'+escH((x.changes_identified||'').substring(0,80))+'</td>';
      h+='<td style="padding:8px 10px;text-align:center">'+(x.applicable?'<span style="color:var(--green);font-weight:700">Y</span>':'<span style="color:var(--text2)">N</span>')+'</td>';
      h+='<td style="padding:8px 10px;font-size:11px">'+escH(x.action_required||'—')+'</td>';
      h+='<td style="padding:8px 10px;text-align:center">'+(x.implemented?'<i class="ti ti-check" style="color:var(--green);font-weight:700"></i>':'<i class="ti ti-x" style="color:var(--amber)"></i>')+'</td>';
      h+='<td style="padding:8px 10px"><div style="display:flex;gap:4px">';
      h+='<button class="btn btn-sm" data-id="'+x.id+'" onclick="legalOpenChg(this.getAttribute(\'data-id\'))"><i class="ti ti-edit"></i></button>';
      if(isMgr())h+='<button class="btn btn-sm" style="color:var(--red)" data-id="'+x.id+'" onclick="legalDeleteChgFromList(this.getAttribute(\'data-id\'))"><i class="ti ti-trash"></i></button>';
      h+='</div></td></tr>';
    });
    h+='</tbody></table>';
    if(el)el.innerHTML=h;
  }catch(e){if(el)el.innerHTML='<p style="padding:20px;color:red">'+e.message+'</p>';console.error(e);}
}

function legalShowChgForm(){
  document.getElementById('legal-view-register').style.display='none';
  document.getElementById('legal-view-changes').style.display='none';
  document.getElementById('legal-view-dashboard').style.display='none';
  document.getElementById('legal-req-form').style.display='none';
  document.getElementById('legal-chg-form').style.display='block';
}
function legalChgBack(){
  document.getElementById('legal-chg-form').style.display='none';
  document.getElementById('legal-view-changes').style.display='block';
  // Reset active tab
  document.querySelectorAll('.mtg-tab').forEach(function(t){t.classList.remove('active');});
  var tab=document.getElementById('legal-tab-changes');if(tab)tab.classList.add('active');
  legalLoadChanges();
}

function legalNewChange(){
  lcEditingId=null;
  document.getElementById('lc-form-title').textContent='New Legislative Change';
  document.getElementById('lc-del-btn').style.display='none';
  ['lc-source','lc-jurisdiction','lc-legislation','lc-changes','lc-action','lc-comments'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  var dt=document.getElementById('lc-date');if(dt)dt.value=new Date().toISOString().slice(0,10);
  var ap=document.getElementById('lc-applicable');if(ap)ap.value='true';
  var im=document.getElementById('lc-implemented');if(im)im.value='false';
  legalShowChgForm();
}

function legalOpenChg(id){
  var x=lcAllData.find(function(c){return c.id===id;});
  if(!x)return;
  lcEditingId=id;
  document.getElementById('lc-form-title').textContent='Edit Legislative Change';
  document.getElementById('lc-del-btn').style.display=isMgr()?'inline-flex':'none';
  var flds={'lc-source':'source_material','lc-jurisdiction':'jurisdiction','lc-legislation':'applicable_legislation','lc-changes':'changes_identified','lc-action':'action_required','lc-comments':'comments'};
  Object.entries(flds).forEach(function(e){var el=document.getElementById(e[0]);if(el)el.value=x[e[1]]||'';});
  var dt=document.getElementById('lc-date');if(dt)dt.value=x.date_received||'';
  var ap=document.getElementById('lc-applicable');if(ap)ap.value=String(x.applicable!==false);
  var im=document.getElementById('lc-implemented');if(im)im.value=String(!!x.implemented);
  legalShowChgForm();
}

async function legalSaveChg(){
  var changes=document.getElementById('lc-changes')?.value?.trim();
  if(!changes){toast('Please describe the change',false);return;}
  var g=function(id){var el=document.getElementById(id);return el?el.value||null:null;};
  var body={
    company_id:prof?.company_id,
    date_received:g('lc-date'),
    source_material:g('lc-source'),
    jurisdiction:g('lc-jurisdiction'),
    applicable_legislation:g('lc-legislation'),
    changes_identified:changes,
    applicable:document.getElementById('lc-applicable')?.value!=='false',
    action_required:g('lc-action'),
    implemented:document.getElementById('lc-implemented')?.value==='true',
    comments:g('lc-comments'),
    updated_at:new Date().toISOString()
  };
  try{
    if(lcEditingId){
      await api('/legislative_changes?id=eq.'+lcEditingId,{m:'PATCH',p:'return=minimal',b:body});
      toast('Change updated!');
    }else{
      body.created_by=prof?.id;
      await api('/legislative_changes',{m:'POST',p:'return=minimal',b:body});
      toast('Change recorded!');
    }
    legalChgBack();
  }catch(e){toast(e.message,false);console.error(e);}
}

async function legalDeleteChg(){
  if(!lcEditingId)return;
  if(!confirm('Delete this change record?'))return;
  try{await api('/legislative_changes?id=eq.'+lcEditingId,{m:'DELETE'});toast('Deleted!');legalChgBack();}
  catch(e){toast(e.message,false);}
}

async function legalDeleteChgFromList(id){
  if(!confirm('Delete this change record?'))return;
  try{
    await api('/legislative_changes?id=eq.'+id,{m:'DELETE'});
    lcAllData=lcAllData.filter(function(x){return x.id!==id;});
    toast('Deleted!');legalLoadChanges();
  }catch(e){toast(e.message,false);}
}

// ── COMPLIANCE DASHBOARD ──────────────────────────────────────────────────────
function legalRenderDashboard(){
  if(!lrAllData.length){legalLoadRegister().then(legalRenderDashboardData);}
  else legalRenderDashboardData();
}

function legalRenderDashboardData(){
  var total=lrAllData.filter(function(x){return x.applicable!==false;}).length;
  var compliant=lrAllData.filter(function(x){return x.compliance_status==='compliant';}).length;
  var partial=lrAllData.filter(function(x){return x.compliance_status==='partial';}).length;
  var nonComp=lrAllData.filter(function(x){return x.compliance_status==='non_compliant';}).length;
  var pct=total>0?Math.round(((compliant+(partial*0.5))/total)*100):0;
  var pctEl=document.getElementById('lr-compliance-pct');
  if(pctEl){
    var col=pct>=80?'var(--green)':pct>=50?'var(--amber)':'var(--red)';
    pctEl.textContent=pct+'%';
    pctEl.style.color=col;
  }
  var bkEl=document.getElementById('lr-compliance-breakdown');
  if(bkEl)bkEl.innerHTML=
    '<span style="background:#EAF3DE;color:#3B6D11;padding:4px 12px;border-radius:8px;font-size:12px;font-weight:600">'+compliant+' Compliant</span>'+
    '<span style="background:#FEF9EC;color:#854F0B;padding:4px 12px;border-radius:8px;font-size:12px;font-weight:600">'+partial+' Partial</span>'+
    '<span style="background:#FCEBEB;color:#A32D2D;padding:4px 12px;border-radius:8px;font-size:12px;font-weight:600">'+nonComp+' Non-Compliant</span>';

  // By legislation
  var byLeg={};
  lrAllData.forEach(function(x){
    var k=x.legislation_main||'Other';
    if(!byLeg[k])byLeg[k]={total:0,compliant:0,partial:0,non:0};
    byLeg[k].total++;
    if(x.compliance_status==='compliant')byLeg[k].compliant++;
    else if(x.compliance_status==='non_compliant')byLeg[k].non++;
    else byLeg[k].partial++;
  });
  var legEl=document.getElementById('lr-by-legislation');
  if(legEl){
    var lh='';
    Object.entries(byLeg).forEach(function(e){
      var k=e[0],v=e[1];
      var p=v.total>0?Math.round((v.compliant/v.total)*100):0;
      var barCol=p>=80?'var(--green)':p>=50?'var(--amber)':'var(--red)';
      lh+='<div style="margin-bottom:12px">'
        +'<div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px">'
        +'<span style="font-weight:600">'+escH(k)+'</span>'
        +'<span style="color:var(--text2)">'+v.compliant+'/'+v.total+' compliant ('+p+'%)</span>'
        +'</div>'
        +'<div style="height:8px;background:#f3f4f6;border-radius:4px">'
        +'<div style="height:8px;background:'+barCol+';border-radius:4px;width:'+p+'%"></div>'
        +'</div></div>';
    });
    legEl.innerHTML=lh||'<div style="color:var(--text2);padding:16px">No data yet</div>';
  }

  // Gaps
  var gapsEl=document.getElementById('lr-gaps-list');
  if(gapsEl){
    var gaps=lrAllData.filter(function(x){return x.gap_identified||x.compliance_status==='non_compliant';});
    if(!gaps.length){
      gapsEl.innerHTML='<div style="padding:16px;color:var(--green);font-weight:600"><i class="ti ti-check"></i> No gaps identified</div>';
    }else{
      var gh='<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f9fafb"><th style="padding:8px;text-align:left;border-bottom:1px solid var(--border)">Legislation</th><th style="padding:8px;text-align:left;border-bottom:1px solid var(--border)">Requirement</th><th style="padding:8px;text-align:left;border-bottom:1px solid var(--border)">Further controls needed</th><th style="padding:8px;text-align:left;border-bottom:1px solid var(--border)">Responsible</th><th style="padding:8px;text-align:left;border-bottom:1px solid var(--border)">Status</th></tr></thead><tbody>';
      gaps.forEach(function(x){
        gh+='<tr style="border-bottom:1px solid #f3f4f6">';
        gh+='<td style="padding:8px;font-size:11px">'+escH(x.legislation_main||'')+(x.section?' s.'+x.section:'')+'</td>';
        gh+='<td style="padding:8px;font-size:11px">'+escH((x.requirement||'').substring(0,80))+'</td>';
        gh+='<td style="padding:8px;font-size:11px;color:var(--red)">'+escH(x.further_controls||'Not specified')+'</td>';
        gh+='<td style="padding:8px;font-size:11px">'+escH(x.responsibility||'—')+'</td>';
        gh+='<td style="padding:8px">'+legalStatusBadge(x.compliance_status)+'</td>';
        gh+='</tr>';
      });
      gh+='</tbody></table>';
      gapsEl.innerHTML=gh;
    }
  }
}

async function loadMtgs(){
  var btn=document.getElementById('mtg-new-series-btn');
  if(btn)btn.style.display=isMgr()?'inline-flex':'none';
  mtgRoadmapYear=new Date().getFullYear();
  var yl=document.getElementById('mtg-agenda-year');
  if(yl)yl.textContent=mtgRoadmapYear;
  ['schedule','minutes','tbt','alerts','bulletins'].forEach(function(t){
    var el=document.getElementById('mtg-view-'+t);if(el)el.style.display=t==='schedule'?'block':'none';
  });
  document.querySelectorAll('[id^="mtg-tab-"]').forEach(function(t){t.classList.remove('active');});
  var scheduleTab=document.getElementById('mtg-tab-schedule');if(scheduleTab)scheduleTab.classList.add('active');
  ['tbt-add-btn','alert-add-btn','bull-add-btn'].forEach(function(id){
    var el=document.getElementById(id);if(el)el.style.display=isMgr()?'inline-flex':'none';
  });
  var container=document.getElementById('mtg-roadmap-container');
  if(container)container.innerHTML='<div class="loading-msg">Loading roadmap...</div>';
  mtgKickAgendaRoadmap();
}

function mtgKickAgendaRoadmap(){
  var run=async function(){
    try{
      // The Minutes tab reliably primes the meeting dataset; do that silently before painting Agenda.
      if(typeof mtgLoadMinutes==='function')await mtgLoadMinutes();
    }catch(e){console.warn('Minutes preload for roadmap failed',e);}
    try{await mtgLoadSeries();}
    catch(e){
      console.error(e);
      var c=document.getElementById('mtg-roadmap-container');
      if(c)c.innerHTML='<div style="padding:20px;color:#A32D2D;text-align:center">Could not load roadmap: '+((e&&e.message)||e)+'</div>';
    }
  };
  setTimeout(run,50);
  [500,1500,3000].forEach(function(delay){
    setTimeout(function(){
      var c=document.getElementById('mtg-roadmap-container');
      if(c&&/Loading roadmap/i.test(c.textContent||''))run();
    },delay);
  });
}
async function mtgLoadSeries(){
  var el=document.getElementById('mtg-series-list');
  try{
    var d=await api('/meeting_series?select=*'+cf()+'&order=meeting_type,title');
    mtgSeriesData=d||[];
    try{
      var mins=await api('/hse_meetings?select=id,series_id,meeting_date,status'+cf());
      mtgMinutesData=mins||[];
    }catch(_){}
    if(!d||!d.length){
      if(el)el.innerHTML='<div style="text-align:center;padding:40px;color:var(--text2)">'
        +'<div style="font-size:40px;margin-bottom:12px">📅</div>'
        +'<div style="font-weight:600;margin-bottom:8px">No meeting schedules yet</div>'
        +(isMgr()?'<button class="btn btn-primary" onclick="mtgNewSeries()"><i class="ti ti-plus"></i>Add first schedule</button>':'<div>Contact your HSE manager to set up meeting schedules</div>')
        +'</div>';
      mtgRenderRoadmap();

      return;
    }
    // Group by type
    var byType={};
    d.forEach(function(s){
      if(!byType[s.meeting_type])byType[s.meeting_type]=[];
      byType[s.meeting_type].push(s);
    });
    var h='';
    Object.entries(byType).forEach(function(e){
      var type=e[0], series=e[1];
      h+='<div style="padding:10px 16px;background:#f9fafb;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--green);letter-spacing:.05em">'+(MTG_TYPES[type]||type)+'</div>';
      series.forEach(function(s){
        var nextDt=s.next_date?new Date(s.next_date).toLocaleDateString('en-GB'):'Not set';
        var isOverdue=s.next_date&&new Date(s.next_date)<new Date();
        h+='<div style="padding:14px 20px;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">'
          +'<div style="flex:1">'
          +'<div style="font-size:14px;font-weight:700;margin-bottom:4px">'+(s.title||'—')
          +(s.active===false?'<span style="background:#f3f4f6;color:#888;padding:2px 8px;border-radius:99px;font-size:10px;margin-left:8px">Inactive</span>':'')
          +'</div>'
          +'<div style="font-size:12px;color:var(--text2);display:flex;gap:16px;flex-wrap:wrap">'
          +'<span><i class="ti ti-refresh" style="font-size:11px"></i> '+(MTG_RECURRENCE[s.recurrence]||s.recurrence||'—')+'</span>'
          +'<span><i class="ti ti-map-pin" style="font-size:11px"></i> '+(s.location||'—')+'</span>'
          +'<span><i class="ti ti-user" style="font-size:11px"></i> '+(s.chaired_by||'—')+'</span>'
          +'<span style="'+(isOverdue?'color:var(--red);font-weight:600':'')+'"><i class="ti ti-calendar" style="font-size:11px"></i> Next: '+nextDt+(isOverdue?' ⚠':'')+'</span>'
          +'</div>'
          +'</div>'
          +'<div style="display:flex;gap:8px">'
          +'<button class="btn btn-primary" data-id="'+s.id+'" onclick="mtgScheduleMeeting(this.getAttribute(\'data-id\'))"><i class="ti ti-file-text"></i>Schedule meeting</button>'
          +(isMgr()?'<button class="btn btn-sm" data-id="'+s.id+'" onclick="mtgEditSeries(this.getAttribute(\'data-id\'))" title="Edit schedule"><i class="ti ti-edit"></i></button>':'')
          +'</div>'
          +'</div>';
      });
    });
    if(isMgr()){
      h+='<div style="padding:14px 20px;text-align:center;border-top:1px solid var(--border)">'
        +'<button class="btn btn-sm" onclick="mtgNewSeries()"><i class="ti ti-plus"></i> Add new meeting schedule</button>'
        +'</div>';
    }
    if(el)el.innerHTML=h;
  }catch(e){
    if(el)el.innerHTML='<p style="padding:20px;color:red">'+e.message+'</p>';
    var rc=document.getElementById('mtg-roadmap-container');
    if(rc)rc.innerHTML='<div style="padding:20px;color:#A32D2D;text-align:center">Could not load roadmap: '+((e&&e.message)||e)+'</div>';
    console.error(e);
  }
  // Render roadmap after series loaded
  mtgRenderRoadmap();
  setTimeout(function(){var c=document.getElementById('mtg-roadmap-container');if(c&&/Loading roadmap/i.test(c.textContent||''))mtgRenderRoadmap();},150);
  setTimeout(function(){var c=document.getElementById('mtg-roadmap-container');if(c&&/Loading roadmap/i.test(c.textContent||''))mtgRenderRoadmap();},600);
}

function mtgNewSeries(){
  mtgEditingSeriesId=null;
  document.getElementById('mtg-series-title').textContent='New Meeting Schedule';
  document.getElementById('mtg-series-del-btn').style.display='none';
  ['ms-title','ms-location','ms-chaired-by','ms-responsible','ms-notes'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  var nd=document.getElementById('ms-next-date');if(nd)nd.value='';
  var tp=document.getElementById('ms-type');if(tp)tp.value='management_review';
  var rc=document.getElementById('ms-recurrence');if(rc)rc.value='quarterly';
  var ac=document.getElementById('ms-active');if(ac)ac.value='true';
  document.getElementById('mtg-view-schedule').style.display='none';
  document.getElementById('mtg-view-minutes').style.display='none';
  document.getElementById('mtg-series-form').style.display='block';
  document.getElementById('mtg-mom-form').style.display='none';
}

function mtgEditSeries(id){
  var s=mtgSeriesData.find(function(x){return x.id===id;});
  if(!s)return;
  mtgEditingSeriesId=id;
  document.getElementById('mtg-series-title').textContent='Edit Meeting Schedule';
  document.getElementById('mtg-series-del-btn').style.display='inline-flex';
  var flds={'ms-title':'title','ms-location':'location','ms-chaired-by':'chaired_by','ms-responsible':'responsible','ms-notes':'notes'};
  Object.entries(flds).forEach(function(e){var el=document.getElementById(e[0]);if(el)el.value=s[e[1]]||'';});
  var nd=document.getElementById('ms-next-date');if(nd)nd.value=s.next_date||'';
  var tp=document.getElementById('ms-type');if(tp)tp.value=s.meeting_type||'management_review';
  var rc=document.getElementById('ms-recurrence');if(rc)rc.value=s.recurrence||'quarterly';
  var ac=document.getElementById('ms-active');if(ac)ac.value=s.active===false?'false':'true';
  document.getElementById('mtg-view-schedule').style.display='none';
  document.getElementById('mtg-view-minutes').style.display='none';
  document.getElementById('mtg-series-form').style.display='block';
  document.getElementById('mtg-mom-form').style.display='none';
}

function mtgSeriesBack(){
  document.getElementById('mtg-series-form').style.display='none';
  document.getElementById('mtg-view-schedule').style.display='block';
  mtgLoadSeries();
}

async function mtgSaveSeries(){
  var title=document.getElementById('ms-title')?.value?.trim();
  if(!title){toast('Please enter a meeting title',false);return;}
  var body={
    company_id:prof?.company_id,
    meeting_type:document.getElementById('ms-type')?.value||'management_review',
    title:title,
    recurrence:document.getElementById('ms-recurrence')?.value||'quarterly',
    location:document.getElementById('ms-location')?.value||null,
    chaired_by:document.getElementById('ms-chaired-by')?.value||null,
    responsible:document.getElementById('ms-responsible')?.value||null,
    next_date:document.getElementById('ms-next-date')?.value||null,
    notes:document.getElementById('ms-notes')?.value||null,
    active:document.getElementById('ms-active')?.value!=='false',
    updated_at:new Date().toISOString()
  };
  try{
    if(mtgEditingSeriesId){
      await api('/meeting_series?id=eq.'+mtgEditingSeriesId,{m:'PATCH',p:'return=minimal',b:body});
      toast('Schedule updated!');
    }else{
      body.created_by=prof?.id;
      await api('/meeting_series',{m:'POST',p:'return=minimal',b:body});
      toast('Schedule created!');
    }
    mtgSeriesBack();
  }catch(e){toast(e.message,false);console.error(e);}
}

async function mtgDeleteSeries(){
  if(!mtgEditingSeriesId)return;
  if(!confirm('Delete this meeting schedule? Past minutes will not be deleted.'))return;
  try{
    await api('/meeting_series?id=eq.'+mtgEditingSeriesId,{m:'DELETE'});
    toast('Schedule deleted!');
    mtgSeriesBack();
  }catch(e){toast(e.message,false);console.error(e);}
}

// ── SCHEDULE MEETING → open MOM form ──────────────────────────────────────
function mtgScheduleMeeting(seriesId){
  var s=mtgSeriesData.find(function(x){return x.id===seriesId;});
  mtgEditingMomId=null;
  // Clear form
  mtgClearMom();
  // Pre-fill from series
  if(s){
    var tp=document.getElementById('mom-type');if(tp)tp.value=s.meeting_type||'management_review';
    var ti=document.getElementById('mom-title');if(ti){ti.value=s.title||'';document.getElementById('mom-header-title').textContent=s.title||'HSE Meeting';}
    var loc=document.getElementById('mom-location');if(loc)loc.value=s.location||'';
    var ch=document.getElementById('mom-chaired-by');if(ch)ch.value=s.chaired_by||'';
    var sc=document.getElementById('mom-sign-chair');if(sc)sc.value=s.chaired_by||'';
    // Set date to next scheduled date or today
    var dt=document.getElementById('mom-date');
    if(dt)dt.value=(s.next_date?s.next_date+'T09:00':new Date().toISOString().slice(0,16));
    // Set next meeting date based on recurrence
    var nextDate=mtgCalcNextDate(s.next_date||new Date().toISOString().slice(0,10), s.recurrence);
    var nd=document.getElementById('mom-next-date');if(nd)nd.value=nextDate;
    // Store series id for later update
    document.getElementById('mtg-mom-form').dataset.seriesId=seriesId;
  }
  document.getElementById('mtg-view-schedule').style.display='none';
  document.getElementById('mtg-view-minutes').style.display='none';
  document.getElementById('mtg-series-form').style.display='none';
  document.getElementById('mtg-mom-form').style.display='block';
  document.getElementById('mtg-mom-title').textContent='New Minutes of Meeting';
  document.getElementById('mtg-mom-ref').textContent='';
  document.getElementById('mtg-mom-del-btn').style.display='none';
  var sendBtnN=document.getElementById('mtg-mom-send-btn');if(sendBtnN)sendBtnN.style.display='none';
  momPopulateDropdowns();
}

function mtgCalcNextDate(fromDate, recurrence){
  var d=new Date(fromDate);
  var months={'monthly':1,'bimonthly':2,'quarterly':3,'triannual':4,'biannual':6,'annual':12};
  var m=months[recurrence]||3;
  d.setMonth(d.getMonth()+m);
  return d.toISOString().slice(0,10);
}

function mtgClearMom(){
  ['mom-title','mom-location','mom-chaired-by','mom-recorder','mom-attendees','mom-apologies','mom-notes','mom-sign-chair','mom-sign-approver','mom-attendees-extra','mom-apologies-extra'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  var at=document.getElementById('mom-attendees-tags');if(at)at.innerHTML='';
  var apt=document.getElementById('mom-apologies-tags');if(apt)apt.innerHTML='';
  var sendBtn=document.getElementById('mtg-mom-send-btn');if(sendBtn)sendBtn.style.display='none';
  ['mom-date'].forEach(function(id){var el=document.getElementById(id);if(el)el.value=new Date().toISOString().slice(0,16);});
  ['mom-next-date','mom-sign-date','mom-sign-approver-date'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  var st=document.getElementById('mom-status');if(st)st.value='draft';
  var hdr=document.getElementById('mom-header-title');if(hdr)hdr.textContent='HSE Meeting';
  // Clear agenda
  var ab=document.getElementById('mom-agenda-body');
  if(ab)ab.innerHTML=`
    <tr><td style="padding:6px;text-align:center;border:1px solid var(--border);font-weight:700;font-size:12px;color:var(--text2)">1</td><td style="padding:4px;border:1px solid var(--border)"><input type="text" class="mom-agenda-item" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px" placeholder="e.g. Approval of previous minutes"/></td><td style="padding:4px;border:1px solid var(--border)"><textarea class="mom-agenda-notes" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;min-height:50px;resize:vertical" placeholder="Discussion notes..."></textarea></td><td style="padding:4px;text-align:center;border:1px solid var(--border)"><button onclick="this.parentNode.parentNode.remove()" style="background:none;border:none;cursor:pointer;color:var(--red)"><i class="ti ti-x"></i></button></td></tr>
    <tr><td style="padding:6px;text-align:center;border:1px solid var(--border);font-weight:700;font-size:12px;color:var(--text2)">2</td><td style="padding:4px;border:1px solid var(--border)"><input type="text" class="mom-agenda-item" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px" placeholder="e.g. Review of incidents"/></td><td style="padding:4px;border:1px solid var(--border)"><textarea class="mom-agenda-notes" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;min-height:50px;resize:vertical" placeholder="Discussion notes..."></textarea></td><td style="padding:4px;text-align:center;border:1px solid var(--border)"><button onclick="this.parentNode.parentNode.remove()" style="background:none;border:none;cursor:pointer;color:var(--red)"><i class="ti ti-x"></i></button></td></tr>
    <tr><td style="padding:6px;text-align:center;border:1px solid var(--border);font-weight:700;font-size:12px;color:var(--text2)">3</td><td style="padding:4px;border:1px solid var(--border)"><input type="text" class="mom-agenda-item" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px" placeholder="e.g. KPI performance review"/></td><td style="padding:4px;border:1px solid var(--border)"><textarea class="mom-agenda-notes" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;min-height:50px;resize:vertical" placeholder="Discussion notes..."></textarea></td><td style="padding:4px;text-align:center;border:1px solid var(--border)"><button onclick="this.parentNode.parentNode.remove()" style="background:none;border:none;cursor:pointer;color:var(--red)"><i class="ti ti-x"></i></button></td></tr>
  `;
  // Clear recommendations
  var rb=document.getElementById('mom-rec-body');if(rb)rb.innerHTML='';
  var re=document.getElementById('mom-rec-empty');if(re)re.style.display='block';
}

function mtgAddAgendaItem(){
  var body=document.getElementById('mom-agenda-body');
  if(!body)return;
  var num=body.querySelectorAll('tr').length+1;
  var tr=document.createElement('tr');
  tr.innerHTML='<td style="padding:6px;text-align:center;border:1px solid var(--border);font-weight:700;font-size:12px;color:var(--text2)">'+num+'</td>'
    +'<td style="padding:4px;border:1px solid var(--border)"><input type="text" class="mom-agenda-item" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px" placeholder="Agenda item..."/></td>'
    +'<td style="padding:4px;border:1px solid var(--border)"><textarea class="mom-agenda-notes" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;min-height:50px;resize:vertical" placeholder="Discussion notes..."></textarea></td>'
    +'<td style="padding:4px;text-align:center;border:1px solid var(--border)"><button onclick="this.parentNode.parentNode.remove()" style="background:none;border:none;cursor:pointer;color:var(--red)"><i class="ti ti-x"></i></button></td>';
  body.appendChild(tr);
}

function mtgAddRec(){
  var body=document.getElementById('mom-rec-body');
  var empty=document.getElementById('mom-rec-empty');
  if(!body)return;
  if(empty)empty.style.display='none';
  var num=body.querySelectorAll('tr').length+1;
  var tr=document.createElement('tr');
  tr.innerHTML='<td style="padding:6px;text-align:center;border:1px solid var(--border);font-weight:700;font-size:12px;color:var(--text2)">'+num+'</td>'
    +'<td style="padding:4px;border:1px solid var(--border)"><input type="text" class="mom-rec-desc" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px" placeholder="Recommendation or action..."/></td>'
    +'<td style="padding:4px;border:1px solid var(--border)"><input type="text" class="mom-rec-resp" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px" placeholder="Responsible..."/></td>'
    +'<td style="padding:4px;border:1px solid var(--border)"><input type="date" class="mom-rec-date" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"/></td>'
    +'<td style="padding:4px;border:1px solid var(--border)"><select class="mom-rec-prio" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select></td>'
    +'<td style="padding:4px;border:1px solid var(--border)"><select class="mom-rec-status" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"><option value="open">Open</option><option value="in_progress">In progress</option><option value="closed">Closed</option></select></td>'
    +'<td style="padding:4px;text-align:center;border:1px solid var(--border)"><button onclick="this.parentNode.parentNode.remove()" style="background:none;border:none;cursor:pointer;color:var(--red)"><i class="ti ti-x"></i></button></td>';
  body.appendChild(tr);
}

function mtgCollectRecs(){
  var recs=[];
  document.querySelectorAll('#mom-rec-body tr').forEach(function(tr){
    var desc=tr.querySelector('.mom-rec-desc')?.value;
    if(!desc?.trim())return;
    recs.push({
      desc:desc,
      resp:tr.querySelector('.mom-rec-resp')?.value||null,
      date:tr.querySelector('.mom-rec-date')?.value||null,
      prio:tr.querySelector('.mom-rec-prio')?.value||'medium',
      status:tr.querySelector('.mom-rec-status')?.value||'open'
    });
  });
  return recs;
}

function mtgCollectAgenda(){
  var items=[];
  document.querySelectorAll('#mom-agenda-body tr').forEach(function(tr,i){
    var item=tr.querySelector('.mom-agenda-item')?.value||'';
    var notes=tr.querySelector('.mom-agenda-notes')?.value||'';
    if(item||notes)items.push({no:i+1,item:item,notes:notes});
  });
  return items;
}

// ── ATTENDEE DROPDOWN ─────────────────────────────────────────────────────
function momPopulateDropdowns(){
  var opts='<option value="">+ Add person...</option>';
  (people||[]).forEach(function(p){
    opts+='<option value="'+p.full_name+(p.job_title?' ('+p.job_title+')':'')+'">'+p.full_name+(p.job_title?' — '+p.job_title:'')+'</option>';
  });
  var s1=document.getElementById('mom-attendees-sel');
  var s2=document.getElementById('mom-apologies-sel');
  if(s1)s1.innerHTML=opts;
  if(s2)s2.innerHTML=opts;
}

function momAddAttendee(){
  var sel=document.getElementById('mom-attendees-sel');
  var val=sel?.value;
  if(!val)return;
  momAddTag('mom-attendees-tags','mom-attendees',val);
  sel.value='';
}

function momAddApology(){
  var sel=document.getElementById('mom-apologies-sel');
  var val=sel?.value;
  if(!val)return;
  momAddTag('mom-apologies-tags','mom-apologies',val);
  sel.value='';
}

function momAddTag(containerId, hiddenId, name){
  var container=document.getElementById(containerId);
  if(!container)return;
  var existing=Array.from(container.querySelectorAll('.mom-tag')).map(function(t){return t.dataset.name;});
  if(existing.indexOf(name)>=0)return;
  var tag=document.createElement('span');
  tag.className='mom-tag';
  tag.dataset.name=name;
  tag.dataset.cid=containerId;
  tag.dataset.hid=hiddenId;
  tag.style.cssText='background:#E6F1FB;color:#185FA5;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:5px;white-space:nowrap';
  var span=document.createElement('span');
  span.textContent=name;
  var btn=document.createElement('span');
  btn.textContent='×'.decode();
  btn.style.cssText='cursor:pointer;margin-left:4px;font-weight:700;opacity:.6;user-select:none';
  btn.onclick=function(){
    var t=this.parentNode;
    momSyncHidden(t.dataset.cid, t.dataset.hid);
    t.remove();
  };
  tag.appendChild(span);
  tag.appendChild(btn);
  container.appendChild(tag);
  momSyncHidden(containerId, hiddenId);
}

function momSyncHidden(containerId, hiddenId){
  var container=document.getElementById(containerId);
  var hidden=document.getElementById(hiddenId);
  if(!container||!hidden)return;
  var names=Array.from(container.querySelectorAll('.mom-tag')).map(function(t){return t.dataset.name;});
  hidden.value=names.join(', ');
}

function momGetAttendees(){
  var tags=Array.from(document.querySelectorAll('#mom-attendees-tags .mom-tag')).map(function(t){return t.dataset.name;});
  var extra=document.getElementById('mom-attendees-extra')?.value||'';
  return tags.concat(extra?[extra]:[]).join('\n');
}

function momGetApologies(){
  var tags=Array.from(document.querySelectorAll('#mom-apologies-tags .mom-tag')).map(function(t){return t.dataset.name;});
  var extra=document.getElementById('mom-apologies-extra')?.value||'';
  return tags.concat(extra?[extra]:[]).join('\n');
}

function momSetAttendees(val){
  var container=document.getElementById('mom-attendees-tags');
  var extra=document.getElementById('mom-attendees-extra');
  if(!container)return;
  container.innerHTML='';
  if(!val)return;
  var names=val.split(/[,\n]/).map(function(s){return s.trim();}).filter(Boolean);
  // Try to match against people list
  var peopleNames=(people||[]).map(function(p){return p.full_name+(p.job_title?' ('+p.job_title+')':'');});
  var manuals=[];
  names.forEach(function(n){
    if(peopleNames.indexOf(n)>=0){momAddTag('mom-attendees-tags','mom-attendees',n);}
    else{manuals.push(n);}
  });
  if(extra)extra.value=manuals.join(', ');
}

function momSetApologies(val){
  var container=document.getElementById('mom-apologies-tags');
  var extra=document.getElementById('mom-apologies-extra');
  if(!container)return;
  container.innerHTML='';
  if(!val)return;
  var names=val.split(/[,\n]/).map(function(s){return s.trim();}).filter(Boolean);
  var peopleNames=(people||[]).map(function(p){return p.full_name+(p.job_title?' ('+p.job_title+')':'');});
  var manuals=[];
  names.forEach(function(n){
    if(peopleNames.indexOf(n)>=0){momAddTag('mom-apologies-tags','mom-apologies',n);}
    else{manuals.push(n);}
  });
  if(extra)extra.value=manuals.join(', ');
}

// ── SEND MINUTES ─────────────────────────────────────────────────────────────
function mtgSendMinutes(){
  var title=document.getElementById('mom-title')?.value||'HSE Meeting';
  var dt=document.getElementById('mom-date')?.value;
  var dtStr=dt?new Date(dt).toLocaleDateString('en-GB'):'';
  var attendees=momGetAttendees();
  var agenda=[];
  document.querySelectorAll('#mom-agenda-body tr').forEach(function(tr,i){
    var item=tr.querySelector('.mom-agenda-item')?.value||'';
    var notes=tr.querySelector('.mom-agenda-notes')?.value||'';
    if(item)agenda.push((i+1)+'. '+item+(notes?' — '+notes:''));
  });
  var recs=[];
  document.querySelectorAll('#mom-rec-body tr').forEach(function(tr){
    var desc=tr.querySelector('.mom-rec-desc')?.value||'';
    var resp=tr.querySelector('.mom-rec-resp')?.value||'';
    var date=tr.querySelector('.mom-rec-date')?.value||'';
    if(desc)recs.push('• '+desc+(resp?' ('+resp+')':(date?' — '+date:'')));
  });
  var notes=document.getElementById('mom-notes')?.value||'';
  var nextDate=document.getElementById('mom-next-date')?.value;
  var nextStr=nextDate?new Date(nextDate).toLocaleDateString('en-GB'):'';

  var body='MINUTES OF MEETING\n'
    +'===========================================\n'
    +title+'\n'
    +(dtStr?'Date: '+dtStr+'\n':'')
    +(document.getElementById('mom-location')?.value?'Location: '+document.getElementById('mom-location').value+'\n':'')
    +(document.getElementById('mom-chaired-by')?.value?'Chaired by: '+document.getElementById('mom-chaired-by').value+'\n':'')
    +'\nATTENDEES:\n'+(attendees||'—')+'\n'
    +(agenda.length?'\nAGENDA & DISCUSSION:\n'+agenda.join('\n')+'\n':'')
    +(recs.length?'\nACTIONS & RECOMMENDATIONS:\n'+recs.join('\n')+'\n':'')
    +(notes?'\nOTHER NOTES:\n'+notes+'\n':'')
    +(nextStr?'\nNEXT MEETING: '+nextStr+'\n':'')
    +'\n---\nThis communication was sent from AURIS360 HSE Platform.';

  var subject=encodeURIComponent('Minutes of Meeting — '+title+(dtStr?' ('+dtStr+')':''));
  var emailBody=encodeURIComponent(body);
  window.location.href='mailto:?subject='+subject+'&body='+emailBody;
  toast('Opening email client with minutes...');
}


async function mtgSaveMom(){
  var title=document.getElementById('mom-title')?.value?.trim();
  if(!title){toast('Please enter a meeting title',false);return;}
  var recs=mtgCollectRecs();
  var agenda=mtgCollectAgenda();
  var body={
    company_id:prof?.company_id,
    series_id:document.getElementById('mtg-mom-form').dataset.seriesId||null,
    meeting_type:document.getElementById('mom-type')?.value||'management_review',
    title:title,
    meeting_date:document.getElementById('mom-date')?.value||null,
    location:document.getElementById('mom-location')?.value||null,
    chaired_by:document.getElementById('mom-chaired-by')?.value||null,
    attendees:momGetAttendees()||null,
    apologies:momGetApologies()||null,
    minutes:document.getElementById('mom-notes')?.value||null,
    next_meeting_date:document.getElementById('mom-next-date')?.value||null,
    agenda_items:agenda,
    recommendations:recs,
    status:document.getElementById('mom-status')?.value||'draft',
    updated_at:new Date().toISOString()
  };
  try{
    var savedId=mtgEditingMomId;
    if(mtgEditingMomId){
      await api('/hse_meetings?id=eq.'+mtgEditingMomId,{m:'PATCH',p:'return=minimal',b:body});
      toast('Minutes updated!');
    }else{
      body.created_by=prof?.id;
      var res=await api('/hse_meetings',{m:'POST',p:'return=representation',b:body});
      savedId=res?.[0]?.id;
      toast('Minutes saved!');
    }
    // Update series next_date if series linked
    var seriesId=document.getElementById('mtg-mom-form').dataset.seriesId;
    if(seriesId){
      var nd=document.getElementById('mom-next-date')?.value;
      if(nd)await api('/meeting_series?id=eq.'+seriesId,{m:'PATCH',p:'return=minimal',b:{next_date:nd,updated_at:new Date().toISOString()}});
    }
    // Sync recommendations to MAP
    if(savedId&&recs.length){
      try{await api('/action_tracker?source_module=eq.meeting&source_id=eq.'+savedId,{m:'DELETE'});}catch(ex){}
      var ref=title+' ('+new Date(body.meeting_date||new Date()).toLocaleDateString('en-GB')+')';
      for(var i=0;i<recs.length;i++){
        var r=recs[i];
        await api('/action_tracker',{m:'POST',p:'return=minimal',b:{
          company_id:prof?.company_id,source_module:'meeting',source_id:savedId,
          source_ref:ref,description:r.desc,responsible:r.resp||null,
          target_date:r.date||null,priority:r.prio||'medium',
          status:r.status||'open',created_by:prof?.id
        }});
      }
      toast('Minutes saved! '+recs.length+' action(s) synced to Master Action Plan.');
    }
    // Reload agenda to reflect completed status
    try{
      var mins=await api('/hse_meetings?select=id,series_id,meeting_date,status'+cf());
      mtgMinutesData=mins||[];
    }catch(ex){}
    mtgMomBack();
  }catch(e){toast(e.message,false);console.error(e);}
}

async function mtgDeleteMom(){
  if(!mtgEditingMomId)return;
  if(!confirm('Delete these minutes? This cannot be undone.'))return;
  try{
    await api('/action_tracker?source_module=eq.meeting&source_id=eq.'+mtgEditingMomId,{m:'DELETE'});
    await api('/hse_meetings?id=eq.'+mtgEditingMomId,{m:'DELETE'});
    toast('Minutes deleted!');
    mtgMomBack();
  }catch(e){toast(e.message,false);console.error(e);}
}

function mtgMomBack(){
  document.getElementById('mtg-mom-form').style.display='none';
  document.getElementById('mtg-series-form').style.display='none';
  document.getElementById('mtg-view-minutes').style.display='none';
  document.getElementById('mtg-view-schedule').style.display='block';
  // Reset active tab
  document.querySelectorAll('.mtg-tab').forEach(t=>t.classList.remove('active'));
  var tab=document.getElementById('mtg-tab-schedule');if(tab)tab.classList.add('active');
  mtgLoadSeries();
}

// ── MINUTES LIST ────────────────────────────────────────────────────────────
// ── ROADMAP ─────────────────────────────────────────────────────────────────
let mtgRoadmapYear = new Date().getFullYear();
let mtgSeriesListOpen = false;

function mtgRoadmapPrevYear(){ mtgRoadmapYear--; mtgRenderRoadmap(); }
function mtgRoadmapNextYear(){ mtgRoadmapYear++; mtgRenderRoadmap(); }
function mtgRoadmapToday(){ mtgRoadmapYear=new Date().getFullYear(); mtgRenderRoadmap(); }

function mtgToggleSeriesList(){
  var el=document.getElementById('mtg-series-list');
  var chev=document.getElementById('series-list-chev');
  mtgSeriesListOpen=!mtgSeriesListOpen;
  if(el)el.style.display=mtgSeriesListOpen?'block':'none';
  if(chev)chev.className='ti '+(mtgSeriesListOpen?'ti-chevron-up':'ti-chevron-down');
  if(mtgSeriesListOpen)mtgLoadSeries();
}

function mtgGetWeeksForSeries(series, year){
  // Given a series with recurrence and next_date, calculate which weeks in the year have meetings
  var weeks=[];
  var recurrenceMonths={'monthly':1,'bimonthly':2,'quarterly':3,'triannual':4,'biannual':6,'annual':12};
  var months=recurrenceMonths[series.recurrence]||3;

  // Get start date - use next_date or Jan 1 of year
  var startDate=series.next_date?new Date(series.next_date):new Date(year,0,1);

  // Work backwards from startDate to find first occurrence in or before this year
  var d=new Date(startDate);
  while(d.getFullYear()>year){d.setMonth(d.getMonth()-months);}
  while(d.getFullYear()<year||(d.getFullYear()===year&&d<new Date(year,0,1))){
    var next=new Date(d);next.setMonth(next.getMonth()+months);
    if(next.getFullYear()>year||(next.getFullYear()===year&&next>=new Date(year,0,1)))break;
    d=next;
  }
  // Now d is first occurrence at or before start of year - advance to be in year
  if(d.getFullYear()<year)d.setMonth(d.getMonth()+months);

  // Collect all occurrences in this year
  var cur=new Date(d);
  while(cur.getFullYear()<=year){
    if(cur.getFullYear()===year){
      var week=mtgGetWeekNumber(cur);
      if(week>=1&&week<=52)weeks.push({week:week,date:new Date(cur),past:cur<new Date()});
    }
    cur.setMonth(cur.getMonth()+months);
  }
  return weeks;
}

function mtgGetWeekNumber(date){
  var d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
  d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
  var yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil((((d-yearStart)/86400000)+1)/7);
}

function mtgCurrentWeek(){
  return mtgGetWeekNumber(new Date());
}

function mtgRenderRoadmap(){
  var container=document.getElementById('mtg-roadmap-container');
  var yearLabel=document.getElementById('mtg-agenda-year');
  var newBtn=document.getElementById('mtg-new-series-btn2');
  if(yearLabel)yearLabel.textContent=mtgRoadmapYear;
  if(newBtn)newBtn.style.display=isMgr()?'inline-flex':'none';
  if(!container){
    setTimeout(function(){try{mtgRenderRoadmap();}catch(e){console.error(e);}},100);
    return;
  }
  try{

  if(!mtgSeriesData||!mtgSeriesData.length){
    container.innerHTML='<div style="text-align:center;padding:40px;color:var(--text2)">No meeting schedules yet.'+(isMgr()?'<button class="btn btn-primary btn-sm" style="margin-left:8px" onclick="mtgNewSeries()"><i class="ti ti-plus"></i>Add schedule</button>':'')+'</div>';
    return;
  }

  var curWeek=mtgRoadmapYear===new Date().getFullYear()?mtgCurrentWeek():-1;
  var typeColors={management_review:'#1D9E75',hse_committee:'#185FA5',other:'#8B5CF6'};

  // Build table matching the Excel template exactly
  var html='<table style="border-collapse:collapse;width:100%;min-width:900px;font-size:12px;table-layout:fixed">';

  // ROW 1: Header - No | Meeting | Frequency | "Week" spanning 52 cols
  html+='<thead>';
  html+='<tr style="background:#1a3a5c;color:#fff">';
  html+='<th style="padding:8px 6px;text-align:center;border:1px solid #2d5a8c;width:36px;font-size:11px">No</th>';
  html+='<th style="padding:8px 10px;text-align:left;border:1px solid #2d5a8c;width:180px;font-size:11px">Meeting</th>';
  html+='<th style="padding:8px 8px;text-align:left;border:1px solid #2d5a8c;width:110px;font-size:11px">Frequency</th>';
  html+='<th colspan="52" style="padding:8px;text-align:center;border:1px solid #2d5a8c;font-size:11px;font-weight:700;letter-spacing:.05em">WEEK</th>';
  html+='</tr>';

  // ROW 2: Week numbers 1-52
  html+='<tr style="background:#2d5a8c;color:#fff">';
  html+='<th style="border:1px solid #1a3a5c;padding:4px 2px"></th>';
  html+='<th style="border:1px solid #1a3a5c;padding:4px 2px"></th>';
  html+='<th style="border:1px solid #1a3a5c;padding:4px 2px"></th>';
  for(var w=1;w<=52;w++){
    var isCur=w===curWeek;
    html+='<th style="padding:4px 1px;text-align:center;border:1px solid #1a3a5c;font-size:10px;'
      +(isCur?'background:#EF9F27;color:#fff;font-weight:700;':'color:#cce4ff;font-weight:400;')
      +'width:'+(100/52).toFixed(2)+'%">'+w+'</th>';
  }
  html+='</tr></thead><tbody>';

  // DATA ROWS: one per series
  var recurrenceWeeks={'monthly':4,'bimonthly':9,'quarterly':13,'triannual':17,'biannual':26,'annual':52};

  mtgSeriesData.forEach(function(series,si){
    var color=typeColors[series.meeting_type]||'#6B7280';
    var rowBg=si%2===0?'#f9fafb':'#ffffff';

    // Calculate meeting weeks for this series
    var weeks=mtgGetWeeksForSeries(series,mtgRoadmapYear);
    var weekSet={};
    weeks.forEach(function(o){weekSet[o.week]={date:o.date,past:o.past};});
    (mtgMinutesData||[]).forEach(function(m){
      if(m.series_id===series.id&&m.meeting_date){
        var md=new Date(m.meeting_date);
        if(md.getFullYear()===mtgRoadmapYear){
          var mw=mtgGetWeekNumber(md);
          var isCompleted=m.status==='completed';
          if(weekSet[mw]){
            weekSet[mw].hasMom=true;
            weekSet[mw].completed=isCompleted;
          }else{
            // Meeting saved on a week not in calculated schedule — still show it
            weekSet[mw]={date:md,past:md<new Date(),hasMom:true,completed:isCompleted};
          }
        }
      }
    });

    html+='<tr style="border-bottom:1px solid #e5e7eb">';

    // No.
    html+='<td style="padding:6px 4px;text-align:center;background:'+rowBg+';border:1px solid #e5e7eb;font-weight:700;font-size:11px;color:#374151">'+(si+1)+'</td>';

    // Meeting name
    html+='<td style="padding:6px 8px;background:'+rowBg+';border:1px solid #e5e7eb;font-weight:600;font-size:11px;color:#111827" title="'+series.title+'">'+series.title+'</td>';

    // Frequency
    html+='<td style="padding:6px 6px;background:'+rowBg+';border:1px solid #e5e7eb;font-size:10px;color:#6b7280">'+(MTG_RECURRENCE[series.recurrence]||series.recurrence)+'</td>';

    // Week cells
    for(var w=1;w<=52;w++){
      var isCur=w===curWeek;
      var occ=weekSet[w];
      var cellBg=isCur?'#FEF9EC':rowBg;

      if(occ){
        var isPast=occ.past&&(mtgRoadmapYear<new Date().getFullYear()||(mtgRoadmapYear===new Date().getFullYear()&&w<curWeek));
        var hasMom=occ.hasMom;
        var isCompleted=occ.completed;
        // Green = completed minutes, Orange = upcoming scheduled, Red = overdue no minutes
        var dotColor=isCompleted?'#1D9E75':hasMom?'#3B82F6':isPast?'#E24B4A':'#EF9F27';
        var dt=occ.date.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
        html+='<td style="padding:2px 1px;text-align:center;background:'+cellBg+';border:1px solid #e5e7eb;cursor:pointer" '
          +'title="'+series.title+' — Week '+w+' ('+dt+')" '
          +'data-series-id="'+series.id+'" onclick="mtgClickWeek(this.dataset.seriesId,'+w+')">'
          +'<div style="background:'+dotColor+';border-radius:3px;margin:1px;height:20px;display:flex;align-items:center;justify-content:center">'
          +'<i class="ti ti-check" style="font-size:11px;color:#fff"></i>'
          +'</div>'
          +'</td>';
      }else{
        html+='<td style="padding:2px 1px;text-align:center;background:'+cellBg+';border:1px solid #e5e7eb"></td>';
      }
    }
    html+='</tr>';
  });

  html+='</tbody></table>';
  container.innerHTML=html;
  }catch(e){
    console.error(e);
    container.innerHTML='<div style="padding:20px;color:#A32D2D;text-align:center">Roadmap error: '+((e&&e.message)||e)+'</div>';
  }
}

function mtgClickWeek(seriesId,week){
  // Open the meeting form for this series, pre-set to the approximate date of that week
  var s=mtgSeriesData.find(function(x){return x.id===seriesId;});
  if(!s)return;
  // Calculate actual date for this week
  var weekDate=mtgWeekToDate(week,mtgRoadmapYear);
  // Override next_date temporarily for pre-filling
  var tempSeries=Object.assign({},s,{next_date:weekDate.toISOString().slice(0,10)});
  // Store and call schedule
  var origData=mtgSeriesData;
  mtgSeriesData=mtgSeriesData.map(function(x){return x.id===seriesId?tempSeries:x;});
  mtgScheduleMeeting(seriesId);
  mtgSeriesData=origData;
}


function mtgWeekToDate(week,year){
  // Returns the Monday of the given ISO week in the given year
  var simple=new Date(year,0,1+((week-1)*7));
  var dow=simple.getDay();
  var mon=simple;
  if(dow<=4)mon.setDate(simple.getDate()-simple.getDay()+1);
  else mon.setDate(simple.getDate()+8-simple.getDay());
  return mon;
}


async function mtgLoadMinutes(){
  var el=document.getElementById('mtg-minutes-list');
  if(!el)return;
  try{
    var d=await api('/hse_meetings?select=*'+cf()+'&order=meeting_date.desc');
    mtgMinutesData=d||[];
    if(!d||!d.length){
      if(el)el.innerHTML='<div style="text-align:center;padding:40px;color:var(--text2)">No minutes yet — schedule a meeting from the Schedule tab.</div>';
      return;
    }
    var h='<table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f9fafb">'
      +'<th style="padding:10px 16px;text-align:left;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">Date</th>'
      +'<th style="padding:10px;text-align:left;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">Meeting</th>'
      +'<th style="padding:10px;text-align:left;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">Type</th>'
      +'<th style="padding:10px;text-align:left;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">Chaired by</th>'
      +'<th style="padding:10px;text-align:center;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">Actions</th>'
      +'<th style="padding:10px;text-align:left;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;color:var(--text2)">Status</th>'
      +'<th style="padding:10px;width:90px;border-bottom:1px solid var(--border)"></th>'
      +'</tr></thead><tbody>';
    d.forEach(function(x){
      var dt=x.meeting_date?new Date(x.meeting_date).toLocaleDateString('en-GB'):'--';
      var recs=Array.isArray(x.recommendations)?x.recommendations.length:0;
      var statusBadge=x.status==='completed'?'<span class="badge bg">Completed</span>':x.status==='cancelled'?'<span class="badge br">Cancelled</span>':'<span class="badge ba">Draft</span>';
      h+='<tr style="border-bottom:1px solid #f3f4f6">'
        +'<td style="padding:10px 16px;font-weight:600">'+dt+'</td>'
        +'<td style="padding:10px;cursor:pointer;color:var(--green);font-weight:600" data-id="'+x.id+'" onclick="mtgOpenMom(this.getAttribute(\'data-id\'))">'+(x.title||'—')+'</td>'
        +'<td style="padding:10px;font-size:12px;color:var(--text2)">'+(MTG_TYPES[x.meeting_type]||x.meeting_type||'—')+'</td>'
        +'<td style="padding:10px">'+(x.chaired_by||'—')+'</td>'
        +'<td style="padding:10px;text-align:center"><span style="background:#EAF3DE;color:#3B6D11;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600">'+recs+' action'+(recs!==1?'s':'')+'</span></td>'
        +'<td style="padding:10px">'+statusBadge+'</td>'
        +'<td style="padding:10px"><div style="display:flex;gap:4px">'
        +'<button class="btn btn-sm" data-id="'+x.id+'" onclick="mtgOpenMom(this.getAttribute(\'data-id\'))"><i class="ti ti-edit"></i></button>'
        +(isMgr()?'<button class="btn btn-sm" style="color:var(--red)" data-id="'+x.id+'" onclick="mtgDeleteMomFromList(this.getAttribute(\'data-id\'))"><i class="ti ti-trash"></i></button>':'')
        +'</div></td>'
        +'</tr>';
    });
    h+='</tbody></table>';
    if(el)el.innerHTML=h;
  }catch(e){if(el)el.innerHTML='<p style="padding:20px;color:red">'+e.message+'</p>';console.error(e);}
}

async function mtgOpenMom(id){
  var m=mtgMinutesData.find(function(x){return x.id===id;});
  if(!m){
    try{var d=await api('/hse_meetings?id=eq.'+id+'&select=*');m=d&&d[0];}
    catch(e){toast(e.message,false);return;}
  }
  if(!m)return;
  mtgEditingMomId=id;
  mtgClearMom();
  document.getElementById('mtg-mom-form').dataset.seriesId=m.series_id||'';
  var flds={'mom-title':'title','mom-location':'location','mom-chaired-by':'chaired_by',
    'mom-notes':'minutes','mom-sign-chair':'chaired_by'};
  Object.entries(flds).forEach(function(e){var el=document.getElementById(e[0]);if(el)el.value=m[e[1]]||'';});
  var hdr=document.getElementById('mom-header-title');if(hdr)hdr.textContent=m.title||'HSE Meeting';
  momPopulateDropdowns();
  if(m.attendees)momSetAttendees(m.attendees);
  if(m.apologies)momSetApologies(m.apologies);
  var sendBtn=document.getElementById('mtg-mom-send-btn');if(sendBtn)sendBtn.style.display='inline-flex';
  var tp=document.getElementById('mom-type');if(tp)tp.value=m.meeting_type||'management_review';
  var st=document.getElementById('mom-status');if(st)st.value=m.status||'draft';
  var dt=document.getElementById('mom-date');if(dt)dt.value=m.meeting_date?m.meeting_date.slice(0,16):'';
  var nd=document.getElementById('mom-next-date');if(nd)nd.value=m.next_meeting_date||'';
  // Render agenda items
  var ab=document.getElementById('mom-agenda-body');
  if(ab&&m.agenda_items&&m.agenda_items.length){
    ab.innerHTML='';
    m.agenda_items.forEach(function(a,i){
      var tr=document.createElement('tr');
      tr.innerHTML='<td style="padding:6px;text-align:center;border:1px solid var(--border);font-weight:700;font-size:12px;color:var(--text2)">'+(i+1)+'</td>'
        +'<td style="padding:4px;border:1px solid var(--border)"><input type="text" class="mom-agenda-item" value="'+escH2(a.item||'')+'" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"/></td>'
        +'<td style="padding:4px;border:1px solid var(--border)"><textarea class="mom-agenda-notes" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;min-height:50px;resize:vertical">'+escH2(a.notes||'')+'</textarea></td>'
        +'<td style="padding:4px;text-align:center;border:1px solid var(--border)"><button onclick="this.parentNode.parentNode.remove()" style="background:none;border:none;cursor:pointer;color:var(--red)"><i class="ti ti-x"></i></button></td>';
      ab.appendChild(tr);
    });
  }
  // Render recommendations
  var rb=document.getElementById('mom-rec-body');
  var re=document.getElementById('mom-rec-empty');
  if(rb&&m.recommendations&&m.recommendations.length){
    if(re)re.style.display='none';
    rb.innerHTML='';
    m.recommendations.forEach(function(r){
      var tr=document.createElement('tr');
      tr.innerHTML='<td style="padding:6px;text-align:center;border:1px solid var(--border);font-weight:700;font-size:12px;color:var(--text2)">•</td>'
        +'<td style="padding:4px;border:1px solid var(--border)"><input type="text" class="mom-rec-desc" value="'+escH2(r.desc||'')+'" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"/></td>'
        +'<td style="padding:4px;border:1px solid var(--border)"><input type="text" class="mom-rec-resp" value="'+escH2(r.resp||'')+'" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"/></td>'
        +'<td style="padding:4px;border:1px solid var(--border)"><input type="date" class="mom-rec-date" value="'+(r.date||'')+'" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"/></td>'
        +'<td style="padding:4px;border:1px solid var(--border)"><select class="mom-rec-prio" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"><option value="low"'+(r.prio==='low'?' selected':'')+'>Low</option><option value="medium"'+((!r.prio||r.prio==='medium')?' selected':'')+'>Medium</option><option value="high"'+(r.prio==='high'?' selected':'')+'>High</option><option value="critical"'+(r.prio==='critical'?' selected':'')+'>Critical</option></select></td>'
        +'<td style="padding:4px;border:1px solid var(--border)"><select class="mom-rec-status" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px"><option value="open"'+(r.status==='open'?' selected':'')+'>Open</option><option value="in_progress"'+(r.status==='in_progress'?' selected':'')+'>In progress</option><option value="closed"'+(r.status==='closed'?' selected':'')+'>Closed</option></select></td>'
        +'<td style="padding:4px;text-align:center;border:1px solid var(--border)"><button onclick="this.parentNode.parentNode.remove()" style="background:none;border:none;cursor:pointer;color:var(--red)"><i class="ti ti-x"></i></button></td>';
      rb.appendChild(tr);
    });
  }else if(re){re.style.display='block';}
  document.getElementById('mtg-mom-title').textContent='Minutes of Meeting';
  document.getElementById('mtg-mom-ref').textContent=m.title||'';
  document.getElementById('mtg-mom-del-btn').style.display=isMgr()?'inline-flex':'none';
  document.getElementById('mtg-view-schedule').style.display='none';
  document.getElementById('mtg-view-minutes').style.display='none';
  document.getElementById('mtg-series-form').style.display='none';
  document.getElementById('mtg-mom-form').style.display='block';
}

async function mtgDeleteMomFromList(id){
  if(!confirm('Delete these minutes? This cannot be undone.'))return;
  try{
    await api('/action_tracker?source_module=eq.meeting&source_id=eq.'+id,{m:'DELETE'});
    await api('/hse_meetings?id=eq.'+id,{m:'DELETE'});
    toast('Minutes deleted!');
    mtgLoadMinutes();
  }catch(e){toast(e.message,false);console.error(e);}
}

function escH2(str){return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

async function saveMtg(){mtgSaveMom();}

async function loadTraining(){
const el=document.getElementById('training-list');
if(!el)return;
try{
const d=await api('/training_sessions?select=*'+cf()+'&order=date_conducted.desc');
if(!d||!d.length){el.innerHTML='<p style="padding:20px;color:#666">No training sessions yet</p>';return;}
let h='<table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f9fafb"><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Course</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Trainer</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Date</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Expiry</th></tr></thead><tbody>';
for(var i=0;i<d.length;i++){var x=d[i];var dt=x.date_conducted?new Date(x.date_conducted).toLocaleDateString('en-GB'):'--';var ex=x.expiry_date?new Date(x.expiry_date).toLocaleDateString('en-GB'):'--';h+='<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:10px">'+(x.course||'--')+'</td><td style="padding:10px">'+(x.trainer||'--')+'</td><td style="padding:10px">'+dt+'</td><td style="padding:10px">'+ex+'</td></tr>';}
h+='</tbody></table>';if(el)el.innerHTML=h;
}catch(e){if(el)el.innerHTML='<p style="padding:20px;color:red">'+e.message+'</p>';console.error(e);}
}

async function saveTraining(){
if(!isMgr()){toast('Access denied',false);return;}
try{
const sel=document.getElementById('tf-attendees');
const selected=Array.from(sel.selectedOptions).map(o=>pname(o.value)).join(', ');
await api('/training_sessions',{m:'POST',p:'return=minimal',b:{company_id:prof?.company_id,course:document.getElementById('tf-course').value,trainer:document.getElementById('tf-trainer').value,date_conducted:document.getElementById('tf-date').value||null,expiry_date:document.getElementById('tf-expiry').value||null,attendees:selected,created_by:prof?.id}});
toggleForm('training-form');toast('Training saved!');loadTraining();
}catch(e){toast(e.message,false);}
}
async function loadActions(){
const el=document.getElementById('actions-list');
if(!el)return;
try{
let path='/action_tracker?select=*'+cf()+'&order=target_date.asc';
const mod=document.getElementById('filter-module')?.value;
const sts=document.getElementById('filter-status')?.value;
const pri=document.getElementById('filter-priority')?.value;
if(mod)path+='&source_module=eq.'+mod;
if(sts)path+='&status=eq.'+sts;
if(pri)path+='&priority=eq.'+pri;
const d=await api(path);
const cnt=document.getElementById('action-count');
if(cnt)cnt.textContent='('+(d||[]).length+' actions)';
if(!d||!d.length){el.innerHTML='<p style="padding:20px;color:#666">No actions found</p>';return;}
const today=new Date();
let h='<table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f9fafb"><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Description</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Source</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Responsible</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Due</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Priority</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Status</th><th style="padding:10px"></th></tr></thead><tbody>';
for(var i=0;i<d.length;i++){
var x=d[i];
var ov=x.target_date&&new Date(x.target_date)<today&&x.status!=='closed';
var dt=x.target_date?new Date(x.target_date).toLocaleDateString('en-GB'):'--';
var bg=ov?'background:#fef2f2':'';
var cb=isMgr()?'<button class="btn btn-sm" data-id="'+x.id+'" data-st="'+x.status+'" onclick="var b=this;cycleAction(b.dataset.id,b.dataset.st)"><i class="ti ti-check"></i></button>':'';
h+='<tr style="border-bottom:1px solid #f3f4f6;'+bg+'"><td style="padding:10px">'+(x.description||'--')+(ov?' <span style="color:red;font-size:10px;font-weight:700">OVERDUE</span>':'')+'</td><td style="padding:10px">'+(x.source_module||'--')+'</td><td style="padding:10px">'+(x.responsible||'--')+'</td><td style="padding:10px">'+dt+'</td><td style="padding:10px">'+prio(x.priority)+'</td><td style="padding:10px">'+stat(x.status)+'</td><td style="padding:10px">'+cb+'</td></tr>';
}
h+='</tbody></table>';if(el)el.innerHTML=h;
}catch(e){if(el)el.innerHTML='<p style="padding:20px;color:red">'+e.message+'</p>';console.error(e);}
}

async function cycleAction(id,s){
if(!isMgr()){toast('Only managers can update actions',false);return;}
const ns=s==='closed'?'open':s==='open'?'in_progress':'closed';
try{
await api('/action_tracker?id=eq.'+id,{m:'PATCH',p:'return=minimal',b:{status:ns,completion_date:ns==='closed'?new Date().toISOString().slice(0,10):null,updated_at:new Date().toISOString()}});
toast(ns==='closed'?'Action closed!':ns==='in_progress'?'Marked in progress!':'Action reopened!');
loadActions();loadDash();
}catch(e){toast(e.message,false);}
}
async function saveAction(){
try{
const rid=document.getElementById('af-resp').value;
await api('/action_tracker',{m:'POST',p:'return=minimal',b:{company_id:prof?.company_id,source_module:document.getElementById('af-module').value,description:document.getElementById('af-desc').value,responsible:rid?pname(rid):null,target_date:document.getElementById('af-date').value||null,priority:document.getElementById('af-priority').value,status:document.getElementById('af-status').value,comments:document.getElementById('af-comments').value,created_by:prof?.id}});
toggleForm('action-form');toast('Action added!');loadActions();
}catch(e){toast(e.message,false);}
}
async function loadDocs(){
const el=document.getElementById('docs-list');
if(!el)return;
try{
const d=await api('/documents?select=*'+cf()+'&order=created_at.desc');
if(!d||!d.length){el.innerHTML='<p style="padding:20px;color:#666">No documents yet</p>';return;}
const today=new Date();
let h='<table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f9fafb"><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Title</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Type</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Ref</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Version</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Review date</th><th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Status</th></tr></thead><tbody>';
for(var i=0;i<d.length;i++){var x=d[i];var rev=x.review_date?new Date(x.review_date):null;var ov=rev&&rev<today;var rv=x.review_date?new Date(x.review_date).toLocaleDateString('en-GB'):'--';var title=x.file_url?'<a href="'+x.file_url+'" target="_blank" style="color:var(--green)">'+x.title+'</a>':(x.title||'--');h+='<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:10px">'+title+'</td><td style="padding:10px">'+(x.doc_type||'--')+'</td><td style="padding:10px">'+(x.reference_no||'--')+'</td><td style="padding:10px">'+(x.version||'--')+'</td><td style="padding:10px;'+(ov?'color:red;font-weight:700':'')+'">'+rv+(ov?' ⚠':'')+'</td><td style="padding:10px">'+stat(x.status)+'</td></tr>';}
h+='</tbody></table>';if(el)el.innerHTML=h;
}catch(e){if(el)el.innerHTML='<p style="padding:20px;color:red">'+e.message+'</p>';console.error(e);}
}

async function saveDoc(){
if(!isMgr()){toast('Access denied',false);return;}
try{
const oid=document.getElementById('df-owner').value;
await api('/documents',{m:'POST',p:'return=minimal',b:{company_id:prof?.company_id,title:document.getElementById('df-title').value,doc_type:document.getElementById('df-type').value,reference_no:document.getElementById('df-ref').value,version:document.getElementById('df-version').value,issue_date:document.getElementById('df-issue').value||null,review_date:document.getElementById('df-review').value||null,owner:oid?pname(oid):null,file_url:document.getElementById('df-url').value||null,status:document.getElementById('df-status').value,created_by:prof?.id}});
toggleForm('doc-form');toast('Document registered!');loadDocs();
}catch(e){toast(e.message,false);}
}
async function loadPeople(){
const btn=document.getElementById('people-add-btn');
if(isMgr())btn.innerHTML='<button class="btn btn-primary" onclick="toggleForm(\'people-form\')"><i class="ti ti-plus"></i>Add person</button>';
const el=document.getElementById('people-list');
try{
let path='/people?select=*'+cf();
const tf=document.getElementById('filter-ptype')?.value,sf=document.getElementById('filter-pstatus')?.value;
if(tf)path+='&person_type=eq.'+tf;
if(sf)path+='&status=eq.'+sf;
path+='&order=last_name';
const d=await api(path);
const all=await api('/people?select=person_type,status'+cf());
document.getElementById('pe-total').textContent=(all||[]).filter(x=>x.status==='active').length;
document.getElementById('pe-emp').textContent=(all||[]).filter(x=>x.person_type==='employee'&&x.status==='active').length;
document.getElementById('pe-con').textContent=(all||[]).filter(x=>x.person_type==='contractor'&&x.status==='active').length;
document.getElementById('pe-sub').textContent=(all||[]).filter(x=>x.person_type==='subcontractor'&&x.status==='active').length;
if(!d?.length){el.innerHTML='<div class="empty">No people registered yet</div>';return;}
el.innerHTML=d.map(p=>{
const ac=p.person_type==='employee'?'emp-av':p.person_type==='contractor'?'con-av':'sub-av';
const ini=(p.first_name?.charAt(0)||'')+(p.last_name?.charAt(0)||'');
const tb=p.person_type==='employee'?'bg':p.person_type==='contractor'?'bb':'ba';
return'<div class="person-card"><div class="person-avatar '+ac+'">'+ini+'</div><div style="flex:1"><div style="font-size:13px;font-weight:700">'+p.first_name+' '+p.last_name+'</div><div style="font-size:11px;color:var(--text2)">'+(p.job_title||'--')+(p.department?' &middot; '+p.department:'')+(p.site?' &middot; '+p.site:'')+'</div>'+(p.person_type!=='employee'&&p.company_name?'<div style="font-size:11px;color:var(--blue)">'+p.company_name+'</div>':'')+'<div style="font-size:11px;color:var(--text3)">ID: '+(p.id_number||'--')+' | Phone: '+(p.phone||'--')+'</div></div><div style="text-align:right"><span class="badge '+tb+'" style="margin-bottom:4px;display:block">'+p.person_type+'</span>'+stat(p.status)+(p.induction_completed?'<br><span style="font-size:10px;color:var(--green)">Inducted</span>':'<br><span style="font-size:10px;color:var(--amber)">No induction</span>')+'</div></div>';
}).join('');
}catch(e){el.innerHTML='<div class="empty" style="color:var(--red)">'+e.message+'</div>';}
}
async function savePerson(){
if(!isMgr()){toast('Access denied',false);return;}
try{
await api('/people',{m:'POST',p:'return=minimal',b:{company_id:prof?.company_id,person_type:document.getElementById('pef-type').value,first_name:document.getElementById('pef-first').value,last_name:document.getElementById('pef-last').value,id_number:document.getElementById('pef-id').value,date_of_birth:document.getElementById('pef-dob').value||null,gender:document.getElementById('pef-gender').value||null,nationality:document.getElementById('pef-nationality').value,job_title:document.getElementById('pef-jobtitle').value,department:document.getElementById('pef-dept').value,site:document.getElementById('pef-site').value,employee_number:document.getElementById('pef-empno').value,contract_type:document.getElementById('pef-contract').value,start_date:document.getElementById('pef-start').value||null,end_date:document.getElementById('pef-end').value||null,company_name:document.getElementById('pef-coname').value,contract_ref:document.getElementById('pef-cref').value,contract_start:document.getElementById('pef-cstart').value||null,contract_end:document.getElementById('pef-cend').value||null,email:document.getElementById('pef-email').value,phone:document.getElementById('pef-phone').value,emergency_name:document.getElementById('pef-emname').value,emergency_relation:document.getElementById('pef-emrel').value,emergency_phone:document.getElementById('pef-emphone').value,induction_date:document.getElementById('pef-induction').value||null,induction_completed:!!document.getElementById('pef-induction').value,medical_fitness_date:document.getElementById('pef-medical').value||null,status:document.getElementById('pef-status').value,created_by:prof?.id}});
toggleForm('people-form');toast('Person added!');loadPeople();await loadPeopleCache();
}catch(e){toast(e.message,false);}
}
async function loadUsers(){
if(isInsp()){document.getElementById('users-list').innerHTML=denied();return;}
if(isAdm()){const c=document.getElementById('user-role-card');if(c)c.style.display='block';}
const el=document.getElementById('users-list');
if(!el)return;
try{
const filter=prof?.company_id&&!isSA()?'&company_id=eq.'+prof.company_id:'';
const d=await api('/profiles?select=*'+filter+'&order=full_name');
if(!d||!d.length){el.innerHTML='<div class="empty">No users found</div>';return;}
const tbl=document.createElement('table');
tbl.innerHTML='<thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>';
const tb=document.createElement('tbody');
d.forEach(function(u){
const tr=document.createElement('tr');
tr.innerHTML='<td><strong>'+(u.full_name||'--')+'</strong></td><td>'+(u.email||'--')+'</td><td>'+stat(u.role)+'</td>';
tb.appendChild(tr);
});
tbl.appendChild(tb);el.innerHTML='';el.appendChild(tbl);
}catch(e){el.innerHTML='<div class="empty" style="color:var(--red)">'+e.message+'</div>';console.error(e);}
}

async function updateRole(){
if(!isAdm()){toast('Access denied',false);return;}
const email=document.getElementById('ur-email').value.trim(),role=document.getElementById('ur-role').value;
if(!email){toast('Enter an email',false);return;}
try{
await api('/profiles?email=eq.'+email+'&company_id=eq.'+prof.company_id,{m:'PATCH',p:'return=minimal',b:{role}});
toast('User role updated!');loadUsers();
}catch(e){toast(e.message,false);}
}
async function loadAdmin(){
const el=document.getElementById('companies-list');
try{
const d=await api('/companies?select=*&order=name');
el.innerHTML=!d?.length?'<div class="empty">No companies</div>':'<table><thead><tr><th>Company</th><th>Industry</th><th>Contact</th><th>Status</th></tr></thead><tbody>'+d.map(x=>'<tr><td>'+(x.logo_url?'<img src="'+x.logo_url+'" style="height:20px;margin-right:6px;vertical-align:middle" alt="logo"/>':'')+x.name+'</td><td>'+(x.industry||'--')+'</td><td>'+(x.contact_email||'--')+'</td><td><span class="badge '+(x.active?'bg':'ba')+'">'+(x.active?'Active':'Inactive')+'</span></td></tr>').join('')+'</tbody></table>';
}catch(e){el.innerHTML='<div class="empty" style="color:var(--red)">'+e.message+'</div>';}
}
async function saveCompany(){
try{
await api('/companies',{m:'POST',p:'return=minimal',b:{name:document.getElementById('co-name').value,industry:document.getElementById('co-industry').value,contact_name:document.getElementById('co-contact').value,contact_email:document.getElementById('co-email').value,logo_url:document.getElementById('co-logo').value||null,active:true}});
toast('Company registered!');loadAdmin();loadCoDrop();
['co-name','co-contact','co-email','co-logo'].forEach(id=>document.getElementById(id).value='');
}catch(e){toast(e.message,false);}
}
function loadSettings(){
if(isAdm())document.getElementById('logo-settings').style.display='block';
document.getElementById('my-profile-info').innerHTML='<div style="font-size:13px"><strong>'+(prof?.full_name||'--')+'</strong><br><span style="color:var(--text2)">'+(prof?.email||'--')+'</span><br>'+stat(prof?.role)+'</div>';
}
async function saveLogo(){
const url=document.getElementById('set-logo').value;
if(!prof?.company_id){toast('No company linked',false);return;}
try{
await api('/companies?id=eq.'+prof.company_id,{m:'PATCH',p:'return=minimal',b:{logo_url:url||null}});
toast('Logo updated! Refresh to see it.');
}catch(e){toast(e.message,false);}
}
async function loadCoDrop(){
try{
const d=await api('/companies?select=id,name&active=eq.true&order=name');
const sel=document.getElementById('reg-company');
sel.innerHTML=d?.length?d.map(c=>'<option value="'+c.id+'">'+c.name+'</option>').join(''):'<option value="">No companies yet</option>';
}catch(e){}
}
loadCoDrop();
document.getElementById('if-date')&&(document.getElementById('if-date').value=new Date().toISOString().slice(0,10));
async function kpiLoadAll(){
var yr=parseInt(document.getElementById('year-sel')?.value)||new Date().getFullYear();
document.getElementById('kpi-monthly-year').textContent=yr;
try{
kpiObjectives=[];kpiKPIs=[];kpiIndicators=[];kpiMonthlyData={};
await kpiLoadObjectives(yr);
await kpiLoadKPIsData(yr);
await kpiLoadIndicators();
await kpiLoadMonthly(yr);
kpiRenderOverview();kpiRenderMonthly();kpiUpdateMetrics();
}catch(e){toast(e.message,false);}
}

async function kpiLoadObjectives(yr){
try{const d=await api('/objectives?select=*'+cf()+'&year=eq.'+yr+'&order=sort_order,code');kpiObjectives=d||[];}
catch(e){kpiObjectives=[];}
}

async function kpiLoadKPIsData(yr){
try{const d=await api('/kpis_v2?select=*'+cf()+'&year=eq.'+yr+'&order=code');kpiKPIs=d||[];}
catch(e){kpiKPIs=[];}
}

async function kpiLoadIndicators(){
try{
if(!kpiKPIs.length){kpiIndicators=[];return;}
const d=await api('/kpi_indicators?select=*'+cf()+'&order=sort_order,created_at');
const kpiIds=new Set(kpiKPIs.map(k=>k.id));
kpiIndicators=(d||[]).filter(i=>kpiIds.has(i.kpi_id));
}catch(e){kpiIndicators=[];}
}

async function kpiLoadMonthly(yr){
try{
const d=await api('/kpi_monthly_data?select=*'+cf()+'&year=eq.'+yr);
kpiMonthlyData={};
(d||[]).forEach(r=>{
const key=r.indicator_id||r.kpi_id;
if(!kpiMonthlyData[key])kpiMonthlyData[key]={};
kpiMonthlyData[key][r.month]=r;
});
}catch(e){kpiMonthlyData={};}
}

function kpiUpdateMetrics(){
const total=kpiKPIs.length;
const onTrack=kpiKPIs.filter(k=>k.status==='on_track').length;
const atRisk=kpiKPIs.filter(k=>k.status==='at_risk').length;
const offTrack=kpiKPIs.filter(k=>k.status==='off_track').length;
const setEl=function(id,v,c){var e=document.getElementById(id);if(e){e.textContent=v;if(c)e.style.color=c;}};
setEl('km-total',total,'var(--text)');
setEl('km-ontrack',onTrack,onTrack>0?'var(--green)':'var(--text3)');
setEl('km-atrisk',atRisk,atRisk>0?'var(--amber)':'var(--text3)');
setEl('km-offtrack',offTrack,offTrack>0?'var(--red)':'var(--text3)');
}

function kpiFmtTarget(ind){
const op={eq:'',gte:'>=',lte:'<=',gt:'>',lt:'<'}[ind.target_operator||'gte']||'>=';
return op+(ind.target_value!==null&&ind.target_value!==undefined?ind.target_value:'--')+(ind.unit?' '+ind.unit:'');
}

function kpiStatBadge(s){
const cls={on_track:'bg',at_risk:'ba',off_track:'br',not_started:'bgr'}[s]||'bgr';
const lbl={on_track:'On Track',at_risk:'At Risk',off_track:'Off Track',not_started:'Not Started'}[s]||s;
return '<span class="badge '+cls+'">'+lbl+'</span>';
}

function kpiCellStyle(ind,val){
if(val===null||val===undefined)return '';
const t=parseFloat(ind.target_value);if(isNaN(t))return '';
const op=ind.target_operator||'gte';
const ok=op==='eq'?val===t:op==='gte'?val>=t:op==='lte'?val<=t:op==='gt'?val>t:val<t;
if(ok)return 'background:#EAF3DE;color:#3B6D11;font-weight:600';
const diff=Math.abs(val-t)/Math.max(Math.abs(t),1);
return diff<=0.15?'background:#FAEEDA;color:#854F0B;font-weight:600':'background:#FCEBEB;color:#A32D2D;font-weight:600';
}

function kpiGetProgress(ind,actual){
if(actual===null||actual===undefined)return null;
const t=parseFloat(ind.target_value);if(isNaN(t))return null;
if(t===0)return actual===0?100:0;
const op=ind.target_operator||'gte';
if(op==='lte'||op==='lt')return Math.min(100,Math.max(0,(1-(actual/t))*100+100));
return Math.min(100,Math.max(0,(actual/t)*100));
}

function kpiProgColor(prog){return prog>=100?'#1D9E75':prog>=70?'#EF9F27':'#E24B4A';}

function kpiFmtNumberOnly(v){
const n=parseFloat(v);
if(isNaN(n))return v===null||v===undefined?'--':String(v);
return Number.isInteger(n)?String(n):String(Math.round(n*100)/100);
}

function kpiCalcYTD(indicatorId,month,actual){
const ind=kpiIndicators.find(x=>x.id===indicatorId);
if(!ind)return actual;
const mdata=kpiMonthlyData[indicatorId]||{};
const method=ind.ytd_method||'sum';
const vals=[];
for(let i=1;i<month;i++){
if(mdata[i]&&mdata[i].actual!==null&&mdata[i].actual!==undefined)
vals.push(parseFloat(mdata[i].actual));
}
vals.push(actual);
if(!vals.length)return actual;
if(method==='last')return vals[vals.length-1];
if(method==='average')return Math.round((vals.reduce((a,b)=>a+b,0)/vals.length)*100)/100;
if(method==='max')return Math.max(...vals);
if(method==='min')return Math.min(...vals);
return Math.round(vals.reduce((a,b)=>a+b,0)*100)/100;
}

function kpiRenderOverview(){
const c=document.getElementById('kpi-objectives-container');
if(!c)return;
if(!kpiObjectives.length){
c.innerHTML='<div style="text-align:center;padding:40px;color:var(--text3)">No objectives yet'+(isMgr()?' — click Add objective to start':'')+'</div>';
return;
}
c.innerHTML='';
kpiObjectives.forEach(function(obj){
const objKPIs=kpiKPIs.filter(function(k){return k.objective_id===obj.id;});
const onT=objKPIs.filter(function(k){return k.status==='on_track';}).length;
const totalInds=objKPIs.reduce(function(s,k){return s+kpiIndicators.filter(function(i){return i.kpi_id===k.id;}).length;},0);
const block=document.createElement('div');
block.style.cssText='margin-bottom:20px;border-radius:12px;overflow:hidden;border:1px solid var(--border)';
const hdr=document.createElement('div');
hdr.style.cssText='display:flex;align-items:center;gap:10px;padding:12px 16px;background:'+obj.color+';cursor:pointer';
hdr.onclick=function(){kpiToggleObj(obj.id);};
const numEl=document.createElement('div');
numEl.style.cssText='width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.25);color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0';
numEl.textContent=obj.code||'?';
const nameEl=document.createElement('div');
nameEl.style.cssText='flex:1;font-size:14px;font-weight:700;color:#fff';
nameEl.textContent=obj.name;
const metaEl=document.createElement('div');
metaEl.style.cssText='font-size:11px;color:rgba(255,255,255,.8)';
metaEl.textContent=objKPIs.length+' KPI'+(objKPIs.length!==1?'s':'')+' · '+totalInds+' indicator'+(totalInds!==1?'s':'')+' · '+onT+'/'+objKPIs.length+' on track';
hdr.appendChild(numEl);hdr.appendChild(nameEl);hdr.appendChild(metaEl);
if(isMgr()){
const acts=document.createElement('div');acts.style.cssText='display:flex;gap:4px';acts.onclick=function(e){e.stopPropagation();};
const addKpiBtn=document.createElement('button');
addKpiBtn.style.cssText='background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;display:flex;align-items:center;gap:4px';
addKpiBtn.innerHTML='<i class="ti ti-plus"></i>Add KPI';
addKpiBtn.onclick=function(e){e.stopPropagation();openKpiAddModal(null,obj.id);};
const editBtn=document.createElement('button');
editBtn.style.cssText='background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px';
editBtn.innerHTML='<i class="ti ti-edit"></i>';
editBtn.onclick=function(e){e.stopPropagation();openObjModal(obj.id);};
acts.appendChild(addKpiBtn);acts.appendChild(editBtn);hdr.appendChild(acts);
}
const chevron=document.createElement('i');
chevron.className='ti ti-chevron-down';
chevron.style.cssText='color:rgba(255,255,255,.7);font-size:16px';
chevron.id='kpi-chev-'+obj.id;
hdr.appendChild(chevron);
block.appendChild(hdr);
const body=document.createElement('div');
body.id='kpi-obj-body-'+obj.id;
body.style.cssText='background:var(--card);display:block';
if(!objKPIs.length){
body.innerHTML='<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px">No KPIs yet'+(isMgr()?' — click + Add KPI above':'')+'</div>';
}else{
const tbl=document.createElement('table');
tbl.style.cssText='width:100%;min-width:1280px;border-collapse:collapse;font-size:13px;table-layout:fixed';
tbl.innerHTML='<colgroup><col style="width:58px"><col style="width:24%"><col style="width:34%"><col style="width:220px"><col style="width:160px"><col style="width:130px"></colgroup><thead><tr>'
+'<th style="text-align:left;font-weight:600;color:var(--text2);padding:9px 12px;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;background:#fafafa">Code</th>'
+'<th style="text-align:left;font-weight:600;color:var(--text2);padding:9px 12px;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;background:#fafafa">KPI name</th>'
+'<th style="text-align:left;font-weight:600;color:var(--text2);padding:9px 12px;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;background:#fafafa">Measurement indicator</th>'
+'<th style="text-align:left;font-weight:600;color:var(--text2);padding:9px 12px;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;background:#fafafa">Target</th>'
+'<th style="text-align:left;font-weight:600;color:var(--text2);padding:9px 12px;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;background:#fafafa">Responsible</th>'
+'<th style="text-align:left;font-weight:600;color:var(--text2);padding:9px 12px;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;background:#fafafa">Status</th>'
+'</tr></thead>';
const tbody=document.createElement('tbody');
objKPIs.forEach(function(k){
const inds=kpiIndicators.filter(function(i){return i.kpi_id===k.id;});
const tr=document.createElement('tr');
tr.style.cursor='pointer';
tr.onmouseover=function(){this.style.background='#f9fafb';};
tr.onmouseout=function(){this.style.background='';};
tr.onclick=function(){openKpiAddModal(k.id,obj.id);};
if(!inds.length){
tr.innerHTML='<td style="padding:10px 12px;border-bottom:1px solid var(--border);color:var(--text2);font-size:11px;font-weight:700;vertical-align:middle">'+(k.code||'')+'</td>'
+'<td style="padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:middle"><strong>'+k.name+'</strong></td>'
+'<td style="padding:10px 12px;border-bottom:1px solid var(--border);color:var(--text3);font-size:12px;font-style:italic" colspan="2">No indicators yet</td>'
+'<td style="padding:10px 12px;border-bottom:1px solid var(--border);font-size:12px">'+(k.responsible||'--')+'</td>'
+'<td style="padding:10px 12px;border-bottom:1px solid var(--border)">'+kpiStatBadge(k.status)+'</td>';
tbody.appendChild(tr);
}else{
inds.forEach(function(ind,indIdx){
const indRow=indIdx===0?tr:document.createElement('tr');
if(indIdx>0){indRow.style.cursor='pointer';indRow.onmouseover=function(){this.style.background='#f9fafb';};indRow.onmouseout=function(){this.style.background='';};indRow.onclick=function(){openKpiAddModal(k.id,obj.id);};}
const isLast=indIdx===inds.length-1;
const bdr=isLast?'border-bottom:2px solid var(--border)':'border-bottom:1px solid #f0f0f0';
indRow.innerHTML=
(indIdx===0?'<td style="padding:10px 12px;'+bdr+';color:var(--text2);font-size:11px;font-weight:700;vertical-align:middle" rowspan="'+inds.length+'">'+(k.code||'')+'</td>'
+'<td style="padding:10px 12px;'+bdr+';vertical-align:middle" rowspan="'+inds.length+'"><strong>'+k.name+'</strong><br><span style="font-size:11px;color:var(--text3)">'+(k.frequency||'monthly')+'</span></td>':'')
+'<td style="padding:8px 12px;'+bdr+';font-size:12px;color:var(--text2);vertical-align:middle;line-height:1.4;overflow-wrap:anywhere">'+ind.name+'</td>'
+'<td style="padding:8px 12px;'+bdr+';font-size:12px;font-weight:600;color:var(--text);vertical-align:middle;line-height:1.35;word-break:normal;overflow-wrap:break-word">'+kpiFmtTarget(ind)+'</td>'
+(indIdx===0?'<td style="padding:10px 12px;'+bdr+';font-size:12px;vertical-align:middle;line-height:1.35" rowspan="'+inds.length+'">'+(k.responsible||'--')+'</td>'
+'<td style="padding:10px 12px;'+bdr+';vertical-align:middle" rowspan="'+inds.length+'">'+kpiStatBadge(k.status)+'</td>':'');
tbody.appendChild(indRow);
});
}
});
tbl.appendChild(tbody);
const tableWrap=document.createElement('div');
tableWrap.style.cssText='overflow-x:auto;width:100%';
tableWrap.appendChild(tbl);
body.appendChild(tableWrap);
}
block.appendChild(body);c.appendChild(block);
});
}

const KPI_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function kpiRenderMonthly(){
const tbody=document.getElementById('kpi-monthly-body');
if(!tbody)return;
tbody.innerHTML='';
if(!kpiObjectives.length){
tbody.innerHTML='<tr><td colspan="18" style="text-align:center;padding:30px;color:var(--text3)">No objectives yet</td></tr>';
return;
}
let hasAny=false;
kpiObjectives.forEach(function(obj){
const objKPIs=kpiKPIs.filter(function(k){return k.objective_id===obj.id;});
if(!objKPIs.length)return;
hasAny=true;
const objRow=document.createElement('tr');
const objTd=document.createElement('td');
objTd.colSpan=18;
objTd.style.cssText='background:'+obj.color+'22;border-left:4px solid '+obj.color+';padding:7px 12px;font-weight:700;font-size:11px;color:'+obj.color+';text-transform:uppercase;border:1px solid var(--border)';
objTd.textContent=obj.code+'. '+obj.name;
objRow.appendChild(objTd);tbody.appendChild(objRow);
objKPIs.forEach(function(k){
const inds=kpiIndicators.filter(function(i){return i.kpi_id===k.id;});
if(!inds.length){
const pr=document.createElement('tr');
pr.innerHTML='<td style="border:1px solid var(--border);padding:8px 12px;font-size:11px;font-weight:700;color:var(--text2);text-align:center">'+(k.code||'')+'</td>'
+'<td style="border:1px solid var(--border);padding:8px 12px;font-size:12px;font-weight:600">'+k.name+'</td>'
+'<td colspan="15" style="border:1px solid var(--border);padding:8px 12px;font-size:12px;color:var(--text2);font-style:italic">No indicators added yet</td>'
+'<td style="border:1px solid var(--border)"></td>';
tbody.appendChild(pr);return;
}
inds.forEach(function(ind,indIdx){
const mdata=kpiMonthlyData[ind.id]||{};
let ytdSum=0;let hasData=false;
const tr=document.createElement('tr');
if(indIdx===0){
const codeTd=document.createElement('td');
codeTd.style.cssText='border:1px solid var(--border);padding:8px 10px;font-size:11px;font-weight:700;color:var(--text2);text-align:center;vertical-align:middle';
codeTd.rowSpan=inds.length;codeTd.textContent=k.code||'';tr.appendChild(codeTd);
const nameTd=document.createElement('td');
nameTd.style.cssText='border:1px solid var(--border);padding:8px 10px;font-size:12px;font-weight:600;vertical-align:middle';
nameTd.rowSpan=inds.length;nameTd.textContent=k.name;tr.appendChild(nameTd);
}
const indTd=document.createElement('td');
indTd.style.cssText='border:1px solid var(--border);padding:6px 10px;font-size:12px;color:var(--text2);vertical-align:middle';
indTd.textContent=ind.name;tr.appendChild(indTd);
const tgtTd=document.createElement('td');
tgtTd.style.cssText='border:1px solid var(--border);padding:6px 8px;text-align:center;font-weight:600;font-size:12px;background:#f9fafb;white-space:nowrap';
tgtTd.textContent=kpiFmtTarget(ind);tr.appendChild(tgtTd);
KPI_MONTHS.forEach(function(_,mi){
const m=mi+1;const entry=mdata[m];
const td=document.createElement('td');
td.style.cssText='border:1px solid var(--border);padding:6px 8px;text-align:center;cursor:pointer';
td.title='Click to '+(entry?'edit':'enter value');
if(entry&&entry.actual!==null&&entry.actual!==undefined){
hasData=true;const val=parseFloat(entry.actual);ytdSum+=val;
const sty=kpiCellStyle(ind,val);if(sty)td.style.cssText+=';'+sty;
td.textContent=kpiFmtNumberOnly(val);
}else{td.style.color='var(--text3)';td.textContent='--';}
(function(indId,kId,mn){td.onclick=function(){kpiOpenEntry(indId,kId,mn);};})(ind.id,k.id,m);
tr.appendChild(td);
});
const ytdVals=Object.values(mdata).filter(function(v){return v.ytd!==null&&v.ytd!==undefined;});
const ytd=ytdVals.length?parseFloat(ytdVals[ytdVals.length-1].ytd):ytdSum;
const ytdTd=document.createElement('td');
const ytdSty=hasData?kpiCellStyle(ind,ytd):'';
ytdTd.style.cssText='border:1px solid var(--border);padding:6px 8px;text-align:center;font-weight:700'+(ytdSty?';'+ytdSty:'');
ytdTd.textContent=hasData?kpiFmtNumberOnly(ytd):'--';tr.appendChild(ytdTd);
if(indIdx===0){
const stTd=document.createElement('td');
stTd.style.cssText='border:1px solid var(--border);padding:6px 8px;text-align:center;vertical-align:middle';
stTd.rowSpan=inds.length;stTd.innerHTML=kpiStatBadge(k.status);tr.appendChild(stTd);
}
tbody.appendChild(tr);
});
});
});
if(!hasAny)tbody.innerHTML='<tr><td colspan="18" style="text-align:center;padding:30px;color:var(--text3)">No KPIs yet</td></tr>';
}

function kpiToggleObj(id){
const b=document.getElementById('kpi-obj-body-'+id);
const c=document.getElementById('kpi-chev-'+id);
const open=b.style.display==='none';
b.style.display=open?'block':'none';
if(c)c.className='ti '+(open?'ti-chevron-up':'ti-chevron-down');
}

function kpiSwitchTab(tab,btn){
document.querySelectorAll('.kpi-tab').forEach(t=>{t.style.background='transparent';t.style.color='var(--text2)';});
btn.style.background='var(--green)';btn.style.color='#fff';
document.getElementById('kpi-tab-overview').style.display=tab==='overview'?'block':'none';
document.getElementById('kpi-tab-monthly').style.display=tab==='monthly'?'block':'none';
}

function kpiSelectColor(color,el){
kpiSelectedColor=color;
document.querySelectorAll('.kpi-color-dot').forEach(d=>d.style.border='2px solid transparent');
if(el)el.style.border='3px solid var(--text)';
else document.querySelectorAll('.kpi-color-dot').forEach(d=>{if(d.style.background===color)d.style.border='3px solid var(--text)';});
}

function closeKpiModal(id){const e=document.getElementById(id);if(e)e.style.display='none';}
function openKpiModal(id){const e=document.getElementById(id);if(e)e.style.display='flex';}




async function kpiDeleteObjective(){
if(!kpiEditObjId||!confirm("Delete this objective and all its KPIs?"))return;
try{
const kpiIds=kpiKPIs.filter(k=>k.objective_id===kpiEditObjId).map(k=>k.id);
for(const kid of kpiIds){
await api('/kpi_indicators?kpi_id=eq.'+kid,{m:'DELETE'});
await api('/kpis_v2?id=eq.'+kid,{m:'DELETE'});
}
await api('/objectives?id=eq.'+kpiEditObjId,{m:'DELETE'});
toast('Deleted!');closeKpiModal('obj-modal');await kpiLoadAll();
}catch(e){toast(e.message,false);}
}
function kpiAddIndicatorRow(name='',target='',operator='gte',unit='',ytdMethod='sum'){
const list=document.getElementById('kpi-indicators-list');
const idx=list.children.length;
const row=document.createElement('div');
row.style.cssText='display:grid;grid-template-columns:1fr 80px 120px 100px auto;gap:6px;align-items:center;background:#f9fafb;padding:8px 10px;border-radius:8px;border:1px solid var(--border)';
row.style.cssText='background:#f9fafb;padding:10px 12px;border-radius:8px;border:1px solid var(--border);position:relative';
row.innerHTML=
'<div style="margin-bottom:8px">'
+'<input type="text" class="ind-name-input" placeholder="Measurement indicator name (e.g. Number of near misses reported per month)" value="'+name+'" style="font-size:13px;padding:8px 10px;width:100%;border:1px solid var(--border);border-radius:8px;box-sizing:border-box"/>'
+'</div>'
+'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
+'<label style="font-size:11px;color:var(--text2);font-weight:500">Target:</label>'
+'<input type="number" class="ind-target-input" placeholder="e.g. 4" value="'+target+'" step="any" style="font-size:12px;padding:6px 8px;width:90px;border:1px solid var(--border);border-radius:8px;text-align:center"/>'
+'<select class="ind-op-input" style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:8px">'
+'<option value="gte" '+(operator==="gte"?"selected":"")+'>&#8805; min</option>'
+'<option value="eq" '+(operator==="eq"?"selected":"")+'>= exact</option>'
+'<option value="lte" '+(operator==="lte"?"selected":"")+'>&#8804; max</option>'
+'<option value="gt" '+(operator==="gt"?"selected":"")+'>></option>'
+'<option value="lt" '+(operator==="lt"?"selected":"")+'>< </option>'
+'</select>'
+'<label style="font-size:11px;color:var(--text2);font-weight:500">Unit:</label>'
+'<select class="ind-unit-input" style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:8px">'
+'<option value="" '+(unit===""?"selected":"")+'>Number</option>'
+'<option value="%" '+(unit==="%"?"selected":"")+'>%</option>'
+'<option value="decimal" '+(unit==="decimal"?"selected":"")+'>Decimal</option>'
+'<option value="kg" '+(unit==="kg"?"selected":"")+'>kg</option>'
+'<option value="L" '+(unit==="L"?"selected":"")+'>Litres</option>'
+'<option value="m3" '+(unit==="m3"?"selected":"")+'>m³</option>'
+'<option value="hrs" '+(unit==="hrs"?"selected":"")+'>Hours</option>'
+'<option value="days" '+(unit==="days"?"selected":"")+'>Days</option>'
+'<option value="MWh" '+(unit==="MWh"?"selected":"")+'>MWh</option>'
+'<option value="score" '+(unit==="score"?"selected":"")+'>Score</option>'
+'<option value="ratio" '+(unit==="ratio"?"selected":"")+'>Ratio</option>'
+'</select>'
+'<label style="font-size:11px;color:var(--text2);font-weight:500">YTD:</label>'
+'<select class="ind-ytd-input" style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:8px">'
+'<option value="sum" '+(ytdMethod==="sum"?"selected":"")+'>Sum</option>'
+'<option value="average" '+(ytdMethod==="average"?"selected":"")+'>Average</option>'
+'<option value="last" '+(ytdMethod==="last"?"selected":"")+'>Last value</option>'
+'<option value="max" '+(ytdMethod==="max"?"selected":"")+'>Max</option>'
+'<option value="min" '+(ytdMethod==="min"?"selected":"")+'>Min</option>'
+'</select>'
+'<button type="button" onclick="this.parentNode.parentNode.remove()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:20px;margin-left:auto;padding:2px 6px"><i class="ti ti-trash"></i></button>'
+'</div>';
row.setAttribute('data-ind-row','1');
list.appendChild(row);
}
function openKpiAddModal(kpiId=null,objId=null){
kpiEditKpiId=kpiId;
document.getElementById('kpi-modal-title').textContent=kpiId?'Edit KPI':'Add KPI';
document.getElementById('kpi-delete-btn').style.display=kpiId?'flex':'none';
const sel=document.getElementById('kpi-obj-sel');
sel.innerHTML='<option value="">Select objective...</option>'+kpiObjectives.map(o=>'<option value="'+o.id+'">'+o.code+'. '+o.name+'</option>').join('');
document.getElementById('kpi-indicators-list').innerHTML='';
if(kpiId){
const k=kpiKPIs.find(x=>x.id===kpiId);
if(k){
document.getElementById('kpi-code').value=k.code||'';
document.getElementById('kpi-name').value=k.name||'';
document.getElementById('kpi-freq').value=k.frequency||'monthly';
document.getElementById('kpi-resp').value=k.responsible||'';
document.getElementById('kpi-status').value=k.status||'not_started';
sel.value=k.objective_id||objId||'';
const inds=kpiIndicators.filter(i=>i.kpi_id===kpiId);
if(inds.length){inds.forEach(i=>kpiAddIndicatorRow(i.name,i.target_value!==null?i.target_value:'',i.target_operator||'gte',i.unit||'',i.ytd_method||'sum'));}else{kpiAddIndicatorRow();}
}
}else{
['kpi-name','kpi-resp'].forEach(id=>document.getElementById(id).value='');
document.getElementById('kpi-freq').value='monthly';
document.getElementById('kpi-status').value='not_started';
if(objId){
sel.value=objId;
const obj=kpiObjectives.find(o=>o.id===objId);
if(obj){const existingKPIs=kpiKPIs.filter(k=>k.objective_id===objId);document.getElementById('kpi-code').value=(obj.code||'?')+'.'+(existingKPIs.length+1);}
}else{document.getElementById('kpi-code').value='';}
kpiAddIndicatorRow();
}
sel.onchange=function(){
if(!kpiId&&this.value){
const obj=kpiObjectives.find(o=>o.id===this.value);
if(obj){const ex=kpiKPIs.filter(k=>k.objective_id===this.value);document.getElementById('kpi-code').value=(obj.code||'?')+'.'+(ex.length+1);}
}
};
openKpiModal('kpi-edit-modal');
}
async function kpiSaveKPI(){
const name=document.getElementById('kpi-name').value.trim();
const objId=document.getElementById('kpi-obj-sel').value;
if(!name){toast('Please enter a KPI name',false);return;}
if(!objId){toast('Please select an objective',false);return;}
const indRows=Array.from(document.getElementById('kpi-indicators-list').children);
if(!indRows.length){toast('Please add at least one measurement indicator',false);return;}
const indicators=indRows.map(row=>{
const nameEl=row.querySelector('.ind-name-input');
const targetEl=row.querySelector('.ind-target-input');
const opEl=row.querySelector('.ind-op-input');
const unitEl=row.querySelector('.ind-unit-input');
const ytdEl=row.querySelector('.ind-ytd-input');
if(!nameEl||!nameEl.value.trim())return null;
return{
name:nameEl.value.trim(),
target_value:targetEl&&targetEl.value!==''?parseFloat(targetEl.value):null,
target_operator:opEl?opEl.value:'gte',
unit:unitEl?unitEl.value||null:null,
ytd_method:ytdEl?ytdEl.value||'sum':'sum'
};
}).filter(i=>i&&i.name);
if(!indicators.length){toast('Please enter at least one indicator name',false);return;}
const body={company_id:prof?.company_id,objective_id:objId,code:document.getElementById('kpi-code').value.trim(),name,frequency:document.getElementById('kpi-freq').value,responsible:document.getElementById('kpi-resp').value.trim()||null,status:document.getElementById('kpi-status').value,year:parseInt(document.getElementById('year-sel')?.value)||new Date().getFullYear(),created_by:prof?.id};
try{
let kpiId=kpiEditKpiId;
if(kpiId){
await api('/kpis_v2?id=eq.'+kpiId,{m:'PATCH',p:'return=representation',b:body});
}else{
const res=await api('/kpis_v2',{m:'POST',p:'return=representation',b:body});
kpiId=res?.[0]?.id||res?.id;
}
if(kpiId&&indicators.length){
const existingInds=kpiIndicators.filter(i=>i.kpi_id===kpiId);
for(let i=0;i<indicators.length;i++){
const ind=indicators[i];
const existing=existingInds.find(e=>e.name===ind.name);
if(existing){
await api('/kpi_indicators?id=eq.'+existing.id,{m:'PATCH',p:'return=minimal',b:{
target_value:ind.target_value,target_operator:ind.target_operator,
unit:ind.unit,ytd_method:ind.ytd_method,sort_order:i
}});
}else{
await api('/kpi_indicators',{m:'POST',p:'return=minimal',b:{...ind,kpi_id:kpiId,company_id:prof?.company_id,sort_order:i}});
}
}
for(const ex of existingInds){
const stillExists=indicators.find(i=>i.name===ex.name);
if(!stillExists){
const hasData=await api('/kpi_monthly_data?indicator_id=eq.'+ex.id+'&limit=1');
if(!hasData||!hasData.length){
await api('/kpi_indicators?id=eq.'+ex.id,{m:'DELETE'});
}
}
}
}
toast(kpiEditKpiId?'KPI updated!':'KPI added!');closeKpiModal('kpi-edit-modal');await kpiLoadAll();
}catch(e){toast(e.message,false);}
}
async function kpiDeleteKPI(){
if(!kpiEditKpiId||!confirm("Delete this KPI and all its data?"))return;
try{
await api('/kpi_indicators?kpi_id=eq.'+kpiEditKpiId,{m:'DELETE'});
await api('/kpi_monthly_data?kpi_id=eq.'+kpiEditKpiId,{m:'DELETE'});
await api('/kpis_v2?id=eq.'+kpiEditKpiId,{m:'DELETE'});
toast('KPI deleted!');closeKpiModal('kpi-edit-modal');await kpiLoadAll();
}catch(e){toast(e.message,false);}
}
function kpiCalcYTD(indicatorId,upToMonth,newActual){
const ind=kpiIndicators.find(x=>x.id===indicatorId);
const mdata=kpiMonthlyData[indicatorId]||{};
const method=ind?.ytd_method||'sum';
const vals=[];
for(let m=1;m<=upToMonth;m++){
const v=m===upToMonth?parseFloat(newActual):(mdata[m]?.actual!==null&&mdata[m]?.actual!==undefined?parseFloat(mdata[m].actual):null);
if(v!==null&&!isNaN(v))vals.push(v);
}
if(!vals.length)return null;
if(method==='last')return vals[vals.length-1];
if(method==='average')return Math.round((vals.reduce((a,b)=>a+b,0)/vals.length)*100)/100;
if(method==='max')return Math.max(...vals);
if(method==='min')return Math.min(...vals);
return Math.round(vals.reduce((a,b)=>a+b,0)*100)/100;
}
function kpiOpenEntry(indicatorId,kpiId,month){
kpiEntryIndicatorId=indicatorId;
kpiEntryYear=parseInt(document.getElementById('year-sel')?.value)||new Date().getFullYear();
kpiEntryMonth=month;
const ind=kpiIndicators.find(x=>x.id===indicatorId);
const k=kpiKPIs.find(x=>x.id===kpiId);
if(!ind||!k)return;
document.getElementById('entry-modal-title').textContent='Enter value — '+KPI_MONTHS[month-1]+' '+kpiEntryYear;
document.getElementById('entry-kpi-name').textContent=k.name+' — '+ind.name;
const methodLabel={sum:'YTD = cumulative sum',average:'YTD = average of months entered',last:'YTD = last value entered',max:'YTD = maximum value',min:'YTD = minimum value'}[ind.ytd_method||'sum'];
document.getElementById('entry-kpi-target').textContent='Target: '+kpiFmtTarget(ind)+' | '+methodLabel;
document.getElementById('entry-month-label').textContent='Actual value for '+KPI_MONTHS[month-1];
const ex=kpiMonthlyData[indicatorId]?.[month];
document.getElementById('entry-actual').value=ex?.actual!==null&&ex?.actual!==undefined?ex.actual:'';
const previewYTD=kpiCalcYTD(indicatorId,month,ex?.actual||0);
document.getElementById('entry-ytd').value=previewYTD!==null?previewYTD:'';
document.getElementById('entry-ytd').placeholder='Auto ('+(ind.ytd_method||'sum')+')';
document.getElementById('entry-comment').value=ex?.comment||'';
document.getElementById('entry-actual').oninput=function(){
if(this.value!==''){
const newYTD=kpiCalcYTD(indicatorId,month,parseFloat(this.value));
document.getElementById('entry-ytd').value=newYTD!==null?newYTD:'';
}
};
const clearBtn=document.getElementById('kpi-clear-btn');
if(clearBtn)clearBtn.style.display=ex?'flex':'none';
openKpiModal('kpi-entry-modal');
}
async function kpiSaveEntry(){
const actual=document.getElementById('entry-actual').value;
if(actual===''){toast('Please enter a value',false);return;}
const manualYtd=document.getElementById('entry-ytd').value;
const autoYTD=kpiCalcYTD(kpiEntryIndicatorId,kpiEntryMonth,parseFloat(actual));
let ytd=manualYtd!==''&&manualYtd!==String(autoYTD)?parseFloat(manualYtd):autoYTD;
if(ytd===null)ytd=parseFloat(actual);
const comment=document.getElementById('entry-comment').value;
try{
const existing=kpiMonthlyData[kpiEntryIndicatorId]?.[kpiEntryMonth];
if(existing){
await api('/kpi_monthly_data?indicator_id=eq.'+kpiEntryIndicatorId+'&year=eq.'+kpiEntryYear+'&month=eq.'+kpiEntryMonth,{m:'PATCH',p:'return=minimal',b:{actual:parseFloat(actual),ytd:ytd,comment:comment||null}});
}else{
await api('/kpi_monthly_data',{m:'POST',p:'return=minimal',b:{indicator_id:kpiEntryIndicatorId,year:kpiEntryYear,month:kpiEntryMonth,actual:parseFloat(actual),ytd:ytd,comment:comment||null,company_id:prof?.company_id}});
}
const ind=kpiIndicators.find(x=>x.id===kpiEntryIndicatorId);
const k=kpiKPIs.find(x=>kpiIndicators.some(i=>i.kpi_id===x.id&&i.id===kpiEntryIndicatorId));
if(ind&&k){
const prog=kpiGetProgress(ind,ytd);
let status='not_started';
if(prog!==null){if(prog>=100)status='on_track';else if(prog>=70)status='at_risk';else status='off_track';}
await api('/kpis_v2?id=eq.'+k.id,{m:'PATCH',p:'return=representation',b:{status,updated_at:new Date().toISOString()}});
await kpiRecalcAllYTD(kpiEntryIndicatorId,kpiEntryYear);
}
toast('Value saved!');
closeKpiModal('kpi-entry-modal');
kpiObjectives=[];kpiKPIs=[];kpiIndicators=[];kpiMonthlyData={};
await kpiLoadAll();
}catch(e){toast(e.message,false);}
}

async function kpiRecalcAllYTD(indicatorId,year){
const ind=kpiIndicators.find(x=>x.id===indicatorId);
if(!ind)return;
try{
const fresh=await api('/kpi_monthly_data?indicator_id=eq.'+indicatorId+'&year=eq.'+year+'&order=month');
if(!fresh||!fresh.length)return;
for(var mi=0;mi<fresh.length;mi++){
  var m=fresh[mi].month;
  var prevVals=fresh.filter(function(x){return x.month<=m&&x.actual!==null&&x.actual!==undefined;}).map(function(x){return parseFloat(x.actual);});
  if(!prevVals.length)continue;
  var newYTD=kpiCalcYTD(indicatorId,m,parseFloat(fresh[mi].actual));
  var entry=fresh[mi];
  if(Math.abs(newYTD-(parseFloat(entry.ytd)||0))>0.001){
    await api('/kpi_monthly_data?indicator_id=eq.'+indicatorId+'&year=eq.'+year+'&month=eq.'+m,{m:'PATCH',p:'return=minimal',b:{ytd:newYTD}});
  }
}
}catch(e){console.error('YTD recalc error:',e);}
}


async function kpiClearEntry(){
if(!confirm("Clear this month's data? This cannot be undone."))return;
try{
await api('/kpi_monthly_data?indicator_id=eq.'+kpiEntryIndicatorId+'&year=eq.'+kpiEntryYear+'&month=eq.'+kpiEntryMonth,{m:'DELETE'});
toast('Data cleared!');
closeKpiModal('kpi-entry-modal');
kpiObjectives=[];kpiKPIs=[];kpiIndicators=[];kpiMonthlyData={};
await kpiLoadAll();
}catch(e){toast(e.message,false);}
}

// ── SOP MODULE HELPERS ────────────────────────────────────────────────────────
function sopShowList(){
  document.getElementById('sop-list-view').style.display='block';
  document.getElementById('sop-gen-view').style.display='none';
  sopLoadList();
}

function sopShowPreview(){
  document.getElementById('sop-generate-panel').style.display='none';
  document.getElementById('sop-preview').style.display='block';
  document.getElementById('sop-step4-back').style.display='none';
}

function sopGoStep(n){
  for(var i=1;i<=4;i++){
    var s=document.getElementById('sop-step-'+i);
    var b=document.getElementById('sop-step-btn-'+i);
    if(s)s.style.display=i===n?'block':'none';
    if(b){b.classList.toggle('active',i===n);}
  }
  if(n===4){
    // Update summary
    var title=document.getElementById('sop-title')?.value||'Untitled';
    var dept=document.getElementById('sop-dept')?.value||'—';
    var frames=sopFrames.filter(function(f){return f.narration;}).length;
    var sumEl=document.getElementById('sop-gen-summary');
    if(sumEl)sumEl.innerHTML='<strong>Task:</strong> '+escH(title)+'<br><strong>Department:</strong> '+escH(dept)+'<br><strong>Steps with narration:</strong> '+frames+'<br><strong>Frames selected:</strong> '+sopFrames.length;
    document.getElementById('sop-generate-panel').style.display='block';
    document.getElementById('sop-preview').style.display='none';
    document.getElementById('sop-step4-back').style.display='block';
  }
}

async function sopSave(){
  var title=document.getElementById('sop-title')?.value?.trim();
  if(!title){toast('Please enter a task title first',false);return;}
  var body={
    company_id:prof?.company_id,
    title:title,
    department:document.getElementById('sop-dept')?.value||null,
    sop_number:document.getElementById('sop-number')?.value||null,
    risk_level:document.getElementById('sop-risk')?.value||'medium',
    prepared_by:document.getElementById('sop-author')?.value||prof?.full_name||null,
    revision:document.getElementById('sop-revision')?.value||'Rev 00',
    approved_by:document.getElementById('sop-approver')?.value||null,
    date:document.getElementById('sop-date')?.value||null,
    description:document.getElementById('sop-description')?.value||null,
    frames:JSON.stringify(sopFrames.map(function(f){return{time:f.time,narration:f.narration,hazard:f.hazard,dataUrl:f.dataUrl};})),
    generated_html:document.getElementById('sop-doc-output')?.innerHTML||null,
    status:'draft',
    updated_at:new Date().toISOString()
  };
  try{
    if(sopEditingId){
      await api('/sop_documents?id=eq.'+sopEditingId,{m:'PATCH',p:'return=minimal',b:body});
      toast('SOP saved!');
    }else{
      body.created_by=prof?.id;
      var res=await api('/sop_documents',{m:'POST',p:'return=representation',b:body});
      if(res?.[0])sopEditingId=res[0].id;
      toast('SOP draft saved!');
    }
  }catch(e){toast(e.message,false);console.error(e);}
}

async function sopDelete(){
  if(!sopEditingId)return;
  if(!confirm('Delete this SOP draft?'))return;
  try{
    await api('/sop_documents?id=eq.'+sopEditingId,{m:'DELETE'});
    toast('Deleted!');
    sopShowList();
  }catch(e){toast(e.message,false);}
}

async function sopExportPDF(){
  var html=document.getElementById('sop-doc-output')?.innerHTML||'';
  if(!html){toast('Generate the SOP first',false);return;}
  var w=window.open('','_blank','width=900,height=700,scrollbars=yes');
  w.document.write('<html><head><title>SOP</title><style>body{font-family:Arial,sans-serif;padding:30px;max-width:800px;margin:0 auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}@media print{.no-print{display:none}}</style></head><body>');
  w.document.write('<button class="no-print" onclick="window.print()" style="margin-bottom:20px;padding:8px 20px;background:#1D9E75;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px">🖨️ Print / Save PDF</button>');
  w.document.write(html);
  w.document.write('</body></html>');
  w.document.close();
}

function sopSaveToDocControl(){
  toast('SOP saved to Document Control!');
  sopSave();
}
