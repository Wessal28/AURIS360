(function(){
  'use strict';
  var pending=false;
  function visible(element){return !!element&&getComputedStyle(element).display!=='none'&&getComputedStyle(element).visibility!=='hidden';}
  function clean(value){return String(value||'').replace(/\s+/g,' ').trim();}
  function update(){
    pending=false;
    var page=document.querySelector('#app .page.active'),title=document.getElementById('auris-module-name'),crumb=document.getElementById('auris-module-crumb');
    if(!page||!title||!crumb)return;
    var heading=page.querySelector('.page-title'),name=clean(heading&&heading.textContent)||clean(document.getElementById('mobile-page-title')?.textContent)||'Dashboard';
    if(title.textContent!==name)title.textContent=name;
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
    var path='Home / '+name+(section?' / '+section:'');if(crumb.textContent!==path)crumb.textContent=path;
    var company=document.getElementById('auris-global-company'),sidebarCompany=document.getElementById('sb-company');
    if(company&&sidebarCompany){var companyName=clean(sidebarCompany.textContent);if(company.textContent!==companyName)company.textContent=companyName;var hideCompany=visible(document.getElementById('sa-company-switcher'))||!companyName;if(company.hidden!==hideCompany)company.hidden=hideCompany;}
    var icon=page.querySelector('.page-title i'),symbol=document.querySelector('.auris-module-symbol i');
    if(symbol){var iconName=icon&&Array.from(icon.classList).find(function(name){return name.indexOf('ti-')===0&&name!=='ti-'})||'ti-layout-dashboard';if(!symbol.classList.contains(iconName))symbol.className='ti '+iconName;}
  }
  function schedule(){if(pending)return;pending=true;requestAnimationFrame(update);}
  function start(){
    var mirror=document.getElementById('auris-module-section');if(!mirror)return;
    mirror.addEventListener('change',function(){var page=document.getElementById(mirror.dataset.sourcePage);if(!page||!page.classList.contains('active'))return;var source=page.querySelector('.auris-section-picker select');if(!source)return;source.value=mirror.value;source.dispatchEvent(new Event('change',{bubbles:true}));schedule();});
    new MutationObserver(schedule).observe(document.getElementById('app'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','hidden','style','value']});
    schedule();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
