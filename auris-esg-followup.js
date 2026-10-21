// Verified reference factors: DESNZ 2026, revised flat file published 31 July 2026.
// Scope 1 fuel combustion only. These UK references require applicability confirmation.
const ESG_FACTOR_SOURCE=Object.freeze({name:'UK DESNZ 2026',version:'2026 flat file, July revision',url:'https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026',file:'https://assets.publishing.service.gov.uk/media/6a6c9748862aaf18d9c62ac9/ghg-conversion-factors-2026-flat-format-revised.xlsx',sha256:'a9a455ab396dae226d510c7be6233748416d490c41a5d20f3dc7a0c45feecd5e'});
const ESG_REFERENCE_FACTORS=Object.freeze({
  diesel:{value:2.66155,unit:'litres',row:'1_101_1012_8_1',label:'Diesel (100% mineral diesel)'},
  petrol:{value:2.35372,unit:'litres',row:'1_101_1018_8_1',label:'Petrol (100% mineral petrol)'},
  lpg:{value:1.55713,unit:'litres',row:'1_100_1003_8_1',label:'LPG'},
  natural_gas:{value:2.04987,unit:'m3',row:'1_100_1005_1_1',label:'Natural gas (100% mineral blend)'},
  heavy_fuel_oil:{value:3.17492,unit:'litres',row:'1_101_1013_8_1',label:'Fuel oil'}
});
var esgRecordedFactor=null,esgRecordedInputs=null,esgFuelAssets=[],esgEditingContext=null,esgEditingVersion=0,esgAssetRequest=0,esgOwnerRequest=0;
function esgCaptureContext(){esgEditingContext={company:String(ccid()),user:String(prof?.id||''),version:++esgEditingVersion};}
function esgAssertEditContext(){if(!esgEditingContext||esgEditingContext.company!==String(ccid())||esgEditingContext.user!==String(prof?.id||'')||!isMgr())throw new Error('Your company, account or editing access changed. Reopen this environmental record.');}
function esgFactorSnapshot(input){
  if(input.method==='recorded')return input.recorded?Object.assign({},input.recorded):null;
  if(!input.confirmed||input.method==='none')return null;
  if(input.method==='desnz2026'){
    var ref=ESG_REFERENCE_FACTORS[input.type];if(!ref||ref.unit!==input.unit)return null;
    return {factor_value:ref.value,factor_unit:'kg CO2e/'+ref.unit,factor_source:ESG_FACTOR_SOURCE.name+'; '+ref.label+'; '+ref.row,factor_version:ESG_FACTOR_SOURCE.version,factor_source_url:ESG_FACTOR_SOURCE.url,factor_scope:'Scope 1 combustion; excludes upstream emissions',factor_confirmed:true};
  }
  if(input.method==='custom'){
    var value=Number(input.value),url=esgSafeDocumentUrl(input.url);
    if(input.value===''||!Number.isFinite(value)||value<0||!input.source?.trim()||!input.version?.trim()||!url)return null;
    return {factor_value:value,factor_unit:'kg CO2e/'+input.unit,factor_source:input.source.trim(),factor_version:input.version.trim(),factor_source_url:url,factor_scope:'User-supplied factor; applicability confirmed by recorder',factor_confirmed:true};
  }
  return null;
}
function esgReadFactor(){var g=function(id){return document.getElementById(id)?.value||'';};if(g('ff-factor-method')==='recorded'&&(!esgRecordedInputs||g('ff-type')!==esgRecordedInputs.type||g('ff-unit')!==esgRecordedInputs.unit||(!esgRecordedFactor?.factor_confirmed&&Number(g('ff-qty'))!==esgRecordedInputs.quantity)))return null;return esgFactorSnapshot({method:g('ff-factor-method'),type:g('ff-type'),unit:g('ff-unit'),confirmed:!!document.getElementById('ff-factor-confirmed')?.checked,value:g('ff-factor-value'),source:g('ff-factor-source'),version:g('ff-factor-version'),url:g('ff-factor-url'),recorded:esgRecordedFactor});}
function esgFactorInputChanged(){var check=document.getElementById('ff-factor-confirmed');if(check)check.checked=false;esgCalcCO2();}
function esgFactorFieldsChanged(){var method=document.getElementById('ff-factor-method')?.value,custom=document.getElementById('ff-factor-custom');if(custom)custom.hidden=method!=='custom';esgFactorInputChanged();}
function esgInitFuelFactor(row){
  esgRecordedInputs=row?{type:row.fuel_type,unit:row.unit,quantity:Number(row.quantity)}:null;
  esgRecordedFactor=row?{factor_value:row.factor_value??null,factor_unit:row.factor_unit||null,factor_source:row.factor_source||null,factor_version:row.factor_version||null,factor_source_url:row.factor_source_url||null,factor_scope:row.factor_scope||null,factor_confirmed:row.factor_confirmed||false,carbon_kg:row.carbon_kg??null}:null;
  var method=document.getElementById('ff-factor-method');if(method){method.replaceChildren(new Option('Do not estimate','none'),new Option('DESNZ 2026 UK combustion reference','desnz2026'),new Option('Supplier / locally applicable factor','custom'));if(row)method.add(new Option('Retain saved factor / estimate','recorded'));method.value=row&&(row.carbon_kg!=null||row.factor_value!=null)?'recorded':'none';}
  ['ff-factor-value','ff-factor-source','ff-factor-version','ff-factor-url'].forEach(function(id){var e=document.getElementById(id);if(e)e.value='';});var check=document.getElementById('ff-factor-confirmed');if(check)check.checked=false;esgFactorFieldsChanged();
}
async function esgLoadFuelAssets(row){
  var request=++esgAssetRequest,el=document.getElementById('ff-equipment'),link=document.getElementById('ff-equipment-open'),company=String(ccid());if(!el)return;
  el.replaceChildren(new Option('No registered asset / enter details below',''));if(link)link.hidden=true;
  // Preserve identity even when a historical item is no longer in the selectable list.
  if(row?.equipment_id)el.add(new Option('Previously linked asset',row.equipment_id));el.value=row?.equipment_id||'';
  try{var rows=await apiAllRows('/tools_register?select=id,company_id,name,ref_number,registration_number,is_vehicle,status'+cf()+'&order=name.asc');if(String(ccid())!==company||request!==esgAssetRequest)return;esgFuelAssets=rows||[];el.replaceChildren(new Option('No registered asset / enter details below',''));esgFuelAssets.forEach(function(asset){if(String(asset.company_id)!==company)return;el.add(new Option((asset.registration_number||asset.ref_number||'')+' · '+asset.name+' ('+(asset.is_vehicle?'vehicle':'equipment')+')',asset.id));});if(row?.equipment_id&&!esgFuelAssets.some(function(a){return a.id===row.equipment_id;}))el.add(new Option('Previously linked asset',row.equipment_id));el.value=row?.equipment_id||'';esgFuelAssetChanged(false);}catch(error){if(request===esgAssetRequest&&!row?.equipment_id)el.add(new Option('Asset list unavailable; use text details',''));}
}
function esgFuelAssetChanged(prefill){
  var id=document.getElementById('ff-equipment')?.value,asset=esgFuelAssets.find(function(row){return row.id===id&&String(row.company_id)===String(ccid());}),link=document.getElementById('ff-equipment-open');
  if(asset&&prefill!==false){var field=document.getElementById('ff-vehicle');if(field)field.value=asset.registration_number||asset.ref_number||asset.name;}
  if(link){link.hidden=!asset;link.style.display=asset?'inline-flex':'none';if(asset)link.href=deepLinkRecordUrl({module:asset.is_vehicle?'fleet':'tools',table:'tools_register',id:asset.id,company_id:ccid()});}
}
async function esgLoadWasteOwner(row){
  var request=++esgOwnerRequest,el=document.getElementById('hwf-owner'),company=String(ccid());if(!el)return;el.replaceChildren(new Option('Unassigned — remind company managers',''));if(row?.responsible_profile_id)el.add(new Option('Previously assigned person',row.responsible_profile_id));el.value=row?.responsible_profile_id||'';
  try{var people=await api('/profiles?select=id,company_id,full_name'+cf()+'&status=eq.active&order=full_name.asc&limit=1000');if(String(ccid())!==company||request!==esgOwnerRequest)return;el.replaceChildren(new Option('Unassigned — remind company managers',''));(people||[]).forEach(function(p){el.add(new Option(p.full_name||'Company user',p.id));});if(row?.responsible_profile_id&&!Array.from(el.options).some(function(o){return o.value===row.responsible_profile_id;}))el.add(new Option('Previously assigned person',row.responsible_profile_id));el.value=row?.responsible_profile_id||'';}catch(error){/* Keep the saved identity when the list is unavailable. */}
}
function esgDuplicateIdentity(table,body){
  var specs={waste_records:['record_date',body.manifest_number?'manifest_number':'waste_type',...(body.manifest_number?[]:['location','quantity','unit'])],hazardous_waste:['generation_date',body.manifest_number?'manifest_number':'waste_name',...(body.manifest_number?[]:['storage_location','quantity','unit'])],fuel_consumption:['record_date',body.equipment_id?'equipment_id':'vehicle_equipment','fuel_type',...(body.document_reference?['document_reference']:['quantity','unit'])],water_usage:['record_date',body.meter_id?'meter_id':'location',...(body.document_reference?['document_reference']:['quantity','unit'])],spill_reports:['spill_date','spill_time','location','substance'],environmental_inspections:['inspection_date','area','inspection_type','inspector']};
  var fields=specs[table];if(!fields)return null;var date=body[fields[0]];if(!date)return null;
  if(table==='fuel_consumption'&&!body.equipment_id&&!body.vehicle_equipment&&!body.document_reference)return null;
  return fields.filter(function(field){return body[field]!==null&&body[field]!==undefined&&body[field]!=='';}).map(function(field){return field+'=eq.'+encodeURIComponent(String(body[field]));});
}
async function esgConfirmDuplicate(table,body,editId){
  esgAssertEditContext();var version=esgEditingContext.version,assertCurrent=function(){esgAssertEditContext();if(esgEditingContext.version!==version)throw new Error('Another record was opened. Save from its current form.');};var filters=esgDuplicateIdentity(table,body);if(!filters)return true;
  var path='/'+table+'?select=id&company_id=eq.'+encodeURIComponent(body.company_id)+'&'+filters.join('&')+(editId?'&id=neq.'+encodeURIComponent(editId):'')+'&limit=1';
  var existing=await api(path);assertCurrent();if(!existing?.length)return true;
  var proceed=await appConfirmAction({title:'Possible duplicate environmental record',message:'A record with the same date and identifying details already exists. Save another?',detail:'Check the asset, meter, manifest or supporting document before continuing.',confirmText:'Save another',cancelText:'Review entry'});assertCurrent();return !!proceed;
}
async function esgOpenExactRecord(table,id){
  var tables={waste_records:['waste','esg-waste-list'],hazardous_waste:['hazwaste','esg-hw-list'],fuel_consumption:['fuel','esg-fuel-list'],water_usage:['water','esg-water-list'],spill_reports:['spills','esg-spill-list'],environmental_inspections:['inspections','esg-insp-list']};var target=tables[table];if(!target)return false;
  esgSwitchTab(target[0],document.getElementById('esg-tab-'+target[0]));await esgOpenRecord(target[1],id);return true;
}
function esgCsvCell(value){var text=value===null||value===undefined?'':String(value);if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
async function esgExportCsv(){
  var active=document.querySelector('#page-esg .mtg-tab.active'),tab=(active?.id||'esg-tab-dash').replace('esg-tab-',''),tables={waste:'waste_records',hazwaste:'hazardous_waste',fuel:'fuel_consumption',water:'water_usage',spills:'spill_reports',inspections:'environmental_inspections'},table=tables[tab];
  if(!table)return toast('Open a register to export its reporting month.',false);
  var date={spills:'spill_date',inspections:'inspection_date',hazwaste:'generation_date'}[tab]||'record_date',company=String(ccid()),period=esgPeriod().month;
  try{var rows=await apiAllRows('/'+table+'?select=*'+cf()+esgPeriodQuery(date)+'&order='+date+'.desc');if(String(ccid())!==company||esgPeriod().month!==period)throw new Error('Reporting context changed. Try the export again.');var fields=Array.from(new Set((rows||[]).flatMap(function(row){return Object.keys(row);}))).filter(function(k){return !['company_id','created_by','updated_by'].includes(k);});var lines=[fields.map(esgCsvCell).join(',')].concat((rows||[]).map(function(row){return fields.map(function(key){return esgCsvCell(typeof row[key]==='object'&&row[key]!==null?JSON.stringify(row[key]):row[key]);}).join(',');}));var blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Environmental-'+tab+'-'+period+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);toast('Exported '+rows.length+' records for '+period+'.');}catch(error){toastActionError('Export environmental register','Environmental / ESG',error);}
}
