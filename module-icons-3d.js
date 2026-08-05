(function(){
'use strict';
var keys=new Set(['kpi','engagement','workschedule','events','observation','inspection','risk','tools','fleet','atex','sitemap','permit','contractor','emergency','ohealth','ppe','fire','chemical','esg','noise']);
var queued=false;
function keyFrom(el){
  if(el.dataset.navKey)return el.dataset.navKey;
  var click=el.getAttribute('onclick')||'';
  var match=click.match(/(?:showPage|modulesMenuNavigate)\('([^']+)'/);
  return match?match[1]:'';
}
function applyModuleArtwork(){
  queued=false;
  document.querySelectorAll('.sidebar .nav-item,.modules-menu-item').forEach(function(el){
    var key=keyFrom(el);
    if(!key)return;
    el.dataset.navKey=key;
    var icon=el.querySelector('i');
    if(icon)icon.classList.toggle('module-art-icon',keys.has(key));
  });
}
function queue(){if(queued)return;queued=true;requestAnimationFrame(applyModuleArtwork);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyModuleArtwork);
else applyModuleArtwork();
new MutationObserver(queue).observe(document.documentElement,{childList:true,subtree:true});
window.applyModuleArtwork=applyModuleArtwork;
})();
