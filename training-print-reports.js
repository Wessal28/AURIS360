(function(root){
'use strict';
var reports={
 matrix:{label:'Training & Competency Matrix',section:'matrix',tables:['people','competencies','competency_matrix']},
 plan:{label:'Training Plan',section:'plan',tables:['training_plan'],host:'#tp-table'},
 records:{label:'Training Records',section:'followup',tables:['training_followup']},
 certificates:{label:'Certificates & Work Permissions Register',section:'auth',tables:['authorisations']},
 inductions:{label:'Induction Register',section:'induction',tables:['induction_records']},
 gaps:{label:'Training Needs & Gap Analysis',section:'tna',tables:['training_needs']},
 competencies:{label:'Competency Catalogue',section:'competency',tables:['competencies']},
 elearning:{label:'E-Learning Enrolments',section:'elearning',tables:['elearning_enrolments','elearning_courses']},
 catalogue:{label:'E-Learning Course Catalogue',section:'elearning',tables:['elearning_courses']},
 assessments:{label:'Practical Assessments',section:'elearning',tables:['learning_practical_assessments']},
 external:{label:'External Training Plan',section:'plan',tables:['training_plan']}
};
var tabMap={sessions:'plan',records:'records',certificates:'certificates',competency:'matrix',gaps:'gaps',inductions:'inductions',elearning:'elearning',catalogue:'catalogue',studio:'catalogue',assessments:'assessments',external:'external'};
var css='/training-print-reports.css?v=20261020-1',baseCSS='/kpi-print-reports.css?v=20261020-1';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function text(v){if(v==null||v==='')return '—';if(typeof v==='boolean')return v?'Yes':'No';if(Array.isArray(v))return v.map(text).join(', ');if(typeof v==='object')return v.full_name||v.name||[v.first_name,v.last_name].filter(Boolean).join(' ')||'Not recorded';return String(v);}
function friendly(v){return text(v).replace(/_/g,' ').replace(/\b[a-z]/g,function(c){return c.toUpperCase();});}
function date(v){if(!v)return '—';var match=String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);return match?match[3]+'/'+match[2]+'/'+match[1]:text(v);}
function localDay(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function outcome(v){return v===true?'Pass':v===false?'Fail':'Pending assessment';}
function allowed(kind){var r=reports[kind],p=typeof prof!=='undefined'?prof:null;return !!r&&(!root.AurisUserAccess||root.AurisUserAccess.sectionAllowed(p,'training',r.section));}
function context(){
 var p=typeof prof!=='undefined'?prof:null,company=String(typeof ccid==='function'?ccid():'');
 if(typeof isSA==='function'&&isSA()&&typeof sephsCompanyContext!=='undefined'&&!sephsCompanyContext)throw Error('Select one company before printing Training reports.');
 if(!p||!p.id||!company)throw Error('Sign in and select one company before printing Training reports.');
 if(root.AurisPlatformServices){root.AurisPlatformServices.rbac.requireAccess('training');if(!root.AurisPlatformServices.auth.isAuthenticated())throw Error('Sign in again before printing.');}
 return {company:company,user:String(p.id),role:String(p.role||'')};
}
function check(expected,kind){var now=context();if(now.company!==expected.company||now.user!==expected.user||now.role!==expected.role)throw Error('Your account or company changed. Close and reopen print options.');if(!allowed(kind))throw Error('You do not have access to this Training report.');}
function brand(c){
 var own=typeof co!=='undefined'?co:null,list=typeof saCompanyList!=='undefined'?saCompanyList:[];
 var selected=list.find(function(row){return String(row.id)===c.company;})||(own&&String(own.id)===c.company?own:null);
 if(!selected||!selected.name)throw Error('The selected company details are unavailable. Reselect the company and retry.');
 return {name:selected.name,logo:selected.logo_url||''};
}
function safeLogo(v){if(!v)return '';if(typeof aurisSafeMediaUrl==='function')return aurisSafeMediaUrl(v,'image');if(/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(v))return v;try{var u=new URL(v,location.href);return u.protocol==='https:'||u.origin===location.origin?u.href:'';}catch(_){return '';}}
async function rows(table,c){
 var path='/'+table+'?select=*&company_id=eq.'+encodeURIComponent(c.company)+'&order=id.asc',data;
 if(typeof apiAllRows==='function')data=await apiAllRows(path);
 else{data=[];for(var page=0;page<100;page++){var batch=await api(path+'&limit=500&offset='+(page*500));if(!Array.isArray(batch))throw Error('Unexpected report response.');data=data.concat(batch);if(batch.length<500)break;if(page===99)throw Error('The report is too large. Narrow the reporting period.');}}
 if(!Array.isArray(data)||data.some(function(row){return !row||String(row.company_id||'')!==c.company;}))throw Error('The report response did not match the selected company. Reload and retry.');
 return data;
}
function table(heads,values,classes){return '<table class="kpr-table trp-table '+(classes||'')+'"><thead><tr>'+heads.map(function(h){return '<th scope="col">'+esc(h)+'</th>';}).join('')+'</tr></thead><tbody>'+values.map(function(row){return '<tr>'+row.map(function(v){return '<td>'+esc(text(v))+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table>';}
function validity(r){var today=localDay(),exp=String(r.expiry_date||'').slice(0,10);return !exp?'No expiry recorded':exp<today?'Expired':exp===today?'Expires today':'Expiry not reached';}
function inYear(row,year,kind){if(!year)return true;if(kind==='plan'||kind==='external')return Number(row.year)===Number(year)||!row.year&&String(row.planned_date||'').slice(0,4)===String(year);var field=kind==='records'?'training_date':kind==='inductions'?'induction_date':kind==='elearning'?'enrolment_date':kind==='assessments'?'scheduled_at':null;return !field||String(row[field]||'').slice(0,4)===String(year);}
function buildMatrix(data,paper){
 var ppl=data.people.filter(function(p){return p.status==='active';}).sort(function(a,b){return text(a.last_name).localeCompare(text(b.last_name));}),comps=data.competencies.slice().sort(function(a,b){return (a.sort_order||0)-(b.sort_order||0)||text(a.name).localeCompare(text(b.name));}),map=new Map();
 data.competency_matrix.forEach(function(r){var key=r.person_id+':'+r.competency_id;map.set(key,map.has(key)?null:r);});
 if(!ppl.length||!comps.length)return {html:'<p class="trp-empty">No active people or competency definitions are recorded for this company.</p>',count:ppl.length};
 var size=paper==='A3'?12:8,html='';
 for(var from=0;from<comps.length;from+=size){var group=comps.slice(from,from+size);html+='<section class="trp-matrix-block"><h2>Competencies '+(from+1)+'–'+(from+group.length)+' of '+comps.length+'</h2><table class="kpr-table trp-table trp-matrix"><thead><tr><th scope="col">Person / Role</th>'+group.map(function(c){return '<th scope="col">'+esc(c.name)+'</th>';}).join('')+'</tr></thead><tbody>';
  ppl.forEach(function(p){html+='<tr><th scope="row">'+esc([p.first_name,p.last_name].filter(Boolean).join(' ')||p.full_name||'Name not recorded')+'<small>'+esc(p.job_title||'Role not recorded')+'</small></th>';group.forEach(function(comp){var key=p.id+':'+comp.id,r=map.get(key),cur=r&&r.current_level,req=r&&r.required_level,validCur=Number.isInteger(cur)&&cur>=0&&cur<=4,validReq=Number.isInteger(req)&&req>=0&&req<=4,gap=validCur&&validReq&&cur<req;html+='<td class="'+(validCur?'trp-level-'+cur:'trp-unassessed')+(gap?' trp-gap':'')+'">'+(map.has(key)&&r===null?'Multiple records<br>Review required':(validCur?cur:'—')+' / '+(validReq?req:'—')+(gap?'<small>Gap</small>':!validCur?'<small>Not assessed</small>':''))+'</td>';});html+='</tr>';});html+='</tbody></table></section>';}
 html='<p class="trp-legend"><strong>Current / required level:</strong> 0 No knowledge · 1 Theoretical · 2 First experience · 3 Good level · 4 Expert. — Not recorded. A gap requires a recorded current level below a recorded required level. Missing levels are never counted as zero.</p>'+html;
 return {html:html,count:ppl.length};
}
function buildRows(kind,data,year,paper){
 if(kind==='matrix')return buildMatrix(data,paper);
 var r=data[reports[kind].tables[0]].filter(function(row){return inYear(row,year,kind);}),heads,values,note='';
 if(kind==='external')r=r.filter(function(row){return /external/i.test(row.training_type||'');});
 if(kind==='plan'||kind==='external'){r.sort(function(a,b){return String(a.planned_date||'').localeCompare(String(b.planned_date||''));});heads=['Reference','Training / Target group','Type','Priority','Planned','Actual','Trainer / Provider','Location','Status'];values=r.map(function(x){return [x.training_ref||x.reference,[x.training_topic,x.target_group].filter(Boolean).join('\n'),friendly(x.training_type),friendly(x.priority),date(x.planned_date),date(x.actual_date),Array.from(new Set([x.trainer,x.training_provider||x.provider||x.provider_name].filter(Boolean))).join('\n'),x.location,friendly(x.status)];});note='Planned or completed session status does not establish attendance, evidence acceptance or competence.';}
 if(kind==='records'){heads=['Person','Training','Training date','Expiry','Attendance','Assessment','Evidence review','Trainer'];values=r.map(function(x){return [x.person_name,x.training_topic,date(x.training_date),x.expiry_date?date(x.expiry_date):'No expiry recorded',friendly(x.attendance_status),outcome(x.passed),friendly(x.evidence_review_status),x.trainer];});note='Assessment, attendance and evidence review are separate recorded outcomes. A training record does not itself authorise work.';}
 if(kind==='certificates'){heads=['Person','Record kind','Certificate / Permission','Reference','Issuer','Issued','Expires','Date validity','Record status'];values=r.map(function(x){return [x.person_name,friendly(x.record_kind),x.authorisation_type,x.reference,x.issuing_body,date(x.issue_date),x.expiry_date?date(x.expiry_date):'No expiry recorded',validity(x),friendly(x.status)];});note='This is a register, not an issued certificate. Original certificate documents remain available through the certificate viewer. Date validity and record status do not grant permission to work.';}
 if(kind==='inductions'){heads=['Person','Department / Role','Induction type','Induction date','Inducted by','Refresher due','Status'];values=r.map(function(x){return [x.person_name,[x.department,x.job_title].filter(Boolean).join('\n'),friendly(x.induction_type),date(x.induction_date),x.inducted_by,date(x.refresher_due_date||x.refresher_due),friendly(x.status)];});note='Recorded status is retained; printing does not confirm checklist completion or understanding.';}
 if(kind==='gaps'){heads=['Role','Training requirement','Category','Requirement','Notes'];values=r.map(function(x){return [x.role_name,x.training_topic,friendly(x.category),({M:'Mandatory',D:'Desirable',N:'Not required'})[x.requirement]||text(x.requirement),x.notes];});note='Training needs are requirements by role; they are not completed learning or competency decisions.';}
 if(kind==='competencies'){heads=['Competency','Category','Description'];values=r.map(function(x){return [x.name,friendly(x.category),x.description];});note='Catalogue definitions do not establish a worker’s competence. Use the Training Matrix for recorded levels.';}
 if(kind==='catalogue'){heads=['Course code','Course','Category','Duration (minutes)','Passing score','Validity (months)','Status'];values=r.map(function(x){return [x.course_code,x.title,friendly(x.category),x.duration_minutes??x.duration_mins,x.passing_score,x.validity_months,friendly(x.status)];});}
 if(kind==='elearning'){var courses=new Map(data.elearning_courses.map(function(x){return [String(x.id),x.title];}));heads=['Person','Course','Enrolled','Target','Completed','Expiry','Status','Score'];values=r.map(function(x){return [x.person_name,x.course_title||courses.get(String(x.course_id))||'Course details not recorded',date(x.enrolment_date),date(x.target_date),date(x.completion_date),date(x.expiry_date),friendly(x.status),x.score];});note='E-learning completion and quiz results do not establish practical competence.';}
 if(kind==='assessments'){heads=['Reference','Candidate','Competency / Scope','Scheduled','Assessor','Result','Critical failure','Status','Verification'];values=r.map(function(x){return [x.reference,x.candidate_name,[x.competency_name,x.scope_text].filter(Boolean).join('\n'),date(x.scheduled_at),x.assessor_name,friendly(x.result),text(x.critical_failure),friendly(x.status),friendly(x.verification_status)];});note='Assessment result, critical failure and verification are displayed separately. Printing does not approve or finalise an assessment.';}
 return {html:values.length?table(heads,values):'<p class="trp-empty">No matching records are available for this reporting scope.</p>',count:r.length,note:note};
}
function currentKind(){var s=typeof root.AurisTrainingReportState==='function'?root.AurisTrainingReportState():{};return tabMap[s.tab]||'plan';}
function canCurrent(kind){var s=typeof root.AurisTrainingReportState==='function'?root.AurisTrainingReportState():{};return !!reports[kind].host&&currentKind()===kind&&s.company===String(ccid());}
function currentTable(kind,c){
 if(!canCurrent(kind))throw Error('Open this Training page and wait for it to load, or select Company records.');
 var host=document.querySelector(reports[kind].host);if(!host||host.querySelector('.loading-msg,[role="alert"],.register-error'))throw Error('The current view is loading or unavailable. Wait for it to finish or select Company records.');
 var clone=host.cloneNode(true);if(root.AurisViewEngine)root.AurisViewEngine.preparePrint(clone);
 var t=clone.querySelector('table');if(!t)throw Error('Select List view to print the currently displayed rows, or choose Company records.');
 var heads=Array.from(t.querySelectorAll('thead tr:first-child th')),actions=heads.map(function(th,i){return /^(actions?|edit)$/i.test(th.textContent.trim())||!th.textContent.trim()?i:-1;}).filter(function(i){return i>=0;}).reverse();
 Array.from(t.rows).forEach(function(row){if(row.cells.length===heads.length)actions.forEach(function(i){row.cells[i].remove();});else Array.from(row.cells).forEach(function(cell){if(cell.colSpan>1)cell.colSpan=Math.max(1,cell.colSpan-actions.length);});});
 t.querySelectorAll('button').forEach(function(b){var span=document.createElement('span');span.textContent=b.textContent;b.replaceWith(span);});t.querySelectorAll('input,select,textarea,script,iframe,i').forEach(function(el){el.remove();});
 [t].concat(Array.from(t.querySelectorAll('*'))).forEach(function(el){Array.from(el.attributes).forEach(function(a){if(/^on|^data-|^tabindex$/.test(a.name)||a.name==='role'&&a.value==='button')el.removeAttribute(a.name);});['position','left','top','z-index','width','min-width','max-width','height','max-height','overflow','display','cursor'].forEach(function(p){el.style.removeProperty(p);});});
 t.className='kpr-table trp-table';check(c,kind);return {html:t.outerHTML,count:t.querySelectorAll('tbody tr').length,note:'Rows, order and columns reflect the displayed list and its personal filters. Edit actions are excluded.'};
}
async function capture(kind,options,c){
 check(c,kind);var branding=brand(c),result;
 if(options.scope==='current')result=currentTable(kind,c);
 else{var tables=reports[kind].tables,data={};await Promise.all(tables.map(async function(t){data[t]=await rows(t,c);}));check(c,kind);result=buildRows(kind,data,options.year,options.paper);}
 var basis={plan:'plan year',external:'plan year',records:'training date',inductions:'induction date',elearning:'enrolment date',assessments:'scheduled date'},period=kind==='matrix'?'Current recorded levels':options.year?'Reporting year '+options.year+' · '+basis[kind]:'All recorded dates';
 return {kind:kind,title:reports[kind].label,company:branding,html:result.html,count:result.count,note:result.note||'',scope:options.scope==='current'?'Currently displayed list · personal filters and columns':period+' · records accessible to your account',paper:options.paper};
}
function documentHtml(s){
 var logo=safeLogo(s.company.logo),zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'local time',stamp=new Date().toLocaleString('en-GB')+' ('+zone+')';
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(s.title+' - '+s.company.name)+'</title><link rel="stylesheet" href="'+baseCSS+'"><link rel="stylesheet" href="'+css+'"></head><body class="kpr-report kpr-'+s.paper.toLowerCase()+'"><nav class="kpr-preview-controls"><button id="trp-print" disabled>Loading layout and logos…</button><button id="trp-close">Close preview</button><span id="trp-status" role="status"></span></nav><main><header class="kpr-header trp-header">'+(logo?'<img class="trp-company-logo" src="'+esc(logo)+'" alt="'+esc(s.company.name)+' logo">':'')+'<div class="kpr-heading"><h1>'+esc(s.company.name)+'</h1><h2>'+esc(s.title)+'</h2><p>'+esc(s.scope)+'</p></div></header><section class="kpr-meta"><p><strong>Generated:</strong> '+esc(stamp)+'</p><p><strong>'+s.count+'</strong> '+(s.kind==='matrix'?'active people':'record rows')+'</p><p>Read-only reporting snapshot</p></section>'+(s.note?'<p class="kpr-note">'+esc(s.note)+'</p>':'')+s.html+'<footer><span>'+esc(s.company.name)+' · '+esc(s.title)+'</span><span class="trp-powered"><img src="/assets/brand/auris360-icon-32.png" alt="AURIS360">Generated by AURIS360</span></footer></main></body></html>';
}
async function ready(w){
 var failed=false,timer;var waits=Array.from(w.document.querySelectorAll('img,link[rel="stylesheet"]')).map(function(el){if(el.tagName==='IMG'&&el.complete){if(!el.naturalWidth){failed=true;el.hidden=true;}return Promise.resolve();}if(el.tagName==='LINK'&&el.sheet)return Promise.resolve();return new Promise(function(resolve){el.addEventListener('load',resolve,{once:true});el.addEventListener('error',function(){failed=true;if(el.tagName==='IMG')el.hidden=true;resolve();},{once:true});});});
 await Promise.race([Promise.all(waits),new Promise(function(resolve){timer=setTimeout(function(){failed=true;resolve();},8000);})]);clearTimeout(timer);if(w.closed)return;
 var b=w.document.getElementById('trp-print');b.disabled=false;b.textContent='Print / Save as PDF';w.document.getElementById('trp-status').textContent=failed?'Some logos or styles could not load. Check the preview before printing.':'Ready · '+(w.document.body.classList.contains('kpr-a3')?'A3':'A4')+' landscape';b.addEventListener('click',function(){w.focus();w.print();});
}
function open(){
 var c;try{c=context();brand(c);}catch(e){if(typeof toast==='function')toast(e.message,false);return;}
 if(document.getElementById('trp-options'))return;
 [baseCSS,css].forEach(function(href){if(!Array.from(document.querySelectorAll('link')).some(function(l){return l.getAttribute('href')===href;})){var l=document.createElement('link');l.rel='stylesheet';l.href=href;document.head.appendChild(l);}});
 var opener=document.activeElement,d=document.createElement('dialog');d.id='trp-options';d.className='kpr-dialog';d.setAttribute('aria-labelledby','trp-title');
 var choices=Object.keys(reports).filter(allowed);if(!choices.length){toast('No Training reports are available for your access.',false);return;}
 d.innerHTML='<form><h2 id="trp-title">Print Training report</h2><p><strong>'+esc(brand(c).name)+'</strong></p><label>Report<select name="report">'+choices.map(function(k){return '<option value="'+k+'">'+esc(reports[k].label)+'</option>';}).join('')+'</select></label><label>Records<select name="scope"><option value="company">Company records</option><option value="current">Currently displayed list</option></select></label><label>Reporting period<select name="period"><option value="all">All recorded dates / current levels</option><option value="year">Selected year</option></select></label><label>Year<input name="year" type="number" min="2000" max="2100" value="'+(typeof trainYear!=='undefined'?Number(trainYear):new Date().getFullYear())+'"></label><label>Paper<select name="paper"><option value="A4">A4 landscape</option><option value="A3">A3 landscape</option></select></label><p data-note>Company records are read afresh and do not use screen filters. For the Training Plan, choose Currently displayed list to retain its filters, order and columns. Print options do not change records or close your editor.</p><p role="alert" data-error></p><div class="kpr-buttons"><button type="button" data-cancel>Cancel</button><button type="submit">Open print preview</button></div></form>';
 document.body.appendChild(d);var f=d.querySelector('form'),r=f.elements.report,scope=f.elements.scope,period=f.elements.period,year=f.elements.year;r.value=choices.includes(currentKind())?currentKind():choices[0];
 function update(){scope.options[1].disabled=!canCurrent(r.value);if(scope.options[1].disabled)scope.value='company';var dated=['plan','external','records','inductions','elearning','assessments'].includes(r.value)&&scope.value!=='current';period.disabled=!dated;year.disabled=!dated||period.value!=='year';f.elements.paper.value=r.value==='matrix'||scope.value==='current'?'A3':'A4';}
 period.value=r.value==='plan'||r.value==='external'?'year':'all';r.addEventListener('change',update);scope.addEventListener('change',update);period.addEventListener('change',function(){year.disabled=period.disabled||period.value!=='year';});update();
 function close(){d.close();d.remove();if(opener&&opener.isConnected)opener.focus();}d.querySelector('[data-cancel]').addEventListener('click',close);d.addEventListener('cancel',function(e){e.preventDefault();close();});
 f.addEventListener('submit',async function(e){e.preventDefault();var error=d.querySelector('[data-error]');error.textContent='';var button=f.querySelector('[type="submit"]'),w;
  try{check(c,r.value);var selectedYear=!period.disabled&&period.value==='year'?Number(year.value):null;if(selectedYear!==null&&(!Number.isInteger(selectedYear)||selectedYear<2000||selectedYear>2100))throw Error('Enter a valid reporting year.');var kind=r.value,opts={scope:scope.value,year:selectedYear,paper:f.elements.paper.value};w=root.open('','_blank','width=1400,height=900');if(!w)throw Error('Allow popups for AURIS360, then retry.');w.document.body.textContent='Preparing Training report…';button.disabled=true;
   var snapshot=await capture(kind,opts,c);check(c,kind);if(w.closed)throw Error('The preview was closed. Please try again.');w.document.open();w.document.write(documentHtml(snapshot));w.document.close();w.document.getElementById('trp-close').addEventListener('click',function(){w.close();});ready(w).catch(function(){if(!w.closed)w.document.getElementById('trp-status').textContent='Preview could not finish loading. Close it and retry.';});close();
  }catch(err){if(w&&!w.closed)w.close();error.textContent=String(err.message||err);}finally{button.disabled=false;}
 });d.showModal();r.focus();
}
root.AurisTrainingPrint={open:open,capture:capture,context:context,brand:brand,buildRows:buildRows,documentHtml:documentHtml,reports:reports,currentKind:currentKind,allowed:allowed,outcome:outcome};
})(window);
