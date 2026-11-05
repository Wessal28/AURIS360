(function(){
  'use strict';
  var selector='.page .module-tabs,.page .bbs-tabs,.page .mtg-tabs,.page .kpi-x-tabs,.page .se-tabs,.page .dcx-top-tabs,.page .noise-tabs,.page .swx-tabs,.page .ccu-tabs,.page .legx-tabs,.page .lcu-tabs,.page [role="tablist"]';
  // These legacy navigation rows have generated class names rather than a tab-list class.
  var moduleTabs={inspection:'insp-tab-all',esg:'esg-tab-dash',emergency:'em3tab-dash',ohealth:'oh-tab-dash',ppe:'ppe-tab-dash',fire:'fire-tab-certs',meetings:'mtg-tab-schedule',training:'train-tab-matrix',legal:'legal-tab-register'};
  var pending=false,bindings=new WeakMap();

  function tabsIn(bar){return Array.from(bar.children).filter(function(child){return child.tagName==='BUTTON'&&!child.hidden;});}
  function activeIndex(buttons){var index=buttons.findIndex(function(button){return button.classList.contains('active')||button.getAttribute('aria-current')==='page'||button.getAttribute('aria-selected')==='true';});return index<0?0:index;}
  function label(button){var viewName=button.querySelector('.auris-module-view-copy strong');return ((viewName&&viewName.textContent)||button.textContent||'').replace(/\s+/g,' ').trim();}
  function enhance(bar){
    var page=bar?.closest('.page');
    if(!page||['page-tools','page-contractor','page-sop'].includes(page.id)||bar.closest('.auris-section-picker,[role="dialog"],.modal')||bar.id==='lcu-legacy-tabs')return;
    var buttons=tabsIn(bar),picker=bar.previousElementSibling,binding=bindings.get(picker);
    if(buttons.some(function(button){return !label(button);})||(!binding&&buttons.length<2))return;
    if(!binding){
      picker=document.createElement('label');
      picker.className='auris-section-picker';
      var caption=document.createElement('span');caption.textContent='Section';
      var select=document.createElement('select');select.setAttribute('aria-label','Choose module section');
      picker.appendChild(caption);picker.appendChild(select);
      bar.parentNode.insertBefore(picker,bar);
      binding={bar:bar,buttons:buttons};
      bindings.set(picker,binding);
      select.addEventListener('change',function(){
        var target=select.value!==''&&binding.buttons[Number(select.value)];
        if(target&&!target.hidden&&!target.disabled&&target.parentElement===binding.bar&&binding.bar.parentElement===picker.parentElement)target.click();
        // A declined or deferred tab change keeps the last active selection.
        select.value=String(activeIndex(binding.buttons));
      });
    }
    binding.bar=bar;
    binding.buttons=buttons;
    // This class is observed below. Even adding an existing class emits a
    // mutation in browsers, so an unconditional write keeps every page updating.
    if(!bar.classList.contains('auris-section-tabs-hidden'))bar.classList.add('auris-section-tabs-hidden');
    if(!bar.hasAttribute('data-auris-section-nav'))bar.setAttribute('data-auris-section-nav','');
    var select=picker.querySelector('select');
    var names=buttons.map(label);
    if(select.options.length!==names.length||names.some(function(name,index){return select.options[index].textContent!==name||!!select.options[index].disabled!==!!buttons[index].disabled;})){
      select.replaceChildren();
      names.forEach(function(name,index){var option=document.createElement('option');option.value=String(index);option.textContent=name;option.disabled=!!buttons[index].disabled;select.appendChild(option);});
    }
    var selected=String(activeIndex(buttons));
    if(select.value!==selected)select.value=selected;
  }
  function update(){pending=false;document.querySelectorAll(selector).forEach(enhance);Object.keys(moduleTabs).forEach(function(page){var button=document.querySelector('#page-'+page+' #'+moduleTabs[page]);if(button)enhance(button.parentElement);});}
  function schedule(){if(pending)return;pending=true;requestAnimationFrame(update);}
  function start(){schedule();new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-current','aria-selected','hidden','disabled']});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
