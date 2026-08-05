(function(){
'use strict';
var moduleKeys=new Set(['dashboard','executive','ai-insights','kpi','engagement','workschedule','events','observation','inspection','risk','actions','permit','moc','contractor','training','tools','fleet','atex','sitemap','emergency','fire','ohealth','ppe','chemical','esg','noise','meetings','sop','swms','documents','people','users','admin','companies','integrations','approvals','legal','audit','settings']);
var actionMap={
  add:['ti-plus','ti-circle-plus','ti-square-plus','ti-user-plus','ti-file-plus'],
  edit:['ti-edit','ti-pencil','ti-pencil-plus'],delete:['ti-trash','ti-trash-x'],
  view:['ti-eye','ti-eye-check','ti-file-search'],download:['ti-download'],upload:['ti-upload'],
  share:['ti-share','ti-share-2'],filter:['ti-filter','ti-filter-off'],search:['ti-search'],
  refresh:['ti-refresh','ti-reload'],print:['ti-printer'],export:['ti-file-export','ti-table-export'],
  save:['ti-device-floppy'],cancel:['ti-x','ti-circle-x'],info:['ti-info-circle','ti-info-square'],
  warning:['ti-alert-triangle'],success:['ti-check','ti-checks','ti-circle-check'],
  error:['ti-circle-x-filled','ti-alert-circle','ti-square-x']
};
var actionByClass={};Object.keys(actionMap).forEach(function(k){actionMap[k].forEach(function(c){actionByClass[c]=k;});});
var queued=false;
function navKey(el){if(el.dataset.navKey)return el.dataset.navKey;var click=el.getAttribute('onclick')||'';var m=click.match(/(?:showPage|modulesMenuNavigate|mobileNavTo)\('([^']+)'/);if(m)return m[1];var id=el.id||'';if(id.indexOf('mob-btn-')===0)return id.slice(8);return '';}
function applyModules(){document.querySelectorAll('.sidebar .nav-item,.modules-menu-item,.mob-nav-btn,#mobile-modules-grid [onclick]').forEach(function(el){var key=navKey(el);if(!key)return;el.dataset.navKey=key;var icon=el.querySelector('i');if(icon)icon.classList.toggle('auris-module-icon',moduleKeys.has(key));});}
function applyActions(){document.querySelectorAll('button i.ti,.btn i.ti,a.btn i.ti').forEach(function(icon){if(icon.classList.contains('auris-module-icon'))return;var kind='';Array.prototype.some.call(icon.classList,function(c){if(actionByClass[c]){kind=actionByClass[c];return true;}return false;});icon.classList.toggle('auris-action-icon',!!kind);if(kind)icon.dataset.actionIcon=kind;else delete icon.dataset.actionIcon;});}
function apply(){queued=false;applyModules();applyActions();}
function queue(){if(queued)return;queued=true;requestAnimationFrame(apply);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply);else apply();
new MutationObserver(queue).observe(document.documentElement,{childList:true,subtree:true});
window.applyAurisIconSystem=apply;
})();
