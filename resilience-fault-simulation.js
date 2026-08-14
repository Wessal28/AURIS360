(function(){
'use strict';

var KEY='auris360-resilience-fault-v1';
var OPTIONS={
  incident_evidence:{label:'Incident Evidence',module:'events',paths:['/incident_evidence']},
  inspection_templates:{label:'Inspection Templates',module:'inspection',paths:['/checklist_templates']},
  inspection_findings:{label:'Inspection Findings',module:'inspection',paths:['/audit_findings']},
  risk_jsa:{label:'Risk JSA',module:'risk',paths:['/jsa_records']}
};

function canUse(){try{return !!((typeof isSA==='function'&&isSA())||(typeof isAdm==='function'&&isAdm()));}catch(_){return false;}}
function current(){try{var raw=sessionStorage.getItem(KEY);return raw&&OPTIONS[raw]?raw:'';}catch(_){return '';}}
function activeOption(){return OPTIONS[current()]||null;}
function clearBanners(){document.querySelectorAll('.resilience-simulation-banner').forEach(function(el){el.remove();});}
function renderBanner(){
  clearBanners();var option=activeOption();if(!option||!canUse())return;
  var page=document.getElementById('page-'+option.module);if(!page)return;
  var banner=document.createElement('div');banner.className='resilience-simulation-banner';
  banner.innerHTML='<span><i class="ti ti-flask-2"></i><strong>Resilience test active:</strong> '+option.label+' is being simulated as unavailable in this browser session. No database object or record has been changed.</span><button type="button" class="btn btn-sm" data-auris-module-onclick="b0051"><i class="ti ti-player-stop"></i>Stop test</button>';
  page.insertBefore(banner,page.firstChild);
}
function renderSettings(){
  var card=document.getElementById('settings-resilience-simulation-card');if(!card)return;
  card.style.display=canUse()?'block':'none';if(!canUse())return;
  var selected=current(),option=activeOption();
  card.innerHTML='<div class="card-title"><span><i class="ti ti-flask-2"></i> Optional dependency resilience test</span>'+(option?'<span class="badge ba">Session test active</span>':'')+'</div>'
    +'<div style="font-size:12px;color:var(--text2);line-height:1.55;margin-bottom:12px">Safely simulate one optional API dependency failure in this browser session. This does not rename tables, change permissions, write production data or activate a rollout cohort.</div>'
    +'<div style="display:flex;align-items:end;gap:10px;flex-wrap:wrap"><div class="form3group" style="margin:0;min-width:260px;flex:1"><label class="form3label">Optional dependency</label><select id="resilience-simulation-select">'
    +Object.keys(OPTIONS).map(function(key){return '<option value="'+key+'" '+(key===selected?'selected':'')+'>'+OPTIONS[key].label+'</option>';}).join('')+'</select></div>'
    +(option?'<button class="btn" data-auris-module-onclick="b0051"><i class="ti ti-player-stop"></i>Stop simulation</button>':'<button class="btn btn-primary" data-auris-module-onclick="b0052"><i class="ti ti-player-play"></i>Start simulation</button>')+'</div>'
    +'<div style="margin-top:12px;padding:10px 12px;border-radius:8px;background:#eff6ff;color:#1e3a8a;font-size:11px"><strong>Acceptance:</strong> open the affected module and confirm its primary register remains visible while the unavailable optional feature shows the test banner or controlled empty/error state. Stop the simulation and refresh the module to confirm recovery.</div>';
}

window.aurisResilienceFaultForPath=function(path){
  var option=activeOption();if(!option||!canUse())return '';
  path=String(path||'');return option.paths.some(function(prefix){return path.indexOf(prefix)===0;})?('Resilience simulation: '+option.label+' is temporarily unavailable in this browser session.'):'';
};
window.aurisStartResilienceSimulation=function(){
  if(!canUse())return;var select=document.getElementById('resilience-simulation-select'),key=select&&select.value;
  if(!OPTIONS[key])return;sessionStorage.setItem(KEY,key);renderSettings();renderBanner();
  if(typeof toast==='function')toast('Resilience simulation started. Open '+OPTIONS[key].label+' to verify graceful degradation.');
};
window.aurisStopResilienceSimulation=function(){
  try{sessionStorage.removeItem(KEY);}catch(_){}clearBanners();renderSettings();
  if(typeof toast==='function')toast('Resilience simulation stopped. Refresh the affected module to confirm recovery.');
};
window.renderResilienceSimulation=renderSettings;

var previousLoadSettings=window.loadSettings;
if(typeof previousLoadSettings==='function')window.loadSettings=function(){var result=previousLoadSettings.apply(this,arguments);renderSettings();renderBanner();return result;};
document.addEventListener('DOMContentLoaded',function(){renderSettings();renderBanner();});
document.addEventListener('click',function(){setTimeout(renderBanner,0);});
})();
