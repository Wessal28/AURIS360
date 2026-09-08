(function(root){
'use strict';
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view toolbox talks.');
  services.rbac.requireAccess('meetings');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view toolbox talks.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account or company changed. Reload the toolbox talk register.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),category:String(input.category||'').slice(0,80),status:String(input.status||'').slice(0,80)};}
function attendance(row){
  var named=Array.isArray(row.attendees)?row.attendees.filter(function(a){return a&&(a.name||a.full_name||a.person_name);}).length:0;
  if(named)return named;
  var count=row.attendance_count;
  if(count!==null&&count!==undefined&&String(count).trim()!==''&&Number.isInteger(Number(count))&&Number(count)>=0)return Number(count);
  return Array.isArray(row.attendees)?0:'Not recorded';
}
function project(rows,current,options){
  options=options||{};var f=filters(options.filters),search=f.search.toLowerCase(),topics=options.topics||{};
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId;}).map(function(row){
    if(f.category&&row.topic_category!==f.category||f.status&&row.status!==f.status)return null;
    var topic=Object.prototype.hasOwnProperty.call(topics,row.topic_category)?topics[row.topic_category].label:row.topic_category||'Not recorded';
    var reference=row.tbt_ref||'TBT',title=row.title||'Untitled toolbox talk';
    if(search&&![reference,title,topic,row.presenter,row.location,row.department].some(function(value){return String(value||'').toLowerCase().includes(search);}))return null;
    return {id:String(row.id),company_id:String(row.company_id),source_table:'toolbox_talks',reference:reference,title:title,topic:topic,talk_date:row.talk_date||'',
      presenter:row.presenter||'Not recorded',location:row.location||'',department:row.department||'',attendees:attendance(row),
      actions:Array.isArray(row.actions_raised)?row.actions_raised.length:'Not recorded',duration:row.duration_mins===0||row.duration_mins?row.duration_mins:'Not recorded',
      status:({completed:'Completed',planned:'Planned',cancelled:'Cancelled',draft:'Draft'}[row.status]||row.status||'Not recorded')};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board'],defaultView:'list',defaultSort:'talk_date',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'talk_date',fields:[
  {key:'reference',label:'Reference',required:true,groupable:false,action:'open'},{key:'title',label:'Toolbox talk',required:true,groupable:false,action:'open'},
  {key:'topic',label:'Topic'},{key:'talk_date',label:'Talk date',type:'date',groupable:false},{key:'presenter',label:'Presenter'},{key:'location',label:'Location'},
  {key:'attendees',label:'Recorded attendees',groupable:false},{key:'actions',label:'Recorded actions',groupable:false},
  {key:'status',label:'Status',type:'badge',tones:{Completed:'success',Planned:'info',Cancelled:'neutral',Draft:'neutral'}},
  {key:'duration',label:'Duration (minutes)',groupable:false,hidden:true},{key:'department',label:'Department',hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session(),projected=project(rows,current,options);
  if(!root.AurisViewEngine)throw new Error('The shared toolbox talk register is unavailable. Reload the application.');
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'toolbox-talks',label:'Toolbox Talks',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'Open toolbox talk'}],
    onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},
    onAction:async function(key,row){
      assertSession(current);
      var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});
      if(key!=='open'||!selected||typeof options.openRecord!=='function')throw new Error('This toolbox talk is outside the current register. Reload to retry.');
      if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the toolbox talk form.');
      await options.openRecord(selected.id,current);
    }
  });
}
root.AurisToolboxListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters,attendance:attendance});
})(typeof window!=='undefined'?window:globalThis);
