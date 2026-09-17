(function(root){
'use strict';

var categories={hand_tool:'Hand tool',power_tool:'Power tool',equipment:'Equipment',lifting:'Lifting equipment',electrical:'Electrical',ppe:'PPE',other:'Other'};
var statuses={active:'Active',out_of_service:'Out of service',under_maintenance:'Under maintenance',disposed:'Disposed'};
var intervals={daily:1,weekly:7,monthly:31,quarterly:92,six_monthly:183,annual:366,yearly:366};
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view equipment.');
  services.rbac.requireAccess('tools');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view equipment.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||''),name:String(profile.full_name||profile.name||profile.email||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account, company or access changed. Reload the equipment register.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),category:String(input.category||'').slice(0,80),status:String(input.status||'').slice(0,80),inspection:String(input.inspection||'').slice(0,80)};}
function inspectionFor(row,inspections,now){
  inspections=inspections||{};var item=inspections[String(row.id)]||inspections[row.id]||null,date=item&&(item.inspection_date||item.date),last=date?new Date(date):null;
  if(!last||Number.isNaN(last.getTime()))return {last:null,due:true,soon:false,label:'Never inspected'};
  var days=Math.floor((now-last)/86400000),interval=intervals[String(row.inspection_frequency||'monthly').toLowerCase()]||30;
  return {last:last,due:days>interval,soon:days>Math.max(1,interval-7)&&days<=interval,label:days+' days ago'};
}
function statutoryDue(row,now){if(!row.requires_statutory||!row.next_statutory_date)return false;var date=new Date(row.next_statutory_date),limit=new Date(now);limit.setDate(limit.getDate()+30);return !Number.isNaN(date.getTime())&&date<=limit;}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase(),inspections=options.inspections||{};
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId;}).map(function(row){
    var category=String(row.category||'other').toLowerCase(),status=String(row.status||'active').toLowerCase(),inspection=inspectionFor(row,inspections,now),statDue=statutoryDue(row,now),categoryLabel=categories[category]||String(row.category||'Other').replace(/_/g,' '),statusLabel=statuses[status]||String(row.status||'Not recorded').replace(/_/g,' '),serial=[row.serial_number,row.model].filter(Boolean).join(' / ')||'Not recorded',assigned=row.assigned_to_name||'General use';
    if(f.category&&category!==f.category.toLowerCase())return null;if(f.status&&status!==f.status.toLowerCase())return null;
    if(f.inspection&&!(f.inspection==='overdue'&&inspection.due||f.inspection==='due_soon'&&inspection.soon||f.inspection==='never'&&!inspection.last||f.inspection==='statutory_due'&&statDue))return null;
    var hay=[row.ref_number,row.name,row.brand,row.model,row.serial_number,row.location,assigned,categoryLabel,statusLabel,inspection.label,row.notes].join(' ').toLowerCase();if(search&&!hay.includes(search))return null;
    return {id:String(row.id),company_id:String(row.company_id),source_table:'tools_register',reference:row.ref_number||'EQ-DRAFT',title:row.name||'Unnamed equipment',category:categoryLabel,serial_model:serial,location:row.location||'Not recorded',assigned_to:assigned,last_inspection:inspection.last?inspection.last.toISOString().slice(0,10):'',inspection:inspection.last?(inspection.due?'Overdue':inspection.soon?'Due soon':'Current'):'Never inspected',statutory:row.requires_statutory?(row.next_statutory_date?(statDue?'Due by '+row.next_statutory_date:row.next_statutory_date):'Required'):'—',status:statusLabel,updated_at:row.updated_at||row.created_at||''};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board'],defaultView:'list',defaultSort:'last_inspection',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'last_inspection',activityField:'updated_at',fields:[
  {key:'reference',label:'Reference',required:true,groupable:false,action:'open'},{key:'title',label:'Equipment',required:true,groupable:false,action:'open'},
  {key:'category',label:'Category'},{key:'serial_model',label:'Serial / model'},{key:'location',label:'Location'},{key:'assigned_to',label:'Assigned to'},
  {key:'last_inspection',label:'Last inspection',type:'date',groupable:false,action:'inspect'},{key:'inspection',label:'Inspection',type:'badge',tones:{Overdue:'danger','Due soon':'warning',Current:'success','Never inspected':'warning'}},
  {key:'statutory',label:'Statutory',groupable:false},{key:'status',label:'Status',type:'badge',tones:{Active:'success','Out of service':'danger','Under maintenance':'warning',Disposed:'neutral','Not recorded':'neutral'}},{key:'updated_at',label:'Updated',type:'datetime',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session();if(!root.AurisViewEngine)throw new Error('The shared equipment register is unavailable. Reload the application.');var projected=project(rows,current,options);
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'tools-equipment',label:'Tools & Equipment',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'Open equipment'},{key:'inspect',label:'Start inspection'},{key:'edit',label:'Edit equipment',when:function(){return options.canEdit===true;}}],onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},onAction:async function(key,row){
    assertSession(current);var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});if(!selected)throw new Error('This equipment is outside the current register. Reload to retry.');if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the equipment record.');
    var callback=key==='open'?options.openRecord:key==='inspect'?options.inspectRecord:key==='edit'&&options.canEdit===true?options.editRecord:null;if(typeof callback!=='function')throw new Error('This equipment action is unavailable. Reload the register.');await callback(selected.id,current);
  }});
}
root.AurisToolsListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters,inspectionFor:inspectionFor});
})(typeof window!=='undefined'?window:globalThis);
