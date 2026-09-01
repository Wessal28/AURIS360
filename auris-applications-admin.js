(function(root){
'use strict';
var registry=root.AurisModuleRegistry,runtime=root.AurisModuleRuntime,services=root.AurisPlatformServices;
if(!registry||!runtime)throw new Error('AURIS Applications administration requires the module registry and runtime.');

function unique(items){var out=[];(items||[]).forEach(function(item){if(item&&out.indexOf(item)===-1)out.push(item);});return out;}
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(character){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];});}
function serviceHealth(){return services&&typeof services.health==='function'?services.health():{};}
function launched(options){return unique(options&&options.launchedKeys||root.LAUNCHED_MODULES||registry.keys({companyScoped:true}));}
function normaliseSelection(enabled){return registry.dependencyClosure(unique(['dashboard'].concat(enabled||[])));}
function planEnable(moduleKey,enabled,options){
  var live=launched(options),closure=registry.dependencyClosure([moduleKey]),blocked=closure.filter(function(key){return live.indexOf(key)===-1;});
  return {action:'enable',moduleKey:moduleKey,add:closure.filter(function(key){return (enabled||[]).indexOf(key)===-1;}),remove:[],blocked:blocked,next:blocked.length?normaliseSelection(enabled):normaliseSelection((enabled||[]).concat(closure))};
}
function planDisable(moduleKey,enabled){
  var remove=unique([moduleKey].concat(registry.dependantsOf(moduleKey,{recursive:true}))).filter(function(key){return (enabled||[]).indexOf(key)!==-1;});
  if(moduleKey==='dashboard')return {action:'disable',moduleKey:moduleKey,add:[],remove:[],blocked:['dashboard'],next:normaliseSelection(enabled)};
  return {action:'disable',moduleKey:moduleKey,add:[],remove:remove,blocked:[],next:normaliseSelection((enabled||[]).filter(function(key){return remove.indexOf(key)===-1;}))};
}
function plan(moduleKey,enable,enabled,options){return enable?planEnable(moduleKey,enabled,options):planDisable(moduleKey,enabled);}
function catalogue(enabled,options){
  enabled=normaliseSelection(enabled);var live=launched(options),health=serviceHealth(),unready=Object.keys(health).filter(function(name){return !health[name];});
  return registry.list({companyScoped:true}).map(function(manifest){
    var isLive=live.indexOf(manifest.key)!==-1,isEnabled=enabled.indexOf(manifest.key)!==-1,missing=registry.missingDependencies(manifest.key,enabled),enablePlan=planEnable(manifest.key,enabled,options),state=!isLive?'blocked':isEnabled?'installed':'available';
    return {key:manifest.key,name:manifest.name,shortName:manifest.shortName,icon:manifest.icon,color:manifest.color,category:manifest.category,state:state,enabled:isEnabled,released:isLive,managed:manifest.lifecycle.managed,version:manifest.version,platformRange:manifest.compatibility.platform,migrations:Array.from(manifest.compatibility.migrations),dependencies:Array.from(manifest.dependencies),missingDependencies:missing,enableImpact:enablePlan.add,serviceHealth:health,unreadyServices:unready,reason:!isLive?'Not in the controlled production release':missing.length?'Requires '+missing.join(', '):unready.length?'Platform service setup: '+unready.join(', '):isEnabled?'Installed for this company':'Available to install'};
  });
}
function diagnostics(enabled,options){
  var apps=catalogue(enabled,options),counts={installed:0,available:0,blocked:0};apps.forEach(function(app){counts[app.state]+=1;});
  return {counts:counts,services:serviceHealth(),applications:apps,healthy:Object.keys(serviceHealth()).every(function(name){return serviceHealth()[name];})};
}
function badge(app){return '<span class="auris-app-state '+app.state+'"><i class="ti '+(app.state==='installed'?'ti-circle-check':app.state==='available'?'ti-download':'ti-lock')+'"></i>'+esc(app.state)+'</span>';}
function appCard(app,companyId){
  var dependencies=app.dependencies.length?app.dependencies.map(function(key){var item=registry.get(key);return item?item.shortName:key;}).join(' · '):'Independent';
  return '<article class="auris-app-card" data-app-key="'+esc(app.key)+'"><div class="auris-app-card-top"><span class="auris-app-icon" style="--auris-app-color:'+esc(app.color)+'"><i class="ti '+esc(app.icon)+'"></i></span>'+badge(app)+'</div><div><h4>'+esc(app.name)+'</h4><p>'+esc(app.reason)+'</p></div><dl><div><dt>Version</dt><dd>'+esc(app.version)+'</dd></div><div><dt>Platform</dt><dd>'+esc(app.platformRange)+'</dd></div><div><dt>Dependencies</dt><dd>'+esc(dependencies)+'</dd></div><div><dt>Lifecycle</dt><dd>'+(app.managed?'Shared engine':'Compatibility mode')+'</dd></div></dl><div class="auris-app-actions"><button type="button" data-app-configure="'+esc(app.key)+'">Configure</button><button type="button" class="primary" data-app-toggle="'+esc(app.key)+'" '+(app.state==='blocked'?'disabled':'')+'>'+(app.enabled?'Uninstall':'Install')+'</button></div></article>';
}
function companySection(company,options){
  var apps=catalogue(company.module_access||[],options),diag=diagnostics(company.module_access||[],options);
  return '<section class="auris-app-company" data-company-id="'+esc(company.id)+'"><header><div><span class="auris-app-eyebrow">Company applications</span><h3>'+esc(company.name||'Unnamed company')+'</h3></div><div class="auris-app-summary"><span><b>'+diag.counts.installed+'</b> Installed</span><span><b>'+diag.counts.available+'</b> Available</span><span><b>'+diag.counts.blocked+'</b> Blocked</span><span class="'+(diag.healthy?'healthy':'warning')+'"><i class="ti '+(diag.healthy?'ti-heart-check':'ti-alert-triangle')+'"></i>'+(diag.healthy?'Services ready':'Service attention')+'</span></div></header><div class="auris-app-grid">'+apps.map(function(app){return appCard(app,company.id);}).join('')+'</div></section>';
}
function renderPortfolio(host,companies,options){
  options=options||{};host.innerHTML='<div class="auris-applications-toolbar"><div><span class="auris-app-eyebrow">AURIS Applications</span><h2>Install, configure and monitor company applications</h2><p>Dependencies and safe rollback impacts are calculated before access is changed.</p></div><button type="button" data-app-refresh><i class="ti ti-refresh"></i>Refresh</button></div>'+((companies||[]).length?(companies||[]).map(function(company){return companySection(company,options);}).join(''):'<div class="auris-app-empty">No companies are available.</div>');
  var refresh=host.querySelector('[data-app-refresh]');if(refresh)refresh.addEventListener('click',function(){if(typeof options.onRefresh==='function')options.onRefresh();});
  host.querySelectorAll('[data-app-configure]').forEach(function(button){button.addEventListener('click',function(){var section=button.closest('[data-company-id]');if(typeof options.onConfigure==='function')options.onConfigure(section.dataset.companyId,button.dataset.appConfigure);});});
  host.querySelectorAll('[data-app-toggle]').forEach(function(button){button.addEventListener('click',async function(){
    var section=button.closest('[data-company-id]'),company=(companies||[]).find(function(item){return String(item.id)===String(section.dataset.companyId);});if(!company)return;
    var app=catalogue(company.module_access||[],options).find(function(item){return item.key===button.dataset.appToggle;});if(!app)return;
    var impact=plan(app.key,!app.enabled,company.module_access||[],options);if(impact.blocked.length){if(typeof options.onBlocked==='function')options.onBlocked(impact);return;}
    button.disabled=true;try{if(typeof options.onApply==='function')await options.onApply(company,impact);}finally{button.disabled=false;}
  });});
  return diagnostics((companies&&companies[0]&&companies[0].module_access)||[],options);
}

root.AurisApplicationsAdmin=Object.freeze({version:'1.0.0',normaliseSelection:normaliseSelection,planEnable:planEnable,planDisable:planDisable,plan:plan,catalogue:catalogue,diagnostics:diagnostics,renderPortfolio:renderPortfolio});
})(typeof window!=='undefined'?window:globalThis);
