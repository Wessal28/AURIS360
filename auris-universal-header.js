(function(){
  'use strict';
  var pending=false;
  var redundantRegisterSearch=['map-search','fire-cert-search','ptw-search','atex-search','fleet-search','tools-search','ra-search','lr-search','swms-search'];
  function visible(element){return !!element&&getComputedStyle(element).display!=='none'&&getComputedStyle(element).visibility!=='hidden';}
  function clean(value){return String(value||'').replace(/\s+/g,' ').trim();}
  function update(){
    pending=false;
    var page=document.querySelector('#app .page.active'),title=document.getElementById('auris-module-name'),crumb=document.getElementById('auris-module-crumb');
    if(!page||!title||!crumb)return;
    redundantRegisterSearch.forEach(function(id){var input=page.querySelector('#'+id);if(input&&input.value){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));}});
    var key=page.id.replace(/^page-/,''),heading=page.querySelector('.page-title'),module=typeof MODULES_DIR!=='undefined'&&MODULES_DIR.find(function(item){return item.k===key;}),name=key==='dashboard'?'Home':key==='kpi'?'Objectives & KPIs':clean(module&&module.l)||clean(heading&&heading.textContent)||clean(document.getElementById('mobile-page-title')?.textContent)||'Dashboard';
    var quick=document.getElementById('auris-module-quick-actions');
    if(quick){
      var hideQuick=key!=='risk';if(quick.hidden!==hideQuick)quick.hidden=hideQuick;
      if(key==='risk'){
        var newButton=quick.querySelector('[data-risk-action="new"]');
        if(newButton){var hideNew=typeof isMgr==='function'&&!isMgr();if(newButton.hidden!==hideNew)newButton.hidden=hideNew;var importButton=quick.querySelector('[data-risk-action="import"]');if(importButton&&importButton.hidden!==hideNew)importButton.hidden=hideNew;}
      }
    }
    if(title.textContent!==name)title.textContent=name;
    if(heading&&!heading.classList.contains('auris-title-mirrored'))heading.classList.add('auris-title-mirrored');
    var kpiTitle=key==='kpi'&&page.querySelector('.kpi-x-title');if(kpiTitle&&!kpiTitle.classList.contains('auris-title-mirrored'))kpiTitle.classList.add('auris-title-mirrored');
    var original=Array.from(page.querySelectorAll('.auris-section-picker')).find(function(picker){return picker.parentElement&&picker.parentElement.getClientRects().length>0;});
    var source=original&&original.querySelector('select'),mirror=document.getElementById('auris-module-section'),wrap=document.getElementById('auris-module-section-wrap');
    if(source&&source.options.length){
      if(!original.classList.contains('auris-section-mirrored'))original.classList.add('auris-section-mirrored');
      var options=Array.from(source.options),same=mirror.options.length===options.length&&options.every(function(option,index){return mirror.options[index].textContent===option.textContent&&mirror.options[index].value===option.value;});
      if(!same)mirror.replaceChildren.apply(mirror,options.map(function(option){var copy=document.createElement('option');copy.value=option.value;copy.textContent=option.textContent;return copy;}));
      if(mirror.value!==source.value)mirror.value=source.value;
      mirror.dataset.sourcePage=page.id;
      if(wrap.hidden)wrap.hidden=false;
    }else{if(!wrap.hidden)wrap.hidden=true;mirror.dataset.sourcePage='';}
    var section=source&&source.selectedOptions[0]?clean(source.selectedOptions[0].textContent):'';
    var path=name==='Home'?'':' / '+name+(section?' / '+section:'');if(crumb.textContent!==path)crumb.textContent=path;
    var company=document.getElementById('auris-global-company'),sidebarCompany=document.getElementById('sb-company');
    if(company&&sidebarCompany){var companyName=clean(sidebarCompany.textContent);if(company.textContent!==companyName)company.textContent=companyName;var hideCompany=visible(document.getElementById('sa-company-switcher'))||!companyName;if(company.hidden!==hideCompany)company.hidden=hideCompany;}
    var icon=page.querySelector('.page-title i'),symbol=document.querySelector('.auris-module-symbol i');
    if(symbol){var iconName=module&&module.i||icon&&Array.from(icon.classList).find(function(name){return name.indexOf('ti-')===0&&name!=='ti-'})||'ti-layout-dashboard';if(!symbol.classList.contains(iconName))symbol.className='ti '+iconName;}
  }
  function schedule(){if(pending)return;pending=true;requestAnimationFrame(update);}
  function start(){
    var mirror=document.getElementById('auris-module-section');if(!mirror)return;
    var bar=document.getElementById('auris-module-bar'),sectionWrap=document.getElementById('auris-module-section-wrap');
    if(bar&&sectionWrap&&!document.getElementById('auris-module-quick-actions')){
      var quick=document.createElement('div');quick.id='auris-module-quick-actions';quick.className='auris-module-quick-actions';quick.hidden=true;
      quick.innerHTML='<button type="button" data-risk-action="refresh"><i class="ti ti-refresh"></i> Refresh</button><button type="button" data-risk-action="libraries"><i class="ti ti-books"></i> Risk Libraries</button><button type="button" class="primary" data-risk-action="new"><i class="ti ti-plus"></i> New RA</button><details class="auris-module-more"><summary>More</summary><div><button type="button" data-risk-action="print"><i class="ti ti-printer"></i> Print view</button><button type="button" data-risk-action="import"><i class="ti ti-file-import"></i> Import RA PDF</button></div></details>';
      bar.insertBefore(quick,sectionWrap);
      quick.addEventListener('click',function(event){var action=event.target.closest('[data-risk-action]')?.dataset.riskAction;if(!action)return;var page=document.getElementById('page-risk');if(!page?.classList.contains('active'))return;if(action==='print'&&typeof raPrintCurrentView==='function')return raPrintCurrentView();if(action==='import'&&typeof raImportExistingPDF==='function'&&(!(typeof isMgr==='function')||isMgr()))return raImportExistingPDF('baseline');var selector=action==='refresh'?'[data-layout-action="refresh"]':action==='libraries'?'[data-layout-command="libraries"]':'[data-layout-action="primary"]';var original=page.querySelector(selector);if(original){original.click();return;}if(action==='refresh'&&typeof loadRA==='function')loadRA();if(action==='libraries'&&typeof raShowLibrary==='function')raShowLibrary();if(action==='new'&&typeof raShowNewPanel==='function'&&(!(typeof isMgr==='function')||isMgr()))raShowNewPanel();});
    }
    var profileButton=document.getElementById('auris-profile-trigger'),profileMenu=document.getElementById('auris-profile-menu');
    function closeProfile(){if(!profileMenu)return;profileMenu.hidden=true;profileButton.setAttribute('aria-expanded','false');}
    document.getElementById('auris-home-link')?.addEventListener('click',function(){if(typeof showPage==='function')showPage('dashboard');});
    document.getElementById('auris-quick-create')?.addEventListener('click',function(){if(typeof mobileFieldReports==='function')mobileFieldReports();});
    profileButton?.addEventListener('click',function(){if(!profileMenu)return;profileMenu.querySelector('[data-auris-profile-action="rollout"]').hidden=!(typeof prof!=='undefined'&&prof&&prof.role==='sephs_admin');profileMenu.hidden=!profileMenu.hidden;profileButton.setAttribute('aria-expanded',String(!profileMenu.hidden));});
    profileMenu?.addEventListener('click',function(event){var action=event.target.closest('[data-auris-profile-action]')?.dataset.aurisProfileAction;if(!action)return;closeProfile();if(action==='profile')document.getElementById('sb-user')?.click();if(action==='apps')document.getElementById('modules-trigger')?.click();if(action==='rollout')document.getElementById('dev-mode-toggle')?.click();});
    document.addEventListener('click',function(event){if(profileMenu&&!profileMenu.hidden&&!event.target.closest('#auris-profile-menu,#auris-profile-trigger'))closeProfile();});
    document.addEventListener('keydown',function(event){if(event.key==='Escape')closeProfile();});
    mirror.addEventListener('change',function(){var page=document.getElementById(mirror.dataset.sourcePage);if(!page||!page.classList.contains('active'))return;var source=page.querySelector('.auris-section-picker select');if(!source)return;source.value=mirror.value;source.dispatchEvent(new Event('change',{bubbles:true}));schedule();});
    new MutationObserver(schedule).observe(document.getElementById('app'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','hidden','style','value']});
    schedule();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
