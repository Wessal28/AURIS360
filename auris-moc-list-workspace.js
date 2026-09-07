(function(root){
'use strict';
var statuses={draft:'Draft',screening:'Screening',impact_assessment:'Impact assessment',pending_approval:'Pending approval',approved:'Approved',implementation:'Implementation',verification:'Post-change verification',closed:'Closed',rejected:'Rejected',cancelled:'Cancelled'};
var types={process:'Process change',equipment:'Equipment / machinery',chemical:'Chemical / substance',layout:'Layout / premises',people:'Organisation / people',supplier:'Supplier / contractor',legal:'Legal / permit condition',temporary:'Temporary change',emergency:'Emergency change',other:'Other change'};
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view change requests.');
  services.rbac.requireAccess('moc');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view change requests.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||'')};
}
function assertSession(expected){
  var current=session();
  if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account or company changed. Reload the change register.');
  return current;
}
function canonical(status){return ({open:'screening',in_progress:'implementation',pending_verification:'verification'}[status]||status||'draft');}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),status:Object.prototype.hasOwnProperty.call(statuses,input.status)?input.status:''};}
function legacyRecord(row){
  return !!row&&row.source_module==='moc'&&(!row.source_table||row.source_table==='action_tracker')&&(!row.source_id||String(row.source_id)===String(row.id));
}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase();
  return (rows||[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId&&(!options.legacy||legacyRecord(row));}).map(function(row){
    var status=canonical(row.lifecycle_status||row.status),reference=typeof options.reference==='function'?options.reference(row):row.moc_ref||row.source_ref||row.action_ref||'MOC-DRAFT';
    var hay=[reference,row.title,row.description,row.reason,row.owner_name,row.assigned_to_name,row.responsible,row.location,row.department,row.priority,status,statuses[status]].join(' ').toLowerCase();
    if(search&&!hay.includes(search)||f.status&&status!==f.status)return null;
    var legacyType=String(row.description||'').match(/^Change type:\s*(.*)$/mi);
    var overdue=!!(row.target_date&&new Date(row.target_date)<now&&['closed','cancelled','rejected'].indexOf(status)===-1);
    return {id:String(row.id),company_id:String(row.company_id),source_table:options.legacy?'action_tracker':'moc_change_requests',reference:reference,title:row.title||'Change request',
      change_type:types[row.change_type]||legacyType&&legacyType[1].trim()||'Change',owner:row.owner_name||row.assigned_to_name||row.responsible||'Unassigned',
      target_date:row.target_date||'',priority:({critical:'Critical',high:'High',medium:'Medium',low:'Low'}[row.priority]||row.priority||'Medium'),
      status:statuses[status]||status,location:row.location||'',department:row.department||'',attention:overdue?'Overdue':'—',
      impacted_areas:Array.isArray(row.impacted_areas)?row.impacted_areas.join(', '):'',storage:options.legacy?'Legacy change request':'Dedicated change request'};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board'],defaultView:'list',defaultSort:'target_date',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'target_date',fields:[
  {key:'reference',label:'Reference',required:true,groupable:false,action:'open'},{key:'title',label:'Change request',required:true,groupable:false,action:'open'},
  {key:'change_type',label:'Change type'},{key:'owner',label:'Owner'},{key:'target_date',label:'Target date',type:'date',groupable:false},
  {key:'priority',label:'Risk priority',type:'badge',tones:{Critical:'danger',High:'warning',Medium:'info',Low:'success'}},
  {key:'status',label:'Lifecycle stage',type:'badge',tones:{Draft:'neutral',Screening:'info','Impact assessment':'warning','Pending approval':'warning',Approved:'success',Implementation:'info','Post-change verification':'info',Closed:'success',Rejected:'danger',Cancelled:'neutral'}},
  {key:'attention',label:'Attention',groupable:false},{key:'location',label:'Location',hidden:true},{key:'department',label:'Department',hidden:true},
  {key:'impacted_areas',label:'Impacted areas',hidden:true,groupable:false},{key:'storage',label:'Record storage',hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session(),projected=project(rows,current,options);
  if(!root.AurisViewEngine)throw new Error('The shared change register is unavailable. Reload the application.');
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'management-of-change',label:'Management of Change',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),
    actions:[{key:'open',label:'Open change request'}],
    onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},
    onAction:async function(key,row){
      assertSession(current);
      var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});
      if(key!=='open'||!selected||typeof options.openRecord!=='function')throw new Error('This change request is outside the current register. Reload to retry.');
      if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the change request form.');
      await options.openRecord(selected.id,selected.source_table,current);
    }
  });
}
root.AurisMocListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters,legacyRecord:legacyRecord});
})(typeof window!=='undefined'?window:globalThis);
