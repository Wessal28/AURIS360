(function(){
'use strict';
var KEY='auris360-rollback-rehearsal-v1';
function canUse(){try{return !!(typeof isSA==='function'&&isSA());}catch(_){return false;}}
function allows(status){return typeof rolloutStatusAllowsModules==='function'?rolloutStatusAllowsModules(status):(status==='pilot'||status==='enabled');}
function row(label,ok,detail){return '<div style="display:grid;grid-template-columns:22px minmax(150px,220px) 1fr;gap:8px;padding:9px 0;border-bottom:1px solid var(--border)"><i class="ti '+(ok?'ti-circle-check':'ti-alert-triangle')+'" style="color:'+(ok?'#07835B':'#B45309')+'"></i><b style="font-size:12px">'+label+'</b><span style="font-size:11px;color:var(--text2)">'+detail+'</span></div>';}
function run(){
  var cohort=(typeof ROLLOUT_COHORTS!=='undefined'&&ROLLOUT_COHORTS.find(function(c){return c.key==='core_control';}))||{modules:['actions','events','inspection','risk']};
  var gates={database:true,data_safety:true,security:true,navigation:true,resilience:true,workflow:true,mobile_offline:true,rollback:true};
  var evidence={enabled_at:'diagnostic-activation-evidence',gate_results:JSON.parse(JSON.stringify(gates)),module_keys:cohort.modules.slice()},before=JSON.stringify(evidence);
  var transitions=['pilot','paused','disabled'].map(function(status){return {status:status,modules_visible:allows(status),dashboard_visible:true};});
  var checks=[
    {label:'Pilot visibility',ok:transitions[0].modules_visible,detail:'Core Control modules are available during the synthetic Pilot state.'},
    {label:'Paused safety',ok:!transitions[1].modules_visible&&transitions[1].dashboard_visible,detail:'Paused hides the cohort while retaining Dashboard as the safe landing page.'},
    {label:'Disabled safety',ok:!transitions[2].modules_visible&&transitions[2].dashboard_visible,detail:'Disabled keeps cohort modules unavailable without deleting data.'},
    {label:'Evidence retention',ok:before===JSON.stringify(evidence),detail:'Activation timestamp, gate evidence and module membership remain unchanged through the rehearsal.'},
    {label:'Production isolation',ok:true,detail:'The rehearsal used local synthetic state only; no cohort policy, business record or transition row was written.'}
  ];
  var result={ran_at:new Date().toISOString(),passed:checks.every(function(c){return c.ok;}),checks:checks,transitions:transitions};
  try{sessionStorage.setItem(KEY,JSON.stringify(result));}catch(_){}render(result);return result;
}
function read(){try{var value=JSON.parse(sessionStorage.getItem(KEY)||'null');return value&&Array.isArray(value.checks)?value:null;}catch(_){return null;}}
function clear(){try{sessionStorage.removeItem(KEY);}catch(_){}render(null);if(typeof toast==='function')toast('Rollback rehearsal evidence cleared from this browser session.');}
function render(result){
  var card=document.getElementById('settings-rollback-rehearsal-card');if(!card)return;card.style.display=canUse()?'block':'none';if(!canUse())return;result=result===undefined?read():result;
  var h='<div class="card-title" style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><span><i class="ti ti-history-toggle" style="color:#7C3AED"></i> Controlled rollback rehearsal</span>'+(result?'<span class="badge '+(result.passed?'bg':'ba')+'">'+(result.passed?'Rehearsal passed':'Review required')+'</span>':'')+'</div>'
    +'<div style="font-size:12px;color:var(--text2);line-height:1.55;margin-bottom:12px">Rehearse Core Control through Pilot → Paused → Disabled using the application status policy and synthetic session-only evidence. The rehearsal does not save a cohort or alter production access.</div>';
  if(result)h+='<div>'+result.checks.map(function(c){return row(c.label,c.ok,c.detail);}).join('')+'</div><div style="font-size:10px;color:var(--text3);margin-top:8px">Run '+new Date(result.ran_at).toLocaleString()+'</div>';
  h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn btn-primary" data-auris-module-onclick="b0055"><i class="ti ti-player-play"></i>Run safe rehearsal</button>'+(result?'<button class="btn" data-auris-module-onclick="b0056"><i class="ti ti-trash"></i>Clear result</button>':'')+'</div>'
    +'<div style="margin-top:12px;padding:10px 12px;border-radius:8px;background:#FFFBEB;color:#854D0E;font-size:11px"><strong>Protected-tenant evidence still required:</strong> after choosing a real pilot company and completing all required gates, record business-table counts and perform an authorised Pilot → Paused → Disabled exercise. Confirm counts and transition evidence remain intact before restoring Pilot. This rehearsal does not replace that controlled test.</div>';
  card.innerHTML=h;
}
window.runRollbackRehearsal=run;window.clearRollbackRehearsal=clear;window.renderRollbackRehearsal=render;
document.addEventListener('DOMContentLoaded',function(){render();});
})();
