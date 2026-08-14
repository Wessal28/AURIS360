(function(){
'use strict';
var KEY='auris360-offline-diagnostic-v1';
function canUse(){try{return !!((typeof isSA==='function'&&isSA())||(typeof isAdm==='function'&&isAdm()));}catch(_){return false;}}
function companyId(){try{return String((typeof ccid==='function'&&ccid())||'diagnostic-company');}catch(_){return 'diagnostic-company';}}
function icon(ok){return '<i class="ti '+(ok?'ti-circle-check':'ti-alert-triangle')+'" style="color:'+(ok?'#07835B':'#B45309')+'"></i>';}
function statusRow(label,ok,detail){return '<div style="display:grid;grid-template-columns:22px minmax(160px,240px) 1fr;gap:8px;padding:9px 0;border-bottom:1px solid var(--border);align-items:start">'+icon(ok)+'<b style="font-size:12px">'+label+'</b><span style="font-size:11px;color:var(--text2)">'+detail+'</span></div>';}
function sampleDrafts(){var current=companyId(),other=current+'-other';return [
  {local_id:'diagnostic-incident-1',module:'incident',company_id:current,status:'pending',body:{company_id:current,description:'Synthetic offline incident'},photos:[{name:'diagnostic-photo.jpg',type:'image/jpeg',size:27,data_url:'data:image/jpeg;base64,RGlhZ25vc3RpYw=='}]},
  {local_id:'diagnostic-incident-1',module:'incident',company_id:current,status:'pending',body:{company_id:current,description:'Duplicate retry copy'},photos:[]},
  {local_id:'diagnostic-observation-2',module:'observation',company_id:other,status:'pending',body:{company_id:other,observation_text:'Synthetic cross-company observation'},photos:[]}
];}
function deduplicate(items){if(typeof offlineDraftDeduplicate==='function')return offlineDraftDeduplicate(items);var seen={};return items.filter(function(item){if(seen[item.local_id])return false;seen[item.local_id]=true;return true;});}
function canSync(item,current){return typeof offlineDraftCanSync==='function'?offlineDraftCanSync(item,current):String(item.company_id||item.body?.company_id||'')===String(current);}
function run(){
  var source=sampleDrafts(),restored=[],storageOk=false;
  try{sessionStorage.setItem(KEY,JSON.stringify(source));restored=JSON.parse(sessionStorage.getItem(KEY)||'[]');storageOk=restored.length===source.length;}catch(_){restored=[];}
  var unique=deduplicate(restored),current=companyId(),eligible=unique.filter(function(item){return canSync(item,current);}),retained=unique.filter(function(item){return !canSync(item,current);}),photo=eligible[0]&&eligible[0].photos&&eligible[0].photos[0];
  var checks=[
    {label:'Local queue round-trip',ok:storageOk,detail:storageOk?'Synthetic drafts were serialized and restored in this browser session.':'Session storage is unavailable or full.'},
    {label:'Duplicate protection',ok:unique.length===2,detail:unique.length===2?'A repeated local draft ID is retained once.':'Duplicate local IDs were not collapsed.'},
    {label:'Company isolation',ok:eligible.length===1&&retained.length===1,detail:(eligible.length===1&&retained.length===1)?'Only the active-company draft is eligible; the other-company draft remains retained.':'Tenant eligibility did not separate the synthetic drafts as expected.'},
    {label:'Attachment retention',ok:!!(photo&&photo.data_url&&photo.name),detail:(photo&&photo.data_url)?'Compressed-photo metadata and content survived the storage round-trip.':'Synthetic attachment content was not retained.'},
    {label:'Reconnect readiness',ok:true,detail:navigator.onLine?'Browser is online; a real queued draft can be tested on the protected tenant.':'Browser is offline; drafts remain local until connectivity returns.'}
  ];
  var result={ran_at:new Date().toISOString(),checks:checks,passed:checks.every(function(c){return c.ok;}),online:navigator.onLine,service_worker:'serviceWorker' in navigator};
  try{sessionStorage.setItem(KEY,JSON.stringify(result));}catch(_){}render(result);return result;
}
function read(){try{var value=JSON.parse(sessionStorage.getItem(KEY)||'null');return value&&Array.isArray(value.checks)?value:null;}catch(_){return null;}}
function clear(){try{sessionStorage.removeItem(KEY);}catch(_){}render(null);if(typeof toast==='function')toast('Offline diagnostic evidence cleared from this browser session.');}
function render(result){
  var card=document.getElementById('settings-offline-sync-diagnostic-card');if(!card)return;card.style.display=canUse()?'block':'none';if(!canUse())return;result=result===undefined?read():result;
  var h='<div class="card-title" style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><span><i class="ti ti-cloud-check" style="color:#07835B"></i> Mobile/offline synchronization preflight</span>'+(result?'<span class="badge '+(result.passed?'bg':'ba')+'">'+(result.passed?'Preflight passed':'Review required')+'</span>':'')+'</div>'
    +'<div style="font-size:12px;color:var(--text2);line-height:1.55;margin-bottom:12px">Validate queue storage, attachment retention, duplicate protection and company isolation with synthetic session-only drafts. This diagnostic never calls an API and never creates or changes an Incident or BBS record.</div>';
  if(result)h+='<div>'+result.checks.map(function(c){return statusRow(c.label,c.ok,c.detail);}).join('')+'</div><div style="font-size:10px;color:var(--text3);margin-top:8px">Run '+new Date(result.ran_at).toLocaleString()+' · Service worker '+(result.service_worker?'available':'not available')+'</div>';
  h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn btn-primary" data-auris-module-onclick="b0053"><i class="ti ti-player-play"></i>Run safe preflight</button>'+(result?'<button class="btn" data-auris-module-onclick="b0054"><i class="ti ti-trash"></i>Clear result</button>':'')+'</div>'
    +'<div style="margin-top:12px;padding:10px 12px;border-radius:8px;background:#FFFBEB;color:#854D0E;font-size:11px"><strong>Live evidence still required:</strong> on the protected pilot tenant, create one Incident and one BBS draft offline, reconnect under the same company, confirm each syncs once with photos, and record the resulting IDs. This preflight does not replace that test.</div>';
  card.innerHTML=h;
}
window.runOfflineSyncDiagnostic=run;window.clearOfflineSyncDiagnostic=clear;window.renderOfflineSyncDiagnostic=render;
document.addEventListener('DOMContentLoaded',function(){render();});
})();
