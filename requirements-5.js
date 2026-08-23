(function(){
'use strict';

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function close(){document.getElementById('r5-generic-viewer')?.remove();}
function openViewer(title,fields,edit){
  close();var modal=document.createElement('div');modal.id='r5-generic-viewer';modal.className='r5-record-modal';
  modal.innerHTML='<div class="card r5-record-dialog" role="dialog" aria-modal="true"><header><div><div class="r5-kicker">Read-only record</div><h2>'+esc(title)+'</h2><p>Review the saved record before choosing a separate edit action.</p></div><button class="btn btn-sm r5-close"><i class="ti ti-x"></i></button></header><div class="r5-detail-grid">'+fields.filter(function(x){return String(x[1]||'').trim();}).map(function(x){return '<div><span>'+esc(x[0])+'</span><strong>'+esc(x[1])+'</strong></div>';}).join('')+'</div><footer>'+(edit?'<button class="btn r5-edit"><i class="ti ti-edit"></i>Edit record</button>':'')+'<button class="btn btn-primary r5-close">Close</button></footer></div>';
  document.body.appendChild(modal);modal.querySelectorAll('.r5-close').forEach(function(b){b.addEventListener('click',close);});if(edit)modal.querySelector('.r5-edit')?.addEventListener('click',function(){close();edit();});modal.addEventListener('click',function(e){if(e.target===modal)close();});
}
function rowFields(row){var table=row.closest('table'),heads=Array.from(table?.querySelectorAll('thead th')||[]).map(function(x){return x.textContent.trim();}),cells=Array.from(row.children);return cells.map(function(c,i){return [heads[i]||('Field '+(i+1)),c.textContent.replace(/\s+/g,' ').trim()];}).filter(function(x){return x[1]&&x[0].toLowerCase()!=='actions'&&x[0].toLowerCase()!=='action';});}
function invoke(name,id){return function(){if(typeof window[name]==='function')window[name](id);};}
function bindTable(id,title,editFn,dataSource){
  var host=document.getElementById(id);if(!host||host.dataset.r5ViewerBound)return;host.dataset.r5ViewerBound='1';
  host.addEventListener('click',function(ev){var row=ev.target.closest('tbody tr');if(!row||ev.target.closest('a,button,input,select,textarea,label'))return;ev.preventDefault();ev.stopImmediatePropagation();var rid=row.dataset.id||row.querySelector('[data-id]')?.dataset.id||'';var record=typeof dataSource==='function'?dataSource(rid):null;var fields=record?Object.keys(record).filter(function(k){return !['id','company_id','created_by'].includes(k)&&record[k]!=null&&typeof record[k]!=='object';}).map(function(k){return [k.replace(/_/g,' '),record[k]];}):rowFields(row);openViewer(title+(rid?' · '+rid:''),fields,editFn&&rid?invoke(editFn,rid):null);},true);
}
function bindDocumentCards(){var host=document.getElementById('docs-list');if(!host||host.dataset.r5ViewerBound)return;host.dataset.r5ViewerBound='1';host.addEventListener('click',function(ev){var card=ev.target.closest('.card[data-id]');if(!card||ev.target.closest('button,a,input,select,textarea'))return;ev.preventDefault();ev.stopImmediatePropagation();var id=card.dataset.id,d=(typeof dcAllData!=='undefined'?dcAllData:[]).find(function(x){return String(x.id)===String(id);});if(!d)return;var fields=[['Reference',d.doc_ref||d.reference_no],['Title',d.title],['Document type',d.document_type||d.doc_type],['Department',d.department||d.dept],['Version',d.version||d.revision],['Owner / author',d.author||d.doc_owner||d.created_by_name],['Approval status',d.approval_status||d.status],['Issue date',d.issue_date],['Review date',d.review_date],['Expiry date',d.expiry_date],['Description',d.description]];openViewer('Document · '+(d.doc_ref||d.title||'record'),fields,invoke('dcEdit',id));},true);}
function enhance(){
  bindTable('fire-cert-tbody','Fire certificate','fireShowCertForm',function(id){return (typeof fireAllCerts!=='undefined'?fireAllCerts:[]).find(function(x){return String(x.id)===String(id);});});
  bindTable('fire-insp-tbody','Fire inspection','fireShowInspForm',function(id){return (typeof fireAllInsp!=='undefined'?fireAllInsp:[]).find(function(x){return String(x.id)===String(id);});});
  bindTable('fire-equip-tbody','Fire equipment','fireShowEquipForm',function(id){return (typeof fireAllEquip!=='undefined'?fireAllEquip:[]).find(function(x){return String(x.id)===String(id);});});
  bindTable('fire-layout-plan-list','Fire site layout','fireSelectLayoutPlan',function(id){return (typeof fireLayoutPlans!=='undefined'?fireLayoutPlans:[]).find(function(x){return String(x.id)===String(id);});});
  bindTable('lca-list','Legal compliance assessment','lcaEdit',function(id){return (typeof lcaAllData!=='undefined'?lcaAllData:[]).find(function(x){return String(x.id)===String(id);});});
  bindTable('swms-list','Safe Work Method Statement',null,function(id){return (typeof swmsAllData!=='undefined'?swmsAllData:[]).find(function(x){return String(x.id)===String(id);});});
  bindTable('con-pa-list','Contractor pre-assessment','cpaEdit',function(id){return (typeof conPAData!=='undefined'?conPAData:[]).find(function(x){return String(x.id)===String(id);});});
  bindTable('con-ev-list','Contractor performance evaluation','cevEdit',function(id){return (typeof conEvalData!=='undefined'?conEvalData:[]).find(function(x){return String(x.id)===String(id);});});
  bindTable('con-atw-list','Contractor authorisation to work','catwEdit',function(id){return (typeof conATWData!=='undefined'?conATWData:[]).find(function(x){return String(x.id)===String(id);});});
  bindDocumentCards();
}

var originalPtw=window.ptwNew;
if(typeof originalPtw==='function')window.ptwNew=function(){originalPtw();var list=document.getElementById('ptw-list-view'),form=document.getElementById('ptw-form3view'),selector=document.getElementById('ptw-type-selector');if(list)list.style.display='none';if(form)form.style.setProperty('display','block','important');if(selector)selector.style.setProperty('display','block','important');form?.scrollIntoView({block:'start',behavior:'smooth'});};

document.addEventListener('DOMContentLoaded',function(){enhance();var observer=new MutationObserver(function(){enhance();});observer.observe(document.body,{childList:true,subtree:true});});
})();
