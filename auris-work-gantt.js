(function(root){
'use strict';
var VERSION='work-gantt-20261103-1',DAY=86400000,WIDTH=960,states=new WeakMap(),generation=0;
function escape(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function civilDay(year,month,day){var date=new Date(0);date.setUTCHours(0,0,0,0);date.setUTCFullYear(year,month,day);return Math.floor(date.getTime()/DAY);}
function parseDay(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;var year=Number(value.slice(0,4)),month=Number(value.slice(5,7)),day=Number(value.slice(8,10));if(year<1||year>9999||month<1||month>12||day<1||day>31)return null;var result=civilDay(year,month-1,day),date=new Date(result*DAY);return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?result:null;}
function formatDay(day){if(!Number.isInteger(day))return '';var date=new Date(day*DAY);if(Number.isNaN(date.getTime()))return '';return String(date.getUTCFullYear()).padStart(4,'0')+'-'+String(date.getUTCMonth()+1).padStart(2,'0')+'-'+String(date.getUTCDate()).padStart(2,'0');}
var MIN=parseDay('0001-01-01'),MAX=parseDay('9999-12-31');
function clamp(day){return Math.max(MIN,Math.min(MAX,day));}
function todayDay(now){var date=now==null?new Date():new Date(now);if(Number.isNaN(date.getTime()))throw Error('The current date is unavailable.');return parseDay(String(date.getFullYear()).padStart(4,'0')+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0'));}
function readable(day){var value=formatDay(day);return value?value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4):'Not recorded';}
function identity(value){return {companyId:String(value&&value.companyId||value&&value.company||''),userId:String(value&&value.userId||value&&value.user||''),role:String(value&&value.role||'')};}
function same(a,b){return a.companyId===b.companyId&&a.userId===b.userId&&a.role===b.role;}
function model(rawRows,current,filters,now){
 var workspace=root.AurisWorkScheduleWorkspace;if(!workspace||typeof workspace.project!=='function')throw Error('Work Schedule filters are unavailable. Reload this module.');
 var scope=identity(current);if(!scope.companyId||!scope.userId)throw Error('Sign in and select a company before viewing the schedule.');
 var rawById=new Map();(rawRows||[]).forEach(function(row){if(row&&row.id&&String(row.company_id||'')===scope.companyId)rawById.set(String(row.id),row);});
 var seen=new Set(),rows=workspace.project(rawRows||[],scope,{filters:filters||{}},now==null?undefined:new Date(now)).filter(function(row){if(!row||!rawById.has(String(row.id))||seen.has(String(row.id)))return false;seen.add(String(row.id));return true;}).map(function(projected){
  var raw=rawById.get(String(projected.id)),startValue=raw.planned_start,endValue=raw.planned_end,start=parseDay(startValue),end=parseDay(endValue),hasStart=startValue!==null&&startValue!==undefined&&startValue!=='',hasEnd=endValue!==null&&endValue!==undefined&&endValue!=='',issue='',scheduled=false;
  if(hasStart&&start===null)issue='Invalid planned start date';
  else if(hasEnd&&end===null)issue='Invalid planned end date';
  else if(!hasStart)issue=hasEnd?'Start date not recorded; end date only':'Planned dates not recorded';
  else if(hasEnd&&end<start)issue='Planned end precedes planned start';
  else{scheduled=true;if(!hasEnd){end=start;issue='End date not recorded; shown as one planned day';}}
  var dates=scheduled?(readable(start)+(end!==start?' – '+readable(end):'')+(issue?' · '+issue:'')):issue+(hasStart?' · Start: '+String(startValue):'')+(hasEnd?' · End: '+String(endValue):'');
  return {id:String(projected.id),reference:String(projected.reference||'Draft'),title:String(projected.title||'Untitled work order'),location:String(projected.location||'Not recorded'),status:String(raw.status||''),statusLabel:String(projected.status||'Not recorded'),priority:String(projected.priority||'Not recorded'),timing:String(projected.timing||''),start:start,end:end,scheduled:scheduled,dateIssue:issue,datesLabel:dates};
 });
 var scheduled=rows.filter(function(row){return row.scheduled;}),unscheduled=rows.filter(function(row){return !row.scheduled;}),min=null,max=null;
 scheduled.forEach(function(row){min=min===null?row.start:Math.min(min,row.start);max=max===null?row.end:Math.max(max,row.end);});
 return {rows:rows,scheduled:scheduled,unscheduled:unscheduled,today:todayDay(now),min:min,max:max};
}
function rangeFor(mode,anchor){
 if(!Number.isInteger(anchor)||anchor<MIN||anchor>MAX)throw Error('Choose a valid schedule date.');var date=new Date(anchor*DAY),year=date.getUTCFullYear(),month=date.getUTCMonth(),start,end;
 if(mode==='week'){start=anchor-(date.getUTCDay()+6)%7;end=start+6;}
 else if(mode==='quarter'){month=Math.floor(month/3)*3;start=civilDay(year,month,1);end=civilDay(year,month+3,1)-1;}
 else{start=civilDay(year,month,1);end=civilDay(year,month+1,1)-1;}
 return {start:clamp(start),end:clamp(end)};
}
function fitRange(data){return data.min===null?rangeFor('month',data.today):{start:clamp(data.min-1),end:clamp(data.max+1)};}
function scale(start,end){
 if(!Number.isInteger(start)||!Number.isInteger(end)||start>end||start<MIN||end>MAX)throw Error('The schedule display range is invalid.');
 var span=end-start+1,unit=span<=60?'day':span<=420?'week':span<=1826?'month':'year',buckets=[],cursor=start,date=new Date(start*DAY),lastDate=new Date(end*DAY),yearStep=Math.max(1,Math.ceil((lastDate.getUTCFullYear()-date.getUTCFullYear()+1)/60));
 while(cursor<=end&&buckets.length<62){
  var d=new Date(cursor*DAY),next,label;
  if(unit==='day'){next=cursor+1;label=String(d.getUTCDate())+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];}
  else if(unit==='week'){next=cursor+7;label=readable(cursor).slice(0,5);}
  else if(unit==='month'){next=civilDay(d.getUTCFullYear(),d.getUTCMonth()+1,1);label=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]+' '+String(d.getUTCFullYear()).padStart(4,'0');}
  else{next=civilDay(d.getUTCFullYear()+yearStep,0,1);label=String(d.getUTCFullYear()).padStart(4,'0')+(yearStep>1?'–'+String(Math.min(9999,d.getUTCFullYear()+yearStep-1)).padStart(4,'0'):'');}
  next=Math.max(cursor+1,Math.min(end+1,next));buckets.push({start:cursor,end:next-1,label:label});cursor=next;
 }
 return {start:start,end:end,span:span,unit:unit,buckets:buckets};
}
function ensureStyle(){if(document.getElementById('auris-work-gantt-style'))return;var link=document.createElement('link');link.id='auris-work-gantt-style';link.rel='stylesheet';link.href='auris-work-gantt.css?v='+VERSION;(document.head||document.documentElement).appendChild(link);}
function verify(state){if(states.get(state.host)!==state||state.host.isConnected===false||state.options.isActive&&state.options.isActive()===false)throw Error('The schedule view is no longer open.');var current=identity(state.options.context());if(!same(current,state.scope))throw Error('Your account, company or access changed. Reopen Work Schedule.');return current;}
function x(day,axis){return Math.max(0,Math.min(WIDTH,(day-axis.start)/axis.span*WIDTH));}
function number(value){return Math.round(value*100)/100;}
function gridPath(axis,height){return axis.buckets.map(function(bucket){var pos=number(x(bucket.start,axis));return 'M'+pos+' 0V'+height;}).join(' ');}
function axisHtml(axis,today){var labelStep=Math.max(1,Math.ceil(axis.buckets.length/16));return '<svg class="awg-axis" viewBox="0 0 '+WIDTH+' 48" preserveAspectRatio="none" aria-hidden="true"><path class="awg-grid" d="'+gridPath(axis,48)+'"/>'+axis.buckets.map(function(bucket,index){return index%labelStep?'':'<text x="'+number((x(bucket.start,axis)+x(bucket.end+1,axis))/2)+'" y="22" text-anchor="middle">'+escape(bucket.label)+'</text>';}).join('')+(today>=axis.start&&today<=axis.end?'<line class="awg-today" x1="'+number(x(today+.5,axis))+'" x2="'+number(x(today+.5,axis))+'" y1="30" y2="48"/>':'')+'</svg>';}
function timelineHtml(row,axis,today){
 if(!row.scheduled)return '<div class="awg-date-warning">'+escape(row.datesLabel)+'</div>';
 var visible=row.start<=axis.end&&row.end>=axis.start,title=row.reference+' · '+row.title+' · '+row.statusLabel+' · '+row.datesLabel,left=number(x(Math.max(row.start,axis.start),axis)),right=number(x(Math.min(row.end+1,axis.end+1),axis)),width=Math.max(2,right-left);
 return '<svg class="awg-timeline" viewBox="0 0 '+WIDTH+' 42" preserveAspectRatio="none" role="img" aria-label="'+escape(title)+'" data-work-gantt-open="'+escape(row.id)+'"><title>'+escape(title+(visible?'':' · Outside displayed period'))+'</title><path class="awg-grid" d="'+gridPath(axis,42)+'"/>'+(today>=axis.start&&today<=axis.end?'<line class="awg-today" x1="'+number(x(today+.5,axis))+'" x2="'+number(x(today+.5,axis))+'" y1="0" y2="42"/>':'')+(visible?'<rect class="awg-bar" data-status="'+escape(row.status)+'" x="'+left+'" y="10" width="'+number(width)+'" height="22" rx="4"/>'+(row.start<axis.start?'<path class="awg-continues" d="M8 15L2 21L8 27"/>':'')+(row.end>axis.end?'<path class="awg-continues" d="M952 15L958 21L952 27"/>':''):'<text class="awg-outside" x="12" y="26">Outside displayed period</text>')+'</svg>';
}
function render(state){
 verify(state);var data=state.data,axis=scale(state.range.start,state.range.end),visible=data.scheduled.filter(function(row){return row.start<=axis.end&&row.end>=axis.start;}).length;
 var buttons=[['prev','Previous','ti-chevron-left'],['today','Today','ti-calendar'],['next','Next','ti-chevron-right']],modes=[['week','Week'],['month','Month'],['quarter','Quarter']];
 state.host.innerHTML='<section class="awg-shell" aria-label="Work-order Gantt chart"><header class="awg-header"><div><h2>Work schedule timeline</h2><p>'+data.rows.length+' '+(data.rows.length===1?'work order matches':'work orders match')+' the current filters · '+visible+' scheduled in this period'+(data.unscheduled.length?' · '+data.unscheduled.length+' need date details':'')+'</p></div><div class="awg-toolbar"><div class="awg-group" role="group" aria-label="Timeline period">'+modes.map(function(mode){return '<button type="button" class="btn btn-sm" data-work-gantt-action="'+mode[0]+'" aria-pressed="'+(state.mode===mode[0])+'">'+mode[1]+'</button>';}).join('')+'</div><button type="button" class="btn btn-sm" data-work-gantt-action="fit" aria-pressed="'+(state.mode==='fit')+'"><i class="ti ti-arrows-horizontal" aria-hidden="true"></i> Fit work</button><div class="awg-group" role="group" aria-label="Navigate timeline">'+buttons.map(function(button){return '<button type="button" class="btn btn-sm" data-work-gantt-action="'+button[0]+'" aria-label="'+button[1]+' timeline period"><i class="ti '+button[2]+'" aria-hidden="true"></i>'+button[1]+'</button>';}).join('')+'</div>'+(typeof state.options.onRefresh==='function'?'<button type="button" class="btn btn-sm" data-work-gantt-action="refresh"><i class="ti ti-refresh" aria-hidden="true"></i> Refresh</button>':'')+'</div></header><div class="awg-summary"><strong>'+readable(axis.start)+' – '+readable(axis.end)+'</strong><span>Planned dates · '+escape(axis.unit)+' scale · Today: '+readable(data.today)+(data.today<axis.start||data.today>axis.end?' (outside this period)':' (green line)')+'</span></div><p class="awg-feedback" data-work-gantt-feedback role="status" aria-live="polite"></p>'+(data.rows.length?'<div class="awg-scroll" tabindex="0" role="region" aria-label="Scrollable work-order timeline"><table class="awg-table"><caption>Select a work order to open its saved details. Scroll horizontally to view the timeline. Missing or invalid dates remain listed.</caption><thead><tr><th scope="col" class="awg-work-heading">Work order</th><th scope="col" class="awg-time-heading">'+axisHtml(axis,data.today)+'</th></tr></thead><tbody>'+data.rows.map(function(row){return '<tr><th scope="row" class="awg-work"><button type="button" data-work-gantt-row data-work-gantt-open="'+escape(row.id)+'" aria-label="View work order '+escape(row.reference+' · '+row.title+' · '+row.datesLabel)+'"><span class="awg-reference">'+escape(row.reference)+'</span><strong>'+escape(row.title)+'</strong><span>'+escape(row.location)+' · <span class="awg-status" data-status="'+escape(row.status)+'">'+escape(row.statusLabel)+'</span>'+(row.timing==='Overdue'?' · <span class="awg-overdue">Overdue</span>':'')+'</span><span class="awg-dates">'+escape(row.datesLabel)+'</span></button></th><td>'+timelineHtml(row,axis,data.today)+'</td></tr>';}).join('')+'</tbody></table></div>':'<div class="awg-empty">No saved work orders match the current filters.</div>')+'<footer class="awg-legend" aria-label="Recorded work status legend">'+[['planned','Planned'],['approved','Approved'],['in_progress','In progress'],['on_hold','On hold'],['completed','Completed'],['cancelled','Cancelled']].map(function(status){return '<span><span class="awg-swatch" data-status="'+status[0]+'" aria-hidden="true"></span>'+status[1]+'</span>';}).join('')+'</footer></section>';
}
function feedback(state,message){if(states.get(state.host)!==state||state.host.isConnected===false)return;var node=state.host.querySelector('[data-work-gantt-feedback]');if(node)node.textContent=message;}
function changedRange(state,action){
 if(action==='fit'){state.mode='fit';state.range=fitRange(state.data);}
 else if(['week','month','quarter'].includes(action)){state.mode=action;state.range=rangeFor(action,state.range.start);}
 else if(action==='today'){state.mode=['week','month','quarter'].includes(state.mode)?state.mode:'month';state.range=rangeFor(state.mode,state.data.today);}
 else if(action==='prev'||action==='next'){
  var direction=action==='prev'?-1:1,anchor;if(state.mode==='fit')state.mode='custom';
  if(state.mode==='month'||state.mode==='quarter'){var date=new Date(state.range.start*DAY);anchor=clamp(civilDay(date.getUTCFullYear(),date.getUTCMonth()+direction*(state.mode==='quarter'?3:1),1));state.range=rangeFor(state.mode,anchor);}
  else{var span=state.range.end-state.range.start+1,start=clamp(state.range.start+direction*span);state.range={start:start,end:clamp(start+span-1)};}
 }
}
function bind(state){
 state.click=async function(event){var target=event.target&&event.target.closest?event.target.closest('[data-work-gantt-action], [data-work-gantt-open]'):null;if(!target||!state.host.contains(target))return;event.preventDefault();var openingTicket=null;
  try{
   verify(state);var action=target.getAttribute('data-work-gantt-action');if(action){if(action==='refresh'){if(state.refreshing)return;state.refreshing=true;target.disabled=true;feedback(state,'Refreshing saved work orders…');try{await state.options.onRefresh();verify(state);feedback(state,'');}finally{state.refreshing=false;if(states.get(state.host)===state&&state.host.isConnected!==false)target.disabled=false;}return;}changedRange(state,action);render(state);var active=state.host.querySelector('[data-work-gantt-action="'+action+'"]');if(active&&active.focus)active.focus();return;}
   var id=target.getAttribute('data-work-gantt-open');if(!id||!state.data.rows.some(function(row){return row.id===id;})||state.pendingOpens.has(id))return;
   if(typeof state.options.onOpen!=='function')throw Error('The work-order viewer is unavailable. Reload this module.');openingTicket=++state.openTicket;state.pendingOpens.set(id,openingTicket);feedback(state,'Opening saved work order…');
   var origin=String(target.tagName||'').toLowerCase()==='button'?target:Array.from(state.host.querySelectorAll('[data-work-gantt-row]')).find(function(button){return button.getAttribute('data-work-gantt-open')===id;})||target;
   origin.disabled=true;function verifyThisOpen(){var current=verify(state);if(state.openTicket!==openingTicket)throw Error('Another work order was selected.');return current;}
   try{await state.options.onOpen(id,origin,verifyThisOpen);verifyThisOpen();feedback(state,'');}finally{if(state.pendingOpens.get(id)===openingTicket)state.pendingOpens.delete(id);if(states.get(state.host)===state&&state.host.isConnected!==false)origin.disabled=false;}
  }catch(error){if(states.get(state.host)!==state||state.host.isConnected===false||openingTicket!==null&&state.openTicket!==openingTicket)return;try{verify(state);feedback(state,error.message||'The work order could not be opened. Retry.');}catch(_){state.host.innerHTML='<p class="awg-empty" role="alert">The schedule context changed. Reopen Work Schedule to continue.</p>';}}
 };
 state.host.addEventListener('click',state.click);
}
function destroy(host){var state=states.get(host);if(!state)return;host.removeEventListener('click',state.click);states.delete(host);host.innerHTML='';}
function mount(host,rawRows,options){
 if(!host||typeof host.addEventListener!=='function')throw Error('The Gantt chart container is unavailable.');options=options||{};if(typeof options.context!=='function')throw Error('An authenticated schedule context is required.');
 var previous=states.get(host),scope,data;try{scope=identity(options.context());data=model(rawRows,scope,options.filters,options.now);}catch(error){if(previous)destroy(host);throw error;}var preserve=previous&&same(previous.scope,scope),mode=preserve?previous.mode:'fit',state={host:host,options:options,scope:scope,data:data,generation:++generation,mode:mode,range:preserve&&mode!=='fit'?previous.range:fitRange(data),openTicket:0,pendingOpens:new Map()};
 if(previous)host.removeEventListener('click',previous.click);states.set(host,state);try{ensureStyle();render(state);bind(state);}catch(error){destroy(host);throw error;}
 return {destroy:function(){if(states.get(host)===state)destroy(host);},refresh:function(nextRows,nextOptions){verify(state);return mount(host,nextRows===undefined?rawRows:nextRows,Object.assign({},options,nextOptions||{}));},model:function(){verify(state);return state.data;}};
}
root.AurisWorkGantt=Object.freeze({mount:mount,destroy:destroy,parseDay:parseDay,formatDay:formatDay,model:model,scale:scale,rangeFor:rangeFor});
})(typeof window!=='undefined'?window:globalThis);
