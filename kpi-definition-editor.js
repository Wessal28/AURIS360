/* Objectives & KPIs: definition editor (classic-script compatibility boundary).
 * Loaded once, after auris-core.js and before KPI configuration/draft/workflow hooks.
 * Owns objective create/edit, indicator rows and KPI definition saves.
 * Dependencies remain explicit legacy globals: identity/RBAC/API, KPI caches,
 * people selectors, modal helpers, rendering and monthly YTD recalculation.
 * Loading this file performs no DOM access, requests, subscriptions or writes.
 * Keep public handler names stable until their CSP dispatchers and hooks migrate.
 * Archive workflows and monthly reporting remain in auris-core.js.
 */

var kpiEditObjId = null;  // tracks which objective is being edited (null = creating new)

// Shared by the two definition forms, including dynamically added indicators.
// Listeners stay on their dialog; they do not capture unrelated page shortcuts.
function kpiEditorFocusAvailable(node){
  if(!node||!node.isConnected||node.disabled||node.matches?.(':disabled')||!node.getClientRects().length)return false;
  if(node.closest?.('[hidden],[inert],[aria-hidden="true"]'))return false;
  return typeof getComputedStyle!=='function'||!['hidden','collapse'].includes(getComputedStyle(node).visibility);
}
function kpiEditorContainTab(event,modal,title){
  if(event.key!=='Tab'||event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||!modal.getClientRects().length)return;
  const focused=document.activeElement,inner=focused?.closest?.('[role="dialog"]');
  if(inner&&inner!==modal&&modal.contains(inner))return; // A nested dialog owns its keyboard.
  const controls=Array.from(modal.querySelectorAll('button,input,select,textarea,a[href],[tabindex]'))
    .filter(node=>node.tabIndex>=0&&kpiEditorFocusAvailable(node))
    .sort((a,b)=>(a.tabIndex||Infinity)-(b.tabIndex||Infinity));
  const index=controls.indexOf(focused);
  if(!controls.length||index===-1||(event.shiftKey?index===0:index===controls.length-1)){
    event.preventDefault();
    (controls.length?controls[event.shiftKey?controls.length-1:0]:title)?.focus();
  }
}
function kpiEditorBindDialog(modal,title){
  if(modal._kpiEditorFocusBound)return;
  modal._kpiEditorFocusBound=true;
  modal.addEventListener('keydown',event=>kpiEditorContainTab(event,modal,title));
}
function kpiEditorRestoreFocus(modal,launcher){
  // A drawer may have removed the launch button, or a save may rerender its row.
  // Use a visible module control, never body or a hidden/disconnected element.
  const fallback=modal.id==='obj-modal'?'kpi-x-new-objective':'kpi-x-new-kpi';
  const target=[launcher,document.getElementById(fallback),document.getElementById('year-sel')]
    .find(node=>node&&node!==document.body&&node!==document.documentElement&&typeof node.focus==='function'&&kpiEditorFocusAvailable(node));
  target?.focus();
}
async function kpiEditorConfirmArchive(modal,options){
  const overlay=document.getElementById('app-confirm3modal'),dialog=overlay?.querySelector('[role="dialog"]'),title=document.getElementById('app-confirm3title');
  const onKey=event=>{if(modal.getClientRects().length)kpiEditorContainTab(event,dialog,title);};
  // Scope this temporary guard to this editor's archive confirmation only.
  dialog?.addEventListener('keydown',onKey);
  try{return await appConfirmAction(options);}
  finally{dialog?.removeEventListener('keydown',onKey);}
}
function openObjModal(objId) {
  var m = document.getElementById('obj-modal');
  if (!m) return false;
  if(m._kpiObjectiveBusy)return false;
  if(m.style.display==='flex'){kpiObjectiveFeedback('An objective form is already open. Save it or close it before opening another objective.');return false;}
  if(!kpiCanEdit()||!kpiObjectiveCompany()||!prof?.id){toast('Select a company with authorised objective-management access.',false);return false;}
  if(objId&&!kpiObjectives.some(obj=>obj.id===objId&&obj.company_id===kpiObjectiveCompany())){toast('Objective not found for the selected company.',false);return false;}
  (m._kpiObjectiveControls||[]).forEach(item=>{item.node.disabled=item.disabled;});
  m._kpiObjectiveControls=null;m._kpiObjectiveSaved=false;m._kpiObjectiveUncertain=false;
  m.querySelector('[data-kpi-objective-message]')?.remove();
  m._kpiObjectiveReturnFocus=document.activeElement;

  // Common: get form references
  var nameEl  = document.getElementById('obj-name');
  var codeEl  = document.getElementById('obj-code');
  var yearEl  = document.getElementById('obj-year');
  var titleEl = document.getElementById('obj-modal-title');
  var delBtn  = document.getElementById('obj-delete-btn');

  if (objId && typeof kpiObjectives !== 'undefined') {
    // -- EDIT MODE -------------------------------------------------
    var obj = kpiObjectives.find(function(o){ return o.id === objId; });
    if (!obj) {
      toast('Objective not found', false);
      return;
    }

    // Pre-fill form fields with existing values
    if (nameEl) nameEl.value = obj.name || '';
    if (codeEl) codeEl.value = obj.code || '';
    if (yearEl) yearEl.value = obj.year || new Date().getFullYear();

    // Set selected colour and highlight the matching dot
    if (typeof kpiSelectedColor !== 'undefined') {
      kpiSelectedColor = obj.color || '#1D9E75';
    }

    // Set edit mode markers
    m.dataset.editId = objId;
    if (typeof kpiEditObjId !== 'undefined' || true) { kpiEditObjId = objId; }
    if (titleEl) titleEl.textContent = 'Edit objective';
    if (delBtn) delBtn.style.display = 'inline-flex';  // override the hidden-by-default archive class
  } else {
    // -- CREATE MODE -----------------------------------------------
    // Clear all fields
    if (nameEl) nameEl.value = '';
    if (codeEl) codeEl.value = '';
    if (yearEl) yearEl.value = String(new Date().getFullYear());

    // Reset selected colour to default green and highlight that dot
    if (typeof kpiSelectedColor !== 'undefined') {
      kpiSelectedColor = '#1D9E75';
    }

    // Clear edit mode markers
    delete m.dataset.editId;
    kpiEditObjId = null;
    if (titleEl) titleEl.textContent = 'Add objective';
    if (delBtn) delBtn.style.display = 'none';
  }

  kpiRenderObjectiveColour();
  // Show the modal
  m._kpiObjectiveContext={companyId:kpiObjectiveCompany(),actorId:prof.id,viewYear:kpiObjectiveViewYear(),editId:kpiEditObjId||null};
  m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');m.setAttribute('aria-labelledby','obj-modal-title');
  ['obj-code','obj-year','obj-name'].forEach(id=>document.getElementById(id)?.parentElement.querySelector('label')?.setAttribute('for',id));
  m.querySelector('[data-auris-onclick="h0129"]').setAttribute('aria-label','Close objective');
  titleEl.setAttribute('tabindex','-1');
  m.style.display = 'flex';
  kpiEditorBindDialog(m,titleEl);
  titleEl.focus();return true;
}

function kpiObjectiveCompany(){return typeof ccid==='function'?ccid():((isSA()&&typeof sephsCompanyContext!=='undefined'&&sephsCompanyContext)?sephsCompanyContext:prof?.company_id);}
function kpiObjectiveViewYear(){return Number(document.getElementById('year-sel')?.value)||new Date().getFullYear();}
function kpiObjectiveFeedback(message){
  const modal=document.getElementById('obj-modal');if(!modal)return;
  let alert=modal.querySelector('[data-kpi-objective-message]');
  if(!alert){alert=document.createElement('div');alert.setAttribute('data-kpi-objective-message','');alert.setAttribute('role','alert');alert.setAttribute('tabindex','-1');alert.className='kpi-objective-message';modal.querySelector('.auris-kpilegacy-s-0e271dda2d').prepend(alert);}
  alert.textContent=message;alert.focus();
}
function kpiObjectiveCheckContext(context){
  const modal=document.getElementById('obj-modal');
  if(!context||!context.companyId||!context.actorId||context!==modal?._kpiObjectiveContext||modal.style.display==='none'||context.companyId!==kpiObjectiveCompany()||context.actorId!==prof?.id||context.viewYear!==kpiObjectiveViewYear()||context.editId!==(kpiEditObjId||null))throw new Error('The company, account or reporting year changed. Close this form and reload the intended company before continuing.');
  if(!kpiCanEdit())throw new Error('Only authorised managers can save objectives.');
  if(context.editId&&!modal._kpiObjectiveSaved&&!kpiObjectives.some(obj=>obj.id===context.editId&&obj.company_id===context.companyId))throw new Error('The objective is no longer available for this company. Close and reload before editing it.');
}
function kpiObjectiveMatches(row,payload,id){
  return !!row&&!!row.id&&(!id||row.id===id)&&row.company_id===payload.company_id&&Number(row.year)===payload.year&&row.name===payload.name&&String(row.code)===payload.code&&row.color===payload.color;
}
async function kpiSaveObjective() {
  const modal=document.getElementById('obj-modal'),context=modal?._kpiObjectiveContext;
  if(!modal||modal.style.display==='none'||modal._kpiObjectiveBusy)return {saved:false,complete:false};
  if(modal._kpiObjectiveSaved||modal._kpiObjectiveUncertain){kpiObjectiveFeedback(modal.querySelector('[data-kpi-objective-message]')?.textContent||(modal._kpiObjectiveSaved?'This objective is already saved. Close and reload before editing it.':'This save needs checking. Close and reload the objective before trying again.'));return {saved:!!modal._kpiObjectiveSaved,complete:false};}
  let saved=false,writeStarted=false,controls=null;
  try{
    kpiObjectiveCheckContext(context);
    const name=document.getElementById('obj-name').value.trim(),year=Number(document.getElementById('obj-year').value);
    if(!name)throw new Error('Please enter an objective name.');
    if(!Number.isInteger(year)||year<1900||year>9999)throw new Error('Choose a valid reporting year.');
    let code=document.getElementById('obj-code').value.trim();
    const payload={company_id:context.companyId,name,code,year,color:kpiSelectedColor||'#1D9E75'};
    const scope='&company_id=eq.'+encodeURIComponent(context.companyId);
    modal.querySelector('[data-kpi-objective-message]')?.remove();
    controls=Array.from(modal.querySelectorAll('input,select,textarea,button')).map(node=>({node,disabled:node.disabled}));
    modal._kpiObjectiveControls=controls;modal._kpiObjectiveBusy=true;
    controls.forEach(item=>{item.node.disabled=true;});document.getElementById('obj-modal-title').focus();
    if(!code){
      const existing=await api('/objectives?select=code&year=eq.'+year+scope);
      kpiObjectiveCheckContext(context);
      if(!Array.isArray(existing))throw new Error('Objective codes could not be loaded. Reload before saving.');
      let maxCode=0;existing.forEach(obj=>{const n=parseInt(obj.code,10);if(Number.isFinite(n)&&n>maxCode)maxCode=n;});
      code=String(maxCode+1);payload.code=code;
    }
    kpiObjectiveCheckContext(context);
    if(!context.editId)payload.created_by=context.actorId;
    writeStarted=true;
    const result=await api(context.editId?'/objectives?id=eq.'+encodeURIComponent(context.editId)+scope:'/objectives',{m:context.editId?'PATCH':'POST',p:'return=representation',b:payload});
    const rows=Array.isArray(result)?result:result?[result]:[];
    if(rows.length!==1||!kpiObjectiveMatches(rows[0],payload,context.editId)){
      modal._kpiObjectiveUncertain=true;
      throw new Error('The server did not return the matching objective. Close and reload to check whether it was saved.');
    }
    saved=true;modal._kpiObjectiveSaved=true;
    kpiObjectiveCheckContext(context);
    const savedId=rows[0].id,verified=await api('/objectives?select=*&id=eq.'+encodeURIComponent(savedId)+scope);
    kpiObjectiveCheckContext(context);
    if(!Array.isArray(verified)||verified.length!==1||!kpiObjectiveMatches(verified[0],payload,savedId))throw new Error('The saved objective could not be verified in the refreshed data.');
    const objectives=await api('/objectives?select=*'+scope+'&year=eq.'+context.viewYear+'&order=sort_order,code');
    kpiObjectiveCheckContext(context);
    if(!Array.isArray(objectives)||objectives.some(obj=>obj.company_id!==context.companyId||Number(obj.year)!==context.viewYear)||(year===context.viewYear&&!objectives.some(obj=>kpiObjectiveMatches(obj,payload,savedId))))throw new Error('The objective list could not be refreshed for the selected company and year.');
    kpiObjectives=objectives.filter(obj=>!/^\[Archived/i.test(String(obj.name||'')));
    kpiRenderOverview();kpiRenderMonthly();kpiUpdateMetrics();
    kpiObjectiveCheckContext(context);
    toast((context.editId?'Objective updated':'Objective saved')+(year!==context.viewYear?' for '+year:''));
    modal._kpiObjectiveBusy=false;closeKpiModal('obj-modal');
    return {saved:true,complete:true};
  }catch(error){
    kpiObjectiveFeedback((saved?'Objective saved, but verification or refresh could not finish. Close this form and reload; do not create it again. ':writeStarted?'Save could not be confirmed. Check existing objectives before retrying. ':'')+String(error?.message||error));
    return {saved,complete:false};
  }finally{
    if(controls){modal._kpiObjectiveBusy=false;controls.forEach(item=>{item.node.disabled=(modal._kpiObjectiveSaved||modal._kpiObjectiveUncertain)&&!item.node.matches('[data-auris-onclick="h0129"]')?true:item.disabled;});if(!modal._kpiObjectiveSaved&&!modal._kpiObjectiveUncertain)modal._kpiObjectiveControls=null;}
  }
}

function kpiRenderObjectiveColour(){
  const picker=document.getElementById('kpi-color-picker');if(!picker)return;
  let name='';
  picker.querySelectorAll('[data-objective-color]').forEach(button=>{
    const selected=button.getAttribute('data-objective-color').toLowerCase()===String(kpiSelectedColor||'').toLowerCase();
    button.setAttribute('aria-pressed',String(selected));
    if(selected)name=button.getAttribute('aria-label');
  });
  const status=document.getElementById('kpi-color-selection');
  if(status)status.textContent=name?'Selected colour: '+name:'Saved colour is not in this palette. Choose a colour to replace it.';
}
function kpiSelectColor(color,el){
  const modal=document.getElementById('obj-modal');
  if(!modal||modal.style.display==='none'||modal._kpiObjectiveBusy||modal._kpiObjectiveSaved||modal._kpiObjectiveUncertain)return false;
  const picker=document.getElementById('kpi-color-picker');
  const button=Array.from(picker?.querySelectorAll('[data-objective-color]')||[]).find(node=>node.getAttribute('data-objective-color').toLowerCase()===String(color).toLowerCase());
  if(!button||button.disabled||(el&&el!==button))return false;
  kpiSelectedColor=button.getAttribute('data-objective-color');
  kpiRenderObjectiveColour();return true;
}

function kpiAddIndicatorRow(name='',target='',operator='gte',unit='',ytdMethod='sum',indicatorId=''){
const modal=document.getElementById('kpi-edit-modal');if(modal?._kpiDefinitionBusy||modal?._kpiDefinitionWritten)return false;
const list=document.getElementById('kpi-indicators-list');
const row=document.createElement('div');
row.style.cssText='display:grid;grid-template-columns:1fr 80px 120px 100px auto;gap:6px;align-items:center;background:#f9fafb;padding:8px 10px;border-radius:8px;border:1px solid var(--border)';
row.style.cssText='background:#f9fafb;padding:10px 12px;border-radius:8px;border:1px solid var(--border);position:relative';
row.innerHTML=
'<p class="kpi-indicator-heading" data-indicator-heading></p><div style="margin-bottom:8px">'
+'<input type="text" class="ind-name-input" aria-label="Measurement indicator name" placeholder="Measurement indicator name (e.g. Number of near misses reported per month)" style="font-size:13px;padding:8px 10px;width:100%;border:1px solid var(--border);border-radius:8px;box-sizing:border-box"/>'
+'</div>'
+'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
+'<label style="font-size:11px;color:var(--text2);font-weight:500">Target:</label>'
+'<input type="number" class="ind-target-input" aria-label="Indicator target" placeholder="e.g. 4" step="any" style="font-size:12px;padding:6px 8px;width:90px;border:1px solid var(--border);border-radius:8px;text-align:center"/>'
+'<select class="ind-op-input" style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:8px">'
+'<option value="gte" '+(operator==="gte"?"selected":"")+'>&#8805; min</option>'
+'<option value="eq" '+(operator==="eq"?"selected":"")+'>= exact</option>'
+'<option value="lte" '+(operator==="lte"?"selected":"")+'>&#8804; max</option>'
+'<option value="gt" '+(operator==="gt"?"selected":"")+'>></option>'
+'<option value="lt" '+(operator==="lt"?"selected":"")+'>< </option>'
+'<option value="zero" '+(operator==="zero"?"selected":"")+'>= 0 · zero tolerance</option>'
+'<option value="trend_up" '+(operator==="trend_up"?"selected":"")+'>↑ improving trend</option>'
+'<option value="trend_down" '+(operator==="trend_down"?"selected":"")+'>↓ reducing trend</option>'
+'</select>'
+'<label style="font-size:11px;color:var(--text2);font-weight:500">Unit:</label>'
+'<select class="ind-unit-input" style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:8px">'
+'<option value="" '+(unit===""?"selected":"")+'>Number</option>'
+'<option value="%" '+(unit==="%"?"selected":"")+'>%</option>'
+'<option value="decimal" '+(unit==="decimal"?"selected":"")+'>Decimal</option>'
+'<option value="kg" '+(unit==="kg"?"selected":"")+'>kg</option>'
+'<option value="L" '+(unit==="L"?"selected":"")+'>Litres</option>'
+'<option value="m3" '+(unit==="m3"?"selected":"")+'>m3</option>'
+'<option value="hrs" '+(unit==="hrs"?"selected":"")+'>Hours</option>'
+'<option value="days" '+(unit==="days"?"selected":"")+'>Days</option>'
+'<option value="MWh" '+(unit==="MWh"?"selected":"")+'>MWh</option>'
+'<option value="score" '+(unit==="score"?"selected":"")+'>Score</option>'
+'<option value="ratio" '+(unit==="ratio"?"selected":"")+'>Ratio</option>'
+'</select>'
+'<label style="font-size:11px;color:var(--text2);font-weight:500">YTD:</label>'
+'<select class="ind-ytd-input" style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:8px">'
+'<option value="sum" '+(ytdMethod==="sum"?"selected":"")+'>Sum</option>'
+'<option value="average" '+(ytdMethod==="average"?"selected":"")+'>Average</option>'
+'<option value="last" '+(ytdMethod==="last"?"selected":"")+'>Last value</option>'
+'<option value="max" '+(ytdMethod==="max"?"selected":"")+'>Max</option>'
+'<option value="min" '+(ytdMethod==="min"?"selected":"")+'>Min</option>'
+'</select>'
+'<button type="button" data-auris-generated-onclick="g0062" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:20px;margin-left:auto;padding:2px 6px"><i class="ti ti-trash"></i></button>'
+'</div>';
row.setAttribute('data-ind-row','1');
row.setAttribute('data-indicator-id',indicatorId||'');
row.querySelector('.ind-name-input').value=name;
row.querySelector('.ind-target-input').value=target;
const unitSelect=row.querySelector('.ind-unit-input');
if(unit&&unitSelect.options&&!Array.from(unitSelect.options).some(option=>option.value===unit)){const option=document.createElement('option');option.value=unit;option.textContent=unit;unitSelect.appendChild(option);unitSelect.value=unit;}
[['.ind-op-input','Target operator'],['.ind-unit-input','Indicator unit'],['.ind-ytd-input','YTD calculation'],['button','Remove indicator']].forEach(([selector,label])=>row.querySelector(selector)?.setAttribute?.('aria-label',label));
list.appendChild(row);
kpiLabelIndicatorRows(list);
const status=document.getElementById('kpi-indicator-status');if(status)status.textContent='';
return row;
}
function kpiLabelIndicatorRows(list){
  Array.from(list.children).forEach((row,index)=>{
    const number=index+1;
    row.setAttribute('role','group');row.setAttribute('aria-label','Measurement indicator '+number);
    const heading=row.querySelector('[data-indicator-heading]');if(heading)heading.textContent='Indicator '+number;
    [['.ind-name-input','Measurement indicator name'],['.ind-target-input','Indicator target'],['.ind-op-input','Target operator'],['.ind-unit-input','Indicator unit'],['.ind-ytd-input','YTD calculation'],['button','Remove indicator']]
      .forEach(([selector,label])=>row.querySelector(selector)?.setAttribute('aria-label',label+' '+number));
  });
}
function kpiIndicatorActionContext(button){
  const modal=document.getElementById('kpi-edit-modal');
  if(!modal||modal.style.display==='none'||!modal.getClientRects().length||modal._kpiDefinitionBusy||modal._kpiDefinitionWritten||!modal.contains(button)||!kpiEditorFocusAvailable(button))return null;
  try{kpiDefinitionCheckContext(modal._kpiDefinitionContext);return modal;}
  catch(error){kpiDefinitionFeedback(String(error?.message||error));return null;}
}
function kpiIndicatorAnnouncement(list,message){
  let status=document.getElementById('kpi-indicator-status');
  if(!status){status=document.createElement('p');status.id='kpi-indicator-status';status.className='kpi-indicator-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');list.insertAdjacentElement('afterend',status);}
  status.textContent=message;
  if(typeof kpiXCaptureEditorDraft==='function')kpiXCaptureEditorDraft();
}
function kpiAddIndicatorFromButton(button){
  if(button?.getAttribute('data-auris-onclick')!=='h0140'||!kpiIndicatorActionContext(button))return false;
  const list=document.getElementById('kpi-indicators-list'),row=kpiAddIndicatorRow();
  if(!row)return false;
  row.querySelector('.ind-name-input')?.focus();
  kpiIndicatorAnnouncement(list,'Indicator '+list.children.length+' added to this draft. Enter its name and target.');return true;
}
function kpiRemoveIndicatorRow(button){
  if(button?.getAttribute('data-auris-generated-onclick')!=='g0062')return false;
  const modal=kpiIndicatorActionContext(button),list=document.getElementById('kpi-indicators-list'),row=button.closest('[data-ind-row]');
  if(!modal||!list||row?.parentElement!==list||row.querySelector('button')!==button)return false;
  const rows=Array.from(list.children),index=rows.indexOf(row);
  row.remove();kpiLabelIndicatorRows(list);
  const remaining=Array.from(list.children),next=remaining[index]||remaining[index-1];
  const target=[next?.querySelector('.ind-name-input'),modal.querySelector('[data-auris-onclick="h0140"]'),document.getElementById('kpi-modal-title')].find(kpiEditorFocusAvailable);
  target?.focus();
  kpiIndicatorAnnouncement(list,'Indicator '+(index+1)+' removed from this draft. Changes are checked when you save.');return true;
}
function openKpiAddModal(kpiId=null,objId=null){
const modal=document.getElementById('kpi-edit-modal');
if(!modal||modal._kpiDefinitionBusy||modal.style.display==='flex')return false;
const companyId=kpiObjectiveCompany(),actorId=prof?.id;
if(!isMgr()||!companyId||!actorId){toast('Select a company with permission to manage KPIs.',false);return false;}
const selected=kpiId?kpiKPIs.find(k=>k.id===kpiId):null;
if(kpiId&&(!selected||(selected.company_id&&selected.company_id!==companyId)||(window.KpiGovernedWorkflow&&!KpiGovernedWorkflow.canEdit(selected)))){toast('This KPI definition is unavailable for editing. Check its workflow state.',false);return false;}
modal._kpiDefinitionControls?.forEach(item=>{item.node.disabled=item.disabled;});
modal._kpiDefinitionWritten=false;modal._kpiDefinitionControls=null;
modal.querySelector('[data-kpi-definition-message]')?.remove();
modal._kpiDefinitionContext={companyId,actorId,year:kpiObjectiveViewYear(),kpiId};
modal._kpiDefinitionReturnFocus=document.activeElement;
modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','kpi-modal-title');
document.getElementById('kpi-modal-title').setAttribute('tabindex','-1');
modal.querySelector('[data-auris-onclick="h0139"]')?.setAttribute('aria-label','Close KPI editor');
['kpi-code','kpi-obj-sel','kpi-name','kpi-freq','kpi-resp','kpi-status'].forEach(id=>document.getElementById(id)?.parentElement?.querySelector('label')?.setAttribute('for',id));
fillPplDrops();
kpiEditKpiId=kpiId;
document.getElementById('kpi-modal-title').textContent=kpiId?'Edit KPI':'Add KPI';
document.getElementById('kpi-delete-btn').style.display=kpiId?'flex':'none';
const sel=document.getElementById('kpi-obj-sel');
sel.innerHTML='<option value="">Select objective...</option>';kpiObjectives.forEach(o=>{const option=document.createElement('option');option.value=o.id;option.textContent=o.code+'. '+o.name;sel.appendChild(option);});
document.getElementById('kpi-indicators-list').innerHTML='';
const indicatorStatus=document.getElementById('kpi-indicator-status');if(indicatorStatus)indicatorStatus.textContent='';
if(kpiId){
const k=kpiKPIs.find(x=>x.id===kpiId);
if(k){
document.getElementById('kpi-code').value=k.code||'';
document.getElementById('kpi-name').value=k.name||'';
document.getElementById('kpi-freq').value=k.frequency||'monthly';
document.getElementById('kpi-resp').value=k.responsible||'';
document.getElementById('kpi-status').value=k.status||'not_started';
document.getElementById('kpi-description').value=k.description||'';
setSelectValueWithFallback('kpi-data-provider',k.data_provider||'');
document.getElementById('kpi-data-source').value=k.data_source||'';
setSelectValueWithFallback('kpi-reviewer',k.reviewer||'');
setSelectValueWithFallback('kpi-approver',k.approver||'');
document.getElementById('kpi-approval-status').value=k.approval_status||'draft';
sel.value=k.objective_id||objId||'';
const inds=kpiIndicators.filter(i=>i.kpi_id===kpiId);
if(inds.length){inds.forEach(i=>kpiAddIndicatorRow(i.name,i.target_value!==null?i.target_value:'',i.target_operator||'gte',i.unit||'',i.ytd_method||'sum',i.id));}else{kpiAddIndicatorRow();}
}
}else{
['kpi-name','kpi-resp','kpi-description','kpi-data-provider','kpi-data-source','kpi-reviewer','kpi-approver'].forEach(id=>document.getElementById(id).value='');
const publishedWorkflow=(window.kpiConfigPublished&&window.kpiConfigPublished.workflow)||{};
const publishedSources=(window.kpiConfigPublished&&window.kpiConfigPublished.sources)||{};
setSelectValueWithFallback('kpi-resp',publishedWorkflow.stage1||'');
setSelectValueWithFallback('kpi-data-provider',publishedWorkflow.stage1||'');
setSelectValueWithFallback('kpi-reviewer',publishedWorkflow.stage2||'');
setSelectValueWithFallback('kpi-approver',publishedWorkflow.stage3||'');
if(publishedSources.default_source==='manual')document.getElementById('kpi-data-source').value='Manual';
else if(publishedSources.default_source==='module')document.getElementById('kpi-data-source').value='AURIS module';
else if(publishedSources.default_source==='integration')document.getElementById('kpi-data-source').value='Evidence / document';
document.getElementById('kpi-freq').value='monthly';
document.getElementById('kpi-status').value='not_started';
document.getElementById('kpi-approval-status').value='draft';
if(objId){
sel.value=objId;
const obj=kpiObjectives.find(o=>o.id===objId);
if(obj){const existingKPIs=kpiKPIs.filter(k=>k.objective_id===objId);document.getElementById('kpi-code').value=(obj.code||'?')+'.'+(existingKPIs.length+1);}
}else{document.getElementById('kpi-code').value='';}
kpiAddIndicatorRow();
}
sel.onchange=function(){
if(!kpiId&&this.value){
const obj=kpiObjectives.find(o=>o.id===this.value);
if(obj){const ex=kpiKPIs.filter(k=>k.objective_id===this.value);document.getElementById('kpi-code').value=(obj.code||'?')+'.'+(ex.length+1);}
}
};
openKpiModal('kpi-edit-modal');
kpiEditorBindDialog(modal,document.getElementById('kpi-modal-title'));
document.getElementById('kpi-modal-title').focus();
}
function kpiStorageStatus(value){
return ['not_started','on_track','at_risk','off_track','archived'].includes(String(value||''))?String(value):'not_started';
}
function kpiDefinitionFeedback(message,restoreIndicator){
const modal=document.getElementById('kpi-edit-modal');if(!modal)return;
let alert=modal.querySelector('[data-kpi-definition-message]');
if(!alert){alert=document.createElement('div');alert.setAttribute('data-kpi-definition-message','true');alert.className='kpi-x-definition-message';alert.setAttribute('role','alert');alert.setAttribute('tabindex','-1');modal.querySelector(':scope > div').prepend(alert);}
alert.textContent=String(message);
if(restoreIndicator){
 const context=modal._kpiDefinitionContext,button=document.createElement('button');button.type='button';button.className='btn';button.textContent='Restore indicator';
 button.onclick=function(){try{kpiDefinitionCheckContext(context);if(!Array.from(document.getElementById('kpi-indicators-list').children).some(row=>row.getAttribute('data-indicator-id')===restoreIndicator.id)){kpiAddIndicatorRow(restoreIndicator.name,restoreIndicator.target_value??'',restoreIndicator.target_operator||'gte',restoreIndicator.unit||'',restoreIndicator.ytd_method||'sum',restoreIndicator.id);}alert.remove();if(typeof kpiXCaptureEditorDraft==='function')kpiXCaptureEditorDraft();document.getElementById('kpi-indicators-list').lastElementChild?.querySelector('.ind-name-input')?.focus();}catch(error){kpiDefinitionFeedback(String(error?.message||error));}};
 alert.appendChild(button);
}
alert.focus();
}
function kpiDefinitionCheckContext(context){
const modal=document.getElementById('kpi-edit-modal');
if(!context||modal?.style.display==='none'||modal?._kpiDefinitionContext!==context||kpiObjectiveCompany()!==context.companyId||prof?.id!==context.actorId||kpiObjectiveViewYear()!==context.year||kpiEditKpiId!==context.kpiId)throw new Error('The company, account or KPI changed. Close and reopen the intended KPI before saving.');
if(!isMgr())throw new Error('Your permission to edit KPIs has changed.');
const k=context.kpiId?kpiKPIs.find(item=>item.id===context.kpiId):null;
if(context.kpiId&&(!k||(k.company_id&&k.company_id!==context.companyId)))throw new Error('The original KPI is no longer available. Close and reload.');
if(k&&window.KpiGovernedWorkflow&&!KpiGovernedWorkflow.canEdit(k))throw new Error('This KPI definition cannot be edited in its current workflow state.');
}
function kpiDefinitionRowsMatch(rows,expected){
return Array.isArray(rows)&&rows.length===1&&!!rows[0].id&&Object.keys(expected).every(key=>key==='target_value'&&expected[key]!==null&&rows[0][key]!==null?Number(rows[0][key])===Number(expected[key]):(rows[0][key]??null)===(expected[key]??null));
}
async function kpiSaveKPI(){
const modal=document.getElementById('kpi-edit-modal'),context=modal?._kpiDefinitionContext;
if(!modal||modal.style.display==='none'||modal._kpiDefinitionBusy)return {complete:false};
if(modal._kpiDefinitionWritten)return {complete:false};
let controls=null,writeStarted=false,parentSaved=false;
try{
 kpiDefinitionCheckContext(context);
 if(['kpi-resp','kpi-data-provider','kpi-reviewer','kpi-approver'].some(id=>document.getElementById(id)?.getAttribute('aria-busy')==='true'))throw new Error('The people list is still loading. Wait for it to finish, then save again.');
 const field=id=>document.getElementById(id).value.trim();
 const name=field('kpi-name'),objId=field('kpi-obj-sel');
 if(!name)throw new Error('Please enter a KPI name.');
 if(!objId||!kpiObjectives.some(o=>o.id===objId&&(!o.company_id||o.company_id===context.companyId)&&(!o.year||Number(o.year)===context.year)))throw new Error('Please select an objective for this company and reporting year.');
 const indicators=Array.from(document.getElementById('kpi-indicators-list').children).map((row,index)=>{
  const value=selector=>row.querySelector(selector)?.value||'',indicatorId=row.getAttribute('data-indicator-id')||'';
  if(!value('.ind-name-input').trim())throw new Error('Enter a name for every measurement indicator, or remove an unused new row.');
  const target=value('.ind-target-input');
  if(target!==''&&!Number.isFinite(Number(target)))throw new Error('Enter a valid indicator target.');
  return {indicatorId,row,body:{name:value('.ind-name-input').trim(),target_value:target===''?null:Number(target),target_operator:value('.ind-op-input')||'gte',unit:value('.ind-unit-input')||null,ytd_method:value('.ind-ytd-input')||'sum',sort_order:index}};
 });
 if(!indicators.length)throw new Error('Please add at least one measurement indicator.');
 const ids=indicators.map(i=>i.indicatorId).filter(Boolean);
 if(new Set(ids).size!==ids.length)throw new Error('Duplicate indicator identity. Close and reopen the KPI to recover its original rows.');
 const original=context.kpiId?kpiKPIs.find(k=>k.id===context.kpiId):null;
 const body={company_id:context.companyId,objective_id:objId,code:field('kpi-code'),name,description:field('kpi-description')||null,frequency:field('kpi-freq'),responsible:field('kpi-resp')||null,data_provider:field('kpi-data-provider')||null,data_source:field('kpi-data-source')||null,reviewer:field('kpi-reviewer')||null,approver:field('kpi-approver')||null,approval_status:original?.approval_status||'draft',status:kpiStorageStatus(original?.status||field('kpi-status')),year:context.year};
 if(typeof window.kpiXPlannedMonthsValue==='function')body.planned_months=window.kpiXPlannedMonthsValue(body.frequency);
 if(!original)body.created_by=context.actorId;
 const scope='&company_id=eq.'+encodeURIComponent(context.companyId);
 modal.querySelector('[data-kpi-definition-message]')?.remove();
 controls=Array.from(modal.querySelectorAll('input,select,textarea,button')).map(node=>({node,disabled:node.disabled}));
 modal._kpiDefinitionBusy=true;modal._kpiDefinitionControls=controls;
 controls.forEach(item=>{item.node.disabled=true;});document.getElementById('kpi-modal-title').focus();
 let existing=[];
 if(context.kpiId){
  existing=await api('/kpi_indicators?kpi_id=eq.'+encodeURIComponent(context.kpiId)+scope+'&select=*');
  kpiDefinitionCheckContext(context);
  if(!Array.isArray(existing)||existing.some(i=>i.kpi_id!==context.kpiId||i.company_id!==context.companyId))throw new Error('Could not verify the existing indicators. No changes were saved.');
 }
 for(const id of ids)if(!existing.some(i=>i.id===id))throw new Error('An indicator no longer belongs to this KPI. Close and reopen before saving.');
 const removed=existing.filter(i=>!ids.includes(i.id));
 for(const ind of removed){
  const data=await api('/kpi_monthly_data?indicator_id=eq.'+encodeURIComponent(ind.id)+scope+'&select=id&limit=1');
  kpiDefinitionCheckContext(context);
  if(!Array.isArray(data))throw new Error('Could not verify indicator history. No changes were saved.');
  if(data.length){const error=new Error('Cannot remove "'+ind.name+'" because it has monthly records. Restore its row below, then rename the existing row to preserve its history.');error.indicatorToRestore=ind;throw error;}
 }
 kpiDefinitionCheckContext(context);
 writeStarted=true;modal._kpiDefinitionWritten=true;
 const parent=await api(context.kpiId?'/kpis_v2?id=eq.'+encodeURIComponent(context.kpiId)+scope:'/kpis_v2',{m:context.kpiId?'PATCH':'POST',p:'return=representation',b:body});
 if(!kpiDefinitionRowsMatch(parent,body)||(context.kpiId&&parent[0].id!==context.kpiId))throw new Error('The saved KPI identity or fields could not be confirmed.');
 parentSaved=true;
 const kpiId=parent[0].id,kpiScope='&kpi_id=eq.'+encodeURIComponent(kpiId)+scope;
 const saved=[];
 for(const ind of indicators){
  kpiDefinitionCheckContext(context);
  const expected={...ind.body,kpi_id:kpiId,company_id:context.companyId};
  const response=await api(ind.indicatorId?'/kpi_indicators?id=eq.'+encodeURIComponent(ind.indicatorId)+kpiScope:'/kpi_indicators',{m:ind.indicatorId?'PATCH':'POST',p:'return=representation',b:expected});
  if(!kpiDefinitionRowsMatch(response,expected)||(ind.indicatorId&&response[0].id!==ind.indicatorId))throw new Error('A saved indicator could not be confirmed.');
  saved.push(response[0]);
 }
 for(const ind of removed){
  kpiDefinitionCheckContext(context);
  const response=await api('/kpi_indicators?id=eq.'+encodeURIComponent(ind.id)+kpiScope,{m:'DELETE',p:'return=representation'});
  if(!Array.isArray(response)||response.length!==1||response[0].id!==ind.id)throw new Error('Removal of the unused indicator could not be confirmed.');
 }
 for(const ind of saved){
  kpiDefinitionCheckContext(context);
  await kpiRecalcAllYTD(ind.id,context.year,{...context,operation:'definition',definitionContext:context},ind);
 }
 kpiDefinitionCheckContext(context);
 const [freshParent,freshIndicators,freshMonthly]=await Promise.all([
  api('/kpis_v2?id=eq.'+encodeURIComponent(kpiId)+scope+'&select=*'),
  api('/kpi_indicators?kpi_id=eq.'+encodeURIComponent(kpiId)+scope+'&select=*&order=sort_order'),
  api('/kpi_monthly_data?indicator_id=in.('+saved.map(i=>encodeURIComponent(i.id)).join(',')+')'+scope+'&year=eq.'+context.year+'&select=*')
 ]);
 kpiDefinitionCheckContext(context);
 if(!kpiDefinitionRowsMatch(freshParent,{...body,id:kpiId})||!Array.isArray(freshIndicators)||freshIndicators.length!==saved.length||!saved.every(i=>kpiDefinitionRowsMatch(freshIndicators.filter(r=>r.id===i.id),{id:i.id,name:i.name,target_value:i.target_value,target_operator:i.target_operator,unit:i.unit,ytd_method:i.ytd_method,sort_order:i.sort_order,kpi_id:kpiId,company_id:context.companyId})))throw new Error('The refreshed KPI definition does not match the saved rows.');
 if(!Array.isArray(freshMonthly)||freshMonthly.some(r=>!saved.some(i=>i.id===r.indicator_id)||r.company_id!==context.companyId||Number(r.year)!==context.year))throw new Error('Monthly history could not be refreshed safely.');
 kpiKPIs=kpiKPIs.filter(k=>k.id!==kpiId).concat(freshParent);
 kpiIndicators=kpiIndicators.filter(i=>i.kpi_id!==kpiId).concat(freshIndicators);
 existing.concat(saved).forEach(i=>{delete kpiMonthlyData[i.id];});
 freshMonthly.forEach(r=>{if(!kpiMonthlyData[r.indicator_id])kpiMonthlyData[r.indicator_id]={};kpiMonthlyData[r.indicator_id][r.month]=r;});
 kpiRenderOverview();kpiRenderMonthly();kpiUpdateMetrics();
 modal._kpiDefinitionBusy=false;
 toast(context.kpiId?'KPI updated!':'KPI added!');closeKpiModal('kpi-edit-modal');
 return {complete:true,kpiId};
}catch(error){
 modal.dataset.saveFailed='true';
 const detail=String(error?.message||error).includes('kpis_v2_status_check')?'The calculated display status cannot be stored. Your entered information is still open; reload and check the KPI before retrying.':String(error?.message||error);
 kpiDefinitionFeedback((parentSaved?'Some KPI changes were saved, but the operation did not complete. Close and reload this KPI to review the saved rows before editing again. ':writeStarted?'Save could not be confirmed. Close and check existing KPIs before trying again. ':'')+detail,error.indicatorToRestore);
 return {complete:false,partial:writeStarted};
}finally{
 modal._kpiDefinitionBusy=false;
 if(controls)controls.forEach(item=>{item.node.disabled=writeStarted&&modal.style.display!=='none'&&!item.node.matches('[data-auris-onclick="h0139"]')?true:item.disabled;});
}
}
