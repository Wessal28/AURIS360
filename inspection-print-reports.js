(function(root){
'use strict';
var types=['workplace','behavioral','equipment','ppe','fire','environmental','prestart'];
var auditTypes=['iso_audit','internal_audit','supplier_audit','contractor_audit','regulatory'];
function section(type){type=String(type||'').toLowerCase();return auditTypes.includes(type)?'audit':types.includes(type)?type:'all';}
function close(window){if(window&&!window.closed&&typeof window.close==='function')window.close();}
async function print(id,options){
  options=options||{};
  try{
    id=String(id||'').trim();
    if(!id||id.length>150)throw Error('Save and open one inspection before printing its report. Unsaved form entries are excluded.');
    var reports=root.AurisModuleReports,catalogue=root.AurisPrintCatalogue;
    if(!reports||!catalogue||typeof catalogue.record!=='function'||!catalogue.catalogue.inspection)throw Error('Inspection report preview is unavailable. Reload Audits & Inspections and retry.');
    var key=options.section||section(options.type);
    if(!catalogue.catalogue.inspection.reports[key]||key==='findings')throw Error('Choose an audit or inspection report.');
    var captured=reports.context('inspection');
    if(typeof options.guard==='function')options.guard();
    return await catalogue.record('inspection',key,id,captured,{
      preparedWindow:options.preparedWindow,paper:options.paper||'A4',guard:options.guard
    });
  }catch(error){close(options.preparedWindow);throw error;}
}
root.AurisInspectionReports=Object.freeze({version:'1.0.0',print:print,section:section});
})(window);
