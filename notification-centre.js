(function(){
'use strict';

var NC={rows:[],ready:null,open:false,filter:'all',loading:false,timer:null,lastLoaded:null};

function esc(value){return typeof window.escH==='function'?window.escH(String(value==null?'':value)):String(value==null?'':value).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
function profile(){return typeof prof!=='undefined'?prof:null;}
function apiCall(path,opts){return window.api(path,opts);}
function panel(){return document.getElementById('nc-panel');}
function isMissingSchema(error){return /user_notifications|schema cache|does not exist|PGRST205/i.test(String(error&&error.message||error||''));}
function activeRows(){
  if(NC.filter==='unread')return NC.rows.filter(function(x){return !x.read_at;});
  if(NC.filter==='ack')return NC.rows.filter(function(x){return x.acknowledgement_required&&!x.acknowledged_at;});
  return NC.rows;
}
function unreadCount(){return NC.rows.filter(function(x){return !x.read_at;}).length;}
function acknowledgementCount(){return NC.rows.filter(function(x){return x.acknowledgement_required&&!x.acknowledged_at;}).length;}
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
  return '<article class="nc-item '+severity+(unread?' unread':'')+'" data-id="'+esc(row.id)+'" onclick="notificationCentreOpen(\''+esc(row.id)+'\')">'
    +'<div class="nc-item-icon"><i class="ti '+iconFor(row)+'"></i></div><div>'
    +'<div class="nc-item-title">'+esc(row.title||'AURIS360 notification')+'</div>'
    +(row.message?'<div class="nc-item-message">'+esc(row.message)+'</div>':'')
    +'<div class="nc-item-meta"><span>'+esc(timeLabel(row.created_at))+'</span>'
    +(rel.ref?'<span class="nc-pill"><i class="ti ti-link"></i>'+esc(rel.ref)+'</span>':'')
    +(ack?'<span class="nc-pill ack"><i class="ti ti-hand-click"></i>Acknowledgement required</span>':'')
    +(row.acknowledged_at?'<span class="nc-pill"><i class="ti ti-check"></i>Acknowledged</span>':'')+'</div>'
    +'<div class="nc-actions">'
    +(canOpen?'<button type="button" class="nc-action primary" onclick="event.stopPropagation();notificationCentreOpen(\''+esc(row.id)+'\')"><i class="ti ti-external-link"></i> Open record</button>':'')
    +(ack?'<button type="button" class="nc-action" onclick="event.stopPropagation();notificationCentreAcknowledge(\''+esc(row.id)+'\')"><i class="ti ti-check"></i> Acknowledge</button>':'')
    +(unread?'<button type="button" class="nc-action" onclick="event.stopPropagation();notificationCentreMarkRead(\''+esc(row.id)+'\')">Mark read</button>':'')
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
  el.innerHTML='<div class="nc-head"><div><div class="nc-title">Notifications</div><div class="nc-subtitle">Your assignments, reminders and escalations</div></div><div class="nc-head-actions">'
    +'<button type="button" class="nc-icon-btn" title="Mark all as read" aria-label="Mark all as read" onclick="notificationCentreMarkAllRead()"><i class="ti ti-checks"></i></button>'
    +'<button type="button" class="nc-icon-btn" title="Refresh" aria-label="Refresh notifications" onclick="notificationCentreRefresh(true)"><i class="ti ti-refresh"></i></button>'
    +'<button type="button" class="nc-icon-btn" title="Close" aria-label="Close notifications" onclick="notificationCentreClose()"><i class="ti ti-x"></i></button></div></div>'
    +'<div class="nc-filters">'+filterButton('all','All',NC.rows.length)+filterButton('unread','Unread',unreadCount())+filterButton('ack','Needs acknowledgement',ackCount)+'</div>'
    +'<div class="nc-list">'+body+'</div><div class="nc-footer"><span>Private to your account</span><span>'+(NC.lastLoaded?('Updated '+timeLabel(NC.lastLoaded)):'')+'</span></div>';
  updateBadges();
}
function filterButton(key,label,count){return '<button type="button" class="nc-filter '+(NC.filter===key?'active':'')+'" onclick="notificationCentreFilter(\''+key+'\')">'+esc(label)+' <span>'+count+'</span></button>';}
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
async function patch(id,body){
  if(!profile()||NC.ready===false)return false;
  try{
    await apiCall('/user_notifications?id=eq.'+encodeURIComponent(id)+'&recipient_profile_id=eq.'+encodeURIComponent(profile().id),{m:'PATCH',p:'return=minimal',b:Object.assign({updated_at:new Date().toISOString()},body)});
    var row=NC.rows.find(function(x){return String(x.id)===String(id);});if(row)Object.assign(row,body);render();return true;
  }catch(error){if(typeof window.toast==='function')toast('Notification could not be updated: '+(error.message||'Try again'),false);return false;}
}
window.notificationCentreInit=function(){
  ensureUi();
  if(NC.timer)clearInterval(NC.timer);
  NC.rows=[];NC.ready=null;NC.open=false;NC.filter='all';
  NC.timer=setInterval(function(){refresh(false);},60000);
  refresh(true);
};
window.notificationCentreReset=function(){if(NC.timer)clearInterval(NC.timer);NC.timer=null;NC.rows=[];NC.open=false;var el=panel();if(el)el.classList.remove('open');updateBadges();};
window.notificationCentreRefresh=function(force){return refresh(force!==false);};
window.notificationCentreToggle=function(event){if(event)event.stopPropagation();ensureUi();NC.open=!NC.open;panel().classList.toggle('open',NC.open);if(NC.open){render();refresh(true);}};
window.notificationCentreClose=function(){NC.open=false;var el=panel();if(el)el.classList.remove('open');};
window.notificationCentreFilter=function(filter){NC.filter=['all','unread','ack'].includes(filter)?filter:'all';render();};
window.notificationCentreMarkRead=function(id){return patch(id,{read_at:new Date().toISOString()});};
window.notificationCentreAcknowledge=function(id){var now=new Date().toISOString();return patch(id,{read_at:now,acknowledged_at:now,acknowledged_by:profile().id});};
window.notificationCentreMarkAllRead=async function(){
  if(!profile()||NC.ready===false||!unreadCount())return;
  var now=new Date().toISOString();
  try{
    await apiCall('/user_notifications?recipient_profile_id=eq.'+encodeURIComponent(profile().id)+'&read_at=is.null',{m:'PATCH',p:'return=minimal',b:{read_at:now,updated_at:now}});
    NC.rows.forEach(function(row){if(!row.read_at)row.read_at=now;});render();
  }catch(error){if(typeof window.toast==='function')toast('Notifications could not be marked as read',false);}
};
window.notificationCentreOpen=async function(id){
  var row=NC.rows.find(function(x){return String(x.id)===String(id);});if(!row)return;
  if(!row.read_at)await patch(id,{read_at:new Date().toISOString()});
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
})();
