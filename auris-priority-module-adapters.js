(function(root){
'use strict';
var layout=root.AurisModuleLayout,runtime=root.AurisModuleRuntime;
if(!layout||!runtime)throw new Error('Priority module adapters require the shared layout and lifecycle runtime.');

function call(name,args){var fn=root[name];if(typeof fn==='function')return fn.apply(root,args||[]);}
function nav(page){var current=page.querySelector(':scope > .module-tabs');if(current)return current;current=root.document.createElement('nav');current.className='module-tabs auris-priority-module-tabs';var header=page.querySelector(':scope > .page-header');header.insertAdjacentElement('afterend',current);return current;}
function button(id){return root.document.getElementById(id);}
var modules={
  risk:{subtitle:'Assess hazards, controls and residual risk in one governed workspace',views:[{id:'register',label:'Risk Assessments',group:'Registers'},{id:'jsa',label:'JSA / JHA',group:'Registers'},{id:'hira',label:'HIRA',group:'Registers'}],primaryLabel:'New RA',onPrimary:function(){call('raShowNewPanel');},commands:[{id:'libraries',label:'Libraries',icon:'ti-books',onClick:function(){call('raShowLibrary');}}],onViewChange:function(id){call('raListTab',[id==='register'?'ra':id,button('ra-ltab-'+(id==='register'?'ra':id))]);}},
  permit:{subtitle:'Issue, approve, control and close high-risk work permits',views:[{id:'active',label:'Active permits',group:'Work'},{id:'all',label:'All permits',group:'Registers'}],primaryLabel:'New Permit',onPrimary:function(){call('ptwNew');},onViewChange:function(id){call('ptwFilterSet',[id,button('ptw-btn-'+id)]);}},
  documents:{subtitle:'Control revisions, approvals, copies and acknowledgements',views:[{id:'all',label:'All Documents',group:'Registers'},{id:'approval',label:'Pending Approval',group:'Workflow'},{id:'expiry',label:'Expiry / Review',group:'Assurance'},{id:'copies',label:'Controlled Copies',group:'Assurance'},{id:'ack',label:'Acknowledgements',group:'Assurance'}],primaryLabel:'New document',onPrimary:function(){call('dcNew');},onViewChange:function(id){call('dcSwitchTab',[id,button('dc-tab-'+id)]);}},
  moc:{subtitle:'Govern organisational and operational change before new risk is introduced',views:[{id:'register',label:'Change register',group:'Registers'}],primaryLabel:'New change request',onPrimary:function(){call('mocNew');}},
  actions:{subtitle:'Assign, verify and close corrective and preventive actions',views:[{id:'all',label:'All Actions',group:'Registers'},{id:'mine',label:'Assigned to Me',group:'My work'},{id:'overdue',label:'Overdue',group:'My work'},{id:'verify',label:'Pending Verification',group:'Assurance'},{id:'closure',label:'Pending Closure',group:'Assurance'}],primaryLabel:'New action',onPrimary:function(){call('mapNew');},onViewChange:function(id){call('mapSetView',[id,button('map-tab-'+id)]);}}
};
function mount(key){
  var config=modules[key],page=root.document&&root.document.getElementById('page-'+key);if(!config||!page)return null;nav(page);
  return layout.mount(key,Object.assign({},config,{page:page,activeView:(root.AurisModuleRegistry.get(key).layout||{}).defaultView,onRefresh:function(){var manifest=root.AurisModuleRegistry.get(key);call(manifest.loader);}}));
}
Object.keys(modules).forEach(function(key){runtime.register(key,{enter:function(){mount(key);}});});
if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',function(){Object.keys(modules).forEach(mount);});else Object.keys(modules).forEach(mount);}
root.AurisPriorityModuleAdapters=Object.freeze({version:'1.0.0',keys:Object.freeze(Object.keys(modules)),mount:mount});
})(typeof window!=='undefined'?window:globalThis);
