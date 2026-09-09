// Fixture-only September clock, raw results and browser-visible CSV capture.
// No tenant APIs or filesystem downloads. The actual export code still builds its Blob.
window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-09-15T12:00:00Z']));}};
window.kpiMonthlyData=Object.fromEntries(kpiIndicators.map(i=>[i.id,{6:{month:6,actual:95,ytd:95},8:{month:8,actual:80,ytd:175},9:{month:9,actual:100,ytd:275},12:{month:12,actual:0,ytd:275}}]));
const reportingBefore=JSON.stringify(kpiMonthlyData),reportingBanner=document.querySelector('.fixture-banner');
const reportingResult=document.createElement('pre');reportingResult.id='fixture-csv';reportingResult.setAttribute('aria-label','Synthetic CSV output');reportingResult.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;font-size:12px';reportingBanner.appendChild(reportingResult);
const reportingToggle=document.createElement('button');reportingToggle.type='button';reportingToggle.textContent='Include open month (synthetic policy)';reportingBanner.appendChild(reportingToggle);
reportingToggle.addEventListener('click',()=>{const excluded=window.kpiConfigPublished.cycles.current_period_excluded!==false;window.kpiConfigPublished.cycles.current_period_excluded=!excluded;reportingToggle.textContent=excluded?'Exclude open month (synthetic policy)':'Include open month (synthetic policy)';kpiXSwitchTab('reports');});
const reportingUrls=new Map(),reportingCreateUrl=URL.createObjectURL.bind(URL),reportingRevokeUrl=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=reportingCreateUrl(blob);reportingUrls.set(url,blob);return url;};
URL.revokeObjectURL=url=>{reportingUrls.delete(url);reportingRevokeUrl(url);};
document.addEventListener('click',event=>{const a=event.target.closest('a'),blob=a&&reportingUrls.get(a.href);if(!blob)return;event.preventDefault();blob.text().then(csv=>{reportingResult.textContent=a.download+'\n'+csv;document.getElementById('fixture-entry').textContent='CSV captured; monthly records '+(JSON.stringify(kpiMonthlyData)===reportingBefore?'unchanged':'CHANGED');});},true);
