(function(root){
'use strict';

var registry=root.AurisModuleRegistry;
if(!registry)throw new Error('AurisModuleLayout requires AurisModuleRegistry.');
var instances=Object.create(null);
var defaultIcons={dashboard:'ti-layout-dashboard',mywork:'ti-list-check',report:'ti-plus',register:'ti-list-details',triage:'ti-filter-check',investigate:'ti-search',actions:'ti-clipboard-check',regulatory:'ti-scale',lessons:'ti-bulb',reports:'ti-report-analytics',configuration:'ti-settings'};

function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(character){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];});}
function title(value){return String(value||'').replace(/[-_]/g,' ').replace(/\b\w/g,function(character){return character.toUpperCase();});}
function direct(page,selector){try{return page.querySelector(':scope > '+selector);}catch(_){return page.querySelector(selector);}}
function normaliseViews(manifest,views){
  var configured=views||(manifest.layout&&manifest.layout.views)||[];
  return configured.map(function(view,index){
    if(typeof view==='string')view={id:view};
    var id=String(view.id||view.key||'').trim();
    if(!id)throw new Error('AURIS module layout view requires an id.');
    return {id:id,label:view.label||title(id),icon:view.icon||defaultIcons[id]||'ti-layout-grid',group:view.group||'Workspace',order:view.order==null?index:view.order};
  }).sort(function(a,b){return a.order-b.order;});
}
function dependencyLabel(manifest){
  var names=(manifest.dependencies||[]).map(function(key){var item=registry.get(key);return item?(item.shortName||item.name):title(key);});
  return names.length?'Connected to '+names.join(' + '):'Independent application';
}
function headerHtml(manifest,activeView,options){
  var current=(activeView&&activeView.label)||title(manifest.layout.defaultView);
  return '<div class="auris-module-identity"><div class="auris-module-breadcrumb"><button type="button" data-layout-action="apps"><i class="ti ti-apps"></i> Apps</button><i class="ti ti-chevron-right"></i><span>'+esc(manifest.category)+'</span><i class="ti ti-chevron-right"></i><strong data-layout-current-view>'+esc(current)+'</strong></div><div class="auris-module-title-row"><span class="auris-module-mark"><i class="ti '+esc(manifest.icon)+'"></i></span><div><div class="page-title">'+esc(manifest.name)+'</div><div class="auris-module-subtitle" id="ev-subtitle">'+esc(options.subtitle||'One governed workspace for every stage of work')+'</div></div></div><div class="auris-module-meta"><span><i class="ti ti-category"></i>'+esc(manifest.category)+'</span><span><i class="ti ti-plug-connected"></i>'+esc(dependencyLabel(manifest))+'</span><span><i class="ti ti-layout"></i>Shared module layout</span></div></div><div class="auris-module-commandbar"><button type="button" class="auris-module-command" data-layout-action="refresh"><i class="ti ti-refresh"></i><span>Refresh</span></button>'+(options.primaryLabel?'<button type="button" class="auris-module-command primary" data-layout-action="primary"><i class="ti '+esc(options.primaryIcon||'ti-plus')+'"></i><span>'+esc(options.primaryLabel)+'</span></button>':'')+'</div>';
}
function renderHeader(instance){
  var header=instance.header,options=instance.options,manifest=instance.manifest;
  var active=instance.views.find(function(view){return view.id===instance.active;})||instance.views[0];
  header.classList.add('auris-module-header');header.dataset.aurisLayoutHeader=manifest.key;header.innerHTML=headerHtml(manifest,active,options);
  var apps=header.querySelector('[data-layout-action="apps"]');if(apps)apps.addEventListener('click',function(event){if(typeof root.modulesMenuToggle==='function')root.modulesMenuToggle(event);});
  var refresh=header.querySelector('[data-layout-action="refresh"]');if(refresh)refresh.addEventListener('click',function(){if(typeof options.onRefresh==='function')options.onRefresh();});
  var primary=header.querySelector('[data-layout-action="primary"]');if(primary)primary.addEventListener('click',function(){if(typeof options.onPrimary==='function')options.onPrimary();});
}
function renderNavigation(instance){
  var nav=instance.navigation;nav.classList.add('auris-module-viewbar');nav.dataset.aurisLayoutNavigation=instance.manifest.key;nav.setAttribute('role','tablist');nav.setAttribute('aria-label',instance.manifest.name+' views');nav.innerHTML='';
  instance.views.forEach(function(view){
    var button=root.document.createElement('button');button.type='button';button.id=(instance.options.viewIdPrefix||'auris-view-')+view.id;button.className='mtg-tab auris-module-view';button.dataset.viewId=view.id;button.dataset.viewGroup=view.group;button.setAttribute('role','tab');button.setAttribute('title',view.group+' · '+view.label);button.innerHTML='<span class="imx-tab-icon"><i class="ti '+esc(view.icon)+'"></i></span><span class="auris-module-view-copy"><strong>'+esc(view.label)+'</strong><small>'+esc(view.group)+'</small></span>';
    button.addEventListener('click',function(){if(typeof instance.options.onViewChange==='function')instance.options.onViewChange(view.id,button);});
    button.addEventListener('keydown',function(event){if(event.key!=='ArrowRight'&&event.key!=='ArrowLeft')return;event.preventDefault();var index=instance.views.indexOf(view),step=event.key==='ArrowRight'?1:-1,next=(index+step+instance.views.length)%instance.views.length;nav.querySelector('[data-view-id="'+instance.views[next].id+'"]').focus();});
    nav.appendChild(button);
  });
}
function setView(key,viewId){
  var instance=instances[key];if(!instance)return false;
  var view=instance.views.find(function(item){return item.id===viewId;});if(!view)return false;
  instance.active=viewId;instance.navigation.querySelectorAll('[data-view-id]').forEach(function(button){var selected=button.dataset.viewId===viewId;button.classList.toggle('active',selected);button.setAttribute('aria-selected',selected?'true':'false');button.tabIndex=selected?0:-1;});
  var label=instance.header.querySelector('[data-layout-current-view]');if(label)label.textContent=view.label;
  instance.page.dataset.aurisActiveView=viewId;return true;
}
function mount(key,options){
  options=options||{};var manifest=registry.get(key);if(!manifest)throw new Error('Cannot mount layout for unknown AURIS module: '+key);
  var page=options.page||(root.document&&root.document.getElementById(options.pageId||'page-'+key));if(!page)throw new Error('AURIS module layout page was not found: '+key);
  var header=direct(page,'.page-header'),navigation=direct(page,'.module-tabs');if(!header||!navigation)throw new Error('AURIS module layout requires a page header and module tabs: '+key);
  var views=normaliseViews(manifest,options.views),active=options.activeView||manifest.layout.defaultView||views[0].id;
  var instance={key:key,page:page,header:header,navigation:navigation,manifest:manifest,views:views,active:active,options:options};instances[key]=instance;
  page.classList.add('auris-module-layout');page.dataset.aurisModuleLayout=key;renderHeader(instance);renderNavigation(instance);setView(key,active);return instance;
}
function current(key){var instance=instances[key];return instance?instance.active:null;}
function get(key){return instances[key]||null;}

root.AurisModuleLayout=Object.freeze({version:'1.0.0',mount:mount,setView:setView,current:current,get:get,normaliseViews:normaliseViews});
})(typeof window!=='undefined'?window:globalThis);
