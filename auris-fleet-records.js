/* Separate vehicle records; authenticated reads retain company and role context. */
var fleetOpeningLinkedRecord=false;
function fleetRecordHref(id,mode){
  var url=new URL(deepLinkRecordUrl({module:'fleet',id:id,table:'tools_register',company_id:ccid()}));
  url.searchParams.set('fleetMode',['edit','service'].includes(mode)?mode:'view');return url.toString();
}
function fleetRecordWindow(id,mode){
  AurisFleetListWorkspace.session();
  if(mode!=='view'&&!isMgr())throw Error('Manager access is required to change fleet records.');
  var child=window.open(fleetRecordHref(id,mode),'_blank');
  if(child)child.opener=null;else toast('Allow popups to open the vehicle in a separate window.',false);
}
function fleetAssertEditor(current){AurisFleetListWorkspace.assertSession(current);if(!isMgr())throw Error('Manager access is required to save fleet records.');}
async function fleetReadRecordHistory(row,current){
  var specs=[['tool_inspections','tool_id','inspection_date'],['fuel_consumption',null,'record_date'],['equipment_maintenance_events','equipment_id','created_at']];
  return Promise.all(specs.map(async function(spec){
    try{
      var rows=await api('/'+spec[0]+'?select=*&company_id=eq.'+encodeURIComponent(current.companyId)+(spec[1]?'&'+spec[1]+'=eq.'+encodeURIComponent(row.id):'')+'&order='+spec[2]+'.desc&limit=501');
      AurisFleetListWorkspace.assertSession(current);
      var scoped=(rows||[]).filter(function(item){return String(item.company_id)===current.companyId;});
      return {rows:scoped.slice(0,500).filter(function(item){return spec[1]?String(item[spec[1]])===String(row.id):fleetFuelMatchesVehicle(item,row);}),limited:scoped.length>500};
    }catch(error){AurisFleetListWorkspace.assertSession(current);return {rows:[],error:true};}
  }));
}
async function fleetOpenLinkedRecord(req){
  var current=AurisFleetListWorkspace.session();
  if(req.table&&req.table!=='tools_register')throw Error('Unsupported fleet record.');
  if(req.company&&String(req.company)!==current.companyId)throw Error('Select the company that owns this vehicle.');
  var rows=await api('/tools_register?select=*&is_vehicle=eq.true&id=eq.'+encodeURIComponent(req.record)+'&company_id=eq.'+encodeURIComponent(current.companyId));
  AurisFleetListWorkspace.assertSession(current);
  var row=(rows||[]).find(function(item){return item.is_vehicle===true&&String(item.id)===String(req.record)&&String(item.company_id)===current.companyId;});
  if(!row)return false;
  fleetVehicles=(fleetVehicles||[]).filter(function(item){return String(item.company_id)===current.companyId&&String(item.id)!==String(row.id);});fleetVehicles.push(row);
  var mode=req.mode||new URLSearchParams(location.search).get('fleetMode')||'view';
  if(mode==='edit'||mode==='service'){
    fleetAssertEditor(current);fleetOpeningLinkedRecord=true;
    try{if(mode==='edit')fleetOpenVehicleForm(row.id);else fleetOpenServiceForm(row.id);}finally{fleetOpeningLinkedRecord=false;}
    return true;
  }
  var history=await fleetReadRecordHistory(row,current);AurisFleetListWorkspace.assertSession(current);
  fleetInspections=history[0].rows;fleetFuel=history[1].rows;fleetServices=history[2].rows;
  fleetOpeningLinkedRecord=true;try{fleetOpenVehicleDetail(row.id);}finally{fleetOpeningLinkedRecord=false;}
  var modal=document.getElementById('fleet-detail-modal');
  if(!modal)return false;
  modal.classList.add('fleet-readonly-window');
  ['inspections','fuel','services'].forEach(function(key,index){
    var result=history[index],panel=modal.querySelector('[data-panel="'+key+'"]');
    if(result.error){panel.textContent='This history could not be loaded. Reload the vehicle record to retry.';panel.setAttribute('role','alert');}
    else if(result.limited){var warning=document.createElement('p');warning.textContent=key==='fuel'?'Matched against the latest 500 company fuel entries. Older entries may not appear here.':'Showing the latest 500 records. Use the register for older history.';panel.prepend(warning);}
  });
  modal.addEventListener('click',function(event){try{AurisFleetListWorkspace.assertSession(current);}catch(error){event.preventDefault();event.stopImmediatePropagation();modal.remove();toast(error.message,false);}},true);
  modal.querySelector('.r5-close')?.focus();return true;
}
function fleetPrintVehicleRecord(vehicle){
  var source=document.querySelector('#fleet-detail-modal .r5-record-dialog');if(!source)return;
  var host=document.createElement('div');host.id='fleet-print-record';host.hidden=true;
  var copy=source.cloneNode(true);copy.querySelectorAll('[hidden]').forEach(function(node){node.hidden=false;});
  copy.querySelectorAll('nav,footer,button,a.btn').forEach(function(node){node.remove();});
  copy.querySelectorAll('[data-panel]').forEach(function(panel){var h=document.createElement('h3');h.textContent={details:'Vehicle details',inspections:'Inspection history',fuel:'Fuel consumption',services:'Servicing history'}[panel.dataset.panel];panel.prepend(h);});
  host.appendChild(copy);document.body.appendChild(host);
  try{printRegisterView('Fleet vehicle record - '+fleetLabel(vehicle),'#fleet-print-record .r5-record-dialog');}finally{host.remove();}
}
