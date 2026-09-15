(function(root){
'use strict';

var statuses={operational:'Operational',out_of_service:'Out of service',retired:'Retired',archived:'Archived'};
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view emergency equipment.');
  services.rbac.requireAccess('emergency');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view emergency equipment.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||''),name:String(profile.full_name||profile.name||profile.email||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account, company or access changed. Reload emergency equipment.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),type:String(input.type||'').slice(0,80),status:String(input.status||'').slice(0,80),attention:String(input.attention||'').slice(0,80)};}
function dateState(value,now){
  now=now||new Date();if(!value)return {date:'',missing:true,expired:false,soon:false,days:null,label:'Not scheduled'};
  var date=new Date(value);if(Number.isNaN(date.getTime()))return {date:'',missing:true,expired:false,soon:false,days:null,label:'Not scheduled'};
  var today=new Date(now);today.setHours(0,0,0,0);var due=new Date(date);due.setHours(0,0,0,0);var days=Math.ceil((due-today)/86400000);
  return {date:date.toISOString().slice(0,10),missing:false,expired:days<0,soon:days>=0&&days<=30,days:days,label:date.toISOString().slice(0,10)};
}
function label(map,value,fallback){var key=String(value||'').toLowerCase();return map[key]||String(value||fallback||'Not recorded').replace(/_/g,' ');}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase();
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId;}).map(function(row){
    var type=String(row.equipment_type||'other').toLowerCase(),status=String(row.status||'operational').toLowerCase(),condition=String(row.condition||'').toLowerCase(),inspection=dateState(row.next_inspection,now),service=dateState(row.next_service,now),flags=[];
    if(inspection.expired||service.expired)flags.push('overdue');else if(inspection.soon||service.soon)flags.push('due_soon');if(inspection.missing)flags.push('inspection_missing');if(service.missing)flags.push('service_missing');if(['poor','condemned'].includes(condition))flags.push('condition_risk');if(status!=='operational')flags.push('not_operational');
    var attention=flags.includes('overdue')?'Overdue':flags.includes('condition_risk')?'Condition risk':flags.includes('not_operational')?'Not operational':flags.includes('due_soon')?'Due soon':flags.includes('inspection_missing')?'Inspection missing':flags.includes('service_missing')?'Service missing':'—';
    var hay=[row.identifier,type,row.building,row.floor,row.location,condition,row.serviced_by,status,attention,inspection.date,service.date].join(' ').toLowerCase();
    if(f.type&&type!==f.type.toLowerCase())return null;if(f.status&&status!==f.status.toLowerCase())return null;if(f.attention&&!flags.includes(f.attention.toLowerCase()))return null;if(search&&!hay.includes(search))return null;
    return {id:String(row.id),company_id:String(row.company_id),source_table:'emergency_equipment',reference:row.identifier||('EME-'+String(row.id).slice(0,8).toUpperCase()),title:label({},type,'Other equipment'),equipment_type:type,building:row.building||'Not recorded',floor:row.floor||'Not recorded',location:row.location||'Not recorded',condition:label({},condition,'Not recorded'),next_inspection:inspection.date,next_service:service.date,inspection:inspection.expired?'Overdue':inspection.soon?'Due soon':inspection.missing?'Not scheduled':'Current',service:service.expired?'Overdue':service.soon?'Due soon':service.missing?'Not scheduled':'Current',serviced_by:row.serviced_by||'Not recorded',status:label(statuses,status,'Not recorded'),attention:attention,attention_flags:flags,updated_at:row.updated_at||row.created_at||''};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board','calendar','activity'],defaultView:'list',defaultSort:'next_inspection',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'next_inspection',activityField:'updated_at',fields:[
  {key:'reference',label:'Equipment ID / tag',required:true,groupable:false,action:'open'},{key:'title',label:'Equipment type',required:true,groupable:false,action:'open'},{key:'equipment_type',label:'Type',hidden:true},{key:'building',label:'Building'},{key:'floor',label:'Floor'},{key:'location',label:'Location'},{key:'condition',label:'Condition',type:'badge',tones:{Excellent:'success',Good:'success',Fair:'warning',Poor:'danger',Condemned:'danger','Not recorded':'neutral'}},{key:'next_inspection',label:'Next inspection',type:'date',groupable:false,action:'edit'},{key:'inspection',label:'Inspection state',type:'badge',groupable:false,tones:{Current:'success','Due soon':'warning',Overdue:'danger','Not scheduled':'warning'}},{key:'next_service',label:'Next service',type:'date',groupable:false},{key:'service',label:'Service state',type:'badge',groupable:false,tones:{Current:'success','Due soon':'warning',Overdue:'danger','Not scheduled':'warning'}},{key:'serviced_by',label:'Service owner',hidden:true},{key:'status',label:'Status',type:'badge',tones:{Operational:'success','Out of service':'danger',Retired:'neutral',Archived:'neutral','Not recorded':'neutral'}},{key:'attention',label:'Attention',type:'badge',groupable:false,tones:{Overdue:'danger','Condition risk':'danger','Not operational':'danger','Due soon':'warning','Inspection missing':'warning','Service missing':'warning','—':'success'}},{key:'updated_at',label:'Updated',type:'datetime',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session();if(!root.AurisViewEngine)throw new Error('The shared emergency equipment register is unavailable. Reload the application.');var projected=project(rows,current,options);
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'emergency-management',label:'Emergency Equipment',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'Open emergency equipment'},{key:'edit',label:'Edit emergency equipment',when:function(){return options.canEdit===true;}}],onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},onAction:async function(key,row){
    assertSession(current);var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});if(!selected)throw new Error('This emergency equipment is outside the current register. Reload to retry.');if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening emergency equipment.');var callback=key==='open'?options.openRecord:key==='edit'&&options.canEdit===true?options.editRecord:null;if(typeof callback!=='function')throw new Error('This emergency equipment action is unavailable. Reload the register.');await callback(selected.id,current);
  }});
}
root.AurisEmergencyListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters,dateState:dateState});
})(typeof window!=='undefined'?window:globalThis);
