(function(){
  'use strict';
  var selector='.page .module-tabs,.page .bbs-tabs,.page [class*="-tabs"]';
  var pending=false;

  function tabsIn(bar){return Array.from(bar.children).filter(function(child){return child.tagName==='BUTTON'&&!child.hidden;});}
  function activeIndex(buttons){var index=buttons.findIndex(function(button){return button.classList.contains('active')||button.getAttribute('aria-current')==='page'||button.getAttribute('aria-selected')==='true';});return index<0?0:index;}
  function label(button){return (button.textContent||'').replace(/\s+/g,' ').trim();}
  function enhance(bar){
    if(bar.closest('.auris-section-picker'))return;
    var buttons=tabsIn(bar);
    if(buttons.length<3||buttons.some(function(button){return !label(button);}))return;
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
    var select=picker.querySelector('select');
    var names=buttons.map(label);
    if(select.options.length!==names.length||names.some(function(name,index){return select.options[index].textContent!==name;})){
      select.replaceChildren();
      names.forEach(function(name,index){var option=document.createElement('option');option.value=String(index);option.textContent=name;select.appendChild(option);});
    }
    var selected=String(activeIndex(buttons));
    if(select.value!==selected)select.value=selected;
  }
  function update(){pending=false;document.querySelectorAll(selector).forEach(enhance);}
  function schedule(){if(pending)return;pending=true;requestAnimationFrame(update);}
  function start(){schedule();new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-current','aria-selected','hidden']});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
