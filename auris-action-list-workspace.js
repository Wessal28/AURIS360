(function(root){
'use strict';

function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view actions.');
  services.rbac.requireAccess('actions');
  var current=services.auth.current(),profile=current.profile||{},company=current.company&&current.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view actions.');
  return {companyId:String(company),userId:String(profile.id),role:String(current.role||''),name:String(profile.full_name||'')};
}
function assertSession(expected){
  var current=session();
  if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account or company changed. Reload the action register.');
  return current;
}
function filters(input){
  input=input||{};var result={};
  ['search','source','priority','status','type'].forEach(function(key){result[key]=String(input[key]||'').slice(0,key==='search'?300:80);});
  result.scope=['all','mine','overdue','verify','closure'].indexOf(input.scope)!==-1?input.scope:'all';
  return result;
}
function label(config,key,fallback){return config&&config[key]&&config[key].label||key||fallback;}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase(),name=String(current.name||'').toLowerCase().trim();
  return (rows||[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId;}).map(function(row){
    var reference=typeof options.reference==='function'?options.reference(row):row.action_ref||String(row.id);
    var overdue=!!(row.target_date&&new Date(row.target_date)<now&&['closed','cancelled'].indexOf(row.status)===-1);
    return {raw:row,overdue:overdue,reference:reference};
  }).filter(function(item){
    var row=item.raw;
    if(f.scope==='mine'&&!(String(row.assigned_to_id||'')===current.userId||name&&String(row.assigned_to_name||row.responsible||'').toLowerCase().includes(name)))return false;
    if(f.scope==='overdue'&&!item.overdue)return false;
    if(f.scope==='verify'&&row.status!=='pending_verification')return false;
    if(f.scope==='closure'&&row.status!=='pending_closure')return false;
    return (!search||[item.reference,row.action_ref,row.title,row.description,row.assigned_to_name||row.responsible,row.source_ref].some(function(value){return String(value||'').toLowerCase().includes(search);}))
      &&(!f.source||(row.source_type||row.source_module||'')===f.source)&&(!f.priority||row.priority===f.priority)
      &&(!f.status||row.status===f.status)&&(!f.type||(row.action_type||'corrective')===f.type);
  }).map(function(item){
    var row=item.raw,attention=[];
    if(item.overdue)attention.push(Math.floor((now-new Date(row.target_date))/86400000)+'d overdue');
    if(row.escalated)attention.push('Escalated');
    return {id:String(row.id),company_id:String(row.company_id),reference:item.reference,title:row.title||row.description||'Untitled action',
      source:label(options.sources,row.source_type||row.source_module||'manual','Manual'),source_ref:row.source_ref||'',
      responsible:row.assigned_to_name||row.responsible||'Unassigned',due_date:row.target_date||'',
      priority:label(options.priorities,row.priority||'medium','Medium'),status:label(options.statuses,row.status||'open','Open'),
      progress:Math.max(0,Math.min(100,parseInt(row.progress_pct,10)||0)),action_type:label(options.types,row.action_type||'corrective','Corrective'),
      department:row.department||'',attention:attention.join(' · ')||'—'};
  });
}
function definition(){
  return {rowKey:'id',views:['list','card','board'],defaultView:'list',defaultSort:'due_date',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'due_date',fields:[
    {key:'reference',label:'Reference',required:true,groupable:false,action:'open'},
    {key:'title',label:'Action',required:true,groupable:false,action:'open'},
    {key:'source',label:'Source'},{key:'source_ref',label:'Source reference',groupable:false,action:'source'},
    {key:'responsible',label:'Responsible'},{key:'due_date',label:'Due date',type:'date',groupable:false},
    {key:'priority',label:'Priority',type:'badge',tones:{Critical:'danger',High:'warning',Medium:'info',Low:'success'}},
    {key:'status',label:'Status',type:'badge',tones:{Open:'warning','In Progress':'info','Pending Verification':'info','Pending Closure':'warning',Closed:'success',Cancelled:'neutral'}},
    {key:'progress',label:'Progress',type:'percent',groupable:false},{key:'attention',label:'Attention',groupable:false},
    {key:'action_type',label:'Action type',hidden:true},{key:'department',label:'Department',hidden:true}
  ]};
}
function mount(host,rows,options){
  options=options||{};var current=session();
  if(!root.AurisViewEngine)throw new Error('The shared list is unavailable. Reload the application.');
  var projected=project(rows,current,options),currentFilters=filters(options.filters);
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'master-action-plan',label:'Master Action Plan',context:function(){return assertSession(current);},
    definition:definition(),filters:currentFilters,
    actions:[{key:'open',label:'Open action'},{key:'source',label:'Open source',when:function(row){return !!row.source_ref;}}],
    onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},
    onAction:async function(key,row){
      assertSession(current);
      if(row.company_id!==current.companyId||!projected.some(function(item){return item.id===row.id;}))throw new Error('This action is outside the current register.');
      var callback=key==='open'?options.openRecord:key==='source'&&row.source_ref?options.openSource:null;
      if(typeof callback!=='function')throw new Error('This action is unavailable. Reload the register.');
      await callback(row.id,current);
    }
  });
}
root.AurisActionListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters});
})(typeof window!=='undefined'?window:globalThis);
