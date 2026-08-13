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
function applyActions(){document.querySelectorAll('button i.ti,.btn i.ti,a.btn i.ti').forEach(function(icon){if(icon.classList.contains('auris-module-icon')||icon.classList.contains('auris-tab-icon')||icon.classList.contains('auris-indicator-icon')||icon.closest('.kpi-x-metric'))return;var kind='';Array.prototype.some.call(icon.classList,function(c){if(actionByClass[c]){kind=actionByClass[c];return true;}return false;});icon.classList.toggle('auris-action-icon',!!kind);if(kind)icon.dataset.actionIcon=kind;else delete icon.dataset.actionIcon;});}
var indicatorTones=['blue','green','amber','red','purple','cyan'];
var tabSelector='.page .module-tabs>button,.page [class$="-tabs"]>button,.page [class*="-tabs "]>button,.page [role="tab"],.page .rax-nav>button,.page .kpi-tab,.page .mtg-tab';
function tabGlyph(text){
  text=String(text||'').toLowerCase();
  if(/dashboard|overview|home/.test(text))return'ti-layout-dashboard';
  if(/my work|my safety|my online|assignment|task/.test(text))return'ti-user-check';
  if(/team|people|learner|contractor/.test(text))return'ti-users';
  if(/programme|objective|kpi|scorecard|performance/.test(text))return'ti-target-arrow';
  if(/monthly|calendar|schedule|plan/.test(text))return'ti-calendar-stats';
  if(/validation|approval|verify|assurance|governance/.test(text))return'ti-shield-check';
  if(/recognition|competenc|certificate/.test(text))return'ti-award';
  if(/coaching|improvement|lesson|learning|e-learning|training/.test(text))return'ti-school';
  if(/dispute|correction|action|remediation/.test(text))return'ti-list-check';
  if(/report|analytics/.test(text))return'ti-report-analytics';
  if(/configuration|setting|template|type|librar/.test(text))return'ti-settings';
  if(/incident|triage|investigation|hazard|emergency/.test(text))return'ti-alert-triangle';
  if(/register|record|catalogue|document/.test(text))return'ti-books';
  if(/mobile|field/.test(text))return'ti-device-mobile';
  if(/risk|control/.test(text))return'ti-shield-search';
  if(/audit|inspection|check/.test(text))return'ti-clipboard-check';
  return'ti-apps';
}
function tabTone(text,index){
  text=String(text||'').toLowerCase();
  if(/incident|triage|dispute|hazard|emergency/.test(text))return'red';
  if(/monthly|plan|schedule|action|improvement/.test(text))return'amber';
  if(/recognition|competenc|certificate|configuration|setting/.test(text))return'purple';
  if(/report|analytics|register|record|catalogue/.test(text))return'blue';
  if(/team|people|training|learning|programme|objective/.test(text))return'cyan';
  return indicatorTones[index%indicatorTones.length];
}
function applyTabs(){
  document.querySelectorAll(tabSelector).forEach(function(tab,index){
    if(tab.closest('.modal,.drawer,[role="dialog"]')&&!tab.matches('[role="tab"]'))return;
    var text=(tab.textContent||tab.getAttribute('aria-label')||'').trim();if(!text)return;
    var icon=tab.querySelector(':scope>i.ti');
    if(!icon){icon=document.createElement('i');icon.className='ti '+tabGlyph(text);tab.insertBefore(icon,tab.firstChild);}
    icon.classList.remove('auris-action-icon');delete icon.dataset.actionIcon;
    icon.classList.add('auris-tab-icon');tab.classList.add('auris-icon-tab');
    tab.dataset.tabTone=tabTone(text,index);
  });
}
function indicatorGlyph(text){
  text=String(text||'').toLowerCase();
  if(/water/.test(text))return'ti-droplet';if(/fuel|energy/.test(text))return'ti-bolt';if(/carbon|co2|emission/.test(text))return'ti-cloud';
  if(/environment|waste|recycl/.test(text))return'ti-leaf';if(/training|competenc|certificate|learning/.test(text))return'ti-school';
  if(/inspection|audit|finding/.test(text))return'ti-clipboard-check';if(/permit/.test(text))return'ti-file-certificate';
  if(/action|task|return/.test(text))return'ti-list-check';if(/people|worker|employee|contractor|issued/.test(text))return'ti-users';
  if(/tool|equipment|asset|maintenance/.test(text))return'ti-tools';if(/legal|compliance|assurance|release/.test(text))return'ti-shield-check';
  if(/incident|spill|risk|defect|overdue|expired|blocked/.test(text))return'ti-alert-triangle';if(/score|complete|ready|valid/.test(text))return'ti-circle-check';
  return'ti-chart-bar';
}
function applyIndicators(){
  var cards=new Set();
  document.querySelectorAll('.page [class~="metrics"]>.card,.page [class~="metrics"]>.metric,.page [class~="metrics"]>[class*="-metric"],.page [class*="-metrics"]>[class*="-metric"]').forEach(function(el){cards.add(el);});
  document.querySelectorAll('.page [id*="-m3"]').forEach(function(el){var card=el.closest('.card');if(card)cards.add(card);});
  cards.forEach(function(card){
    if(card.closest('#page-dashboard,#page-kpi')||card.classList.contains('auris-indicator-card'))return;
    var siblings=Array.prototype.filter.call(card.parentElement?card.parentElement.children:[],function(el){return el.matches('.card,.metric,[class*="-metric"]');});
    var idx=Math.max(0,siblings.indexOf(card));card.classList.add('auris-indicator-card');card.dataset.indicatorTone=indicatorTones[idx%indicatorTones.length];
    var icon=card.querySelector(':scope>i');
    if(!icon){icon=document.createElement('i');icon.className='ti '+indicatorGlyph(card.textContent);card.insertBefore(icon,card.firstChild);}
    icon.classList.add('auris-indicator-icon');
    var value=card.querySelector('[id*="-m3"],.metric-value,[class*="metric-value"],.value,b,strong');if(value)value.classList.add('auris-indicator-value');
  });
}
function apply(){queued=false;applyModules();applyTabs();applyIndicators();applyActions();}
function queue(){if(queued)return;queued=true;requestAnimationFrame(apply);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply);else apply();
new MutationObserver(queue).observe(document.documentElement,{childList:true,subtree:true});
window.applyAurisIconSystem=apply;
})();
