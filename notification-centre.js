(function(){
'use strict';

var NC={rows:[],ready:null,open:false,filter:'all',loading:false,timer:null,lastLoaded:null,push:{supported:false,configured:false,permission:'default',subscribed:false,loading:false}};

function esc(value){return typeof window.escH==='function'?window.escH(String(value==null?'':value)):String(value==null?'':value).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
function profile(){return typeof prof!=='undefined'?prof:null;}
function apiCall(path,opts){return window.api(path,opts);}
function panel(){return document.getElementById('nc-panel');}
function isMissingSchema(error){return /user_notifications|schema cache|does not exist|PGRST205/i.test(String(error&&error.message||error||''));}
function activeRows(){
  if(NC.filter==='unread')return NC.rows.filter(function(x){return !x.read_at;});
  if(NC.filter==='ack')return NC.rows.filter(function(x){return x.acknowledgement_required&&!x.acknowledged_at;});
  return NC.rows.filter(function(x){return !x.read_at||(x.acknowledgement_required&&!x.acknowledged_at);});
}
function activeCount(){return NC.rows.filter(function(x){return !x.read_at||(x.acknowledgement_required&&!x.acknowledged_at);}).length;}
function unreadCount(){return NC.rows.filter(function(x){return !x.read_at;}).length;}
function acknowledgementCount(){return NC.rows.filter(function(x){return x.acknowledgement_required&&!x.acknowledged_at;}).length;}
function pushStatus(){
  if(!NC.push.supported)return {label:'Push unavailable',detail:'Use the in-app inbox and email on this device.',action:''};
  if(!NC.push.configured)return {label:'Push not configured',detail:'Your administrator must add the VAPID server configuration.',action:''};
  if(NC.push.permission==='denied')return {label:'Push blocked',detail:'Allow notifications for AURIS360 in this browser or device settings.',action:''};
  if(NC.push.subscribed)return {label:'Push enabled',detail:'High-priority alerts can appear on this device.',action:'disable'};
  return {label:'Enable push alerts',detail:isIos()&&!isStandalone()?'On iPhone/iPad, first install AURIS360 using Share > Add to Home Screen.':'The browser will ask for permission only after you continue.',action:'enable'};
}
function updateBadges(){
  var count=unreadCount(),label=count>99?'99+':String(count);
  ['nc-desktop-badge','nc-mobile-badge'].forEach(function(id){var el=document.getElementById(id);if(!el)return;el.textContent=label;el.classList.toggle('show',count>0);});
  ['nc-desktop-trigger','nc-mobile-trigger'].forEach(function(id){var el=document.getElementById(id);if(el)el.setAttribute('aria-label',count?('Notifications, '+count+' unread'):'Notifications');});
}
function timeLabel(value){
  if(!value)return '';
  var date=new Date(value),diff=Date.now()-date.getTime();
  if(!Number.isFinite(diff))return '';
  if(diff<60000)return 'Just now';
  if(diff<3600000)return Math.floor(diff/60000)+' min ago';
  if(diff<86400000)return Math.floor(diff/3600000)+'h ago';
  if(diff<604800000)return Math.floor(diff/86400000)+'d ago';
  return date.toLocaleDateString(undefined,{day:'numeric',month:'short'});
}
function acknowledgementDeadline(row){
  if(!row.acknowledgement_required||row.acknowledged_at||!row.acknowledgement_due_at)return '';
  var due=new Date(row.acknowledgement_due_at),overdue=Date.now()>due.getTime();
  if(!Number.isFinite(due.getTime()))return '';
  return '<span class="nc-pill ack"><i class="ti ti-clock-exclamation"></i>'+(overdue?'Response overdue':'Respond by '+esc(due.toLocaleString()))+'</span>';
}
function iconFor(row){
  var type=String(row.event_type||'').toLowerCase();
  if(type.indexOf('incident')===0)return 'ti-alert-triangle';
  if(type.indexOf('action')===0)return 'ti-list-check';
  if(type.indexOf('permit')===0)return 'ti-file-check';
  if(type.indexOf('training')===0)return 'ti-school';
  if(type.indexOf('investigation')===0)return 'ti-search';
  if(type.indexOf('document')===0)return 'ti-files';
  if(type.indexOf('risk')===0)return 'ti-shield-search';
  return 'ti-bell';
}
function relationship(row){
  return {module:String(row.related_module||'').trim(),table:String(row.related_table||'').trim(),id:String(row.related_id||'').trim(),ref:String(row.related_ref||'').trim(),company_id:String(row.company_id||'').trim(),url:String(row.record_url||'').trim()};
}
function renderItem(row){
  var rel=relationship(row),canOpen=!!(rel.module&&rel.table&&rel.id),unread=!row.read_at;
  var ack=row.acknowledgement_required&&!row.acknowledged_at;
  var severity=['high','urgent'].includes(row.severity)?row.severity:'';
  return '<article class="nc-item '+severity+(unread?' unread':'')+'" data-id="'+esc(row.id)+'" data-auris-module-onclick="b0057" data-auris-module-args="'+encodeURIComponent(JSON.stringify([row.id]))+'">'
    +'<div class="nc-item-icon"><i class="ti '+iconFor(row)+'"></i></div><div>'
    +'<div class="nc-item-title">'+esc(row.title||'AURIS360 notification')+'</div>'
    +(row.message?'<div class="nc-item-message">'+esc(row.message)+'</div>':'')
    +'<div class="nc-item-meta"><span>'+esc(timeLabel(row.created_at))+'</span>'
    +(rel.ref?'<span class="nc-pill"><i class="ti ti-link"></i>'+esc(rel.ref)+'</span>':'')
    +(ack?'<span class="nc-pill ack"><i class="ti ti-hand-click"></i>Acknowledgement required</span>':'')
    +acknowledgementDeadline(row)
    +(row.acknowledged_at?'<span class="nc-pill"><i class="ti ti-check"></i>Acknowledged</span>':'')+'</div>'
    +'<div class="nc-actions">'
    +(canOpen?'<button type="button" class="nc-action primary" data-auris-module-onclick="b0058" data-auris-module-args="'+encodeURIComponent(JSON.stringify([row.id]))+'"><i class="ti ti-external-link"></i> Open record</button>':'')
    +(ack?'<button type="button" class="nc-action" data-auris-module-onclick="b0059" data-auris-module-args="'+encodeURIComponent(JSON.stringify([row.id]))+'"><i class="ti ti-check"></i> Acknowledge</button>':'')
    +(unread?'<button type="button" class="nc-action" data-auris-module-onclick="b0060" data-auris-module-args="'+encodeURIComponent(JSON.stringify([row.id]))+'">Mark read</button>':'')
    +'</div></div></article>';
}
function render(){
  var el=panel();if(!el)return;
  var rows=activeRows(),ackCount=acknowledgementCount();
  var body;
  if(NC.loading&&!NC.rows.length)body='<div class="nc-empty"><i class="ti ti-loader-2 nc-spin"></i><strong>Loading notifications</strong></div>';
  else if(NC.ready===false)body='<div class="nc-empty"><i class="ti ti-bell-off"></i><strong>Notification centre is being activated</strong><span>Email alerts remain available while the personal inbox database upgrade is completed.</span></div>';
  else if(!rows.length)body='<div class="nc-empty"><i class="ti ti-bell-check"></i><strong>'+({unread:'You are all caught up',ack:'No acknowledgements pending',all:'No notifications yet'}[NC.filter])+'</strong><span>New alerts assigned to you will appear here.</span></div>';
  else body=rows.map(renderItem).join('');
  var ps=pushStatus();
  el.innerHTML='<div class="nc-head"><div><div class="nc-title">Notifications</div><div class="nc-subtitle">Your assignments, reminders and escalations</div></div><div class="nc-head-actions">'
    +'<button type="button" class="nc-icon-btn" title="Mark all as read" aria-label="Mark all as read" data-auris-module-onclick="b0061"><i class="ti ti-checks"></i></button>'
    +'<button type="button" class="nc-icon-btn" title="Refresh" aria-label="Refresh notifications" data-auris-module-onclick="b0062"><i class="ti ti-refresh"></i></button>'
    +'<button type="button" class="nc-icon-btn" title="Close" aria-label="Close notifications" data-auris-module-onclick="b0063"><i class="ti ti-x"></i></button></div></div>'
    +'<div class="nc-push"><div class="nc-push-copy"><strong><i class="ti '+(NC.push.subscribed?'ti-bell-ringing':'ti-device-mobile')+'"></i>'+esc(ps.label)+'</strong><span>'+esc(ps.detail)+'</span></div>'
    +(ps.action?'<button type="button" class="nc-action '+(ps.action==='enable'?'primary':'')+'" '+(NC.push.loading?'disabled':'')+' data-auris-module-onclick="b0064">'+(NC.push.loading?'Working...':(ps.action==='enable'?'Enable':'Disable'))+'</button>':'')+'</div>'
    +'<div class="nc-filters">'+filterButton('all','Active',activeCount())+filterButton('unread','Unread',unreadCount())+filterButton('ack','Needs acknowledgement',ackCount)+'</div>'
    +'<div class="nc-list">'+body+'</div><div class="nc-footer"><span>Private to your account</span><span>'+(NC.lastLoaded?('Updated '+timeLabel(NC.lastLoaded)):'')+'</span></div>';
  updateBadges();
}
function filterButton(key,label,count){return '<button type="button" class="nc-filter '+(NC.filter===key?'active':'')+'" data-auris-module-onclick="b0065" data-auris-module-args="'+encodeURIComponent(JSON.stringify([key]))+'">'+esc(label)+' <span>'+count+'</span></button>';}
function ensureUi(){
  var extras=document.getElementById('topbar-extras');
  if(extras&&!document.getElementById('nc-desktop-trigger')){
    var button=document.createElement('button');button.type='button';button.id='nc-desktop-trigger';button.className='topbar-btn nc-trigger';button.title='Notifications';button.setAttribute('aria-haspopup','dialog');button.onclick=function(event){notificationCentreToggle(event);};
    button.innerHTML='<i class="ti ti-bell"></i><span class="nc-badge" id="nc-desktop-badge">0</span>';extras.insertBefore(button,extras.firstChild);
  }
  if(!panel()){
    var el=document.createElement('section');el.id='nc-panel';el.className='nc-panel';el.setAttribute('role','dialog');el.setAttribute('aria-label','Personal notifications');el.onclick=function(event){event.stopPropagation();};document.body.appendChild(el);
  }
}
async function refresh(force){
  if(!profile()||NC.loading||(!force&&document.hidden))return;
  NC.loading=true;if(NC.open)render();
  try{
    var path='/user_notifications?recipient_profile_id=eq.'+encodeURIComponent(profile().id)+'&dismissed_at=is.null&order=created_at.desc&limit=75';
    var rows=await apiCall(path);NC.rows=Array.isArray(rows)?rows:[];NC.ready=true;NC.lastLoaded=new Date().toISOString();
  }catch(error){
    if(isMissingSchema(error)){NC.ready=false;NC.rows=[];}else{console.warn('Notification centre refresh failed',error);}
  }finally{NC.loading=false;render();}
}
function isIos(){return /iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);}
function isStandalone(){return window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;}
function urlBase64ToUint8Array(value){
  var padding='='.repeat((4-value.length%4)%4),base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(base64),out=new Uint8Array(raw.length);
  for(var i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;
}
async function loadPushState(){
  NC.push.supported=!!(window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window);
  NC.push.permission=window.Notification?Notification.permission:'default';
  if(!NC.push.supported){render();return;}
  try{
    var configResponse=await fetch('/api/push-config',{cache:'no-store'}),config=await configResponse.json();
    NC.push.configured=!!(configResponse.ok&&config.enabled&&config.publicKey);NC.push.publicKey=config.publicKey||null;
    var registration=await navigator.serviceWorker.ready,subscription=await registration.pushManager.getSubscription();
    NC.push.subscription=subscription||null;NC.push.subscribed=!!subscription;
    if(subscription&&NC.push.configured&&profile())saveSubscription(subscription).catch(function(error){console.warn('Push subscription sync failed',error);});
  }catch(error){NC.push.configured=false;}
  render();
}
async function saveSubscription(subscription){
  var json=subscription.toJSON(),keys=json.keys||{},body={company_id:profile().company_id,recipient_profile_id:profile().id,endpoint:json.endpoint,p256dh:keys.p256dh,auth_secret:keys.auth,user_agent:navigator.userAgent,device_label:[navigator.platform||'Browser',isStandalone()?'installed app':'web'].join(' - '),enabled:true,last_seen_at:new Date().toISOString(),disabled_at:null,disabled_reason:null,updated_at:new Date().toISOString()};
  try{
    var existing=await apiCall('/push_subscriptions?recipient_profile_id=eq.'+encodeURIComponent(profile().id)+'&endpoint=eq.'+encodeURIComponent(json.endpoint)+'&limit=1');
    if(existing&&existing[0])await apiCall('/push_subscriptions?id=eq.'+encodeURIComponent(existing[0].id),{m:'PATCH',p:'return=minimal',b:body});
    else await apiCall('/push_subscriptions',{m:'POST',p:'return=minimal',b:Object.assign({created_at:new Date().toISOString()},body)});
  }catch(error){
    if(isMissingSchema(error))throw new Error('Run the browser push database upgrade before enabling alerts.');
    throw error;
  }
}
async function patch(id,body){
  if(!profile()||NC.ready===false)return false;
  try{
    var updated=await apiCall('/user_notifications?id=eq.'+encodeURIComponent(id)+'&recipient_profile_id=eq.'+encodeURIComponent(profile().id)+'&select=id,read_at,acknowledged_at,dismissed_at',{m:'PATCH',p:'return=representation',b:Object.assign({updated_at:new Date().toISOString()},body)});
    if(!Array.isArray(updated)||!updated.length)throw new Error('The notification update was not saved. Please sign in again.');
    var row=NC.rows.find(function(x){return String(x.id)===String(id);});if(row)Object.assign(row,body);render();return true;
  }catch(error){if(typeof window.toast==='function')toast('Notification could not be updated: '+(error.message||'Try again'),false);return false;}
}
window.notificationCentreInit=function(){
  ensureUi();
  if(NC.timer)clearInterval(NC.timer);
  NC.rows=[];NC.ready=null;NC.open=false;NC.filter='all';
  NC.timer=setInterval(function(){refresh(false);},60000);
  refresh(true);loadPushState();
};
window.notificationCentreReset=function(){if(NC.timer)clearInterval(NC.timer);NC.timer=null;NC.rows=[];NC.open=false;var el=panel();if(el)el.classList.remove('open');updateBadges();};
window.notificationCentreRefresh=function(force){return refresh(force!==false);};
window.notificationCentreToggle=function(event){if(event)event.stopPropagation();ensureUi();NC.open=!NC.open;panel().classList.toggle('open',NC.open);if(NC.open){render();refresh(true);}};
window.notificationCentreClose=function(){NC.open=false;var el=panel();if(el)el.classList.remove('open');};
window.notificationCentreFilter=function(filter){NC.filter=['all','unread','ack'].includes(filter)?filter:'all';render();};
window.notificationCentreMarkRead=function(id){var now=new Date().toISOString(),row=NC.rows.find(function(x){return String(x.id)===String(id);});return patch(id,Object.assign({read_at:now},row&&row.acknowledgement_required&&!row.acknowledged_at?{}:{dismissed_at:now}));};
window.notificationCentreAcknowledge=function(id){var now=new Date().toISOString();return patch(id,{read_at:now,acknowledged_at:now,acknowledged_by:profile().id,dismissed_at:now});};
window.notificationCentreMarkAllRead=async function(){
  if(!profile()||NC.ready===false||!unreadCount())return;
  var now=new Date().toISOString();
  try{
    var unread=NC.rows.filter(function(row){return !row.read_at;});
    await Promise.all(unread.map(function(row){return patch(row.id,Object.assign({read_at:now},row.acknowledgement_required&&!row.acknowledged_at?{}:{dismissed_at:now}));}));
    render();
  }catch(error){if(typeof window.toast==='function')toast('Notifications could not be marked as read',false);}
};
window.notificationCentrePushToggle=async function(){
  if(NC.push.loading||!profile())return;
  NC.push.loading=true;render();
  try{
    var registration=await navigator.serviceWorker.ready,subscription=await registration.pushManager.getSubscription();
    if(subscription){
      var endpoint=subscription.endpoint;
      await subscription.unsubscribe();
      await apiCall('/push_subscriptions?recipient_profile_id=eq.'+encodeURIComponent(profile().id)+'&endpoint=eq.'+encodeURIComponent(endpoint),{m:'PATCH',p:'return=minimal',b:{enabled:false,disabled_at:new Date().toISOString(),disabled_reason:'User disabled push on this device',updated_at:new Date().toISOString()}});
      NC.push.subscribed=false;NC.push.subscription=null;
      if(typeof window.toast==='function')toast('Push alerts disabled on this device');
    }else{
      if(isIos()&&!isStandalone())throw new Error('Install AURIS360 from Share > Add to Home Screen before enabling iPhone or iPad push alerts.');
      if(Notification.permission==='denied')throw new Error('Notifications are blocked. Allow AURIS360 in your browser or device settings.');
      if(Notification.permission==='default'){
        var permission=await Notification.requestPermission();NC.push.permission=permission;
        if(permission!=='granted')throw new Error('Notification permission was not granted.');
      }
      if(!NC.push.publicKey)throw new Error('Push alerts are not configured by the administrator.');
      subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(NC.push.publicKey)});
      try{await saveSubscription(subscription);}catch(error){await subscription.unsubscribe().catch(function(){});throw error;}
      NC.push.subscribed=true;NC.push.subscription=subscription;
      if(typeof window.toast==='function')toast('Push alerts enabled on this device');
    }
  }catch(error){if(typeof window.toast==='function')toast(error.message||'Push setting could not be changed',false);}
  finally{NC.push.loading=false;NC.push.permission=window.Notification?Notification.permission:'default';render();}
};
window.notificationCentreOpen=async function(id){
  var row=NC.rows.find(function(x){return String(x.id)===String(id);});if(!row)return;
  if(!row.read_at)await window.notificationCentreMarkRead(id);
  var rel=relationship(row);
  if(!rel.module||!rel.table||!rel.id){if(typeof window.toast==='function')toast('This notification has no linked source record.',false);return;}
  var request=typeof window.deepLinkNormalise==='function'?deepLinkNormalise({goto:rel.module,record:rel.id,ref:rel.ref,table:rel.table,company:rel.company_id}):null;
  if(!request||typeof window.canAccessPage==='function'&&!canAccessPage(deepLinkPage(request))){if(typeof window.toast==='function')toast('Your current role cannot open this notification source.',false);return;}
  notificationCentreClose();
  if(typeof window.deepLinkStore==='function')deepLinkStore(request);
  if(typeof window.deepLinkResume==='function')await deepLinkResume('personal-notification-centre');
};

document.addEventListener('click',function(event){if(NC.open&&!event.target.closest('#nc-panel')&&!event.target.closest('#nc-desktop-trigger')&&!event.target.closest('#nc-mobile-trigger'))notificationCentreClose();});
document.addEventListener('keydown',function(event){if(event.key==='Escape'&&NC.open)notificationCentreClose();});
document.addEventListener('visibilitychange',function(){if(!document.hidden&&profile())refresh(true);});
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',function(event){if(event.data&&event.data.type==='PUSH_SUBSCRIPTION_CHANGED'&&profile())loadPushState();});
})();
