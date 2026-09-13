(function(root){
'use strict';
var tables=new WeakMap(),timer;
function context(){return String(typeof ccid==='function'?ccid():'')+':'+String(typeof prof!=='undefined'&&prof?prof.id:'');}
function key(table,labels){var host=table.closest('[id]');return 'auris-register-columns-v1:'+context()+':'+(host?host.id:'table')+':'+labels.join('|');}
function read(storageKey){try{var value=JSON.parse(root.localStorage.getItem(storageKey));return Array.isArray(value)?value:[];}catch(_){return [];}}
function apply(table,hidden){
 Array.from(table.rows).forEach(function(row){var offset=0;Array.from(row.cells).forEach(function(cell){var span=cell.colSpan||1,hide=true;for(var i=offset;i<offset+span;i++)if(hidden.indexOf(i)===-1)hide=false;cell.classList.toggle('auris-column-hidden',hide);offset+=span;});});
}
function enhance(table){
 if(table.closest('.ave-workspace,.ave-list,.ave-table-wrap,.kpi-x-table')||table.querySelector('input:not([type=checkbox]),select,textarea'))return;
 var header=table.tHead&&table.tHead.rows[0];if(!header||header.cells.length<2||Array.from(header.cells).some(function(c){return c.colSpan>1||c.rowSpan>1;}))return;
 var labels=Array.from(header.cells).map(function(c){return c.textContent.trim();}),storageKey=key(table,labels),existing=tables.get(table);
 if(existing&&existing.key===storageKey){apply(table,existing.hidden);return;}
 if(existing)existing.control.remove();
 // Existing view-engine registers own their column controls.
 if(table.closest('[data-ave-module]')||table.parentElement.querySelector('.ave-columns'))return;
 var hidden=read(storageKey).filter(function(i){return Number.isInteger(i)&&i>0&&i<labels.length&&labels[i]&&!/^(actions?|edit)$/i.test(labels[i]);});
 var control=document.createElement('details');control.className='auris-register-columns';
 var summary=document.createElement('summary');summary.textContent='Columns';control.appendChild(summary);
 var list=document.createElement('div');list.className='auris-register-column-options';control.appendChild(list);
 labels.forEach(function(label,index){if(!label)return;var row=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=hidden.indexOf(index)===-1;input.disabled=index===0||/^(actions?|edit)$/i.test(label);row.append(input,document.createTextNode(label));list.appendChild(row);
 input.addEventListener('change',function(){if(context()!==record.context){schedule();return;}hidden=hidden.filter(function(i){return i!==index;});if(!input.checked)hidden.push(index);record.hidden=hidden;try{root.localStorage.setItem(storageKey,JSON.stringify(hidden));}catch(_){}apply(table,hidden);});});
 var reset=document.createElement('button');reset.type='button';reset.className='btn btn-sm';reset.textContent='Show all columns';list.appendChild(reset);
 var record={key:storageKey,hidden:hidden,control:control,context:context()};tables.set(table,record);
 reset.addEventListener('click',function(){if(context()!==record.context){schedule();return;}hidden=[];record.hidden=[];list.querySelectorAll('input').forEach(function(i){i.checked=true;});try{root.localStorage.removeItem(storageKey);}catch(_){}apply(table,[]);});
 table.parentElement.insertBefore(control,table);apply(table,hidden);
}
function scan(){document.querySelectorAll('.page table').forEach(function(table){if(table.getClientRects().length)enhance(table);});}
function schedule(){clearTimeout(timer);timer=setTimeout(scan,100);}
function start(){scan();new MutationObserver(function(records){if(records.some(function(r){return !r.target.closest||!r.target.closest('.auris-register-columns');}))schedule();}).observe(document.body,{childList:true,subtree:true});document.addEventListener('click',schedule);}
root.AurisRegisterColumns={apply:apply};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})(window);
