(function(root){
'use strict';

var types={fire_certificate:'Fire Certificate',fire_precaution:'Fire Precaution Certificate',occupation_permit:'Occupation Permit (Fire)',temporary:'Temporary Fire Certificate',other:'Other'};
var statuses={valid:'Valid',expiring_soon:'Expiring soon',expired:'Expired',suspended:'Suspended',pending_renewal:'Pending renewal',archived:'Archived'};
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view fire certificates.');
  services.rbac.requireAccess('fire');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view fire certificates.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||''),name:String(profile.full_name||profile.name||profile.email||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account, company or access changed. Reload the fire certificate register.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),type:String(input.type||'').slice(0,80),status:String(input.status||'').slice(0,80),attention:String(input.attention||'').slice(0,80)};}
function dateState(value,now){
  now=now||new Date();if(!value)return {date:'',missing:true,expired:false,soon:false,days:null,label:'Not scheduled'};
  var date=new Date(value);if(Number.isNaN(date.getTime()))return {date:'',missing:true,expired:false,soon:false,days:null,label:'Not scheduled'};
  var today=new Date(now);today.setHours(0,0,0,0);var due=new Date(date);due.setHours(0,0,0,0);var days=Math.ceil((due-today)/86400000);
  return {date:date.toISOString().slice(0,10),missing:false,expired:days<0,soon:days>=0&&days<=30,days:days,label:date.toISOString().slice(0,10)};
}
function typeLabel(value){return types[String(value||'').toLowerCase()]||String(value||'Not recorded').replace(/_/g,' ');}
function statusLabel(value){return statuses[String(value||'').toLowerCase()]||String(value||'Not recorded').replace(/_/g,' ');}
function relatedCount(rows,id,companyId){return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&String(row.certificate_id||'')===String(id)&&(!companyId||String(row.company_id||'')===String(companyId));}).length;}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase(),inspections=options.inspections||[],equipment=options.equipment||[];
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId;}).map(function(row){
    var code=String(row.cert_type||'fire_certificate').toLowerCase(),status=String(row.status||'valid').toLowerCase(),expiry=dateState(row.expiry_date,now),inspectionCount=relatedCount(inspections,row.id,current.companyId),equipmentCount=relatedCount(equipment,row.id,current.companyId),statusText=statusLabel(status),attention=expiry.expired||status==='expired'?'Expired':status==='suspended'?'Suspended':status==='pending_renewal'||row.renewal_submitted?'Renewal pending':expiry.soon?'Expiring soon':expiry.missing?'Missing expiry':'—';
    var hay=[row.cert_number,row.premises_name,row.address,row.occupancy_type,row.issuing_authority,row.conditions,row.notes,code,typeLabel(code),status,statusText,attention].join(' ').toLowerCase();
    if(f.type&&code!==f.type.toLowerCase())return null;if(f.status&&status!==f.status.toLowerCase())return null;
    if(f.attention&&!(f.attention==='expired'&&(expiry.expired||status==='expired')||f.attention==='expiring_soon'&&expiry.soon||f.attention==='renewal_pending'&&(status==='pending_renewal'||row.renewal_submitted)||f.attention==='missing_expiry'&&expiry.missing||f.attention==='suspended'&&status==='suspended'))return null;
    if(search&&!hay.includes(search))return null;
    return {id:String(row.id),company_id:String(row.company_id),source_table:'fire_certificates',reference:row.cert_number||('FIRE-'+String(row.id).slice(0,8).toUpperCase()),title:row.premises_name||'Unnamed premises',type:typeLabel(code),address:row.address||'',occupancy:row.occupancy_type||'Not recorded',authority:row.issuing_authority||'Not recorded',issue_date:dateState(row.issue_date,now).date,expiry_date:expiry.date,expiry:expiry.expired?'Expired':expiry.soon?'Due soon':expiry.missing?'Not scheduled':'Current',days_left:expiry.days,renewal:row.renewal_submitted?'Submitted':'Not submitted',renewal_date:row.renewal_date||'',inspections:inspectionCount,equipment:equipmentCount,status:statusText,attention:attention,updated_at:row.updated_at||row.created_at||''};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board','calendar','activity'],defaultView:'list',defaultSort:'expiry_date',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'expiry_date',activityField:'updated_at',fields:[
  {key:'reference',label:'Certificate reference',required:true,groupable:false,action:'open'},{key:'title',label:'Premises / site',required:true,groupable:false,action:'open'},
  {key:'type',label:'Certificate type'},{key:'address',label:'Address',hidden:true},{key:'occupancy',label:'Occupancy'},{key:'authority',label:'Issuing authority',hidden:true},
  {key:'issue_date',label:'Issue date',type:'date',groupable:false},{key:'expiry_date',label:'Expiry date',type:'date',groupable:false,action:'edit'},{key:'expiry',label:'Expiry state',type:'badge',groupable:false,tones:{Expired:'danger','Due soon':'warning',Current:'success','Not scheduled':'warning'}},{key:'days_left',label:'Days left',type:'number',groupable:false},
  {key:'renewal',label:'Renewal'},{key:'renewal_date',label:'Renewal date',type:'date',groupable:false,hidden:true},{key:'inspections',label:'Inspections',type:'number',groupable:false},{key:'equipment',label:'Fire equipment',type:'number',groupable:false},
  {key:'status',label:'Status',type:'badge',tones:{Valid:'success','Expiring soon':'warning',Expired:'danger',Suspended:'danger','Pending renewal':'warning',Archived:'neutral','Not recorded':'neutral'}},{key:'attention',label:'Attention',type:'badge',groupable:false,tones:{Expired:'danger','Expiring soon':'warning','Renewal pending':'warning','Missing expiry':'warning',Suspended:'danger','—':'success'}},{key:'updated_at',label:'Updated',type:'datetime',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session();if(!root.AurisViewEngine)throw new Error('The shared fire certificate register is unavailable. Reload the application.');var projected=project(rows,current,options);
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'fire-certificates',label:'Fire Certificate Register',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'Open certificate'},{key:'edit',label:'Edit certificate',when:function(){return options.canEdit===true;}}],onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},onAction:async function(key,row){
    assertSession(current);var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});if(!selected)throw new Error('This certificate is outside the current register. Reload to retry.');if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the fire certificate.');var callback=key==='open'?options.openRecord:key==='edit'&&options.canEdit===true?options.editRecord:null;if(typeof callback!=='function')throw new Error('This fire certificate action is unavailable. Reload the register.');await callback(selected.id,current);
  }});
}
root.AurisFireListWorkspace=Object.freeze({version:'1.0.0',mount:mount,project:project,definition:definition,filters:filters,dateState:dateState});
})(typeof window!=='undefined'?window:globalThis);
