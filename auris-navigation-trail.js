(function(root){
'use strict';
var trail=[],session='',current=null,gesture=null,restoring=null,sequence=0,entries=Object.create(null),pendingBack=null,activeHistoryId=null,ignoreHistoryId=null;
function cancelPending(){if(pendingBack){pendingBack.resolve(false);pendingBack=null;}if(restoring)restoring.cancelled=true;}
function scope(){try{var p=(typeof prof!=='undefined'&&prof)||root.prof||{};return [p.id||'',typeof ccid==='function'?ccid():'',typeof activeRole==='function'?activeRole():p.role||''].join('|');}catch(_){return '';}}
function activePage(){return root.document.querySelector('#app .page.active');}
function keyOf(page){return page&&String(page.id||'').replace(/^page-/,'')||'';}
function clean(value){return String(value||'').replace(/\s+/g,' ').trim();}
function moduleName(key){return root.AurisModuleRegistry?.get(key)?.name||key;}
function checkScope(){var value=scope();if(session!==value){cancelPending();trail=[];current=null;gesture=null;entries=Object.create(null);activeHistoryId=null;session=value;}return value;}
function selectedSection(page){
  var picker=page?.querySelector('.auris-section-picker select');
  var active=page?.querySelector('[data-auris-section-nav] button.active,.lcu-tabs button.active,[role="tablist"] [aria-selected="true"]');
  return {id:active?.id||'',value:picker?.value||'',label:clean(active?.textContent||picker?.selectedOptions?.[0]?.textContent)};
}
function controlKey(node){
  if(node.id&&/search|filter/i.test(node.id))return {id:node.id};
  var bar=node.closest('.ave-toolbar'),host=bar?.parentElement;
  if(!host?.id)return null;
  var attr=['data-view-mode','data-view-group','data-view-sort','data-view-saved','data-view-column'].find(function(name){return node.hasAttribute(name);});
  return attr?{host:host.id,attr:attr,value:node.getAttribute(attr)}:null;
}
function capture(page){
  if(!page)return null;
  var controls=[];
  page.querySelectorAll('input,select').forEach(function(node){
    if(node.type==='password'||node.type==='file'||node.closest('[role="dialog"],.modal,form'))return;
    var locator=controlKey(node);if(locator)controls.push({locator:locator,value:node.value,checked:!!node.checked,type:node.type});
  });
  var main=root.document.querySelector('.main');
  return {key:keyOf(page),name:moduleName(keyOf(page)),section:selectedSection(page),page:page,scope:scope(),controls:controls,scroll:{top:main?.scrollTop||0,left:main?.scrollLeft||0,x:root.scrollX||0,y:root.scrollY||0},historyId:root.history?.state?.aurisNavigation?.id||null};
}
function marker(){return root.history?.state?.aurisNavigation;}
function historyEntry(snapshot){
  if(!root.history?.replaceState)return null;
  var mark=marker(),entry=mark?.scope===session&&entries[mark.id];
  if(!entry){var id='auris-'+(++sequence);entry=entries[id]={id:id,position:0,trail:trail.slice(),snapshot:snapshot};root.history.replaceState(Object.assign({},root.history.state,{aurisNavigation:{id:id,scope:session}}),'');}
  if(snapshot){snapshot.historyId=entry.id;entry.snapshot=snapshot;entry.trail=trail.slice();}
  activeHistoryId=entry.id;return entry;
}
function recordHistory(snapshot){
  try{var previous=historyEntry(snapshot);if(!previous||!root.history?.pushState)return;var id='auris-'+(++sequence);entries[id]={id:id,position:previous.position+1,trail:trail.slice(),snapshot:null};root.history.pushState(Object.assign({},root.history.state,{aurisNavigation:{id:id,scope:session}}),'');activeHistoryId=id;}catch(_){}
}
function reset(){cancelPending();trail=[];current=null;gesture=null;entries=Object.create(null);activeHistoryId=null;ignoreHistoryId=null;try{var state=Object.assign({},root.history?.state);delete state.aurisNavigation;root.history?.replaceState(state,'');}catch(_){};}
function direct(element){return !!element?.closest?.('.sidebar,.mobile-bottom-nav,#mobile-bottom3nav,#mobile-modules-overlay,[data-sidebar-go],#auris-home-link,.auris-app-grid');}
function begin(key,element,options){
  checkScope();options=options||{};var from=capture(activePage());
  if(restoring&&options.navigationReturn===restoring.id&&restoring.snapshot.key===key)return {key:key,scope:session,mode:'return',returning:restoring,reuse:restoring.snapshot.page===root.document.getElementById('page-'+key)&&restoring.snapshot.page.isConnected};
  var explicit=direct(element)||(gesture&&Date.now()-gesture.time<1500&&gesture.direct);
  return {key:key,scope:session,from:from,mode:!from||from.key===key?'same':explicit||key==='dashboard'||from.key==='dashboard'?'direct':'follow',committed:false};
}
function commit(ticket){
  if(!ticket||ticket.committed||ticket.scope!==checkScope())return;
  ticket.committed=true;
  if(ticket.mode==='return'){trail=ticket.returning.trail.slice();current={key:ticket.key};return;}
  if(ticket.mode==='direct')reset();
  if(ticket.mode==='follow'&&ticket.from){
    try{historyEntry(ticket.from);}catch(_){}
    trail.push(ticket.from);if(trail.length>20)trail.shift();recordHistory(null);
  }
  if(gesture)gesture.used=true;
  current={key:ticket.key};
}
function locate(page,locator){if(locator.id)return root.document.getElementById(locator.id);var host=root.document.getElementById(locator.host);return host&&Array.from(host.querySelectorAll('['+locator.attr+']')).find(function(node){return node.getAttribute(locator.attr)===locator.value;});}
function frame(){return new Promise(function(resolve){(root.requestAnimationFrame||function(fn){root.setTimeout(fn,0);})(resolve);});}
async function restore(snapshot,targetTrail,historyId){
  if(restoring||snapshot.scope!==checkScope())return false;
  if(typeof root.canAccessPage==='function'&&!root.canAccessPage(snapshot.key))throw Error('Your account cannot return to this module.');
  var request={id:++sequence,snapshot:snapshot,trail:targetTrail.slice()};restoring=request;
  function valid(){return !request.cancelled&&snapshot.scope===checkScope()&&keyOf(activePage())===snapshot.key;}
  try{
    var result=await root.showPage(snapshot.key,null,{navigationReturn:request.id});
    if(result?.cancelled||snapshot.scope!==checkScope()||keyOf(activePage())!==snapshot.key)return false;
    await frame();
    if(!valid())return false;
    var page=activePage(),section=selectedSection(page);
    if(snapshot.section.label&&section.label!==snapshot.section.label){
      var tab=snapshot.section.id&&root.document.getElementById(snapshot.section.id),picker=page.querySelector('.auris-section-picker select');
      if(tab&&!tab.hidden&&!tab.disabled&&page.contains(tab))tab.click();
      else if(picker){var option=Array.from(picker.options).find(function(item){return clean(item.textContent)===snapshot.section.label&&!item.hidden&&!item.disabled;});if(option){picker.value=option.value;picker.dispatchEvent(new root.Event('change',{bubbles:true}));}}
      await frame();
      if(!valid())return false;
    }
    for(var item of snapshot.controls){var node=locate(page,item.locator);if(!node||!page.contains(node)||node.disabled)continue;var changed=item.type==='checkbox'?node.checked!==item.checked:node.value!==item.value;if(!changed)continue;if(item.type==='checkbox')node.checked=item.checked;else node.value=item.value;node.dispatchEvent(new root.Event(item.locator.id?'input':'change',{bubbles:true}));if(item.locator.id)node.dispatchEvent(new root.Event('change',{bubbles:true}));}
    await frame();
    if(!valid())return false;
    var main=root.document.querySelector('.main');if(main){main.scrollTop=snapshot.scroll.top;main.scrollLeft=snapshot.scroll.left;}root.scrollTo?.(snapshot.scroll.x,snapshot.scroll.y);
    trail=targetTrail.slice();current={key:snapshot.key};gesture=null;
    if(historyId&&entries[historyId]){root.history?.replaceState(Object.assign({},root.history.state,{aurisNavigation:{id:historyId,scope:session}}),'');activeHistoryId=historyId;}
    root.document.dispatchEvent(new root.CustomEvent('auris:navigation-restored',{detail:{module:snapshot.key,section:snapshot.section.label}}));
    return true;
  }finally{if(restoring===request)restoring=null;root.AurisModuleHeader?.refresh?.();}
}
function error(error){if(typeof root.toast==='function')root.toast(error.message||String(error),false);}
async function back(index){
  checkScope();if(restoring||pendingBack||!trail.length)return false;index=Number.isInteger(index)?index:trail.length-1;
  var snapshot=trail[index];if(!snapshot)return false;
  var targetTrail=trail.slice(0,index),from=marker(),entry=from?.scope===session&&entries[from.id],target=entries[snapshot.historyId];
  if(entry&&target&&root.history?.go&&entry.position>target.position){
    return new Promise(function(resolve){
      var pending={resolve:resolve,snapshot:snapshot,trail:targetTrail};pendingBack=pending;
      try{root.history.go(target.position-entry.position);}catch(_){pendingBack=null;restore(snapshot,targetTrail,snapshot.historyId).then(resolve,function(e){error(e);resolve(false);});return;}
      root.setTimeout(function(){if(pendingBack!==pending)return;pendingBack=null;restore(snapshot,targetTrail,snapshot.historyId).then(resolve,function(e){error(e);resolve(false);});},1200);
    });
  }
  try{return await restore(snapshot,targetTrail,snapshot.historyId);}catch(e){error(e);return false;}
}
function handlePopState(event){
  checkScope();var mark=event.state?.aurisNavigation,entry=mark?.scope===session&&entries[mark.id];if(!entry?.snapshot)return false;
  if(ignoreHistoryId===entry.id){ignoreHistoryId=null;activeHistoryId=entry.id;return true;}
  var prior=entries[activeHistoryId];
  event.preventDefault?.();var pending=pendingBack;pendingBack=null;
  function compensate(){if(!prior||entries[prior.id]!==prior||entry.snapshot.scope!==scope()||scope()!==session)return;ignoreHistoryId=prior.id;try{if(root.history?.go&&prior.position!==entry.position){root.history.go(prior.position-entry.position);return;}}catch(_){}root.history?.replaceState(Object.assign({},root.history.state,{aurisNavigation:{id:prior.id,scope:session}}),'');activeHistoryId=prior.id;ignoreHistoryId=null;}
  restore(entry.snapshot,entry.trail,entry.id).then(function(ok){if(!ok)compensate();pending?.resolve(ok);},function(e){compensate();error(e);pending?.resolve(false);});return true;
}
function render(crumb,route){
  checkScope();var page=activePage();if(!page||keyOf(page)!==route.key)return false;
  var section=route.section||'';
  if(!restoring&&current?.key===route.key&&gesture&&!gesture.used&&!gesture.direct&&Date.now()-gesture.time<10000&&gesture.snapshot?.key===route.key&&gesture.snapshot.section.label&&section&&gesture.snapshot.section.label!==section){
    gesture.used=true;try{historyEntry(gesture.snapshot);}catch(_){}trail.push(gesture.snapshot);if(trail.length>20)trail.shift();recordHistory(null);
  }
  current={key:route.key};
  try{var mark=marker();if(mark?.scope===session&&entries[mark.id])entries[mark.id].snapshot=capture(page);}catch(_){}
  var signature=JSON.stringify([trail.map(function(item){return [item.key,item.section.label];}),route.key,route.name,section]);
  if(crumb.dataset.navigationTrail===signature)return true;
  crumb.dataset.navigationTrail=signature;
  crumb.replaceChildren();
  var parts=[],lastKey='';
  trail.forEach(function(item,index){if(item.key!==lastKey)parts.push({label:item.name,index:index});if(item.section.label)parts.push({label:item.section.label,index:index});lastKey=item.key;});
  if(route.key!=='dashboard'){if(route.key!==lastKey)parts.push({label:route.name});if(section)parts.push({label:section});}
  parts.forEach(function(item){crumb.appendChild(root.document.createTextNode(' / '));if(item.index===undefined){var span=root.document.createElement('span');span.textContent=item.label;crumb.appendChild(span);}else{var button=root.document.createElement('button');button.type='button';button.className='auris-breadcrumb-link';button.textContent=item.label;button.addEventListener('click',function(){back(item.index);});crumb.appendChild(button);}});
  var button=root.document.getElementById('auris-navigation-back');
  if(!button&&crumb.parentElement){button=root.document.createElement('button');button.id='auris-navigation-back';button.type='button';button.className='auris-navigation-back';button.textContent='Back';button.addEventListener('click',function(){back();});crumb.parentElement.insertBefore(button,crumb);}
  if(button){button.hidden=!trail.length;button.setAttribute('aria-label',trail.length?'Back to '+trail[trail.length-1].name+(trail[trail.length-1].section.label?' · '+trail[trail.length-1].section.label:''):'Back');}
  return true;
}
function remember(event){
  if(restoring)return;var page=activePage(),target=event.target;if(!page||!target?.closest)return;
  if(target.closest('#auris-navigation-back,.auris-breadcrumb-link'))return;
  var isDirect=direct(target),section=target.closest('.auris-section-picker,[data-auris-section-nav],#auris-module-section');
  gesture={time:Date.now(),snapshot:capture(page),direct:isDirect||!!section,used:false};
}
root.AurisNavigationTrail=Object.freeze({begin:begin,commit:commit,render:render,back:back,handlePopState:handlePopState,reset:reset,diagnostics:function(){return {depth:trail.length,modules:trail.map(function(item){return item.key;}),restoring:!!restoring};}});
if(root.document){root.document.addEventListener('click',remember,true);root.document.addEventListener('change',remember,true);}
})(typeof window!=='undefined'?window:globalThis);
