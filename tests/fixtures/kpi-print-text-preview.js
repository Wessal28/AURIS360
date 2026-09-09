// Local-only inert markup probes; no script, event-handler or external URL payload.
// Actual kpiPrint/builders are served from auris-core; only the print window is captured.
window.isSA=()=>false;
window.co={name:'Synthetic company & <sample>'};
window.kpiKPIs[0].status='<b data-print-probe>stored status</b>';
window.kpiIndicators[0].unit='<b data-print-probe>count</b>';
window.kpiMonthlyData['i-k0'][1]={month:1,actual:'<b data-print-probe>actual</b>',ytd:'<b data-print-probe>YTD</b>'};
window.kpiMonthlyData['i-k0'][12].ytd='<b data-print-probe>YTD</b>';
const printPreview=document.createElement('section');
printPreview.id='fixture-print-preview';printPreview.setAttribute('aria-label','Generated print preview');printPreview.style.cssText='max-height:300px;overflow:auto;background:white;border:1px solid #64748b;padding:12px';
document.querySelector('.fixture-banner').appendChild(printPreview);
const printRecordsBefore=JSON.stringify({data:kpiMonthlyData,unit:kpiIndicators[0].unit,status:kpiKPIs[0].status});
window.aurisPrint=(html,title)=>{printPreview.innerHTML=html;printPreview.dataset.title=title;document.getElementById('fixture-entry').textContent='Print captured; source records '+(JSON.stringify({data:kpiMonthlyData,unit:kpiIndicators[0].unit,status:kpiKPIs[0].status})===printRecordsBefore?'unchanged':'CHANGED');};
