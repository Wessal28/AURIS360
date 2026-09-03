(function(){
'use strict';

var KPI_PDF_MAX_BYTES=4*1024*1024;
var kpiPdfState={file:null,analysis:null,busy:false,completed:false};
var KPI_PDF_SCHEMA={
  type:'object',additionalProperties:false,
  required:['document_title','reporting_year','confidence','warnings','objectives'],
  properties:{
    document_title:{type:'string'},reporting_year:{type:['integer','null']},confidence:{type:'number'},
    warnings:{type:'array',items:{type:'string'}},
    objectives:{type:'array',items:{
      type:'object',additionalProperties:false,required:['source_ref','code','name','confidence','kpis'],
      properties:{
        source_ref:{type:'string'},code:{type:'string'},name:{type:'string'},confidence:{type:'number'},
        kpis:{type:'array',items:{
          type:'object',additionalProperties:false,required:['source_ref','code','name','frequency','responsible','confidence','indicators'],
          properties:{
            source_ref:{type:'string'},code:{type:'string'},name:{type:'string'},frequency:{type:'string',enum:['monthly','quarterly','annual']},responsible:{type:'string'},confidence:{type:'number'},
            indicators:{type:'array',items:{
              type:'object',additionalProperties:false,required:['name','target_value','target_operator','unit','ytd_method','source_text','confidence'],
              properties:{name:{type:'string'},target_value:{type:['number','null']},target_operator:{type:'string',enum:['gte','lte','eq','gt','lt']},unit:{type:['string','null']},ytd_method:{type:'string',enum:['sum','average','last','max','min']},source_text:{type:'string'},confidence:{type:'number'}}
            }}
          }
        }}
      }
    }}
  }
};

function esc(value){if(typeof escH==='function')return escH(value==null?'':String(value));return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function norm(value){return String(value||'').trim().toLowerCase().replace(/\s+/g,' ');}
function companyId(){return typeof ccid==='function'?ccid():((typeof prof!=='undefined'&&prof)&&prof.company_id);}
function selectedYear(){var el=document.getElementById('year-sel');return parseInt(el&&el.value,10)||new Date().getFullYear();}
function canImport(){return typeof isMgr==='function'&&isMgr()&&companyId();}
function message(text,ok){if(typeof toast==='function')toast(text,ok!==false);}
function close(){var modal=document.getElementById('kpi-pdf-modal');if(modal)modal.remove();kpiPdfState={file:null,analysis:null,busy:false,completed:false};}
async function requestClose(){
  if(kpiPdfState.busy)return;
  var hasWork=!kpiPdfState.completed&&(kpiPdfState.file||kpiPdfState.analysis);
  if(hasWork){
    var confirmed=typeof appConfirmAction==='function'
      ?await appConfirmAction({title:'Discard PDF import?',message:'Your selected document and reviewed objective/KPI draft have not been created.',detail:'Choose Continue reviewing to keep this window and all current entries.',confirmText:'Discard import',cancelText:'Continue reviewing',danger:true})
      :window.confirm('Discard this PDF import and all reviewed entries?');
    if(!confirmed)return;
  }
  close();
}
function setBusy(busy,label){kpiPdfState.busy=busy;var button=document.getElementById('kpi-pdf-analyse');if(button){button.disabled=busy;button.innerHTML=busy?'<i class="ti ti-loader-2 kpi-pdf-spin"></i>'+esc(label||'Working...'):'<i class="ti ti-sparkles"></i>Analyse PDF';}}
function confidence(value){var n=Math.round(Number(value)*100);if(!Number.isFinite(n))n=0;return Math.max(0,Math.min(100,n));}
function exactObjective(obj){var rows=typeof kpiObjectives!=='undefined'?kpiObjectives:[];return rows.find(function(row){return norm(row.code)&&norm(row.code)===norm(obj.code)||norm(row.name)===norm(obj.name);});}
function exactKpi(kpi,objective){var rows=typeof kpiKPIs!=='undefined'?kpiKPIs:[];return rows.find(function(row){var sameObjective=!objective||String(row.objective_id)===String(objective.id);return sameObjective&&(norm(row.code)&&norm(row.code)===norm(kpi.code)||norm(row.name)===norm(kpi.name));});}
function statusHtml(obj){var existing=exactObjective(obj);return existing?'<span class="kpi-pdf-state duplicate"><i class="ti ti-link"></i>Existing objective will be reused</span>':'<span class="kpi-pdf-state new"><i class="ti ti-plus"></i>New objective</span>';}
function option(value,current,label){return '<option value="'+esc(value)+'"'+(value===current?' selected':'')+'>'+esc(label||value)+'</option>';}

function open(){
  if(!canImport()){message('Only an authorised manager or administrator working in a selected company can import KPI documents.',false);return;}
  close();
  var modal=document.createElement('div');modal.id='kpi-pdf-modal';modal.className='kpi-pdf-modal';modal.innerHTML='<section class="kpi-pdf-card" role="dialog" aria-modal="true" aria-labelledby="kpi-pdf-title"><header><div><small>GOVERNED DOCUMENT IMPORT</small><h2 id="kpi-pdf-title">Create objectives and KPIs from PDF</h2><p>The PDF is analysed into an editable draft. Nothing is created until you review and confirm it.</p></div><button type="button" class="kpi-pdf-icon" data-kpi-pdf-close aria-label="Close"><i class="ti ti-x"></i></button></header><div class="kpi-pdf-body"><section class="kpi-pdf-upload"><label for="kpi-pdf-file"><i class="ti ti-file-type-pdf"></i><strong>Select a searchable PDF</strong><span>PDF only · maximum 4 MB · the original file is not stored</span></label><input id="kpi-pdf-file" type="file" accept="application/pdf,.pdf"><div id="kpi-pdf-file-name" class="kpi-pdf-file-name">No file selected</div><div class="kpi-pdf-year"><label for="kpi-pdf-year">Reporting year</label><input id="kpi-pdf-year" type="number" min="2000" max="2100" value="'+selectedYear()+'"></div><button id="kpi-pdf-analyse" type="button" class="kpi-pdf-primary" disabled><i class="ti ti-sparkles"></i>Analyse PDF</button></section><div id="kpi-pdf-result"></div></div></section>';
  modal.addEventListener('click',onClick);modal.addEventListener('change',onChange);document.body.appendChild(modal);document.getElementById('kpi-pdf-file').focus();
}

function onChange(event){
  if(event.target.id==='kpi-pdf-file'){
    var file=event.target.files&&event.target.files[0],name=document.getElementById('kpi-pdf-file-name'),button=document.getElementById('kpi-pdf-analyse');kpiPdfState.file=null;kpiPdfState.analysis=null;
    if(!file){name.textContent='No file selected';button.disabled=true;return;}
    if(!/\.pdf$/i.test(file.name)||file.type&&file.type!=='application/pdf'){name.textContent='Choose a PDF file.';button.disabled=true;message('Only PDF documents can be imported here.',false);return;}
    if(file.size>KPI_PDF_MAX_BYTES){name.textContent='This file is larger than 4 MB.';button.disabled=true;message('The PDF must be 4 MB or smaller.',false);return;}
    if(!file.size){name.textContent='This PDF is empty.';button.disabled=true;return;}
    kpiPdfState.file=file;name.textContent=file.name+' · '+Math.ceil(file.size/1024)+' KB';button.disabled=false;
  }
}

function onClick(event){
  if(event.target===event.currentTarget)return;
  if(event.target.closest('[data-kpi-pdf-close]')){requestClose();return;}
  if(event.target.closest('#kpi-pdf-analyse'))analyse();
  if(event.target.closest('#kpi-pdf-create'))createRecords();
  var remove=event.target.closest('[data-kpi-pdf-remove-objective]');if(remove)remove.closest('.kpi-pdf-objective').remove();
  var removeKpi=event.target.closest('[data-kpi-pdf-remove-kpi]');if(removeKpi)removeKpi.closest('.kpi-pdf-kpi').remove();
  var removeInd=event.target.closest('[data-kpi-pdf-remove-indicator]');if(removeInd)removeInd.closest('.kpi-pdf-indicator').remove();
}

function fileBase64(file){return new Promise(function(resolve,reject){var reader=new FileReader();reader.onload=function(){resolve(String(reader.result||'').split(',')[1]||'');};reader.onerror=function(){reject(new Error('The PDF could not be read from this device.'));};reader.readAsDataURL(file);});}
async function extract(file){
  var data=await fileBase64(file),response=await fetch('/api/extract-document',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(typeof tok!=='undefined'?tok:'')},body:JSON.stringify({name:file.name,type:'application/pdf',data:data})});
  var result=await response.json().catch(function(){return {};});if(!response.ok)throw new Error(result.error||'The PDF text could not be extracted.');return result;
}
function cleanAnalysis(value){
  var parsed=value;if(typeof value==='string'){var text=value.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');parsed=JSON.parse(text);}if(!parsed||!Array.isArray(parsed.objectives))throw new Error('The document analysis did not return objectives.');
  parsed.objectives=parsed.objectives.filter(function(o){return o&&String(o.name||'').trim();}).map(function(o,oi){o.code=String(o.code||oi+1);o.kpis=Array.isArray(o.kpis)?o.kpis.filter(function(k){return k&&String(k.name||'').trim();}):[];o.kpis.forEach(function(k,ki){k.code=String(k.code||o.code+'.'+(ki+1));k.frequency=['monthly','quarterly','annual'].includes(k.frequency)?k.frequency:'monthly';k.indicators=Array.isArray(k.indicators)?k.indicators.filter(function(i){return i&&String(i.name||'').trim();}):[];});return o;});return parsed;
}
async function analyse(){
  if(kpiPdfState.busy||!kpiPdfState.file)return;setBusy(true,'Reading PDF...');var result=document.getElementById('kpi-pdf-result');result.innerHTML='<div class="kpi-pdf-progress"><i class="ti ti-loader-2 kpi-pdf-spin"></i><strong>Reading and analysing the document…</strong><span>This may take up to a minute.</span></div>';
  try{
    var extracted=await extract(kpiPdfState.file);if(!extracted.text||extracted.text.length<20)throw new Error('No readable text was found. Scanned image PDFs need OCR before import.');setBusy(true,'Analysing...');
    var year=parseInt(document.getElementById('kpi-pdf-year').value,10)||selectedYear(),instruction='Extract company objectives, KPIs and measurement indicators from the document below for an HSE management system. Use reporting year '+year+'. Extract only information explicitly present in the text. Never invent an owner, target, unit, measurement method, or KPI. If a target is absent, use null and add a warning. Map words such as at least/minimum to gte and at most/maximum to lte. Use monthly unless the document explicitly specifies quarterly or annual. source_ref and source_text must be short traceability excerpts or section/page references, not entire paragraphs. Return only the required JSON.',documentText=extracted.text.slice(0,55000),parts=[{type:'text',text:instruction}];
    for(var offset=0;offset<documentText.length;offset+=11000)parts.push({type:'text',text:'DOCUMENT PART '+(Math.floor(offset/11000)+1)+':\n'+documentText.slice(offset,offset+11000)});
    var raw=await callAI([{role:'user',content:parts}],'You are a conservative HSE performance-management document extraction engine. Preserve source meaning, never manufacture facts, and return valid JSON only.',{max_tokens:4000,response_schema:{name:'kpi_document_import',schema:KPI_PDF_SCHEMA}});
    kpiPdfState.analysis=cleanAnalysis(raw);renderReview(extracted.characters||extracted.text.length);
    if(typeof auditLogEvent==='function')auditLogEvent('analyse','kpi','KPI import document analysed',{file_name:kpiPdfState.file.name,file_size:kpiPdfState.file.size,characters:extracted.characters||extracted.text.length,objective_count:kpiPdfState.analysis.objectives.length,year:year},{company_id:companyId()});
  }catch(error){result.innerHTML='<div class="kpi-pdf-error"><i class="ti ti-alert-triangle"></i><div><strong>PDF could not be analysed</strong><p>'+esc(error.message||error)+'</p><span>If the PDF is scanned, run OCR or export it as a searchable PDF and try again.</span></div></div>';message('PDF analysis failed.',false);}finally{setBusy(false);}
}

function indicatorHtml(ind){var target=ind.target_value==null?'':ind.target_value;return '<div class="kpi-pdf-indicator"><input class="kpi-pdf-ind-name" aria-label="Indicator name" value="'+esc(ind.name)+'"><input class="kpi-pdf-ind-target" aria-label="Target value" type="number" step="any" value="'+esc(target)+'" placeholder="Target"><select class="kpi-pdf-ind-op" aria-label="Target operator">'+option('gte',ind.target_operator,'≥ minimum')+option('lte',ind.target_operator,'≤ maximum')+option('eq',ind.target_operator,'= exact')+option('gt',ind.target_operator,'> greater than')+option('lt',ind.target_operator,'< less than')+'</select><input class="kpi-pdf-ind-unit" aria-label="Unit" value="'+esc(ind.unit||'')+'" placeholder="Unit"><select class="kpi-pdf-ind-ytd" aria-label="Year to date calculation">'+option('sum',ind.ytd_method,'Sum')+option('average',ind.ytd_method,'Average')+option('last',ind.ytd_method,'Latest value')+option('max',ind.ytd_method,'Maximum')+option('min',ind.ytd_method,'Minimum')+'</select><button type="button" class="kpi-pdf-remove" data-kpi-pdf-remove-indicator aria-label="Remove indicator"><i class="ti ti-trash"></i></button>'+(ind.target_value==null?'<span class="kpi-pdf-warning"><i class="ti ti-alert-circle"></i>No target found — add one now or leave it blank.</span>':'')+'</div>';}
function kpiHtml(kpi,obj){var existingObj=exactObjective(obj),duplicate=exactKpi(kpi,existingObj);return '<article class="kpi-pdf-kpi" data-source-ref="'+esc(kpi.source_ref||'')+'"><div class="kpi-pdf-kpi-head"><div class="kpi-pdf-fields"><input class="kpi-pdf-kpi-code" aria-label="KPI code" value="'+esc(kpi.code)+'"><input class="kpi-pdf-kpi-name" aria-label="KPI name" value="'+esc(kpi.name)+'"><select class="kpi-pdf-kpi-frequency" aria-label="Frequency">'+option('monthly',kpi.frequency,'Monthly')+option('quarterly',kpi.frequency,'Quarterly')+option('annual',kpi.frequency,'Annual')+'</select><input class="kpi-pdf-kpi-owner" aria-label="Responsible person" value="'+esc(kpi.responsible||'')+'" placeholder="Responsible (optional)"></div><button type="button" class="kpi-pdf-remove" data-kpi-pdf-remove-kpi aria-label="Remove KPI"><i class="ti ti-trash"></i></button></div><div class="kpi-pdf-meta"><span>'+confidence(kpi.confidence)+'% confidence</span>'+(duplicate?'<span class="kpi-pdf-state duplicate">Exact KPI already exists and will be skipped</span>':'')+'</div><div class="kpi-pdf-indicators">'+kpi.indicators.map(indicatorHtml).join('')+'</div></article>';}
function objectiveHtml(obj,index){return '<section class="kpi-pdf-objective"><div class="kpi-pdf-objective-head"><div><span class="kpi-pdf-number">'+(index+1)+'</span><input class="kpi-pdf-obj-code" aria-label="Objective code" value="'+esc(obj.code)+'"><input class="kpi-pdf-obj-name" aria-label="Objective name" value="'+esc(obj.name)+'"></div><button type="button" class="kpi-pdf-remove" data-kpi-pdf-remove-objective aria-label="Remove objective"><i class="ti ti-trash"></i></button></div><div class="kpi-pdf-meta">'+statusHtml(obj)+'<span>'+confidence(obj.confidence)+'% confidence</span>'+(obj.source_ref?'<span>Source: '+esc(obj.source_ref)+'</span>':'')+'</div><div class="kpi-pdf-kpis">'+obj.kpis.map(function(k){return kpiHtml(k,obj);}).join('')+'</div></section>';}
function renderReview(characters){var analysis=kpiPdfState.analysis,result=document.getElementById('kpi-pdf-result'),warnings=(analysis.warnings||[]).map(function(w){return '<li>'+esc(w)+'</li>';}).join('');result.innerHTML='<section class="kpi-pdf-review"><div class="kpi-pdf-review-head"><div><small>REVIEW BEFORE CREATION</small><h3>'+esc(analysis.document_title||kpiPdfState.file.name)+'</h3><p>'+analysis.objectives.length+' objective(s) found · '+characters+' readable characters · '+confidence(analysis.confidence)+'% document confidence</p></div><span class="kpi-pdf-private"><i class="ti ti-shield-check"></i>Original PDF not stored</span></div>'+(warnings?'<div class="kpi-pdf-warnings"><strong>Review notes</strong><ul>'+warnings+'</ul></div>':'')+'<p class="kpi-pdf-instruction">Correct any field below. Remove anything that should not be created. Blank targets remain unset.</p><div id="kpi-pdf-objectives">'+analysis.objectives.map(objectiveHtml).join('')+'</div><footer><button type="button" class="kpi-pdf-secondary" data-kpi-pdf-close>Cancel</button><button type="button" id="kpi-pdf-create" class="kpi-pdf-primary"><i class="ti ti-database-import"></i>Create reviewed records</button></footer></section>';}

function readDraft(){return Array.from(document.querySelectorAll('.kpi-pdf-objective')).map(function(obj){return {code:obj.querySelector('.kpi-pdf-obj-code').value.trim(),name:obj.querySelector('.kpi-pdf-obj-name').value.trim(),kpis:Array.from(obj.querySelectorAll(':scope > .kpi-pdf-kpis > .kpi-pdf-kpi')).map(function(kpi){return {code:kpi.querySelector('.kpi-pdf-kpi-code').value.trim(),name:kpi.querySelector('.kpi-pdf-kpi-name').value.trim(),frequency:kpi.querySelector('.kpi-pdf-kpi-frequency').value,responsible:kpi.querySelector('.kpi-pdf-kpi-owner').value.trim(),indicators:Array.from(kpi.querySelectorAll('.kpi-pdf-indicator')).map(function(ind){var target=ind.querySelector('.kpi-pdf-ind-target').value;return {name:ind.querySelector('.kpi-pdf-ind-name').value.trim(),target_value:target===''?null:Number(target),target_operator:ind.querySelector('.kpi-pdf-ind-op').value,unit:ind.querySelector('.kpi-pdf-ind-unit').value.trim()||null,ytd_method:ind.querySelector('.kpi-pdf-ind-ytd').value};}).filter(function(ind){return ind.name;})};}).filter(function(kpi){return kpi.name;})};}).filter(function(obj){return obj.name;});}
async function confirmCreate(counts){if(typeof appConfirmAction!=='function')return window.confirm('Create '+counts.objectives+' objectives and '+counts.kpis+' KPIs?');return appConfirmAction({title:'Create reviewed KPI records?',message:counts.objectives+' objective(s), '+counts.kpis+' KPI(s) and '+counts.indicators+' indicator(s) are ready.',detail:'Exact existing objectives will be reused and exact duplicate KPIs will be skipped. New KPIs begin as Not Started.',confirmText:'Create records',cancelText:'Continue reviewing'});}
async function createRecords(){
  if(kpiPdfState.busy)return;var modal=document.getElementById('kpi-pdf-modal'),button=document.getElementById('kpi-pdf-create'),yearInput=document.getElementById('kpi-pdf-year'),year=parseInt(yearInput&&yearInput.value,10)||selectedYear(),draft=readDraft(),counts={objectives:draft.length,kpis:0,indicators:0};draft.forEach(function(o){counts.kpis+=o.kpis.length;o.kpis.forEach(function(k){counts.indicators+=k.indicators.length;});});if(!counts.objectives||!counts.kpis){message('Keep at least one named objective and KPI before creating records.',false);return;}if(!(await confirmCreate(counts)))return;
  if(!modal||!modal.isConnected||!button||!button.isConnected){message('The import window was closed before creation. Reopen it and review the document again.',false);return;}
  kpiPdfState.busy=true;button.disabled=true;button.innerHTML='<i class="ti ti-loader-2 kpi-pdf-spin"></i>Creating…';var result={objectives:0,reused:0,kpis:0,indicators:0,duplicates:0,failures:[]},cid=companyId();
  try{
    for(var oi=0;oi<draft.length;oi++){
      var obj=draft[oi],existing=exactObjective(obj),objective=existing;
      if(existing)result.reused++;else try{var rows=await api('/objectives',{m:'POST',p:'return=representation',b:{company_id:cid,name:obj.name,code:obj.code||String(oi+1),year:year,color:'#1D9E75',created_by:prof&&prof.id}});objective=rows&&rows[0]||rows;if(!objective||!objective.id)throw new Error('No objective record returned');result.objectives++;}catch(error){result.failures.push('Objective "'+obj.name+'": '+(error.message||error));continue;}
      for(var ki=0;ki<obj.kpis.length;ki++){
        var kpi=obj.kpis[ki];if(exactKpi(kpi,objective)){result.duplicates++;continue;}if(!kpi.indicators.length){result.failures.push('KPI "'+kpi.name+'": no measurement indicator');continue;}
        try{var savedRows=await api('/kpis_v2',{m:'POST',p:'return=representation',b:{company_id:cid,objective_id:objective.id,code:kpi.code||obj.code+'.'+(ki+1),name:kpi.name,frequency:kpi.frequency,responsible:kpi.responsible||null,status:'not_started',year:year,created_by:prof&&prof.id}}),saved=savedRows&&savedRows[0]||savedRows;if(!saved||!saved.id)throw new Error('No KPI record returned');result.kpis++;
          for(var ii=0;ii<kpi.indicators.length;ii++){var ind=kpi.indicators[ii];try{await api('/kpi_indicators',{m:'POST',p:'return=minimal',b:{company_id:cid,kpi_id:saved.id,name:ind.name,target_value:Number.isFinite(ind.target_value)?ind.target_value:null,target_operator:ind.target_operator,unit:ind.unit,ytd_method:ind.ytd_method,sort_order:ii}});result.indicators++;}catch(error){result.failures.push('Indicator "'+ind.name+'" for KPI "'+kpi.name+'": '+(error.message||error));}}
        }catch(error){result.failures.push('KPI "'+kpi.name+'": '+(error.message||error));}
      }
    }
    if(typeof auditLogEvent==='function')auditLogEvent(result.failures.length?'partial_import':'import','kpi','KPI document import completed',{file_name:kpiPdfState.file.name,year:year,created_objectives:result.objectives,reused_objectives:result.reused,created_kpis:result.kpis,created_indicators:result.indicators,skipped_duplicates:result.duplicates,failure_count:result.failures.length},{company_id:cid});
    if(typeof kpiLoadAll==='function')await kpiLoadAll();renderOutcome(result);
  }catch(error){result.failures.push(error.message||String(error));renderOutcome(result);}finally{kpiPdfState.busy=false;}
}
function renderOutcome(result){kpiPdfState.completed=true;var root=document.getElementById('kpi-pdf-result');root.innerHTML='<section class="kpi-pdf-outcome '+(result.failures.length?'partial':'success')+'"><i class="ti '+(result.failures.length?'ti-alert-triangle':'ti-circle-check')+'"></i><div><h3>'+(result.failures.length?'Import completed with issues':'Import completed')+'</h3><p>'+result.objectives+' new objective(s), '+result.reused+' existing objective(s) reused, '+result.kpis+' KPI(s), and '+result.indicators+' indicator(s) created. '+result.duplicates+' exact duplicate KPI(s) skipped.</p>'+(result.failures.length?'<details open><summary>'+result.failures.length+' item(s) need attention</summary><ul>'+result.failures.map(function(f){return '<li>'+esc(f)+'</li>';}).join('')+'</ul></details>':'')+'<button type="button" class="kpi-pdf-primary" data-kpi-pdf-close>Close and view KPIs</button></div></section>';}
function bind(){var button=document.getElementById('kpi-x-import-pdf');if(!button)return;if(!button.dataset.kpiPdfBound){button.dataset.kpiPdfBound='1';button.addEventListener('click',open);}button.hidden=!(typeof isMgr==='function'&&isMgr());}
function boot(){bind();var observer=new MutationObserver(bind);observer.observe(document.body,{childList:true,subtree:true});}

window.kpiPdfOpen=open;window.kpiPdfImportSchema=KPI_PDF_SCHEMA;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
