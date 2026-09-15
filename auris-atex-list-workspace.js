(function(root){
'use strict';

var zones={zone_0:'Zone 0',zone_1:'Zone 1',zone_2:'Zone 2',zone_20:'Zone 20',zone_21:'Zone 21',zone_22:'Zone 22'};
var statuses={controlled:'Controlled',action_required:'Action required',out_of_service:'Out of service',archived:'Archived'};
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view ATEX areas.');
  services.rbac.requireAccess('atex');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view ATEX areas.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||''),name:String(profile.full_name||profile.name||profile.email||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account, company or access changed. Reload the ATEX register.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),zone:String(input.zone||'').slice(0,80),status:String(input.status||'').slice(0,80)};}
function dateState(value,now){now=now||new Date();if(!value)return {date:'',missing:true,expired:false,soon:false,label:'Not scheduled'};var date=new Date(value);if(Number.isNaN(date.getTime()))return {date:'',missing:true,expired:false,soon:false,label:'Not scheduled'};var today=new Date(now);today.setHours(0,0,0,0);var due=new Date(date);due.setHours(0,0,0,0);var soonDate=new Date(today);soonDate.setDate(soonDate.getDate()+30);return {date:date.toISOString().slice(0,10),missing:false,expired:due<today,soon:due>=today&&due<=soonDate,label:date.toISOString().slice(0,10)};}
function zoneLabel(value){return zones[String(value||'').toLowerCase()]||String(value||'Not recorded').replace(/_/g,' ');}
function statusLabel(value){return statuses[String(value||'').toLowerCase()]||String(value||'Not recorded').replace(/_/g,' ');}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase();
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId;}).map(function(row){
    var zone=String(row.zone_type||'').toLowerCase(),status=String(row.status||'controlled').toLowerCase(),inspection=dateState(row.next_inspection_date,now),statusText=statusLabel(status),attention=inspection.expired?'Inspection overdue':inspection.soon?'Inspection due soon':status==='action_required'?'Action required':status==='out_of_service'?'Out of service':'—',text=[row.area_ref,row.area_name,row.location,row.plant_area,row.zone_type,zoneLabel(zone),row.material_type,row.substance,row.source_of_release,row.ventilation_controls,row.ignition_controls,row.detection_controls,row.linked_equipment,row.responsible_person,status,statusText,attention].join(' ').toLowerCase();
    if(f.zone&&zone!==f.zone.toLowerCase())return null;
    if(f.status&&(f.status.toLowerCase()==='active'?(status==='archived'):(status!==f.status.toLowerCase())))return null;
    if(search&&!text.includes(search))return null;
    return {id:String(row.id),company_id:String(row.company_id),source_table:'atex_areas',reference:row.area_ref||('ATEX-'+String(row.id).slice(0,8).toUpperCase()),title:row.area_name||'Unnamed ATEX area',location:row.location||'',plant_area:row.plant_area||'',zone:zoneLabel(zone),material:String(row.material_type||'Not recorded').replace(/_/g,' '),substance:row.substance||'',controls:[row.ventilation_controls,row.ignition_controls,row.detection_controls].filter(Boolean).join(' | ')||'Not recorded',next_inspection:inspection.date,inspection:inspection.expired?'Overdue':inspection.soon?'Due soon':inspection.missing?'Not scheduled':'Current',responsible:row.responsible_person||'',attention:attention,status:statusText,linked_ra:row.linked_ra_ref||'',linked_permit:row.linked_permit_ref||'',updated_at:row.updated_at||row.created_at||''};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board','calendar','activity'],defaultView:'list',defaultSort:'next_inspection',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'next_inspection',activityField:'updated_at',fields:[
  {key:'reference',label:'Reference',required:true,groupable:false,action:'open'},{key:'title',label:'ATEX area',required:true,groupable:false,action:'open'},
  {key:'location',label:'Location'},{key:'plant_area',label:'Plant area',hidden:true},{key:'zone',label:'Zone'},{key:'material',label:'Material'},{key:'substance',label:'Substance'},{key:'controls',label:'Main controls',hidden:true},{key:'responsible',label:'Responsible person'},
  {key:'next_inspection',label:'Next inspection',type:'date',groupable:false,action:'edit'},{key:'inspection',label:'Inspection',type:'badge',groupable:false,tones:{Overdue:'danger','Due soon':'warning',Current:'success','Not scheduled':'warning'}},{key:'attention',label:'Attention',type:'badge',groupable:false,tones:{'Inspection overdue':'danger','Inspection due soon':'warning','Action required':'warning','Out of service':'danger','—':'success'}},
  {key:'status',label:'Status',type:'badge',tones:{Controlled:'success','Action required':'warning','Out of service':'danger',Archived:'neutral','Not recorded':'neutral'}},{key:'linked_ra',label:'Risk assessment',hidden:true},{key:'linked_permit',label:'Permit',hidden:true},{key:'updated_at',label:'Updated',type:'datetime',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session();if(!root.AurisViewEngine)throw new Error('The shared ATEX register is unavailable. Reload the application.');var projected=project(rows,current,options);
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'atex-areas',label:'ATEX Areas',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'Open ATEX area'},{key:'edit',label:'Edit ATEX area',when:function(){return options.canEdit===true;}}],onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},onAction:async function(action,row){
    assertSession(current);var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});if(!selected)throw new Error('This ATEX area is outside the current register. Reload to retry.');if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the ATEX area.');var callback=action==='open'?options.openRecord:action==='edit'&&options.canEdit===true?options.editRecord:null;if(typeof callback!=='function')throw new Error('This ATEX action is unavailable. Reload the register.');await callback(selected.id,current);
  }});
}
root.AurisAtexListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters,dateState:dateState});
})(typeof window!=='undefined'?window:globalThis);
