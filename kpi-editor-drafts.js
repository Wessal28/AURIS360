/* Objective and KPI form lifecycle adapter. Business writes remain in the definition editor. */
(function(root){
'use strict';
var objectiveFields=['obj-name','obj-code','obj-year'];
var kpiFields=['kpi-obj-sel','kpi-code','kpi-name','kpi-description','kpi-freq','kpi-resp','kpi-data-provider','kpi-data-source','kpi-reviewer','kpi-approver'];
function objective(modal){return modal.id==='obj-modal';}
function context(modal){var c=modal[objective(modal)?'_kpiObjectiveContext':'_kpiDefinitionContext'];return c&&{companyId:c.companyId,userId:c.actorId,role:typeof activeRole==='function'?String(activeRole()):'',year:c.viewYear||c.year,id:c.editId||c.kpiId||'new',kind:objective(modal)?'objective':'kpi'};}
function current(modal,state){
  if(modal._editorDraft!==state||modal.style.display==='none'||JSON.stringify(context(modal))!==JSON.stringify(state.context))return false;
  try{if(objective(modal))kpiObjectiveCheckContext(modal._kpiObjectiveContext);else kpiDefinitionCheckContext(modal._kpiDefinitionContext);return true;}catch(e){return false;}
}
function busy(modal){return modal._kpiObjectiveBusy||modal._kpiDefinitionBusy;}
function written(modal){return modal._kpiObjectiveSaved||modal._kpiObjectiveUncertain||modal._kpiDefinitionWritten;}
function snapshot(modal){
  var fields={};(objective(modal)?objectiveFields:kpiFields).forEach(function(id){var el=document.getElementById(id);if(el)fields[id]=el.value;});
  if(objective(modal))return {fields:fields,color:kpiSelectedColor};
  var indicators=Array.from(modal.querySelectorAll('#kpi-indicators-list [data-ind-row]')).map(function(row){function value(selector){return row.querySelector(selector)?.value||'';}return {indicatorId:row.getAttribute('data-indicator-id')||'',name:value('.ind-name-input'),target:value('.ind-target-input'),operator:value('.ind-op-input'),unit:value('.ind-unit-input'),ytd:value('.ind-ytd-input')};});
  return {fields:fields,plannedMonths:root.KpiEditorDraftFields.selectedMonths(),indicators:indicators};
}
function describe(value){
  var labels={'obj-name':'Objective','obj-code':'Code','obj-year':'Year','kpi-obj-sel':'Objective ID','kpi-code':'Code','kpi-name':'KPI','kpi-description':'Description','kpi-freq':'Frequency','kpi-resp':'Owner','kpi-data-provider':'Data provider','kpi-data-source':'Data source','kpi-reviewer':'Reviewer','kpi-approver':'Approver'};
  var lines=Object.keys(value.fields).map(function(key){return labels[key]+': '+value.fields[key];});
  if(value.color)lines.push('Colour: '+value.color);
  if(value.plannedMonths?.length)lines.push('Reporting months: '+value.plannedMonths.join(', '));
  (value.indicators||[]).forEach(function(ind,index){lines.push('Indicator '+(index+1)+': '+ind.name+' | Target: '+ind.operator+' '+ind.target+' '+ind.unit+' | YTD: '+ind.ytd);});
  return lines.join('\n');
}
function valid(value,isObjective){
  if(!value||!value.fields||typeof value.fields!=='object'||Array.isArray(value.fields))return false;
  var allowed=isObjective?objectiveFields:kpiFields;
  if(Object.keys(value.fields).some(function(key){return !allowed.includes(key)||typeof value.fields[key]!=='string';}))return false;
  if(isObjective)return typeof value.color==='string'&&/^#[0-9a-f]{6}$/i.test(value.color);
  return Array.isArray(value.plannedMonths)&&value.plannedMonths.every(function(n){return Number.isInteger(n)&&n>=1&&n<=12;})&&Array.isArray(value.indicators)&&value.indicators.every(function(ind){return ind&&['indicatorId','name','target','operator','unit','ytd'].every(function(key){return typeof ind[key]==='string';});});
}
function apply(modal,value){
  Object.keys(value.fields).forEach(function(id){var el=document.getElementById(id);if(!el)return;if(el.tagName==='SELECT'&&value.fields[id]&&!Array.from(el.options).some(function(option){return option.value===value.fields[id];})){var option=document.createElement('option');option.value=value.fields[id];option.textContent=value.fields[id];el.appendChild(option);}el.value=value.fields[id];});
  if(objective(modal)){kpiSelectedColor=value.color;kpiRenderObjectiveColour();}
  else{ root.KpiEditorDraftFields.setMonths(value.plannedMonths);document.getElementById('kpi-indicators-list').innerHTML='';value.indicators.forEach(function(ind){kpiAddIndicatorRow(ind.name,ind.target,ind.operator,ind.unit,ind.ytd,ind.indicatorId);}); }
}
function lock(modal,state,enabled){
  if(enabled&&!state.controls){state.controls=Array.from(modal.querySelectorAll('input,select,textarea,button')).filter(function(el){return !el.closest('[data-editor-draft]')&&!el.matches('[data-auris-onclick="h0129"],[data-auris-onclick="h0139"]');}).map(function(el){return {el:el,disabled:el.disabled};});state.controls.forEach(function(item){item.el.disabled=true;});}
  if(!enabled&&state.controls){state.controls.forEach(function(item){item.el.disabled=item.disabled;});state.controls=null;}
}
function loading(modal){return !!modal.querySelector('[aria-busy="true"]');}
function render(modal){
  var state=modal._editorDraft;if(!state)return;
  var candidate=state.draft.candidate(),blocked=state.draft.blocked(),changed=state.draft.dirty(snapshot(modal));
  var message=candidate?(blocked?'A retained draft needs review. The loaded values changed or a previous save was unconfirmed. Copy any needed details below; automatic restoration is unavailable.':'An unsaved draft is available from this tab. Restore it or discard it to continue.'):
    busy(modal)?'Saving… Keep this form open.':written(modal)?'Save attempted. Check the result above before closing or editing again.':changed?'Unsaved changes — retained in this tab for up to 24 hours.':'No unsaved changes';
  if(state.draft.error())message=state.draft.error();
  state.note.textContent=message;state.restore.hidden=!candidate;state.restore.disabled=blocked||busy(modal)||loading(modal);state.discard.hidden=!candidate&&!changed;
  state.discard.disabled=!!busy(modal)||!!written(modal)||loading(modal);state.preview.hidden=!candidate;
  if(candidate)state.preview.querySelector('pre').textContent=describe(candidate.value);
  lock(modal,state,!!candidate);
}
function capture(modal){
  var state=modal?._editorDraft;if(!state||!current(modal,state)||busy(modal)||written(modal)||loading(modal))return;
  state.draft.capture(snapshot(modal));render(modal);
}
function legacy(saved,modal){
  if(objective(modal)||!saved.savedAt||Date.now()-saved.savedAt>=86400000||saved.savedAt>Date.now())return null;
  var value={fields:saved.fields||{},plannedMonths:saved.plannedMonths||root.KpiEditorDraftFields.defaultMonths(saved.fields?.['kpi-freq']),indicators:(saved.indicators||[]).map(function(ind){var id=ind.indicatorId||'';if(!id&&!saved.schemaVersion){var matches=kpiIndicators.filter(function(row){return row.kpi_id===context(modal).id&&row.name===ind.name;});if(matches.length===1)id=matches[0].id;}return {indicatorId:id,name:String(ind.name||''),target:String(ind.target??''),operator:String(ind.operator||'gte'),unit:String(ind.unit||''),ytd:String(ind.ytd||'sum')};})};
  // Legacy drafts have no baseline or save-outcome marker, so expose them for review only.
  return valid(value,false)?{value:value,outcome:'legacy',savedAt:saved.savedAt}:null;
}
function begin(modal){
  if(!modal||modal.style.display==='none'||busy(modal)||written(modal))return;
  if(modal._editorDraft)lock(modal,modal._editorDraft,false);
  modal.querySelector('[data-editor-draft]')?.remove();
  var identity=context(modal);if(!identity?.companyId||!identity.userId)return;
  var storage;try{storage=sessionStorage;}catch(e){storage={getItem:function(){throw e;},setItem:function(){throw e;},removeItem:function(){throw e;}};}
  var key=objective(modal)?'auris-objective-editor-draft:'+identity.companyId+':'+identity.userId+':'+identity.year+':'+identity.id:root.KpiEditorDraftFields.key(identity.id==='new'?null:identity.id);
  var backing=storage,legacyKey=key;
  storage={getItem:function(name){return backing.getItem(name)||backing.getItem(legacyKey);},setItem:function(name,value){backing.setItem(name,value);backing.removeItem(legacyKey);},removeItem:function(name){backing.removeItem(name);backing.removeItem(legacyKey);}};
  var state={context:identity,draft:AurisFormDraft.create({key:key+':'+identity.role,storage:storage,context:identity,baseline:snapshot(modal),valid:function(value){return valid(value,objective(modal));},legacy:function(saved){return saved.version?null:legacy(saved,modal);}})};
  modal._editorDraft=state;
  var bar=document.createElement('section');bar.className='kpi-editor-draft';bar.setAttribute('data-editor-draft','');bar.setAttribute('aria-label','Unsaved changes');
  bar.innerHTML='<p role="status" aria-live="polite"></p><div><button type="button" data-draft-restore>Restore draft</button><button type="button" data-draft-discard>Discard changes</button></div><details hidden><summary>Review retained draft</summary><pre></pre></details>';
  state.note=bar.querySelector('p');state.restore=bar.querySelector('[data-draft-restore]');state.discard=bar.querySelector('[data-draft-discard]');state.preview=bar.querySelector('details');
  var title=document.getElementById(objective(modal)?'obj-modal-title':'kpi-modal-title');title.parentElement.insertAdjacentElement('afterend',bar);
  state.restore.addEventListener('click',function(){if(!current(modal,state)||busy(modal)||written(modal)||loading(modal))return;var value=state.draft.restore();if(value){lock(modal,state,false);apply(modal,value);capture(modal);document.getElementById(objective(modal)?'obj-name':'kpi-name').focus();}});
  state.discard.addEventListener('click',async function(){
    if(!current(modal,state)||busy(modal)||written(modal)||loading(modal)||state.confirming)return;
    state.confirming=true;
    try{var confirmed=await kpiEditorConfirmArchive(modal,{title:'Discard unsaved changes?',message:'Remove this draft and return to the values loaded when the form opened?',confirmText:'Discard changes',cancelText:'Keep editing'});if(!confirmed||!current(modal,state)||busy(modal)||written(modal)||loading(modal))return;state.draft.discard();lock(modal,state,false);apply(modal,state.draft.baseline());render(modal);title.focus();}finally{state.confirming=false;if(modal._editorDraft===state)title.focus();}
  });
  if(!modal._editorDraftBound){modal._editorDraftBound=true;modal.addEventListener('input',function(){capture(modal);});modal.addEventListener('change',function(){capture(modal);});modal.addEventListener('keydown',function(event){if(event.key==='Escape'&&!event.defaultPrevented&&document.getElementById('app-confirm3modal')?.style.display!=='flex'){event.preventDefault();closeKpiModal(modal.id);}});}
  var oldNote=document.getElementById('kpi-x-editor-draft-note');if(oldNote)oldNote.hidden=true;
  render(modal);
}
function canSave(modal){var state=modal?._editorDraft;if(!state)return true;if(!current(modal,state)||state.draft.candidate()||state.confirming){state.note.textContent='Resolve the draft or reopen the form in the original company, account and role before saving.';return false;}return true;}
function protect(modal){var state=modal?._editorDraft;if(state){state.draft.protect(snapshot(modal));render(modal);}}
function complete(modal){var state=modal?._editorDraft;if(state){state.draft.discard();state.completed=true;}}
function close(modal){
  var state=modal?._editorDraft;if(!state)return true;
  if(busy(modal)||state.confirming)return false;
  if(state.completed||state.allowClose){lock(modal,state,false);modal._editorDraft=null;return true;}
  if(written(modal)){protect(modal);modal._editorDraft=null;return true;}
  if(state.draft.candidate()||!state.draft.dirty(snapshot(modal))){lock(modal,state,false);modal._editorDraft=null;return true;}
  state.confirming=true;
  kpiEditorConfirmArchive(modal,{title:'Unsaved changes',message:'Keep this form open to save your changes, or discard them and close?',confirmText:'Discard and close',cancelText:'Keep editing'}).then(function(confirmed){
    state.confirming=false;if(modal._editorDraft!==state||busy(modal)||written(modal))return;if(!confirmed){document.getElementById(objective(modal)?'obj-modal-title':'kpi-modal-title').focus();return;}
    state.draft.discard();state.allowClose=true;closeKpiModal(modal.id);
  }).catch(function(){state.confirming=false;});
  return false;
}
function visible(){return ['obj-modal','kpi-edit-modal'].map(function(id){return document.getElementById(id);}).filter(function(modal){return modal&&modal.style.display!=='none'&&modal._editorDraft;});}
if(root.addEventListener)root.addEventListener('beforeunload',function(event){if(visible().some(function(modal){return busy(modal)||modal._editorDraft.draft.dirty(snapshot(modal));})){event.preventDefault();event.returnValue='';}});
if(root.document)document.addEventListener('auris:module-before-leave',function(event){var open=visible();if(open.length){event.preventDefault();var modal=open[0];if(!busy(modal))closeKpiModal(modal.id);}});
root.KpiEditorDrafts=Object.freeze({begin:begin,capture:capture,canSave:canSave,protect:protect,complete:complete,close:close,snapshot:snapshot,refresh:render});
})(typeof window!=='undefined'?window:globalThis);
