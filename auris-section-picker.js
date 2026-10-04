(function(){
  'use strict';
  var selector='.page .module-tabs,.page .bbs-tabs,.page .mtg-tabs,.page .kpi-x-tabs,.page .se-tabs,.page [role="tablist"]';
  // These legacy navigation rows have generated class names rather than a tab-list class.
  var moduleTabs={inspection:'insp-tab-all',contractor:'con-tab-register',esg:'esg-tab-dash',emergency:'em3tab-dash',ohealth:'oh-tab-dash',ppe:'ppe-tab-dash',fire:'fire-tab-certs',meetings:'mtg-tab-schedule',training:'train-tab-matrix'};
  var pending=false;

  function tabsIn(bar){return Array.from(bar.children).filter(function(child){return child.tagName==='BUTTON'&&!child.hidden;});}
  function activeIndex(buttons){var index=buttons.findIndex(function(button){return button.classList.contains('active')||button.getAttribute('aria-current')==='page'||button.getAttribute('aria-selected')==='true';});return index<0?0:index;}
  function label(button){return (button.textContent||'').replace(/\s+/g,' ').trim();}
  function enhance(bar){
    if(!bar||bar.closest('.auris-section-picker,[role="dialog"],.modal')||!bar.closest('.page'))return;
    var buttons=tabsIn(bar);
    if(buttons.length<2||buttons.some(function(button){return !label(button);}))return;
    var picker=bar.previousElementSibling;
    if(!picker||!picker.classList.contains('auris-section-picker')){
      picker=document.createElement('label');
      picker.className='auris-section-picker';
      var caption=document.createElement('span');caption.textContent='Section';
      var select=document.createElement('select');select.setAttribute('aria-label','Choose module section');
      picker.appendChild(caption);picker.appendChild(select);
      bar.parentNode.insertBefore(picker,bar);
      select.addEventListener('change',function(){
        var target=tabsIn(bar)[Number(select.value)];
        if(target)target.click();
      });
    }
    bar.classList.add('auris-section-tabs-hidden');
    if(!bar.hasAttribute('data-auris-section-nav'))bar.setAttribute('data-auris-section-nav','');
    var select=picker.querySelector('select');
    var names=buttons.map(label);
    if(select.options.length!==names.length||names.some(function(name,index){return select.options[index].textContent!==name;})){
      select.replaceChildren();
      names.forEach(function(name,index){var option=document.createElement('option');option.value=String(index);option.textContent=name;select.appendChild(option);});
    }
    var selected=String(activeIndex(buttons));
    if(select.value!==selected)select.value=selected;
  }
  function update(){pending=false;document.querySelectorAll(selector).forEach(enhance);Object.keys(moduleTabs).forEach(function(page){var button=document.querySelector('#page-'+page+' #'+moduleTabs[page]);if(button)enhance(button.parentElement);});}
  function schedule(){if(pending)return;pending=true;requestAnimationFrame(update);}
  function start(){schedule();new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-current','aria-selected','hidden']});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
