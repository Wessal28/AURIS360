(function(root){
'use strict';
var titles={scorecard:'Objectives & KPIs Scorecard',monthly:'KPI Monthly Follow-up',comparison:'Year-on-year KPI Comparison'};
var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var css='/kpi-print-reports.css?v=20261020-1';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function scopeKey(){return String(typeof ccid==='function'?ccid():'')+':'+String(document.getElementById('year-sel')?.value||'');}
function company(){
 var id=String(typeof ccid==='function'?ccid():''),own=typeof co!=='undefined'?co:null,sa=typeof isSA==='function'&&isSA(),selected=typeof saCompanyList!=='undefined'?saCompanyList:[];
 if(sa&&!id)return {name:'All companies',logo:''};
 var row=selected.find(function(c){return String(c.id)===id;})||(own&&String(own.id)===id?own:null);
 return {name:row&&row.name||'AURIS360',logo:row&&row.logo_url||''};
}
function safeLogo(value){
 if(!String(value||'').trim())return '';
 if(typeof aurisSafeMediaUrl==='function')return aurisSafeMediaUrl(value,'image');
 if(/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value))return value;
 try{var u=new URL(value,location.href);return u.protocol==='https:'||u.origin===location.origin?u.href:'';}catch(_){return '';}
}
function cleanTable(html,kind){
 var template=document.createElement('template');template.innerHTML=html;
 var table=template.content.querySelector('table');
 if(!table&&kind==='comparison'){var note=template.content.querySelector('.kpi-x-comparison-note');return '<section class="kpr-empty">'+esc(note?note.textContent:template.content.textContent.trim())+'</section>';}
 if(!table)throw Error(template.content.textContent.trim()||'No report rows are available.');
 if(!table.querySelector('tbody tr'))throw Error('No indicators are available in this report scope.');
 // Remove operational actions, while retaining the same hierarchy, values and styles.
 var heads=Array.from(table.querySelectorAll('thead tr:first-child th'));
 var action=heads.findIndex(function(th){return th.textContent.trim()==='Actions';});
 if(action>=0)Array.from(table.rows).forEach(function(row){if(row.cells.length===heads.length)row.cells[action].remove();else Array.from(row.cells).forEach(function(cell){if(cell.colSpan>1)cell.colSpan-=1;});});
 table.querySelectorAll('button,input,select,textarea,script,iframe').forEach(function(el){el.remove();});
 table.querySelectorAll('*').forEach(function(el){Array.from(el.attributes).forEach(function(attr){if(/^on|^data-|^tabindex$/.test(attr.name)||attr.name==='role'&&attr.value==='button')el.removeAttribute(attr.name);});});
 table.classList.add('kpr-table');
 if(kind==='scorecard')table.classList.add('kpr-scorecard');
 if(kind==='monthly')table.classList.add('kpr-monthly');
 return table.outerHTML;
}
function build(snapshot,kind,options,branding,table){
 var date=new Date(),zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'local time',stamp=date.toLocaleString('en-GB')+' ('+zone+')';
 var cutoff=snapshot.cutoff,period=cutoff?'January–'+months[cutoff-1]+' '+snapshot.year:'No compiled month in '+snapshot.year;
 var counts={};snapshot.kpis.forEach(function(k){counts[k.status]=(counts[k.status]||0)+1;});
 var logo=safeLogo(branding.logo),name=esc(branding.name),kindTitle=titles[kind];
 var pending=snapshot.kpis.length-(counts.on_track||0)-(counts.at_risk||0)-(counts.off_track||0)-(counts.data_missing||0);
 var summary=options.summary?'<section class="kpr-summary"><span><strong>'+snapshot.kpis.length+'</strong> KPIs in scope</span><span><strong>'+(counts.on_track||0)+'</strong> On track</span><span><strong>'+(counts.at_risk||0)+'</strong> At risk</span><span><strong>'+(counts.off_track||0)+'</strong> Off track</span><span><strong>'+(counts.data_missing||0)+'</strong> Data missing</span><span><strong>'+pending+'</strong> Pending / not due</span></section>':'';
 var note=kind==='monthly'?'Recorded cells use the selected '+snapshot.period+' grouping. YTD, variance and status use the compiled cutoff; open/future recorded cells are not approval evidence.':kind==='comparison'?'Same cutoff in each year; each indicator uses its configured YTD method. Missing results are not zero. Percentage change is omitted when the prior value is zero. Illustrative/unverified values are labelled and are not audit evidence.':'The selected scorecard columns, hierarchy, targets, owners, values and statuses are preserved. Recorded trend charts can include open or future periods.';
 var legend='<section class="kpr-legend"><strong>Legend:</strong> <span class="on_track">On track</span> · <span class="at_risk">At risk</span> · <span class="off_track">Off track</span> · Data missing / No Data: required result absent · In Progress: open period · Not Due / N/A: not scheduled · —: no recorded value.</section>';
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(kindTitle+' - '+branding.name+' - '+snapshot.year)+'</title><link rel="stylesheet" href="'+css+'"></head><body class="kpr-report kpr-'+options.paper.toLowerCase()+'"><nav class="kpr-preview-controls" aria-label="Report preview controls"><button id="kpr-print" disabled>Loading logos and layout…</button><button id="kpr-close">Close preview</button><span id="kpr-resource-status" role="status"></span></nav><main><header class="kpr-header"><div class="kpr-brand"><img src="/assets/auris360-logo-final.png" alt="AURIS360 logo"><strong>AURIS360</strong></div><div class="kpr-heading"><h1>'+esc(kindTitle)+'</h1><h2>'+name+'</h2><p>Reporting year '+snapshot.year+' · '+esc(period)+(kind==='comparison'?' · same period each year':'')+'</p></div>'+(logo?'<img class="kpr-company-logo" src="'+esc(logo)+'" alt="'+name+' logo">':'')+'</header><section class="kpr-meta"><p><strong>Scope:</strong> '+esc(snapshot.filters)+(kind==='monthly'?' · '+esc(snapshot.period)+' grouping':'')+'</p><p><strong>Generated:</strong> '+esc(stamp)+'</p><p>Reporting snapshot · workflow decisions remain in AURIS360.</p></section>'+summary+'<p class="kpr-note">'+esc(note)+'</p>'+table+legend+'<footer><span>'+name+' · '+esc(kindTitle)+' · '+snapshot.year+'</span><span>Generated by AURIS360 · Verify against source records</span></footer></main></body></html>';
}
async function ready(w){
 var failed=false;
 var resources=Array.from(w.document.querySelectorAll('img,link[rel="stylesheet"]')).map(function(el){
  if(el.tagName==='IMG'&&el.complete){if(!el.naturalWidth){el.hidden=true;failed=true;}return Promise.resolve();}
  if(el.tagName==='LINK'&&el.sheet)return Promise.resolve();
  return new Promise(function(resolve){el.addEventListener('load',resolve,{once:true});el.addEventListener('error',function(){failed=true;if(el.tagName==='IMG')el.hidden=true;resolve();},{once:true});});
 });
 var timer;await Promise.race([Promise.all(resources),new Promise(function(resolve){timer=setTimeout(function(){failed=true;resolve();},8000);})]);clearTimeout(timer);
 if(w.closed)return;
 if(w.document.fonts)await w.document.fonts.ready;
 var button=w.document.getElementById('kpr-print');button.disabled=false;button.textContent='Print / Save as PDF';
 w.document.getElementById('kpr-resource-status').textContent=failed?'Some branding or layout resources could not load. Check the preview and retry before printing.':'Ready · choose the matching paper size and Landscape in your print dialog.';
 button.addEventListener('click',function(){w.focus();w.print();});
}
function open(kind){
 if(!root.AurisKpiReportSource)return;
 var previous=document.getElementById('kpr-options');if(previous){previous.querySelector('select').focus();return;}
 var opener=document.activeElement,key=scopeKey(),state=root.AurisKpiReportSource.state();
 kind=titles[kind]?kind:state.tab==='monthly'?'monthly':state.tab==='reports'?'comparison':'scorecard';
 if(!document.getElementById('kpr-dialog-styles')){var link=document.createElement('link');link.id='kpr-dialog-styles';link.rel='stylesheet';link.href=css;document.head.appendChild(link);}
 var dialog=document.createElement('dialog');dialog.id='kpr-options';dialog.className='kpr-dialog';dialog.setAttribute('aria-labelledby','kpr-options-title');
 dialog.innerHTML='<form><h2 id="kpr-options-title">Print KPI report</h2><label>Report<select name="kind"><option value="scorecard">Objectives & KPIs scorecard</option><option value="monthly">Monthly follow-up</option><option value="comparison">Year-on-year KPI comparison</option></select></label><label>Scope<select name="scope"><option value="current">Current filters</option><option value="all">All KPIs in the selected year</option></select></label><p data-scope-note>Scorecard uses your visible columns. Follow-up uses your selected monthly, quarterly or annual grouping.</p><label>Paper<select name="paper"><option value="A4">A4 landscape</option><option value="A3">A3 landscape (recommended for monthly follow-up)</option></select></label><label class="kpr-check"><input name="summary" type="checkbox" checked> Include KPI status summary</label><p>The company logo and AURIS360 logo, reporting cutoff, scope and status legend are included. Preview before printing.</p><p role="alert" data-error></p><div class="kpr-buttons"><button type="button" data-cancel>Cancel</button><button type="submit">Open print preview</button></div></form>';
 document.body.appendChild(dialog);var form=dialog.querySelector('form'),select=form.elements.kind,scope=form.elements.scope,paper=form.elements.paper;
 select.value=kind;
 function selection(){paper.value=select.value==='monthly'?'A3':'A4';scope.disabled=select.value==='comparison';if(scope.disabled)scope.value='all';dialog.querySelector('[data-scope-note]').textContent=scope.disabled?'Comparison includes all KPIs in the selected year, matching the complete Reports comparison table.':'Scorecard uses your visible columns. Follow-up uses your selected monthly, quarterly or annual grouping.';}
 selection();select.addEventListener('change',selection);
 function close(){dialog.close();dialog.remove();if(opener&&opener.isConnected)opener.focus();}
 dialog.querySelector('[data-cancel]').addEventListener('click',close);dialog.addEventListener('cancel',function(event){event.preventDefault();close();});
 form.addEventListener('submit',async function(event){
  event.preventDefault();var error=dialog.querySelector('[data-error]');error.textContent='';
  if(scopeKey()!==key){error.textContent='The company or year changed. Close and reopen print options.';return;}
  var report=select.value,options={paper:paper.value,summary:form.elements.summary.checked},branding=company(),all=scope.value==='all',button=form.querySelector('[type="submit"]');
  // Reserve the preview synchronously so history loading does not trigger popup blocking.
  var w=root.open('','_blank','width=1400,height=900');if(!w){error.textContent='Allow popups for AURIS360, then retry.';return;}
  w.document.title='Preparing KPI report';w.document.body.textContent='Preparing report and previous-year results…';button.disabled=true;
  try{
   var snapshot=await root.AurisKpiReportSource.capture(report,all);
   if(scopeKey()!==key)throw Error('The company or year changed. Reopen print options.');
   if(!snapshot.kpis.length)throw Error('No KPIs match this scope. Change the filters or select All KPIs.');
   var table=cleanTable(snapshot.html,report),html=build(snapshot,report,options,branding,table);
   if(w.closed)throw Error('The preview was closed. Open it again when ready.');
   w.document.open();w.document.write(html);w.document.close();w.document.getElementById('kpr-close').addEventListener('click',function(){w.close();});
   ready(w).catch(function(){if(!w.closed)w.document.getElementById('kpr-resource-status').textContent='Preview could not finish loading. Close it and retry.';});close();
  }catch(e){if(!w.closed)w.close();error.textContent=String(e.message||e);}finally{button.disabled=false;}
 });
 dialog.showModal();select.focus();
}
root.AurisKpiPrint={open:open,build:build,cleanTable:cleanTable,company:company,safeLogo:safeLogo};
})(window);
