// ===== ESG_JS.JS =====

// ===== ENVIRONMENTAL & ESG MODULE =====
let esgWasteData=[], esgHWData=[], esgFuelData=[], esgWaterData=[], esgSpillData=[], esgInspData=[];
let esgWasteEditId=null, esgHWEditId=null, esgFuelEditId=null, esgWaterEditId=null, esgSpillEditId=null, esgInspEditId=null;

// Legacy application presets. Their external source/version has not been verified;
// keep that limitation visible wherever an estimate is shown.
const CO2_FACTORS={diesel:2.68,petrol:2.31,lpg:1.51,natural_gas:1.89,electricity:0.233,heavy_fuel_oil:3.18,other:2.5};
const ESG_FUEL_UNITS={diesel:['litres'],petrol:['litres'],lpg:['litres'],natural_gas:['m3'],electricity:['kwh'],heavy_fuel_oil:['litres'],other:['litres','kg','m3','kwh']};
function esgLocalDate(){var now=new Date();return now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');}
function esgPeriod(){var month=document.getElementById('esg-report-period')?.value||esgLocalDate().slice(0,7);var parts=month.split('-').map(Number);if(parts.length!==2||parts[1]<1||parts[1]>12)return {month:esgLocalDate().slice(0,7),start:esgLocalDate().slice(0,7)+'-01',end:''};var next=new Date(parts[0],parts[1],1);return {month:month,start:month+'-01',end:next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0')+'-01'};}
function esgPeriodQuery(column){var p=esgPeriod();return '&'+column+'=gte.'+p.start+(p.end?'&'+column+'=lt.'+p.end:'');}
function esgWasteAmounts(rows){var result={kg:0,litres:0,bags:0,other:{},recycledKg:0,byCategory:{}};(rows||[]).forEach(function(row){var n=Number(row.quantity),unit=String(row.unit||'unknown unit').toLowerCase();if(!Number.isFinite(n)||n<0)return;var group=result.byCategory[row.category||'other']||(result.byCategory[row.category||'other']={kg:0,litres:0,bags:0,other:{}});if(unit==='kg'||unit==='tonnes'){var kg=unit==='tonnes'?n*1000:n;result.kg+=kg;group.kg+=kg;if(row.category==='recyclable')result.recycledKg+=kg;}else if(unit==='litres'||unit==='m3'){var litres=unit==='m3'?n*1000:n;result.litres+=litres;group.litres+=litres;}else if(unit==='bags'){result.bags+=n;group.bags+=n;}else{result.other[unit]=(result.other[unit]||0)+n;group.other[unit]=(group.other[unit]||0)+n;}});return result;}
function esgFuelFactor(type,unit){var allowed=ESG_FUEL_UNITS[type]||[];return allowed.length===1&&allowed[0]===unit?CO2_FACTORS[type]:null;}
function esgFuelUnitChanged(){var type=document.getElementById('ff-type')?.value||'diesel',unit=document.getElementById('ff-unit');if(!unit)return;var allowed=ESG_FUEL_UNITS[type]||[];if(allowed.length===1)unit.value=allowed[0];esgCalcCO2();}
var esgSdsLinks={};
function esgSafeDocumentUrl(value){try{var url=new URL(String(value||''));return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch(_){return '';}}
async function esgLoadChemicalLinks(selectId,selectedId){
  var select=document.getElementById(selectId),company=String(ccid());if(!select)return;
  select.innerHTML='<option value="">Loading chemicals...</option>';
  try{
    var rows=await Promise.all([api('/chemical_register?select=id,company_id,product_name,chemical_ref,sds_file_url'+cf()+'&order=product_name.asc&limit=500'),api('/chemical_sds_versions?select=chemical_id,file_url,validation_status,material_change'+cf()+'&validation_status=eq.current&limit=500')]);
    if(String(ccid())!==company||!select.isConnected)return;
    esgSdsLinks={};(rows[1]||[]).forEach(function(s){if(!s.material_change&&esgSafeDocumentUrl(s.file_url))esgSdsLinks[s.chemical_id]=esgSafeDocumentUrl(s.file_url);});
    select.innerHTML='<option value="">No linked chemical</option>'+(rows[0]||[]).filter(function(row){return String(row.company_id)===company;}).map(function(row){return '<option value="'+escH(row.id)+'"'+(String(row.id)===String(selectedId)?' selected':'')+'>'+escH(row.product_name||row.chemical_ref||'Chemical')+'</option>';}).join('');
    if(selectedId&&!select.value)select.insertAdjacentHTML('beforeend','<option value="'+escH(selectedId)+'" selected>Previously linked chemical</option>');
    esgUpdateSdsLink();
  }catch(error){select.innerHTML='<option value="">Chemical records unavailable</option>'+(selectedId?'<option value="'+escH(selectedId)+'" selected>Previously linked chemical</option>':'');esgUpdateSdsLink();}
}
function esgUpdateSdsLink(){var select=document.getElementById('hwf-chemical'),anchor=document.getElementById('hwf-sds-open'),status=document.getElementById('hwf-sds-status');if(!select||!anchor||!status)return;var href=esgSdsLinks[select.value]||'';anchor.hidden=!href;if(href)anchor.href=href;else anchor.removeAttribute('href');status.textContent=href?'Current validated SDS linked.':'No current validated SDS document linked.';}

// Environmental inspection checklist items
const ENV_CHECKLIST=[
  'Waste segregation - correct bins in place and labelled',
  'Hazardous waste storage - secure, labelled, in bunded area',
  'Spill kits - present, stocked, accessible',
  'Chemical storage - SDS available, containers labelled',
  'Drains - no blockages, oil/silt interceptors functional',
  'No visible liquid discharges to drains',
  'No visible soil contamination',
  'Dust suppression measures in place (if applicable)',
  'Noise from site within acceptable limits',
  'Fuel / oil storage - no leaks, bunded correctly',
  'Waste disposal records up to date',
  'Environmental signage in place',
  'No unauthorised burning or open fires',
  'Water usage meters readable and up to date',
  'Environmental incidents reported correctly'
];

function esgSwitchTab(tab, btn){
  if(window.AurisUserAccess&&!window.AurisUserAccess.sectionAllowed(prof,'esg',tab)){var permitted=window.AurisUserAccess.firstSection(prof,'esg');if(!permitted)return false;tab=permitted.id;btn=document.getElementById(permitted.button);}

  document.querySelectorAll('[id^="esg-tab-"]').forEach(function(t){t.classList.remove('active');});
  if(btn)btn.classList.add('active');
  ['dash','waste','hazwaste','fuel','water','spills','inspections'].forEach(function(t){
    var el=document.getElementById('esg-view-'+t);if(el)el.style.display=t===tab?'block':'none';
  });
  ['esg-waste-form','esg-hw-form','esg-fuel-form','esg-water-form','esg-spill-form','esg-insp-form'].forEach(function(id){
    var el=document.getElementById(id);if(el)el.style.display='none';
  });
  if(tab==='dash')esgLoadDash();
  else if(tab==='waste')esgLoadWaste();
  else if(tab==='hazwaste')esgLoadHW();
  else if(tab==='fuel')esgLoadFuel();
  else if(tab==='water')esgLoadWater();
  else if(tab==='spills')esgLoadSpills();
  else if(tab==='inspections')esgLoadInsp();
}

async function esgLoadModule(){
  var esgPage=document.getElementById('page-esg');
  if(esgPage&&!esgPage.dataset.viewButtonsBound){esgPage.dataset.viewButtonsBound='true';esgPage.addEventListener('click',function(event){var button=event.target.closest('[data-esg-view]');if(!button)return;var list=button.closest('[id$="-list"]');if(!list)return;esgOpenRecord(list.id,button.dataset.esgView);});}
  var hwChemical=document.getElementById('hwf-chemical');if(hwChemical&&!hwChemical.dataset.bound){hwChemical.dataset.bound='true';hwChemical.addEventListener('change',esgUpdateSdsLink);}
  var waterMeter=document.getElementById('waf-meter-id');if(waterMeter&&!waterMeter.dataset.prefillBound){waterMeter.dataset.prefillBound='true';waterMeter.addEventListener('change',esgWaterPrefillPrevious);}
  aurisBindReadOnlyRows('page-esg',function(listId,id){
    esgOpenRecord(listId,id);
  });
  ensureContractorNameOptions();
  var btns=['esg-waste-add-btn','esg-hw-add-btn','esg-fuel-add-btn','esg-water-add-btn','esg-spill-add-btn','esg-insp-add-btn'];
  btns.forEach(function(id){var el=document.getElementById(id);if(el)el.style.display=isMgr()?'inline-flex':'none';});
  var periodInput=document.getElementById('esg-report-period');
  if(periodInput){
    if(!periodInput.value)periodInput.value=esgLocalDate().slice(0,7);
    if(!periodInput.dataset.bound){periodInput.dataset.bound='true';periodInput.addEventListener('change',function(){esgLoadDash();var active=document.querySelector('#page-esg .mtg-tab.active');var tab=active?.id?.replace('esg-tab-','');if(tab&&tab!=='dash')esgSwitchTab(tab,active);});}
  }
  [['esg-m3waste','waste'],['esg-m3fuel','fuel'],['esg-m3water','water'],['esg-m3carbon','fuel'],['esg-m3spills','spills'],['esg-m3hazwaste','hazwaste'],['esg-m3inspections','inspections'],['esg-m3recycle','waste']].forEach(function(pair){var card=document.getElementById(pair[0])?.closest('.card');if(!card||card.dataset.esgOpenBound)return;card.dataset.esgOpenBound='true';card.setAttribute('role','button');card.tabIndex=0;card.setAttribute('aria-label','Open '+pair[1]+' records for selected reporting month');var open=function(){esgSwitchTab(pair[1],document.getElementById('esg-tab-'+pair[1]));};card.addEventListener('click',open);card.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});});
  esgLoadDash();
}
async function esgOpenRecord(listId,id){
  var sources={'esg-waste-list':{rows:esgWasteData,kind:'Waste record',table:'waste_records'},'esg-hw-list':{rows:esgHWData,kind:'Hazardous waste record',table:'hazardous_waste'},'esg-fuel-list':{rows:esgFuelData,kind:'Fuel / energy record',table:'fuel_consumption'},'esg-water-list':{rows:esgWaterData,kind:'Water usage record',table:'water_usage'},'esg-spill-list':{rows:esgSpillData,kind:'Spill report',table:'spill_reports'},'esg-insp-list':{rows:esgInspData,kind:'Environmental inspection',table:'environmental_inspections'}};
  var source=sources[listId];if(!source)return;var company=String(ccid()),record=(source.rows||[]).find(function(row){return String(row.id)===String(id)&&String(row.company_id)===company;});if(!record){try{var fresh=await api('/'+source.table+'?select=*&id=eq.'+encodeURIComponent(id)+cf()+'&limit=1');record=fresh?.[0];}catch(error){return toast('The selected record could not be opened.',false);}}if(!record||String(record.company_id)!==company||String(ccid())!==company)return toast('This record is unavailable in the selected company.',false);
  aurisReadOnlyRecordModal(source.kind,record.title||record.waste_name||record.waste_type||record.substance||record.area||record.category||'Environmental record',record,aurisReadableRecordFields(record));
  var card=document.querySelector('#auris-readonly-record-modal .card[role="dialog"]');if(!card)return;
  var links=[];
  if(record.chemical_id){
    links.push({label:'Open linked chemical',url:deepLinkRecordUrl({module:'chemical-control',table:'chemical_register',id:record.chemical_id,company_id:ccid()})});
    try{var docs=await api('/chemical_sds_versions?select=file_url,validation_status,material_change&chemical_id=eq.'+encodeURIComponent(record.chemical_id)+cf()+'&validation_status=eq.current&limit=1');var doc=docs?.[0];var url=esgSafeDocumentUrl(doc?.file_url);if(!doc?.material_change&&url)links.push({label:'View validated SDS',url:url});}catch(e){console.warn('SDS link unavailable',e);}
  }
  if(record.waste_record_id)links.push({label:'View linked waste record',action:function(){document.getElementById('auris-readonly-record-modal')?.remove();esgOpenRecord('esg-waste-list',record.waste_record_id);}});
  if(record.action_id)links.push({label:'Open corrective action',url:deepLinkRecordUrl({module:'actions',table:'action_tracker',id:record.action_id,company_id:ccid()})});
  if(String(ccid())!==String(record.company_id)||!card.isConnected)return;
  if(links.length){var wrap=document.createElement('div');wrap.style.cssText='display:flex;gap:8px;flex-wrap:wrap;padding:12px';links.forEach(function(link){var a=document.createElement(link.action?'button':'a');a.className='btn btn-sm';a.textContent=link.label;if(link.action){a.type='button';a.addEventListener('click',link.action);}else{a.href=link.url;a.target='_blank';a.rel='noopener noreferrer';}wrap.appendChild(a);});card.appendChild(wrap);}
}

// -- DASHBOARD -----------------------------------------------------------------
async function esgLoadDash(){
  var period=esgPeriod(),company=String(ccid());
  var setM=function(id,v){var e=document.getElementById(id);if(e)e.textContent=v;};
  try{
    var [waste,fuel,water,spills,hw,inspections]=await Promise.all([
      apiAllRows('/waste_records?select=id,quantity,unit,category'+cf()+esgPeriodQuery('record_date')),
      apiAllRows('/fuel_consumption?select=id,quantity,unit,fuel_type,carbon_kg'+cf()+esgPeriodQuery('record_date')),
      apiAllRows('/water_usage?select=id,quantity,unit'+cf()+esgPeriodQuery('record_date')),
      apiAllRows('/spill_reports?select=id,status'+cf()+'&status=neq.closed'+esgPeriodQuery('spill_date')),
      apiAllRows('/hazardous_waste?select=id,status'+cf()+'&status=neq.disposed'+esgPeriodQuery('generation_date')),
      apiAllRows('/environmental_inspections?select=id,overall_rating'+cf()+esgPeriodQuery('inspection_date'))
    ]);
    if(String(ccid())!==company||esgPeriod().month!==period.month)return;
    var wasteTotals=esgWasteAmounts(waste),totalWaste=wasteTotals.kg;
    var totalFuelL=(fuel||[]).reduce(function(s,r){return s+(r.unit==='litres'?parseFloat(r.quantity)||0:0);},0);
    var totalCO2=(fuel||[]).reduce(function(s,r){return s+(parseFloat(r.carbon_kg)||0);},0);
    var totalWaterL=(water||[]).reduce(function(s,r){var q=parseFloat(r.quantity)||0;return s+(r.unit==='m3'?q*1000:r.unit==='gallons'?q*3.785:q);},0);
    setM('esg-m3waste',totalWaste.toFixed(0));
    setM('esg-m3waste-sub',[period.month,wasteTotals.litres?'Volume: '+wasteTotals.litres.toFixed(1)+' L':'',wasteTotals.bags?'Containers: '+wasteTotals.bags+' bags':'',...Object.entries(wasteTotals.other).map(function(pair){return pair[1]+' '+pair[0];})].filter(Boolean).join(' · '));
    setM('esg-m3fuel',totalFuelL.toFixed(0));
    setM('esg-m3fuel-sub',period.month+' · litres only; other energy units excluded');
    setM('esg-m3water',(totalWaterL/1000).toFixed(1));
    setM('esg-m3carbon',totalCO2.toFixed(0));
    setM('esg-m3spills',(spills||[]).length);
    setM('esg-m3hazwaste',(hw||[]).length);
    setM('esg-m3inspections',(inspections||[]).length);
    setM('esg-m3recycle',totalWaste>0?Math.round(wasteTotals.recycledKg/totalWaste*100)+'%':'Not available');
    var missingFactors=(fuel||[]).filter(function(row){return row.carbon_kg===null||row.carbon_kg===undefined;}).length;
    var unrated=(inspections||[]).filter(function(row){return !row.overall_rating;}).length;
    var unclearWaste=(waste||[]).filter(function(row){return !row.unit;}).length;
    setM('esg-report-completeness','Reporting completeness · '+period.month+': '+(waste||[]).length+' waste, '+(fuel||[]).length+' fuel / energy, '+(water||[]).length+' water and '+(inspections||[]).length+' inspection records. Attention: '+unrated+' inspection ratings unanswered, '+missingFactors+' emissions estimates unavailable, '+unclearWaste+' waste units missing. Counts show recorded entries, not whether all expected activity was reported.');
    // Waste chart
    var bycat={};
    Object.keys(wasteTotals.byCategory).forEach(function(category){bycat[category]=wasteTotals.byCategory[category].kg;});
    var wasteEl=document.getElementById('esg-waste-chart');
    var catLabels={general:'General',recyclable:'Recyclable',hazardous:'Hazardous',organic:'Organic',electronic:'Electronic',construction:'Construction',medical:'Medical',other:'Other'};
    var catColors={general:'#6B7280',recyclable:'#1D9E75',hazardous:'#E24B4A',organic:'#854F0B',electronic:'#185FA5',construction:'#EF9F27',medical:'#8B5CF6',other:'#9CA3AF'};
    if(wasteEl){
      if(Object.keys(bycat).length===0){wasteEl.innerHTML='<div style="color:var(--text2);padding:20px;text-align:center">No waste data for this period</div>';}
      else{
        var maxVal=Math.max(...Object.values(bycat));
        var h='<div style="display:flex;flex-direction:column;gap:8px;padding:8px 0">';
        Object.entries(bycat).sort(function(a,b){return b[1]-a[1];}).forEach(function(e){
          var pct=maxVal>0?Math.round((e[1]/maxVal)*100):0;
          var col=catColors[e[0]]||'#6B7280';
          var amounts=wasteTotals.byCategory[e[0]],other=[amounts.litres?amounts.litres.toFixed(1)+' L':'',amounts.bags?amounts.bags+' bags':'',...Object.entries(amounts.other).map(function(pair){return pair[1]+' '+pair[0];})].filter(Boolean).join(' · ');
          h+='<div><div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px"><span style="font-weight:600">'+escH(catLabels[e[0]]||e[0])+'</span><span style="color:var(--text2)">'+e[1].toFixed(1)+' kg'+(other?' · '+other:'')+'</span></div>'
            +'<div style="height:8px;background:#f3f4f6;border-radius:4px"><div style="height:8px;background:'+col+';border-radius:4px;width:'+pct+'%"></div></div></div>';
        });
        h+='</div>';
        wasteEl.innerHTML=h;
      }
    }
    // Carbon chart
    var carbonEl=document.getElementById('esg-carbon-chart');
    if(carbonEl){
      var byfuel={};
      (fuel||[]).forEach(function(r){byfuel[r.fuel_type]=(byfuel[r.fuel_type]||0)+(parseFloat(r.carbon_kg)||0);});
      var fuelColors={diesel:'#374151',petrol:'#EF9F27',lpg:'#185FA5',natural_gas:'#6B7280',electricity:'#1D9E75',heavy_fuel_oil:'#7F1D1D',other:'#9CA3AF'};
      var fuelLabels={diesel:'Diesel',petrol:'Petrol',lpg:'LPG',natural_gas:'Natural Gas',electricity:'Electricity',heavy_fuel_oil:'Heavy Fuel Oil',other:'Other'};
      if(Object.keys(byfuel).length===0){carbonEl.innerHTML='<div style="color:var(--text2);padding:20px;text-align:center">No fuel data this month</div>';}
      else{
        var totalC=Object.values(byfuel).reduce(function(s,v){return s+v;},0);
        var h2='<div style="display:flex;flex-direction:column;gap:8px;padding:8px 0">';
        Object.entries(byfuel).sort(function(a,b){return b[1]-a[1];}).forEach(function(e){
          var pct=totalC>0?Math.round((e[1]/totalC)*100):0;
          var col=fuelColors[e[0]]||'#6B7280';
          h2+='<div><div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px"><span style="font-weight:600">'+escH(fuelLabels[e[0]]||e[0])+'</span><span style="color:var(--text2)">'+e[1].toFixed(1)+' kg CO2e ('+pct+'%)</span></div>'
            +'<div style="height:8px;background:#f3f4f6;border-radius:4px"><div style="height:8px;background:'+col+';border-radius:4px;width:'+pct+'%"></div></div></div>';
        });
        h2+='</div>';
        carbonEl.innerHTML=h2;
      }
    }
  }catch(e){console.error(e);}
}

// -- WASTE ---------------------------------------------------------------------
async function esgLoadWaste(){
  var el=document.getElementById('esg-waste-list');if(!el)return;
  el.innerHTML='<div class="loading-msg">Loading...</div>';
  try{
    var q='/waste_records?select=*'+cf()+esgPeriodQuery('record_date')+'&order=record_date.desc';
    var d=await api(q);esgWasteData=d||[];
    if(!d||!d.length){el.innerHTML='<div style="text-align:center;padding:40px;color:var(--text2)">No waste records found.'+(isMgr()?' <button class="btn btn-primary btn-sm" data-auris-generated-onclick="g0157"><i class="ti ti-plus"></i>Add</button>':'')+'</div>';return;}
    var catColors={general:'#6B7280',recyclable:'#1D9E75',hazardous:'#E24B4A',organic:'#854F0B',electronic:'#185FA5',construction:'#EF9F27',medical:'#8B5CF6',other:'#9CA3AF'};
    var h='<div class="table-scroll"><table class="data-table" style="min-width:860px"><thead><tr>'
      +'<th>Date</th><th>Waste type</th>'
      +'<th>Category</th><th style="text-align:right">Quantity</th>'
      +'<th>Disposal</th><th style="width:70px"></th>'
      +'</tr></thead><tbody>';
    d.forEach(function(x,i){
      var bg=i%2===0?'#fff':'#f9fafb';
      var col=catColors[x.category]||'#6B7280';
      h+='<tr style="border-bottom:1px solid #f0f0f0;background:'+bg+'">'
        +'<td style="padding:8px 14px;font-weight:600">'+( x.record_date?new Date(x.record_date).toLocaleDateString('en-GB'):'-')+'</td>'
        +'<td style="padding:8px 10px">'+escH(x.waste_type||'-')+'</td>'
        +'<td style="padding:8px 10px"><span style="background:'+col+'20;color:'+col+';padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;text-transform:capitalize">'+escH(x.category||'-')+'</span></td>'
        +'<td style="padding:8px 10px;text-align:right;font-weight:700">'+parseFloat(x.quantity||0).toFixed(1)+' '+escH(x.unit||'kg')+'</td>'
        +'<td style="padding:8px 10px;font-size:11px;color:var(--text2)">'+escH(x.disposal_method||'-')+'</td>'
        +'<td style="padding:8px 10px"><div style="display:flex;gap:4px">'
        +'<button class="btn btn-sm" type="button" data-esg-view="'+x.id+'" title="View record" aria-label="View record"><i class="ti ti-eye"></i></button>'+'<button class="btn btn-sm" data-id="'+x.id+'" title="Edit record" aria-label="Edit record" data-auris-generated-onclick="g0158"><i class="ti ti-edit"></i></button>'
        +(isMgr()?'<button class="btn btn-sm" style="color:var(--red)" data-id="'+x.id+'" title="Archive or delete record" aria-label="Archive or delete record" data-auris-generated-onclick="g0159"><i class="ti ti-trash"></i></button>':'')
        +'</div></td></tr>';
    });
    h+='</tbody></table></div>';
    if(el)el.innerHTML=h;
  }catch(e){el.innerHTML=registerErrorHtml('register',e.message);}
}

function esgShowForm(formId){
  ['esg-view-dash','esg-view-waste','esg-view-hazwaste','esg-view-fuel','esg-view-water','esg-view-spills','esg-view-inspections','esg-waste-form','esg-hw-form','esg-fuel-form','esg-water-form','esg-spill-form','esg-insp-form'].forEach(function(id){var el=document.getElementById(id);if(el)el.style.display='none';});
  var el=document.getElementById(formId);if(el)el.style.display='block';
}

function esgResetForm(fields,dates,sels){
  (fields||[]).forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  (dates||[]).forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  Object.entries(sels||{}).forEach(function(e){var el=document.getElementById(e[0]);if(el)el.value=e[1];});
}

function esgWasteNew(){
  esgWasteEditId=null;document.getElementById('esg-waste-form3title').textContent='New Waste Record';
  esgResetForm(['wf-type','wf-qty','wf-disposal','wf-contractor','wf-manifest','wf-location','wf-notes'],['wf-date'],{'wf-cat':'general','wf-unit':'kg'});
  document.getElementById('wf-date').value=esgLocalDate();
  esgShowForm('esg-waste-form');
}
function esgWasteEdit(id){
  var x=esgWasteData.find(function(r){return r.id===id;});if(!x)return;
  esgWasteEditId=id;document.getElementById('esg-waste-form3title').textContent='Edit Waste Record';
  var flds={'wf-type':'waste_type','wf-qty':'quantity','wf-disposal':'disposal_method','wf-contractor':'disposal_contractor','wf-manifest':'manifest_number','wf-location':'location','wf-notes':'notes'};
  Object.entries(flds).forEach(function(e){var el=document.getElementById(e[0]);if(el)el.value=x[e[1]]||'';});
  var dt=document.getElementById('wf-date');if(dt)dt.value=x.record_date||'';
  var cat=document.getElementById('wf-cat');if(cat)cat.value=x.category||'general';
  var un=document.getElementById('wf-unit');if(un)un.value=x.unit||'kg';
  esgShowForm('esg-waste-form');
}
function esgWasteBack(){
  document.getElementById('esg-waste-form').style.display='none';
  document.getElementById('esg-view-waste').style.display='block';
  document.querySelectorAll('[id^="esg-tab-"]').forEach(function(t){t.classList.remove('active');});
  var tab=document.getElementById('esg-tab-waste');if(tab)tab.classList.add('active');
  esgLoadWaste();
}
async function esgWasteSave(){
  var tp=document.getElementById('wf-type')?.value?.trim();if(!tp){toast('Please enter waste type',false);return;}
  var g=function(id){var el=document.getElementById(id);return el?el.value||null:null;};
  var body={company_id:ccid(),record_date:g('wf-date'),waste_type:tp,category:g('wf-cat')||'general',quantity:parseFloat(g('wf-qty'))||0,unit:g('wf-unit')||'kg',disposal_method:g('wf-disposal'),disposal_contractor:g('wf-contractor'),manifest_number:g('wf-manifest'),location:g('wf-location'),notes:g('wf-notes')};
  try{
    if(esgWasteEditId){await api('/waste_records?id=eq.'+esgWasteEditId,{m:'PATCH',p:'return=minimal',b:body});toast('Updated!');}
    else{body.created_by=prof?.id;await api('/waste_records',{m:'POST',p:'return=minimal',b:body});toast('Waste record saved!');}
    esgWasteBack();
  }catch(e){toastActionError('Save waste record','Environmental / ESG',e);}
}
function esgArchivedNotes(notes){return ('[Archived '+esgLocalDate()+'] '+(notes||'')).trim();}
function esgIsArchivedNote(notes){return /\[Archived/i.test(String(notes||''));}
async function esgWasteDel(id){try{var current=esgWasteData.find(x=>x.id===id)||{};if(!esgIsArchivedNote(current.notes)){if(!(await appConfirmAction({title:'Archive waste record',message:'Archive this waste record instead of deleting it?',detail:'Waste records support environmental traceability. The record will remain available for audit history.',confirmText:'Archive record',cancelText:'Back'})))return;var notes=esgArchivedNotes(current.notes);await api('/waste_records?id=eq.'+id,{m:'PATCH',p:'return=minimal',b:{notes:notes}});toast('Waste record archived');esgLoadWaste();return;}if(!(await appConfirmDelete('waste record','This record is already archived. Permanent deletion should be used only for duplicate/test records.')))return;await api('/waste_records?id=eq.'+id,{m:'DELETE'});esgWasteData=esgWasteData.filter(x=>x.id!==id);toast('Deleted!');esgLoadWaste();}catch(e){toastActionError('Delete waste record','Environmental / ESG',e);}}

// -- HAZARDOUS WASTE -----------------------------------------------------------
async function esgLoadHW(){
  var el=document.getElementById('esg-hw-list');if(!el)return;
  el.innerHTML='<div class="loading-msg">Loading...</div>';
  try{
    var d=await api('/hazardous_waste?select=*'+cf()+esgPeriodQuery('generation_date')+'&order=generation_date.desc');
    esgHWData=d||[];
    var stored=(d||[]).filter(function(x){return x.status==='stored'||x.status==='awaiting_collection';}).length;
    var alertEl=document.getElementById('esg-hw-alerts');
    if(alertEl&&stored>0)alertEl.innerHTML='<div style="background:#FEF9EC;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px;font-size:12px;margin-bottom:8px"><strong style="color:#854F0B">Alert: '+stored+' hazardous waste item'+(stored!==1?'s':'')+' currently stored on site - ensure licensed contractor collection is scheduled</strong></div>';
    else if(alertEl)alertEl.innerHTML='';
    if(!d||!d.length){el.innerHTML='<div style="text-align:center;padding:40px;color:var(--text2)">No hazardous waste records.'+(isMgr()?' <button class="btn btn-primary btn-sm" data-auris-generated-onclick="g0160"><i class="ti ti-plus"></i>Add</button>':'')+'</div>';return;}
    var stCfg={stored:['#FEF9EC','#854F0B'],awaiting_collection:['#FEF6E7','#C2410C'],in_transit:['#EDE9FE','#7C3AED'],disposed:['#EAF3DE','#3B6D11'],spilled:['#FCEBEB','#A32D2D']};
    var h='<div class="table-scroll"><table class="data-table" style="min-width:980px"><thead><tr>'
      +'<th>Waste</th><th>UN No.</th>'
      +'<th style="text-align:right">Quantity</th><th>Storage</th>'
      +'<th>Collection date</th><th>Contractor</th>'
      +'<th>Status</th><th style="width:70px"></th>'
      +'</tr></thead><tbody>';
    d.forEach(function(x,i){
      var bg=i%2===0?'#fff':'#f9fafb';
      var sc2=stCfg[x.status]||stCfg.stored;
      h+='<tr style="border-bottom:1px solid #f0f0f0;background:'+bg+'">'
        +'<td style="padding:8px 14px;font-weight:600">'+escH(x.waste_name||'-')+'<br><span style="font-size:10px;color:var(--text2)">'+escH(x.hazard_class||'')+'</span></td>'
        +'<td style="padding:8px 10px;font-family:monospace">'+escH(x.un_number||'-')+'</td>'
        +'<td style="padding:8px 10px;text-align:right;font-weight:700">'+(x.quantity||'-')+' '+escH(x.unit||'')+'</td>'
        +'<td style="padding:8px 10px;font-size:11px">'+escH(x.storage_location||'-')+'</td>'
        +'<td style="padding:8px 10px">'+(x.collection_date?new Date(x.collection_date).toLocaleDateString('en-GB'):'-')+'</td>'
        +'<td style="padding:8px 10px;font-size:11px">'+escH(x.licensed_contractor||'-')+'</td>'
        +'<td style="padding:8px 10px"><span style="background:'+sc2[0]+';color:'+sc2[1]+';padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;text-transform:capitalize">'+(x.status||'stored').replace(/_/g,' ')+'</span></td>'
        +'<td style="padding:8px 10px"><div style="display:flex;gap:4px">'
        +'<button class="btn btn-sm" type="button" data-esg-view="'+x.id+'" title="View record" aria-label="View record"><i class="ti ti-eye"></i></button>'+'<button class="btn btn-sm" data-id="'+x.id+'" title="Edit record" aria-label="Edit record" data-auris-generated-onclick="g0161"><i class="ti ti-edit"></i></button>'
        +(isMgr()?'<button class="btn btn-sm" style="color:var(--red)" data-id="'+x.id+'" title="Archive or delete record" aria-label="Archive or delete record" data-auris-generated-onclick="g0162"><i class="ti ti-trash"></i></button>':'')
        +'</div></td></tr>';
    });
    h+='</tbody></table></div>';el.innerHTML=h;
  }catch(e){el.innerHTML=registerErrorHtml('register',e.message);}
}

function esgHWNew(){esgHWEditId=null;document.getElementById('esg-hw-form3title').textContent='New Hazardous Waste Record';esgResetForm(['hwf-name','hwf-un','hwf-class','hwf-qty','hwf-container','hwf-location','hwf-contractor','hwf-license','hwf-manifest','hwf-disposal-method','hwf-notes'],['hwf-gen-date','hwf-collect-date','hwf-disposal-date'],{'hwf-unit':'kg','hwf-status':'stored'});esgLoadChemicalLinks('hwf-chemical','');esgShowForm('esg-hw-form');}
function esgHWEdit(id){
  var x=esgHWData.find(function(r){return r.id===id;});if(!x)return;esgHWEditId=id;
  document.getElementById('esg-hw-form3title').textContent='Edit Hazardous Waste';
  var flds={'hwf-name':'waste_name','hwf-un':'un_number','hwf-class':'hazard_class','hwf-qty':'quantity','hwf-container':'container_type','hwf-location':'storage_location','hwf-contractor':'licensed_contractor','hwf-license':'contractor_license_number','hwf-manifest':'manifest_number','hwf-disposal-method':'disposal_method','hwf-notes':'notes'};
  Object.entries(flds).forEach(function(e){var el=document.getElementById(e[0]);if(el)el.value=x[e[1]]||'';});
  var dates={'hwf-gen-date':'generation_date','hwf-collect-date':'collection_date','hwf-disposal-date':'disposal_date'};
  Object.entries(dates).forEach(function(e){var el=document.getElementById(e[0]);if(el)el.value=x[e[1]]||'';});
  var un=document.getElementById('hwf-unit');if(un)un.value=x.unit||'kg';
  var st=document.getElementById('hwf-status');if(st)st.value=x.status||'stored';
  esgLoadChemicalLinks('hwf-chemical',x.chemical_id);
  esgShowForm('esg-hw-form');
}
function esgHWBack(){document.getElementById('esg-hw-form').style.display='none';document.getElementById('esg-view-hazwaste').style.display='block';document.querySelectorAll('[id^="esg-tab-"]').forEach(function(t){t.classList.remove('active');});var tab=document.getElementById('esg-tab-hazwaste');if(tab)tab.classList.add('active');esgLoadHW();}
async function esgHWSave(){
  var name=document.getElementById('hwf-name')?.value?.trim();if(!name){toast('Please enter waste name',false);return;}
  var g=function(id){var el=document.getElementById(id);return el?el.value||null:null;};
  var chemicalId=g('hwf-chemical');var body={company_id:ccid(),waste_name:name,un_number:g('hwf-un'),hazard_class:g('hwf-class'),quantity:parseFloat(g('hwf-qty'))||null,unit:g('hwf-unit')||'kg',container_type:g('hwf-container'),storage_location:g('hwf-location'),generation_date:g('hwf-gen-date'),collection_date:g('hwf-collect-date'),disposal_date:g('hwf-disposal-date'),licensed_contractor:g('hwf-contractor'),contractor_license_number:g('hwf-license'),manifest_number:g('hwf-manifest'),disposal_method:g('hwf-disposal-method'),status:g('hwf-status')||'stored',chemical_id:chemicalId||null,sds_available:!!(chemicalId&&esgSdsLinks[chemicalId]),notes:g('hwf-notes'),updated_at:new Date().toISOString()};
  try{if(esgHWEditId){await api('/hazardous_waste?id=eq.'+esgHWEditId,{m:'PATCH',p:'return=minimal',b:body});toast('Updated!');}else{body.created_by=prof?.id;await api('/hazardous_waste',{m:'POST',p:'return=minimal',b:body});toast('Record saved!');}esgHWBack();}catch(e){toastActionError('Save hazardous waste record','Environmental / ESG',e);}
}
async function esgHWDel(id){try{var current=esgHWData.find(x=>x.id===id)||{};if(current.status!=='disposed'&&!esgIsArchivedNote(current.notes)){if(!(await appConfirmAction({title:'Archive hazardous waste record',message:'Mark this hazardous waste record as disposed/archived instead of deleting it?',detail:'Hazardous waste records are regulatory evidence and should remain traceable with manifest and contractor details.',confirmText:'Archive record',cancelText:'Back'})))return;await api('/hazardous_waste?id=eq.'+id,{m:'PATCH',p:'return=minimal',b:{status:'disposed',notes:esgArchivedNotes(current.notes),updated_at:new Date().toISOString()}});toast('Hazardous waste record archived');esgLoadHW();return;}if(!(await appConfirmDelete('hazardous waste record','This record is already disposed/archived. Permanent deletion should be used only for duplicate/test records.')))return;await api('/hazardous_waste?id=eq.'+id,{m:'DELETE'});esgHWData=esgHWData.filter(x=>x.id!==id);toast('Deleted!');esgLoadHW();}catch(e){toastActionError('Delete hazardous waste record','Environmental / ESG',e);}}

// -- FUEL ----------------------------------------------------------------------
function esgCalcCO2(){
  var tp=document.getElementById('ff-type')?.value||'diesel';
  var unit=document.getElementById('ff-unit')?.value||'',qty=parseFloat(document.getElementById('ff-qty')?.value),factor=esgFuelFactor(tp,unit);
  var el=document.getElementById('ff-co2-display'),detail=document.getElementById('ff-co2-factor-detail');
  if(el)el.textContent=Number.isFinite(qty)&&qty>0&&factor!==null?(qty*factor).toFixed(2)+' kg':'Not estimated';
  if(detail)detail.textContent=factor===null?'No verified factor for this type/unit. Estimate withheld.':qty>0?qty+' '+unit+' × '+factor+' kg CO2e/'+unit+' = '+(qty*factor).toFixed(2)+' kg. Source: AURIS360 legacy preset v1 (external provenance unverified).':'Factor: '+factor+' kg CO2e/'+unit+'. Source: AURIS360 legacy preset v1 (external provenance unverified).';
}

async function esgLoadFuel(){
  var el=document.getElementById('esg-fuel-list');if(!el)return;el.innerHTML='<div class="loading-msg">Loading...</div>';
  var ft=document.getElementById('esg-fuel-filter-type')?.value||'';
  try{
    var q='/fuel_consumption?select=*'+cf()+esgPeriodQuery('record_date')+'&order=record_date.desc';if(ft)q+='&fuel_type=eq.'+ft;
    var d=await api(q);esgFuelData=d||[];
    if(!d||!d.length){el.innerHTML='<div style="text-align:center;padding:40px;color:var(--text2)">No fuel records.'+(isMgr()?' <button class="btn btn-primary btn-sm" data-auris-generated-onclick="g0163"><i class="ti ti-plus"></i>Add</button>':'')+'</div>';return;}
    var fuelLabels={diesel:'Diesel',petrol:'Petrol',lpg:'LPG',natural_gas:'Natural Gas',electricity:'Electricity',heavy_fuel_oil:'HFO',other:'Other'};
    var fuelColors={diesel:'#374151',petrol:'#EF9F27',lpg:'#185FA5',natural_gas:'#6B7280',electricity:'#1D9E75',heavy_fuel_oil:'#7F1D1D',other:'#9CA3AF'};
    var h='<div class="table-scroll"><table class="data-table" style="min-width:900px"><thead><tr>'
      +'<th>Date</th><th>Type</th>'
      +'<th>Vehicle/Equipment</th><th style="text-align:right">Quantity</th>'
      +'<th style="padding:8px 10px;text-align:right">CO2e (kg)</th><th style="padding:8px 10px;text-align:left">Purpose</th>'
      +'<th style="width:70px"></th></tr></thead><tbody>';
    d.forEach(function(x,i){
      var bg=i%2===0?'#fff':'#f9fafb';var col=fuelColors[x.fuel_type]||'#6B7280';
      h+='<tr style="border-bottom:1px solid #f0f0f0;background:'+bg+'">'
        +'<td style="padding:8px 14px;font-weight:600">'+(x.record_date?new Date(x.record_date).toLocaleDateString('en-GB'):'-')+'</td>'
        +'<td style="padding:8px 10px"><span style="background:'+col+'20;color:'+col+';padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">'+escH(fuelLabels[x.fuel_type]||x.fuel_type||'-')+'</span></td>'
        +'<td style="padding:8px 10px;font-size:11px">'+escH(x.vehicle_equipment||'-')+'</td>'
        +'<td style="padding:8px 10px;text-align:right;font-weight:700">'+(parseFloat(x.quantity||0).toFixed(1))+' '+escH(x.unit||'L')+'</td>'
        +'<td style="padding:8px 10px;text-align:right;color:#6D28D9;font-weight:600">'+(x.carbon_kg?parseFloat(x.carbon_kg).toFixed(1):'-')+'</td>'
        +'<td style="padding:8px 10px;font-size:11px">'+escH(x.purpose||'-')+'</td>'
        +'<td style="padding:8px 10px"><div style="display:flex;gap:4px">'
        +'<button class="btn btn-sm" type="button" data-esg-view="'+x.id+'" title="View record" aria-label="View record"><i class="ti ti-eye"></i></button>'+'<button class="btn btn-sm" data-id="'+x.id+'" title="Edit record" aria-label="Edit record" data-auris-generated-onclick="g0164"><i class="ti ti-edit"></i></button>'
        +(isMgr()?'<button class="btn btn-sm" style="color:var(--red)" data-id="'+x.id+'" title="Archive or delete record" aria-label="Archive or delete record" data-auris-generated-onclick="g0165"><i class="ti ti-trash"></i></button>':'')
        +'</div></td></tr>';
    });
    h+='</tbody></table>';el.innerHTML=h;
  }catch(e){el.innerHTML=registerErrorHtml('register',e.message);}
}

function esgFuelNew(){esgFuelEditId=null;document.getElementById('fleet-fuel-vehicle-select')?.remove();var vehicleField=document.getElementById('ff-vehicle');if(vehicleField)vehicleField.hidden=false;document.getElementById('esg-fuel-form3title').textContent='New Fuel / Energy Record';esgResetForm(['ff-vehicle','ff-odo-start','ff-odo-end','ff-purpose','ff-dept','ff-cost','ff-notes'],['ff-date'],{'ff-type':'diesel','ff-unit':'litres'});document.getElementById('ff-date').value=esgLocalDate();document.getElementById('ff-qty').value='';esgCalcCO2();esgShowForm('esg-fuel-form');}
function esgFuelEdit(id){
  var x=esgFuelData.find(function(r){return r.id===id;});if(!x)return;esgFuelEditId=id;
  document.getElementById('esg-fuel-form3title').textContent='Edit Fuel Record';
  var flds={'ff-vehicle':'vehicle_equipment','ff-odo-start':'meter_reading_start','ff-odo-end':'meter_reading_end','ff-purpose':'purpose','ff-dept':'department','ff-cost':'cost','ff-notes':'notes'};
  Object.entries(flds).forEach(function(e){var el=document.getElementById(e[0]);if(el)el.value=x[e[1]]||'';});
  var dt=document.getElementById('ff-date');if(dt)dt.value=x.record_date||'';
  var tp=document.getElementById('ff-type');if(tp)tp.value=x.fuel_type||'diesel';
  var qty=document.getElementById('ff-qty');if(qty)qty.value=x.quantity||'';
  var un=document.getElementById('ff-unit');if(un)un.value=x.unit||'litres';
  esgCalcCO2();esgShowForm('esg-fuel-form');
}
function esgFuelBack(){document.getElementById('esg-fuel-form').style.display='none';document.getElementById('esg-view-fuel').style.display='block';document.querySelectorAll('[id^="esg-tab-"]').forEach(function(t){t.classList.remove('active');});var tab=document.getElementById('esg-tab-fuel');if(tab)tab.classList.add('active');esgLoadFuel();}
async function esgFuelSave(){
  var qty=parseFloat(document.getElementById('ff-qty')?.value);if(!qty||qty<=0){toast('Please enter quantity',false);return;}
  if(document.getElementById('fleet-fuel-vehicle-select')&&!document.getElementById('fleet-fuel-vehicle-select').value){toast('Select a registered vehicle for this fleet fuel entry.',false);return;}
  var tp=document.getElementById('ff-type')?.value||'diesel';
  var unit=document.getElementById('ff-unit')?.value||'',allowed=ESG_FUEL_UNITS[tp]||[];
  if(!allowed.includes(unit))return toast('Choose a unit valid for '+tp.replace(/_/g,' ')+'.',false);
  var factor=esgFuelFactor(tp,unit),co2=factor===null?null:qty*factor;
  var g=function(id){var el=document.getElementById(id);return el?el.value||null:null;};
  var body={company_id:ccid(),record_date:g('ff-date'),fuel_type:tp,quantity:qty,unit:unit,vehicle_equipment:g('ff-vehicle'),meter_reading_start:g('ff-odo-start')?parseFloat(g('ff-odo-start')):null,meter_reading_end:g('ff-odo-end')?parseFloat(g('ff-odo-end')):null,purpose:g('ff-purpose'),department:g('ff-dept'),cost:g('ff-cost')?parseFloat(g('ff-cost')):null,currency:'MUR',carbon_kg:co2===null?null:Math.round(co2*100)/100,factor_value:factor,factor_unit:factor===null?null:'kg CO2e/'+unit,factor_source:factor===null?null:'AURIS360 legacy preset',factor_version:factor===null?null:'legacy-v1',notes:g('ff-notes')};
  try{if(esgFuelEditId){await api('/fuel_consumption?id=eq.'+esgFuelEditId,{m:'PATCH',p:'return=minimal',b:body});toast('Updated!');}else{body.created_by=prof?.id;await api('/fuel_consumption',{m:'POST',p:'return=minimal',b:body});toast('Fuel record saved'+(co2===null?'; CO2e not estimated.':'! CO2e: '+co2.toFixed(1)+' kg'));}esgFuelBack();}catch(e){toastActionError('Save fuel record','Environmental / ESG',e);}
}
async function esgFuelDel(id){try{var current=esgFuelData.find(x=>x.id===id)||{};if(!esgIsArchivedNote(current.notes)){if(!(await appConfirmAction({title:'Archive fuel record',message:'Archive this fuel / energy record instead of deleting it?',detail:'Fuel records feed ESG and CO2e history. The record will remain available for audit evidence.',confirmText:'Archive record',cancelText:'Back'})))return;await api('/fuel_consumption?id=eq.'+id,{m:'PATCH',p:'return=minimal',b:{notes:esgArchivedNotes(current.notes)}});toast('Fuel record archived');esgLoadFuel();return;}if(!(await appConfirmDelete('fuel record','This record is already archived. Permanent deletion should be used only for duplicate/test records.')))return;await api('/fuel_consumption?id=eq.'+id,{m:'DELETE'});esgFuelData=esgFuelData.filter(x=>x.id!==id);toast('Deleted!');esgLoadFuel();}catch(e){toastActionError('Delete fuel record','Environmental / ESG',e);}}

// -- WATER ---------------------------------------------------------------------
function esgCalcWater(){
  var start=parseFloat(document.getElementById('waf-start')?.value)||0;
  var end=parseFloat(document.getElementById('waf-end')?.value)||0;
  var diff=end-start;
  var el=document.getElementById('waf-consumption-display');if(el)el.textContent=diff>0?diff.toFixed(3):'-';
  var qty=document.getElementById('waf-qty');if(qty&&diff>0)qty.value=diff.toFixed(3);
  var hint=document.getElementById('waf-prior-reading'),previous=Number(document.getElementById('waf-start')?.dataset.previousConsumption||0);if(hint&&previous>0&&diff>previous*2)hint.textContent='Unusual consumption: this reading is more than twice the previous recorded quantity. Check for a leak or meter-entry error.';
}

async function esgLoadWater(){
  var el=document.getElementById('esg-water-list');if(!el)return;el.innerHTML='<div class="loading-msg">Loading...</div>';
  try{
    var d=await api('/water_usage?select=*'+cf()+esgPeriodQuery('record_date')+'&order=record_date.desc');esgWaterData=d||[];
    if(!d||!d.length){el.innerHTML='<div style="text-align:center;padding:40px;color:var(--text2)">No water records.'+(isMgr()?' <button class="btn btn-primary btn-sm" data-auris-generated-onclick="g0166"><i class="ti ti-plus"></i>Add</button>':'')+'</div>';return;}
    var srcLabels={mains:'Mains',borehole:'Borehole',rainwater:'Rainwater',river:'River',recycled:'Recycled',other:'Other'};
    var h='<div class="table-scroll"><table class="data-table" style="min-width:900px"><thead><tr>'
      +'<th>Date</th><th>Source</th>'
      +'<th>Meter ID</th><th style="text-align:right">Consumption</th>'
      +'<th>Purpose</th><th>Location</th>'
      +'<th style="width:70px"></th></tr></thead><tbody>';
    d.forEach(function(x,i){
      var bg=i%2===0?'#fff':'#f9fafb';
      h+='<tr style="border-bottom:1px solid #f0f0f0;background:'+bg+'">'
        +'<td style="padding:8px 14px;font-weight:600">'+(x.record_date?new Date(x.record_date).toLocaleDateString('en-GB'):'-')+'</td>'
        +'<td style="padding:8px 10px"><span style="background:#e0f2fe;color:#0891B2;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">'+escH(srcLabels[x.source]||x.source||'-')+'</span></td>'
        +'<td style="padding:8px 10px;font-family:monospace;font-size:11px">'+escH(x.meter_id||'-')+'</td>'
        +'<td style="padding:8px 10px;text-align:right;font-weight:700;color:#0891B2">'+(parseFloat(x.quantity||0).toFixed(3))+' '+escH(x.unit||'m3')+'</td>'
        +'<td style="padding:8px 10px;font-size:11px">'+escH(x.purpose||'-')+'</td>'
        +'<td style="padding:8px 10px;font-size:11px">'+escH(x.location||'-')+'</td>'
        +'<td style="padding:8px 10px"><div style="display:flex;gap:4px">'
        +'<button class="btn btn-sm" type="button" data-esg-view="'+x.id+'" title="View record" aria-label="View record"><i class="ti ti-eye"></i></button>'+'<button class="btn btn-sm" data-id="'+x.id+'" title="Edit record" aria-label="Edit record" data-auris-generated-onclick="g0167"><i class="ti ti-edit"></i></button>'
        +(isMgr()?'<button class="btn btn-sm" style="color:var(--red)" data-id="'+x.id+'" title="Archive or delete record" aria-label="Archive or delete record" data-auris-generated-onclick="g0168"><i class="ti ti-trash"></i></button>':'')
        +'</div></td></tr>';
    });
    h+='</tbody></table></div>';el.innerHTML=h;
  }catch(e){el.innerHTML=registerErrorHtml('register',e.message);}
}

function esgWaterNew(){esgWaterEditId=null;document.getElementById('esg-water-form3title').textContent='New Water Reading';esgResetForm(['waf-meter-id','waf-start','waf-end','waf-purpose','waf-location','waf-cost','waf-notes'],['waf-date'],{'waf-source':'mains','waf-unit':'m3'});document.getElementById('waf-date').value=esgLocalDate();document.getElementById('waf-consumption-display').textContent='-';var hint=document.getElementById('waf-prior-reading');if(hint)hint.textContent='Enter a meter ID to look up its last reading.';var start=document.getElementById('waf-start');if(start)delete start.dataset.previousConsumption;esgShowForm('esg-water-form');}
async function esgWaterPrefillPrevious(){
  if(esgWaterEditId)return;var meter=document.getElementById('waf-meter-id')?.value?.trim(),start=document.getElementById('waf-start'),hint=document.getElementById('waf-prior-reading');if(!meter||!start||start.value)return;
  var company=String(ccid()),date=document.getElementById('waf-date')?.value||esgLocalDate();try{var rows=await api('/water_usage?select=record_date,meter_reading_end,quantity,unit&meter_id=eq.'+encodeURIComponent(meter)+cf()+'&record_date=lt.'+date+'&meter_reading_end=not.is.null&order=record_date.desc&limit=1');if(String(ccid())!==company||document.getElementById('waf-meter-id')?.value?.trim()!==meter||start.value)return;var previous=rows?.[0];if(previous&&Number.isFinite(Number(previous.meter_reading_end))){start.value=previous.meter_reading_end;start.dataset.previousConsumption=previous.quantity||'';var unit=document.getElementById('waf-unit');if(unit)unit.value=previous.unit||'m3';if(hint)hint.textContent='Start prefilled from '+previous.record_date+'; confirm the meter and unit before saving.';}else if(hint)hint.textContent='No previous end reading found for this meter.';}catch(error){if(hint)hint.textContent='Previous reading unavailable; enter it manually.';}
}
function esgWaterEdit(id){
  var x=esgWaterData.find(function(r){return r.id===id;});if(!x)return;esgWaterEditId=id;
  document.getElementById('esg-water-form3title').textContent='Edit Water Record';
  var flds={'waf-meter-id':'meter_id','waf-start':'meter_reading_start','waf-end':'meter_reading_end','waf-purpose':'purpose','waf-location':'location','waf-cost':'cost','waf-notes':'notes'};
  Object.entries(flds).forEach(function(e){var el=document.getElementById(e[0]);if(el)el.value=x[e[1]]||'';});
  var dt=document.getElementById('waf-date');if(dt)dt.value=x.record_date||'';
  var src=document.getElementById('waf-source');if(src)src.value=x.source||'mains';
  var un=document.getElementById('waf-unit');if(un)un.value=x.unit||'m3';
  var qty=document.getElementById('waf-qty');if(qty)qty.value=x.quantity||'';
  document.getElementById('waf-consumption-display').textContent=x.quantity?parseFloat(x.quantity).toFixed(3):'-';
  esgShowForm('esg-water-form');
}
function esgWaterBack(){document.getElementById('esg-water-form').style.display='none';document.getElementById('esg-view-water').style.display='block';document.querySelectorAll('[id^="esg-tab-"]').forEach(function(t){t.classList.remove('active');});var tab=document.getElementById('esg-tab-water');if(tab)tab.classList.add('active');esgLoadWater();}
async function esgWaterSave(){
  var qty=parseFloat(document.getElementById('waf-end')?.value||0)-parseFloat(document.getElementById('waf-start')?.value||0);
  if(qty<=0)qty=parseFloat(document.getElementById('waf-qty')?.value)||0;
  if(qty<=0){toast('Please enter meter readings or quantity',false);return;}
  var g=function(id){var el=document.getElementById(id);return el?el.value||null:null;};
  var body={company_id:ccid(),record_date:g('waf-date'),source:g('waf-source')||'mains',meter_id:g('waf-meter-id'),meter_reading_start:g('waf-start')?parseFloat(g('waf-start')):null,meter_reading_end:g('waf-end')?parseFloat(g('waf-end')):null,quantity:qty,unit:g('waf-unit')||'m3',purpose:g('waf-purpose'),location:g('waf-location'),cost:g('waf-cost')?parseFloat(g('waf-cost')):null,notes:g('waf-notes')};
  try{if(esgWaterEditId){await api('/water_usage?id=eq.'+esgWaterEditId,{m:'PATCH',p:'return=minimal',b:body});toast('Updated!');}else{if(body.meter_id&&body.record_date){var existing=await api('/water_usage?select=id,meter_reading_end&meter_id=eq.'+encodeURIComponent(body.meter_id)+'&record_date=eq.'+body.record_date+cf()+'&limit=1');if(existing?.length&&!(await appConfirmAction({title:'Possible duplicate water reading',message:'A reading for this meter and date already exists. Save another?',detail:'Compare the reading and supporting document before continuing.',confirmText:'Save another',cancelText:'Review entry'})))return;}body.created_by=prof?.id;await api('/water_usage',{m:'POST',p:'return=minimal',b:body});toast('Water record saved!');}esgWaterBack();}catch(e){toastActionError('Save water record','Environmental / ESG',e);}
}
async function esgWaterDel(id){try{var current=esgWaterData.find(x=>x.id===id)||{};if(!esgIsArchivedNote(current.notes)){if(!(await appConfirmAction({title:'Archive water record',message:'Archive this water usage record instead of deleting it?',detail:'Water readings support environmental trend history. The record will remain available for audit evidence.',confirmText:'Archive record',cancelText:'Back'})))return;await api('/water_usage?id=eq.'+id,{m:'PATCH',p:'return=minimal',b:{notes:esgArchivedNotes(current.notes)}});toast('Water record archived');esgLoadWater();return;}if(!(await appConfirmDelete('water usage record','This record is already archived. Permanent deletion should be used only for duplicate/test records.')))return;await api('/water_usage?id=eq.'+id,{m:'DELETE'});esgWaterData=esgWaterData.filter(x=>x.id!==id);toast('Deleted!');esgLoadWater();}catch(e){toastActionError('Delete water record','Environmental / ESG',e);}}

// -- SPILLS --------------------------------------------------------------------
async function esgLoadSpills(){
  var el=document.getElementById('esg-spill-list');if(!el)return;el.innerHTML='<div class="loading-msg">Loading...</div>';
  try{
    var d=await api('/spill_reports?select=*'+cf()+esgPeriodQuery('spill_date')+'&order=spill_date.desc');esgSpillData=d||[];
    if(!d||!d.length){el.innerHTML='<div style="text-align:center;padding:40px;color:var(--text2)">No spills recorded.'+(isMgr()?' <button class="btn btn-primary btn-sm" data-auris-generated-onclick="g0169"><i class="ti ti-plus"></i>Report spill</button>':'')+'</div>';return;}
    var sevCfg={minor:['#EAF3DE','#3B6D11'],moderate:['#FEF9EC','#854F0B'],major:['#FEF6E7','#C2410C'],critical:['#FCEBEB','#A32D2D']};
    var stCfg={open:['#FCEBEB','#A32D2D'],contained:['#FEF9EC','#854F0B'],remediated:['#E6F1FB','#185FA5'],closed:['#EAF3DE','#3B6D11']};
    var h='<div class="table-scroll"><table class="data-table" style="min-width:980px"><thead><tr>'
      +'<th>Ref</th><th>Date</th>'
      +'<th>Substance</th><th>Location</th>'
      +'<th style="text-align:right">Qty</th><th>Severity</th>'
      +'<th>Status</th><th style="width:70px"></th>'
      +'</tr></thead><tbody>';
    d.forEach(function(x,i){
      var bg=i%2===0?'#fff':'#f9fafb';
      var sc2=sevCfg[x.severity]||sevCfg.minor;var stc=stCfg[x.status]||stCfg.open;
      var drain=x.reached_drain_watercourse?'<span style="color:var(--red);font-weight:700;font-size:10px"> ? drain</span>':'';
      h+='<tr style="border-bottom:1px solid #f0f0f0;background:'+bg+'">'
        +'<td style="padding:8px 14px;font-family:monospace;font-weight:700;color:#0284C7">'+escH(x.ref_number||'-')+'</td>'
        +'<td style="padding:8px 10px;font-weight:600">'+(x.spill_date?new Date(x.spill_date).toLocaleDateString('en-GB'):'-')+'</td>'
        +'<td style="padding:8px 10px;font-weight:600">'+escH(x.substance||'-')+drain+'</td>'
        +'<td style="padding:8px 10px;font-size:11px">'+escH(x.location||'-')+'</td>'
        +'<td style="padding:8px 10px;text-align:right">'+(x.estimated_quantity?x.estimated_quantity+' '+escH(x.unit||'L'):'-')+'</td>'
        +'<td style="padding:8px 10px"><span style="background:'+sc2[0]+';color:'+sc2[1]+';padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;text-transform:capitalize">'+x.severity+'</span></td>'
        +'<td style="padding:8px 10px"><span style="background:'+stc[0]+';color:'+stc[1]+';padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;text-transform:capitalize">'+x.status+'</span></td>'
        +'<td style="padding:8px 10px"><div style="display:flex;gap:4px">'
        +'<button class="btn btn-sm" type="button" data-esg-view="'+x.id+'" title="View record" aria-label="View record"><i class="ti ti-eye"></i></button>'+'<button class="btn btn-sm" data-id="'+x.id+'" title="Edit record" aria-label="Edit record" data-auris-generated-onclick="g0170"><i class="ti ti-edit"></i></button>'
        +(isMgr()?'<button class="btn btn-sm" style="color:var(--red)" data-id="'+x.id+'" title="Archive or delete record" aria-label="Archive or delete record" data-auris-generated-onclick="g0171"><i class="ti ti-trash"></i></button>':'')
        +'</div></td></tr>';
    });
    h+='</tbody></table></div>';el.innerHTML=h;
  }catch(e){el.innerHTML=registerErrorHtml('register',e.message);}
}

function esgSpillNew(){
  esgSpillEditId=null;document.getElementById('esg-spill-form3title').textContent='New Spill Report';document.getElementById('esg-spill-form3ref').textContent='SPL-AUTO';
  esgResetForm(['spf-location','spf-substance','spf-qty','spf-cause','spf-immediate','spf-containment','spf-cleanup','spf-cleanup-con','spf-waste','spf-root','spf-corrective','spf-impact','spf-lessons','spf-reg-body','spf-reg-ref','spf-reporter','spf-time'],['spf-date'],{'spf-unit':'litres','spf-severity':'minor','spf-status':'open'});
  document.getElementById('spf-date').value=esgLocalDate();
  ['spf-drain','spf-soil','spf-photos','spf-regulator'].forEach(function(id){var el=document.getElementById(id);if(el)el.checked=false;});
  esgLoadSpillLinks({});
  esgShowForm('esg-spill-form');
}
function esgSpillEdit(id){
  var x=esgSpillData.find(function(r){return r.id===id;});if(!x)return;esgSpillEditId=id;
  document.getElementById('esg-spill-form3title').textContent='Edit Spill Report';
  document.getElementById('esg-spill-form3ref').textContent=x.ref_number||'-';
  var flds={'spf-location':'location','spf-substance':'substance','spf-qty':'estimated_quantity','spf-cause':'spill_cause','spf-immediate':'immediate_actions','spf-containment':'containment_method','spf-cleanup':'cleanup_method','spf-cleanup-con':'cleanup_contractor','spf-waste':'waste_generated','spf-root':'root_cause','spf-corrective':'corrective_actions','spf-impact':'environmental_impact','spf-lessons':'lessons_learned','spf-reg-body':'regulatory_body','spf-reg-ref':'regulatory_ref','spf-reporter':'reported_by','spf-time':'spill_time'};
  Object.entries(flds).forEach(function(e){var el=document.getElementById(e[0]);if(el)el.value=x[e[1]]||'';});
  var dt=document.getElementById('spf-date');if(dt)dt.value=x.spill_date||'';
  var sv=document.getElementById('spf-severity');if(sv)sv.value=x.severity||'minor';
  var st=document.getElementById('spf-status');if(st)st.value=x.status||'open';
  var un=document.getElementById('spf-unit');if(un)un.value=x.unit||'litres';
  ['spf-drain','spf-soil','spf-photos','spf-regulator'].forEach(function(id){
    var key={'spf-drain':'reached_drain_watercourse','spf-soil':'reached_soil','spf-photos':'photos_taken','spf-regulator':'regulatory_notification_required'}[id];
    var el=document.getElementById(id);if(el)el.checked=!!x[key];
  });
  esgLoadSpillLinks(x);
  esgShowForm('esg-spill-form');
}
async function esgLoadSpillLinks(saved){
  var pairs=[['spf-chemical','/chemical_register?select=id,product_name,chemical_ref'+cf()+'&order=product_name.asc&limit=500',function(x){return x.product_name||x.chemical_ref;}],['spf-waste-record','/waste_records?select=id,waste_type,record_date'+cf()+'&order=record_date.desc&limit=500',function(x){return (x.record_date||'')+' · '+(x.waste_type||'Waste');}],['spf-action','/action_tracker?select=id,action_ref,source_ref,title,description'+cf()+'&order=created_at.desc&limit=500',function(x){return x.action_ref||x.source_ref||x.title||x.description||'Action';}]];
  var company=String(ccid());await Promise.all(pairs.map(async function(pair){var el=document.getElementById(pair[0]);if(!el)return;el.replaceChildren(new Option('No linked record',''));try{var rows=await api(pair[1]);if(String(ccid())!==company)return;(rows||[]).forEach(function(row){el.add(new Option(pair[2](row),row.id));});var selected=saved[({'spf-chemical':'chemical_id','spf-waste-record':'waste_record_id','spf-action':'action_id'})[pair[0]]];if(selected){if(!Array.from(el.options).some(function(o){return o.value===selected;}))el.add(new Option('Previously linked record',selected));el.value=selected;}}catch(error){el.add(new Option('Linked records unavailable',''));}}));
}
function esgSpillBack(){document.getElementById('esg-spill-form').style.display='none';document.getElementById('esg-view-spills').style.display='block';document.querySelectorAll('[id^="esg-tab-"]').forEach(function(t){t.classList.remove('active');});var tab=document.getElementById('esg-tab-spills');if(tab)tab.classList.add('active');esgLoadSpills();}
async function esgSpillSave(){
  var substance=document.getElementById('spf-substance')?.value?.trim();
  var location=document.getElementById('spf-location')?.value?.trim();
  if(!substance||!location){toast('Please enter substance and location',false);return;}
  var g=function(id){var el=document.getElementById(id);return el?el.value||null:null;};
  var body={company_id:ccid(),spill_date:g('spf-date'),spill_time:g('spf-time'),reported_by:g('spf-reporter'),location:location,substance:substance,chemical_id:g('spf-chemical'),estimated_quantity:g('spf-qty')?parseFloat(g('spf-qty')):null,unit:g('spf-unit')||'litres',spill_cause:g('spf-cause'),reached_drain_watercourse:document.getElementById('spf-drain')?.checked||false,reached_soil:document.getElementById('spf-soil')?.checked||false,immediate_actions:g('spf-immediate'),containment_method:g('spf-containment'),cleanup_method:g('spf-cleanup'),cleanup_contractor:g('spf-cleanup-con'),waste_generated:g('spf-waste'),waste_record_id:g('spf-waste-record'),root_cause:g('spf-root'),corrective_actions:g('spf-corrective'),action_id:g('spf-action'),environmental_impact:g('spf-impact'),lessons_learned:g('spf-lessons'),regulatory_notification_required:document.getElementById('spf-regulator')?.checked||false,regulatory_body:g('spf-reg-body'),regulatory_ref:g('spf-reg-ref'),severity:g('spf-severity')||'minor',status:g('spf-status')||'open',photos_taken:document.getElementById('spf-photos')?.checked||false,updated_at:new Date().toISOString()};
  try{
    if(esgSpillEditId){await api('/spill_reports?id=eq.'+esgSpillEditId,{m:'PATCH',p:'return=minimal',b:body});toast('Updated!');}
    else{
      body.created_by=prof?.id;
      var res=await api('/spill_reports',{m:'POST',p:'return=representation',b:body});
      if(res?.[0]?.id){
        var yr=new Date().getFullYear();var ref=await nextCompanyRef('spill_reports','ref_number','SPL-'+yr+'-');
        await api('/spill_reports?id=eq.'+res[0].id,{m:'PATCH',p:'return=minimal',b:{ref_number:ref}});
        if(['major','critical'].includes(body.severity)&&!body.action_id){
          var actions=await api('/action_tracker',{m:'POST',p:'return=representation',b:{company_id:ccid(),source_module:'esg',source_id:res[0].id,source_ref:ref,description:'Spill remediation: '+substance+' at '+location+(body.corrective_actions?'\n'+body.corrective_actions:''),priority:body.severity==='critical'?'critical':'high',status:'open',created_by:prof?.id}});
          if(actions?.[0]?.id)await api('/spill_reports?id=eq.'+res[0].id,{m:'PATCH',p:'return=minimal',b:{action_id:actions[0].id}});
          toast('Spill report saved! Ref: '+ref+' - Action added to MAP.');
        }else{toast('Spill report saved! Ref: '+ref);}
      }
    }
    esgSpillBack();
  }catch(e){toastActionError('Save spill report','Environmental / ESG',e);console.error(e);}
}
async function esgSpillDel(id){try{var current=esgSpillData.find(x=>x.id===id)||{};if(current.status!=='closed'){if(!(await appConfirmAction({title:'Close spill report',message:'Close this spill report instead of deleting it?',detail:'Spill reports are environmental incident evidence. The report will stay in the register for audit history.',confirmText:'Close report',cancelText:'Back'})))return;await api('/spill_reports?id=eq.'+id,{m:'PATCH',p:'return=minimal',b:{status:'closed',updated_at:new Date().toISOString()}});toast('Spill report closed');esgLoadSpills();return;}if(!(await appConfirmDelete('spill report','This spill report is already closed. Permanent deletion should be used only for duplicate/test records.')))return;await api('/spill_reports?id=eq.'+id,{m:'DELETE'});esgSpillData=esgSpillData.filter(x=>x.id!==id);toast('Deleted!');esgLoadSpills();}catch(e){toastActionError('Delete spill report','Environmental / ESG',e);}}

// -- ENVIRONMENTAL INSPECTIONS -------------------------------------------------
function esgBuildInspChecklist(saved){
  var saved2=saved||[]; var map={};saved2.forEach(function(r){map[r.item]=r;});
  var tbody=document.getElementById('eif-checklist-body');if(!tbody)return;tbody.innerHTML='';
  ENV_CHECKLIST.forEach(function(item,i){
    var s=map[item]||{};var isOK=s.result==='ok';var isNC=s.result==='nc';var isNA=s.result==='na';
    var tr=document.createElement('tr');tr.style.borderBottom='1px solid #f0f4f0';
    tr.innerHTML='<td style="padding:8px 16px;font-size:12px">'+escH(item)+'</td>'
      +'<td style="padding:6px;text-align:center"><input type="radio" name="eic'+i+'" value="ok" id="eic-ok-'+i+'" style="accent-color:#1D9E75;width:16px;height:16px" '+(isOK?'checked':'')+'></td>'
      +'<td style="padding:6px;text-align:center"><input type="radio" name="eic'+i+'" value="nc" id="eic-nc-'+i+'" style="accent-color:#E24B4A;width:16px;height:16px" '+(isNC?'checked':'')+'></td>'
      +'<td style="padding:6px;text-align:center"><input type="radio" name="eic'+i+'" value="na" id="eic-na-'+i+'" style="width:16px;height:16px" '+(isNA?'checked':'')+'></td>'
      +'<td style="padding:5px 12px"><input type="text" id="eic-note-'+i+'" value="'+escH2(s.note||'')+'" placeholder="Observation..." style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:11px"/></td>';
    tbody.appendChild(tr);
  });
}

async function esgLoadInsp(){
  var el=document.getElementById('esg-insp-list');if(!el)return;el.innerHTML='<div class="loading-msg">Loading...</div>';
  try{
    var d=await api('/environmental_inspections?select=*'+cf()+esgPeriodQuery('inspection_date')+'&order=inspection_date.desc');esgInspData=d||[];
    if(window.AurisEsgListWorkspace){
      try{return window.AurisEsgListWorkspace.mount(el,esgInspData||[],{canEdit:isMgr(),openRecord:function(id,current){var selected=(esgInspData||[]).find(function(row){return row&&String(row.id)===String(id)&&String(row.company_id||'')===String(current.companyId);});if(!selected)throw new Error('This environmental inspection is unavailable or outside your company access.');var safe={id:selected.id,company_id:selected.company_id,inspection_date:selected.inspection_date,inspector:selected.inspector,area:selected.area,inspection_type:selected.inspection_type,findings:selected.findings,non_conformances:selected.non_conformances,overall_rating:selected.overall_rating,corrective_actions:selected.corrective_actions,next_inspection_date:selected.next_inspection_date,signed_off:selected.signed_off,notes:selected.notes};return aurisReadOnlyRecordModal('Environmental inspection details',selected.area||'Environmental inspection',safe,aurisReadableRecordFields(safe));},editRecord:function(id,current){var selected=(esgInspData||[]).find(function(row){return row&&String(row.id)===String(id)&&String(row.company_id||'')===String(current.companyId);});if(!selected)throw new Error('This environmental inspection is unavailable or outside your company access.');if(!isMgr())throw new Error('Manager access is required to edit environmental inspections.');return esgInspEdit(id);},onApplyFilters:function(){esgLoadInsp();}});}
      catch(error){el.innerHTML=registerErrorHtml('register',error.message||String(error));console.error(error);return;}
    }
    if(!d||!d.length){el.innerHTML='<div style="text-align:center;padding:40px;color:var(--text2)">No environmental inspections.'+(isMgr()?' <button class="btn btn-primary btn-sm" data-auris-generated-onclick="g0172"><i class="ti ti-plus"></i>New</button>':'')+'</div>';return;}
    var ratCfg={excellent:['#EAF3DE','#3B6D11'],good:['#E6F1FB','#185FA5'],satisfactory:['#FEF9EC','#854F0B'],poor:['#FEF6E7','#C2410C'],unacceptable:['#FCEBEB','#A32D2D'],not_assessed:['#F3F4F6','#4B5563']};
    var h='<div class="table-scroll"><table class="data-table" style="min-width:900px"><thead><tr>'
      +'<th>Date</th><th>Inspector</th>'
      +'<th>Area</th><th>Type</th>'
      +'<th style="text-align:center">NC</th><th>Rating</th>'
      +'<th style="width:70px"></th></tr></thead><tbody>';
    d.forEach(function(x,i){
      var bg=i%2===0?'#fff':'#f9fafb';var rc=ratCfg[x.overall_rating]||ratCfg.not_assessed;
      h+='<tr style="border-bottom:1px solid #f0f0f0;background:'+bg+'">'
        +'<td style="padding:8px 14px;font-weight:600">'+(x.inspection_date?new Date(x.inspection_date).toLocaleDateString('en-GB'):'-')+'</td>'
        +'<td style="padding:8px 10px">'+escH(x.inspector||'-')+'</td>'
        +'<td style="padding:8px 10px">'+escH(x.area||'-')+'</td>'
        +'<td style="padding:8px 10px;text-transform:capitalize;font-size:11px">'+escH((x.inspection_type||'routine').replace(/_/g,' '))+'</td>'
        +'<td style="padding:8px 10px;text-align:center;font-weight:700;color:'+(x.non_conformances>0?'var(--red)':'var(--green)')+'">'+( x.non_conformances||0)+'</td>'
        +'<td style="padding:8px 10px"><span style="background:'+rc[0]+';color:'+rc[1]+';padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;text-transform:capitalize">'+escH((x.overall_rating||'Not assessed').replace(/_/g,' '))+'</span></td>'
        +'<td style="padding:8px 10px"><div style="display:flex;gap:4px">'
        +'<button class="btn btn-sm" type="button" data-esg-view="'+x.id+'" title="View record" aria-label="View record"><i class="ti ti-eye"></i></button>'+'<button class="btn btn-sm" data-id="'+x.id+'" title="Edit record" aria-label="Edit record" data-auris-generated-onclick="g0173"><i class="ti ti-edit"></i></button>'
        +(isMgr()?'<button class="btn btn-sm" style="color:var(--red)" data-id="'+x.id+'" title="Archive or delete record" aria-label="Archive or delete record" data-auris-generated-onclick="g0174"><i class="ti ti-trash"></i></button>':'')
        +'</div></td></tr>';
    });
    h+='</tbody></table></div>';el.innerHTML=h;
  }catch(e){el.innerHTML=registerErrorHtml('register',e.message);}
}

function esgInspNew(){esgInspEditId=null;document.getElementById('esg-insp-form3title').textContent='New Environmental Inspection';esgResetForm(['eif-inspector','eif-area','eif-findings','eif-nc','eif-actions'],['eif-date','eif-next-date'],{'eif-type':'routine','eif-rating':''});fillPersonSelect('eif-inspector',prof?.full_name||personFullName(prof)||'');document.getElementById('eif-date').value=esgLocalDate();document.getElementById('eif-nc').value='0';esgBuildInspChecklist([]);esgShowForm('esg-insp-form');}
function esgInspEdit(id){
  var x=esgInspData.find(function(r){return r.id===id;});if(!x)return;esgInspEditId=id;
  document.getElementById('esg-insp-form3title').textContent='Edit Inspection';
  var flds={'eif-inspector':'inspector','eif-area':'area','eif-findings':'findings','eif-nc':'non_conformances','eif-actions':'corrective_actions'};
  Object.entries(flds).forEach(function(e){var el=document.getElementById(e[0]);if(el)el.value=x[e[1]]||'';});
  fillPersonSelect('eif-inspector',x.inspector||'');
  var dt=document.getElementById('eif-date');if(dt)dt.value=x.inspection_date||'';
  var nd=document.getElementById('eif-next-date');if(nd)nd.value=x.next_inspection_date||'';
  var tp=document.getElementById('eif-type');if(tp)tp.value=x.inspection_type||'routine';
  var rt=document.getElementById('eif-rating');if(rt)rt.value=x.overall_rating||'';
  esgBuildInspChecklist(x.checklist_results||[]);
  esgShowForm('esg-insp-form');
}
function esgInspBack(){document.getElementById('esg-insp-form').style.display='none';document.getElementById('esg-view-inspections').style.display='block';document.querySelectorAll('[id^="esg-tab-"]').forEach(function(t){t.classList.remove('active');});var tab=document.getElementById('esg-tab-inspections');if(tab)tab.classList.add('active');esgLoadInsp();}
async function esgInspSave(){
  var area=document.getElementById('eif-area')?.value?.trim();if(!area){toast('Please enter inspection area',false);return;}
  var g=function(id){var el=document.getElementById(id);return el?el.value||null:null;};
  var checklist=ENV_CHECKLIST.map(function(item,i){var ok=document.getElementById('eic-ok-'+i)?.checked;var nc=document.getElementById('eic-nc-'+i)?.checked;var na=document.getElementById('eic-na-'+i)?.checked;var note=document.getElementById('eic-note-'+i)?.value||'';return{item:item,result:ok?'ok':nc?'nc':na?'na':'unanswered',note:note};});
  if(g('eif-rating')&&checklist.some(function(item){return item.result==='unanswered';})){toast('Complete every checklist item, including deliberate N/A answers, before assigning an overall rating.',false);return;}
  var body={company_id:ccid(),inspection_date:g('eif-date'),inspector:g('eif-inspector'),area:area,inspection_type:g('eif-type')||'routine',checklist_results:checklist,findings:g('eif-findings'),non_conformances:parseInt(g('eif-nc'))||0,overall_rating:g('eif-rating')||null,corrective_actions:g('eif-actions'),next_inspection_date:g('eif-next-date')};
  try{
    if(esgInspEditId){await api('/environmental_inspections?id=eq.'+esgInspEditId,{m:'PATCH',p:'return=minimal',b:body});toast('Updated!');}
    else{
      body.created_by=prof?.id;
      var res=await api('/environmental_inspections',{m:'POST',p:'return=representation',b:body});
      var weak=body.non_conformances>0||['poor','unacceptable'].includes(body.overall_rating)||(body.corrective_actions&&body.corrective_actions.trim());
      var added=false;
      if(weak&&res?.[0]?.id){
        var ncItems=checklist.filter(function(c){return c.result==='nc';}).map(function(c){return c.item+(c.note?' - '+c.note:'');}).slice(0,5).join('; ');
        try{
          await api('/action_tracker',{m:'POST',p:'return=minimal',b:{
            company_id:ccid(),
            source_module:'esg',
            source_id:res[0].id,
            source_ref:'Environmental inspection - '+area,
            description:body.corrective_actions||ncItems||('Environmental inspection rated '+body.overall_rating),
            responsible:body.inspector||null,
            target_date:body.next_inspection_date||null,
            priority:body.overall_rating==='unacceptable'?'high':'medium',
            status:'open',
            created_by:prof?.id
          }});
          added=true;
        }catch(ex){console.warn('Environmental inspection MAP action failed',ex);}
      }
      toast('Inspection saved!'+(added?' Action added to MAP.':''));
    }
    esgInspBack();
  }catch(e){toastActionError('Save environmental inspection','Environmental / ESG',e);console.error(e);}
}
async function esgInspDel(id){try{var current=esgInspData.find(x=>x.id===id)||{};if(!esgIsArchivedNote(current.findings)){if(!(await appConfirmAction({title:'Archive environmental inspection',message:'Archive this environmental inspection instead of deleting it?',detail:'Inspection records support compliance evidence and trend review. The record will remain available for audit history.',confirmText:'Archive inspection',cancelText:'Back'})))return;await api('/environmental_inspections?id=eq.'+id,{m:'PATCH',p:'return=minimal',b:{findings:esgArchivedNotes(current.findings)}});toast('Environmental inspection archived');esgLoadInsp();return;}if(!(await appConfirmDelete('environmental inspection','This inspection is already archived. Permanent deletion should be used only for duplicate/test records.')))return;await api('/environmental_inspections?id=eq.'+id,{m:'DELETE'});esgInspData=esgInspData.filter(x=>x.id!==id);toast('Deleted!');esgLoadInsp();}catch(e){toastActionError('Delete environmental inspection','Environmental / ESG',e);}}

