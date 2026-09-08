(function(root){
'use strict';
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view permits.');
  services.rbac.requireAccess('permit');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view permits.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account or company changed. Reload the permit register.');return current;}
function filters(input){input=input||{};return {scope:input.scope==='all'?'all':'active',search:String(input.search||'').slice(0,300),type:String(input.type||'').slice(0,80),status:String(input.status||'').slice(0,80)};}
function configured(config,key){return config&&Object.prototype.hasOwnProperty.call(config,key)?config[key]:null;}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase();
  return (rows||[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId;}).map(function(row){
    var type=row.permit_type_v2||row.permit_type||'',typeConfig=configured(options.types,type),statusConfig=configured(options.statuses,row.status);
    var typeLabel=typeConfig&&typeConfig.label||type||'Not recorded',statusLabel=statusConfig&&statusConfig[2]||row.status||'Not recorded';
    if(f.scope==='active'&&['active','pending_approval','approved','suspended'].indexOf(row.status)===-1)return null;
    if(f.type&&row.permit_type!==f.type&&row.permit_type_v2!==f.type||f.status&&row.status!==f.status)return null;
    var reference=row.permit_number||row.permit_ref||'DRAFT';
    if(search&&![reference,row.work_description,row.location,row.work_location,row.permit_type,row.permit_type_v2,typeLabel,row.permit_issuer_name,row.issued_by,row.permit_receiver_name,row.permit_receiver].some(function(value){return String(value||'').toLowerCase().includes(search);}))return null;
    var risk=row.risk_level||row.priority||'',end=row.planned_end&&new Date(row.planned_end),overdue=['active','approved'].indexOf(row.status)!==-1&&end&&end<now;
    return {id:String(row.id),company_id:String(row.company_id),source_table:'permits',reference:reference,title:row.work_description||'Permit work',
      permit_type:typeLabel,location:row.work_location||row.location||'',issuer:row.permit_issuer_name||row.issued_by||'Unassigned',receiver:row.permit_receiver_name||row.permit_receiver||'Unassigned',
      planned_start:row.planned_start||'',planned_end:row.planned_end||'',risk:({low:'Low',medium:'Medium',high:'High',critical:'Critical'}[risk]||risk||'Not recorded'),
      status:statusLabel,attention:overdue?'Overdue':'—',created_at:row.created_at||''};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board'],defaultView:'list',defaultSort:'planned_end',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'planned_end',fields:[
  {key:'reference',label:'Permit number',required:true,groupable:false,action:'open'},{key:'title',label:'Work description',required:true,groupable:false,action:'open'},
  {key:'permit_type',label:'Permit type'},{key:'location',label:'Work location'},{key:'issuer',label:'Issuer'},{key:'receiver',label:'Receiver'},
  {key:'planned_start',label:'Start (local time)',type:'datetime',groupable:false},{key:'planned_end',label:'End (local time)',type:'datetime',groupable:false},
  {key:'risk',label:'Risk',type:'badge',tones:{Critical:'danger',High:'warning',Medium:'info',Low:'success'}},
  {key:'status',label:'Status',type:'badge',tones:{Draft:'neutral','Pending Approval':'warning',Approved:'success',Active:'info',Suspended:'warning',Completed:'success',Cancelled:'neutral',Rejected:'danger'}},
  {key:'attention',label:'Attention',groupable:false},{key:'created_at',label:'Created (local time)',type:'datetime',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session(),projected=project(rows,current,options);
  if(!root.AurisViewEngine)throw new Error('The shared permit register is unavailable. Reload the application.');
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'permit-to-work',label:'Permit to Work',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),
    actions:[{key:'open',label:'Open permit'}],
    onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},
    onAction:async function(key,row){
      assertSession(current);
      var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});
      if(key!=='open'||!selected||typeof options.openRecord!=='function')throw new Error('This permit is outside the current register. Reload to retry.');
      if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the permit controls.');
      await options.openRecord(selected.id,current);
    }
  });
}
root.AurisPermitListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters});
})(typeof window!=='undefined'?window:globalThis);
