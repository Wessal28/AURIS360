(function(root){
'use strict';
var queues={all:'All actions',mine:'My actions',overdue:'Overdue actions',verify:'Pending verification',closure:'Pending closure'};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function friendly(v){return String(v||'Not recorded').replace(/_/g,' ').replace(/\b[a-z]/g,function(c){return c.toUpperCase();});}
function value(id){return String(document.getElementById(id)?.value||'');}
function filters(){return {scope:typeof mapCurrentView!=='undefined'?mapCurrentView:'all',search:value('map-search'),source:value('map-filter-source'),priority:value('filter-priority'),status:value('filter-status'),type:value('map-filter-type')};}
function tools(){if(!root.AurisModuleReports||!root.AurisActionListWorkspace)throw Error('The action report tools are unavailable. Reopen Master Action Plan and retry.');return root.AurisModuleReports;}
function references(rows){
 var sorted=rows.slice().sort(function(a,b){return new Date(a.created_at||a.target_date||a.updated_at||0)-new Date(b.created_at||b.target_date||b.updated_at||0)||String(a.id).localeCompare(String(b.id));});
 return function(r){var raw=String(r.action_ref||'').trim();if(typeof mapHasProfessionalRef!=='function')return raw||'Reference not recorded';if(mapHasProfessionalRef(raw))return raw;
  var date=r.created_at||r.target_date||r.updated_at,year=date&&new Date(date).getFullYear();if(!year)return 'Reference not recorded';
  var sameYear=sorted.filter(function(x){return new Date(x.created_at||x.target_date||x.updated_at||0).getFullYear()===year;}),index=sameYear.findIndex(function(x){return String(x.id)===String(r.id);});
  return 'MAP-'+({corrective:'CA',preventive:'PA',improvement:'IA',observation:'OB'}[r.action_type]||'MA')+'-'+year+'-'+String(index+1).padStart(3,'0');
 };
}
function project(rows,c,f){
 var profile=typeof prof!=='undefined'?prof:{},options={filters:f,
 reference:references(rows),
 sourceKey:typeof mapSourceKey==='function'?mapSourceKey:function(v){return {events:'incident',event:'incident',meetings:'meeting',noise:'noise_survey',occupational_health:'ohealth',environmental:'esg'}[v]||v||'manual';},
 sources:typeof MAP_SOURCE_CFG!=='undefined'?MAP_SOURCE_CFG:{},priorities:typeof MAP_PRIORITY_CFG!=='undefined'?MAP_PRIORITY_CFG:{},statuses:typeof MAP_STATUS_CFG!=='undefined'?MAP_STATUS_CFG:{},types:typeof MAP_TYPE_CFG!=='undefined'?MAP_TYPE_CFG:{}};
 return root.AurisActionListWorkspace.project(rows,{companyId:c.company,userId:c.user,role:c.role,name:profile.full_name||profile.name||''},options);
}
function day(v){var m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:'Not recorded';}
function build(rows){var heads=['Reference','Action','Source / Reference','Responsible','Due date','Priority','Recorded status','Progress','Attention'];return '<table><thead><tr>'+heads.map(function(h){return '<th scope="col">'+esc(h)+'</th>';}).join('')+'</tr></thead><tbody>'+rows.map(function(r){return '<tr>'+[r.reference,r.title,[friendly(r.source),r.source_ref].filter(Boolean).join('\n'),r.responsible,day(r.due_date),friendly(r.priority),friendly(r.status),r.progress+'%',r.attention].map(function(v,index){var content=esc(v==null||v===''?'Not recorded':v);return '<td>'+([0,4,5,7].includes(index)?'<span class="mrp-nowrap">'+content+'</span>':content)+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table>';}
function scopeLabel(f){return [['Queue',queues[f.scope]||friendly(f.scope)],['Search',f.search],['Source',f.source&&friendly(f.source)],['Priority',f.priority&&friendly(f.priority)],['Status',f.status&&friendly(f.status)],['Action type',f.type&&friendly(f.type)]].filter(function(p){return p[1];}).map(function(p){return p[0]+': '+p[1];}).join(' · ');}
async function capture(options,c){
 options=options||{};var t=tools();c=c||t.context('actions');var f=options.filtered?root.AurisActionListWorkspace.filters(options.filters||filters()):root.AurisActionListWorkspace.filters({scope:'all'});
 t.check(c,'actions',f.scope);var rows=await t.read('action_tracker',c,'actions',f.scope),result=project(rows,c,f);t.check(c,'actions',f.scope);
 if(!result.length)throw Error('No saved actions match this report scope. Adjust the filters or choose the full company register.');
 return {moduleKey:'actions',section:f.scope,title:'Master Action Plan Register',context:c,html:build(result),paper:options.paper||'A3',sourceLabel:result.length+' saved actions · '+(options.filtered?'Filtered register · '+scopeLabel(f):'Full company register · all queues; screen filters excluded')+' · standard report columns',note:'Status and progress are shown as recorded. Unsaved editor entries and interface controls are excluded.'};
}
function error(e){if(typeof toast==='function')toast(e.message||String(e),false);}
function open(){
 var t,c,brand;try{t=tools();c=t.context('actions');brand=t.company(c);}catch(e){error(e);return;}if(document.getElementById('mrp-options'))return;
 var selected=root.AurisActionListWorkspace.filters(filters()),all=t.allowed('actions','all'),filtered=t.allowed('actions',selected.scope);if(!all&&!filtered){error(Error('No action report is available for your current queue access.'));return;}
 t.ensureStyle();var opener=document.activeElement,d=document.createElement('dialog');d.id='mrp-options';d.setAttribute('aria-labelledby','mrp-options-title');
 d.innerHTML='<form><h2 id="mrp-options-title">Master Action Plan reports</h2><p><strong>'+esc(brand.name)+'</strong></p><label>Information to print<select name="scope">'+(all?'<option value="all">Full company register</option>':'')+(filtered?'<option value="filters">Current filtered register</option>':'')+'</select></label><p data-filters>'+esc(scopeLabel(selected))+'</p><label>Paper<select name="paper"><option value="A3">A3 landscape — wide register</option><option value="A4">A4 landscape</option></select></label><p>Reports use saved company records and standard report columns. A filtered report includes the current queue, search and selected filters.</p><p role="alert" data-error></p><div class="mrp-dialog-actions"><button type="button" data-cancel>Cancel</button><button type="submit">Open print preview</button></div></form>';
 document.body.appendChild(d);var f=d.querySelector('form');f.elements.scope.value=filtered&&(!all||selected.scope!=='all'||['search','source','priority','status','type'].some(function(k){return selected[k];}))?'filters':'all';
 var closed=false,generation=0,pendingWindow=null;
 function close(keepPreview){closed=true;generation++;if(keepPreview!==true&&pendingWindow&&!pendingWindow.closed)pendingWindow.close();pendingWindow=null;d.close();d.remove();if(opener?.isConnected)opener.focus();}d.querySelector('[data-cancel]').addEventListener('click',function(){close(false);});d.addEventListener('cancel',function(e){e.preventDefault();close(false);});
 function explain(){d.querySelector('[data-filters]').textContent=f.elements.scope.value==='filters'?scopeLabel(selected):'All saved company actions. Current queue and screen filters are excluded.';}f.elements.scope.addEventListener('change',explain);explain();
 f.addEventListener('submit',async function(e){e.preventDefault();var button=f.querySelector('[type="submit"]'),w,ticket;if(closed||button.disabled)return;try{t.check(c,'actions',f.elements.scope.value==='filters'?selected.scope:'all');button.disabled=true;ticket=++generation;d.querySelector('[data-error]').textContent='Loading saved actions…';w=pendingWindow=t.reserve();var report=await capture({filtered:f.elements.scope.value==='filters',filters:selected,paper:f.elements.paper.value},c);if(closed||ticket!==generation||!d.isConnected)throw Error('Report preview cancelled.');await t.preview(Object.assign(report,{preparedWindow:w}));if(closed||ticket!==generation||!d.isConnected)throw Error('Report preview cancelled.');close(true);}catch(e){if(w&&!w.closed)w.close();if(d.isConnected)d.querySelector('[data-error]').textContent=e.message||String(e);}finally{if(pendingWindow===w)pendingWindow=null;button.disabled=false;}});
 d.showModal();f.elements.scope.focus();
}
root.AurisActionPrint=Object.freeze({open:open,capture:capture,filters:filters,build:build});root.mapPrintRegister=open;
})(window);
