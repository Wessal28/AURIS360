(function(root){
'use strict';

var statuses={active:'Active',out_of_service:'Out of service',maintenance:'Maintenance',under_maintenance:'Maintenance',archived:'Archived'};
function session(){
  var services=root.AurisPlatformServices;
  if(!services||!services.ready(['auth','rbac'])||!services.auth.isAuthenticated())throw new Error('Sign in and select a company to view the fleet.');
  services.rbac.requireAccess('fleet');
  var identity=services.auth.current(),profile=identity.profile||{},company=identity.company&&identity.company.id||profile.company_id;
  if(!company||!profile.id)throw new Error('Sign in and select a company to view the fleet.');
  return {companyId:String(company),userId:String(profile.id),role:String(identity.role||''),name:String(profile.full_name||profile.name||profile.email||'')};
}
function assertSession(expected){var current=session();if(current.companyId!==expected.companyId||current.userId!==expected.userId||current.role!==expected.role)throw new Error('Your account, company or access changed. Reload the fleet register.');return current;}
function filters(input){input=input||{};return {search:String(input.search||'').slice(0,300),status:String(input.status||'').slice(0,80),check:String(input.check||'').slice(0,80)};}
function label(value){return statuses[String(value||'').toLowerCase()]||String(value||'Not recorded').replace(/_/g,' ');}
function vehicleLabel(row){return row&&((row.registration_number||row.ref_number||row.name)||'Vehicle');}
function key(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function fuelMatches(row,vehicle){var hay=key(row&& (row.vehicle_equipment||row.vehicle_registration||row.registration||''));if(!hay)return false;return [vehicle.registration_number,vehicle.ref_number,vehicle.name].some(function(value){var item=key(value);return item&&(hay.indexOf(item)!==-1||item.indexOf(hay)!==-1);});}
function incidentMatches(row,vehicle){var type=String(row&& (row.event_type||row.type)||'').toLowerCase();if(type&&type.indexOf('vehicle')===-1&&type.indexOf('traffic')===-1&&type.indexOf('transport')===-1)return false;var registration=key(row&&(row.vehicle_reg||row.vehicle_registration||row.registration)||''),vehicleKey=key(vehicleLabel(vehicle)),text=key([row&&row.description,row&&row.location,row&&row.title,row&&row.event_ref].join(' '));if(registration&&vehicleKey&&(registration===vehicleKey||vehicleKey.indexOf(registration)!==-1||registration.indexOf(vehicleKey)!==-1))return true;return !!(vehicleKey&&text&&text.indexOf(vehicleKey)!==-1);}
function latestInspection(rows,vehicle){var candidates=(Array.isArray(rows)?rows:[]).filter(function(row){return row&&(String(row.tool_id||row.equipment_id||row.vehicle_id||'')===String(vehicle.id));});candidates.sort(function(a,b){return String(b.inspection_date||b.date||'').localeCompare(String(a.inspection_date||a.date||''));});return candidates[0]||null;}
function checkState(inspection,now){now=now||new Date();var date=inspection&&(inspection.inspection_date||inspection.date),parsed=date?new Date(date):null;if(!parsed||Number.isNaN(parsed.getTime()))return {date:'',days:null,state:'Never checked',due:true,soon:false};var today=new Date(now);today.setHours(0,0,0,0);var days=Math.floor((today-parsed)/(86400000));return {date:parsed.toISOString().slice(0,10),days:days,state:days>35?'Overdue':days>21?'Due soon':'Current',due:days>35,soon:days>21&&days<=35};}
function project(rows,current,options,now){
  options=options||{};now=now||new Date();var f=filters(options.filters),search=f.search.toLowerCase(),inspections=options.inspections||[],fuel=options.fuel||[],incidents=options.incidents||[];
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&row.id&&current.companyId&&String(row.company_id||'')===current.companyId;}).map(function(row){
    var status=String(row.status||'active').toLowerCase(),inspection=checkState(latestInspection(inspections,row),now),fuelRows=fuel.filter(function(item){return fuelMatches(item,row);}),incidentRows=incidents.filter(function(item){return incidentMatches(item,row);}),fuelTotal=fuelRows.reduce(function(total,item){return total+(parseFloat(item.quantity)||0);},0),text=[vehicleLabel(row),row.name,row.brand,row.model,row.registration_number,row.ref_number,row.location,row.assigned_to_name,row.vehicle_type,status,label(status)].join(' ').toLowerCase();
    if(f.status&&status!==f.status.toLowerCase())return null;if(f.check&&!(f.check==='overdue'&&inspection.due||f.check==='due_soon'&&inspection.soon||f.check==='with_incidents'&&incidentRows.length))return null;if(search&&!text.includes(search))return null;
    return {id:String(row.id),company_id:String(row.company_id),source_table:'tools_register',reference:row.registration_number||row.ref_number||('VEH-'+String(row.id).slice(0,8).toUpperCase()),title:vehicleLabel(row),vehicle:row.name||'',make_model:[row.brand,row.model].filter(Boolean).join(' ')||'Not recorded',vehicle_type:row.vehicle_type||row.category||'Vehicle',assigned_to:row.assigned_to_name||'General use',location:row.location||'Not recorded',last_check:inspection.date,check:inspection.state,fuel_total:fuelTotal,fuel_entries:fuelRows.length,incidents:incidentRows.length,status:label(status),updated_at:row.updated_at||row.created_at||''};
  }).filter(Boolean);
}
function definition(){return {rowKey:'id',views:['list','card','board','calendar','activity'],defaultView:'list',defaultSort:'last_check',titleField:'title',subtitleField:'reference',groupField:'status',dateField:'last_check',activityField:'updated_at',fields:[
  {key:'reference',label:'Registration / reference',required:true,groupable:false,action:'open'},{key:'title',label:'Vehicle',required:true,groupable:false,action:'open'},
  {key:'vehicle',label:'Name'},{key:'make_model',label:'Make / model'},{key:'vehicle_type',label:'Type'},{key:'assigned_to',label:'Assigned to'},{key:'location',label:'Location'},
  {key:'last_check',label:'Last monthly check',type:'date',groupable:false,action:'check'},{key:'check',label:'Check status',type:'badge',groupable:false,tones:{Overdue:'danger','Due soon':'warning',Current:'success','Never checked':'warning'}},
  {key:'fuel_total',label:'Fuel logged (L)',type:'number',groupable:false},{key:'fuel_entries',label:'Fuel entries',groupable:false,hidden:true},{key:'incidents',label:'Vehicle incidents',type:'number',groupable:false},
  {key:'status',label:'Status',type:'badge',tones:{Active:'success','Out of service':'danger',Maintenance:'warning',Archived:'neutral','Not recorded':'neutral'}},{key:'updated_at',label:'Updated',type:'datetime',groupable:false,hidden:true}
]};}
function mount(host,rows,options){
  options=options||{};var current=session();if(!root.AurisViewEngine)throw new Error('The shared fleet register is unavailable. Reload the application.');var projected=project(rows,current,options);
  return root.AurisViewEngine.mount(host,projected,{moduleKey:'fleet-management',label:'Fleet Management',definition:definition(),context:function(){return assertSession(current);},filters:filters(options.filters),actions:[{key:'open',label:'View vehicle',href:typeof options.recordHref==='function'?function(row){return options.recordHref(row.id,'view');}:undefined},{key:'check',label:'Monthly check',when:function(){return options.canEdit===true;}},{key:'edit',label:'Edit vehicle',href:typeof options.recordHref==='function'?function(row){return options.recordHref(row.id,'edit');}:undefined,when:function(){return options.canEdit===true;}}],onApplyFilters:function(value){assertSession(current);if(typeof options.onApplyFilters==='function')options.onApplyFilters(filters(value));},onAction:async function(action,row){
    assertSession(current);var selected=projected.find(function(item){return item.id===row.id&&item.company_id===row.company_id&&item.source_table===row.source_table;});if(!selected)throw new Error('This vehicle is outside the current fleet. Reload to retry.');if(root.navigator&&root.navigator.onLine===false)throw new Error('Reconnect before opening the vehicle record.');var callback=action==='open'?options.openRecord:action==='check'&&options.canEdit===true?options.checkRecord:action==='edit'&&options.canEdit===true?options.editRecord:null;if(typeof callback!=='function')throw new Error('This fleet action is unavailable. Reload the register.');await callback(selected.id,current);
  }});
}
root.AurisFleetListWorkspace=Object.freeze({version:'1.0.0',session:session,assertSession:assertSession,mount:mount,project:project,definition:definition,filters:filters,checkState:checkState});
})(typeof window!=='undefined'?window:globalThis);
