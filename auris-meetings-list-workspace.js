(function(root){
'use strict';

var types={management_review:'HSE Management Review',hse_committee:'HSE Committee Meeting',other:'Other Meeting'};
var statuses={draft:'Draft',completed:'Completed',cancelled:'Cancelled',submitted:'Submitted',approved:'Approved'};
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view HSE meetings.');
  services.rbac.requireAccess('meetings');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view HSE meetings.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||''),name:String(profile.full_name||profile.name||profile.email||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account, company or access changed. Reload the HSE meeting register.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),type:String(input.type||'').slice(0,80),status:String(input.status||'').slice(0,80),attention:String(input.attention||'').slice(0,80)};}
function safeJson(value){if(Array.isArray(value))return value;try{var parsed=JSON.parse(value||'');return Array.isArray(parsed)?parsed:[];}catch(_){return [];}}
function dateState(value,now){
  now=now||new Date();if(!value)return {date:'',missing:true,expired:false,soon:false,days:null,label:'Not scheduled'};
  var date=new Date(value);if(Number.isNaN(date.getTime()))return {date:'',missing:true,expired:false,soon:false,days:null,label:'Not scheduled'};
  var today=new Date(now);today.setHours(0,0,0,0);var due=new Date(date);due.setHours(0,0,0,0);var days=Math.ceil((due-today)/86400000);
  return {date:date.toISOString().slice(0,10),missing:false,expired:days<0,soon:days>=0&&days<=30,days:days,label:date.toISOString().slice(0,10)};
}
function label(map,value,fallback){var key=String(value||'').toLowerCase();return map[key]||String(value||fallback||'Not recorded').replace(/_/g,' ');}
function actionState(items,now){
  var actions=(Array.isArray(items)?items:[]).filter(function(item){return item&&item._kind!=='mom_meta';}),open=0,overdue=0;
  actions.forEach(function(item){var status=String(item.status||'open').toLowerCase();if(!['completed','closed','done','cancelled'].includes(status)){open++;var due=dateState(item.date||item.due_date,now);if(due.expired)overdue++;}});
  return {items:actions,count:actions.length,open:open,overdue:overdue};
}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase();
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId;}).map(function(row){
    var type=String(row.meeting_type||'other').toLowerCase(),status=String(row.status||'draft').toLowerCase(),meeting=dateState(row.meeting_date,now),next=dateState(row.next_meeting_date,now),actions=actionState(row.recommendations,now),minutes=String(row.minutes||'').trim();
    if(f.type&&type!==f.type.toLowerCase())return null;if(f.status&&status!==f.status.toLowerCase())return null;
    var flags=[];if(!row.meeting_date)flags.push('meeting_date_missing');if((meeting.expired||status==='completed')&&!minutes&&status!=='cancelled')flags.push('minutes_missing');if(meeting.expired&&!minutes&&status!=='cancelled')flags.push('minutes_overdue');if(next.expired)flags.push('next_meeting_overdue');else if(next.soon)flags.push('next_meeting_due_soon');if(actions.overdue)flags.push('action_overdue');
    if(f.attention&&!flags.includes(f.attention.toLowerCase()))return null;
    var title=row.title||'HSE meeting',hay=[row.meeting_ref,row.title,row.meeting_type,type,row.location,row.chaired_by,row.attendees,row.apologies,row.agenda,row.minutes,row.notes,actions.items.map(function(item){return item.desc+' '+item.resp;}).join(' ')].join(' ').toLowerCase();if(search&&!hay.includes(search))return null;
    var attention=flags.includes('action_overdue')?'Action overdue':flags.includes('minutes_overdue')?'Minutes overdue':flags.includes('minutes_missing')?'Minutes missing':flags.includes('next_meeting_overdue')?'Next meeting overdue':flags.includes('next_meeting_due_soon')?'Next meeting due soon':flags.includes('meeting_date_missing')?'Meeting date missing':'—';
    return {id:String(row.id),company_id:String(row.company_id),source_table:'hse_meetings',reference:row.meeting_ref||'MOM-'+String(row.id).slice(0,8).toUpperCase(),title:title,type:label(types,type,'Not recorded'),meeting_date:meeting.date,location:row.location||'Not recorded',chaired_by:row.chaired_by||'Not recorded',status:label(statuses,status,'Not recorded'),minutes:minutes,actions:actions.count,open_actions:actions.open,overdue_actions:actions.overdue,next_meeting_date:next.date,next_meeting:next.expired?'Overdue':next.soon?'Due soon':next.missing?'Not scheduled':'Current',days_to_next:next.days,attendees:row.attendees||'',attention:attention,attention_flags:flags,updated_at:row.updated_at||row.created_at||''};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board','calendar','activity'],defaultView:'list',defaultSort:'meeting_date',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'meeting_date',activityField:'updated_at',fields:[
  {key:'reference',label:'Minutes reference',required:true,groupable:false,action:'open'},{key:'title',label:'Meeting',required:true,groupable:false,action:'open'},{key:'type',label:'Meeting type'},{key:'meeting_date',label:'Meeting date',type:'date',groupable:false},{key:'location',label:'Location'},{key:'chaired_by',label:'Chaired by'},{key:'status',label:'Status',type:'badge',tones:{Draft:'warning',Submitted:'warning',Completed:'success',Approved:'success',Cancelled:'neutral','Not recorded':'neutral'}},{key:'actions',label:'Actions',type:'number',groupable:false},{key:'open_actions',label:'Open actions',type:'number',groupable:false},{key:'overdue_actions',label:'Overdue actions',type:'number',groupable:false},{key:'next_meeting_date',label:'Next meeting',type:'date',groupable:false},{key:'next_meeting',label:'Next state',type:'badge',groupable:false,tones:{Current:'success','Due soon':'warning',Overdue:'danger','Not scheduled':'warning'}},{key:'days_to_next',label:'Days to next',type:'number',groupable:false},{key:'attention',label:'Attention',type:'badge',groupable:false,tones:{'Action overdue':'danger','Minutes overdue':'danger','Minutes missing':'warning','Next meeting overdue':'danger','Next meeting due soon':'warning','Meeting date missing':'warning','—':'success'}},{key:'updated_at',label:'Updated',type:'datetime',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session();if(!root.AurisViewEngine)throw new Error('The shared HSE meeting register is unavailable. Reload the application.');var projected=project(rows,current,options);
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'hse-meetings',label:'HSE Meeting Register',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'Open minutes'},{key:'edit',label:'Edit minutes',when:function(){return options.canEdit===true;}}],onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},onAction:async function(key,row){
    assertSession(current);var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});if(!selected)throw new Error('These meeting minutes are outside the current register. Reload to retry.');if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the meeting minutes.');var callback=key==='open'?options.openRecord:key==='edit'&&options.canEdit===true?options.editRecord:null;if(typeof callback!=='function')throw new Error('This meeting minutes action is unavailable. Reload the register.');await callback(selected.id,current);
  }});
}
root.AurisMeetingsListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters,dateState:dateState});
})(typeof window!=='undefined'?window:globalThis);
