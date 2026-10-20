(function(root){
'use strict';
var sequence=0,active=null;
var editRoles=['admin','sephs_admin','hse_manager','hse_officer','manager','site_manager','supervisor','compliance_manager','legal_reviewer','document_controller'];
var statuses={draft:'Draft',submitted:'Submitted for review',completed:'Completed',reviewed:'Reviewed',approved:'Approved',archived:'Archived',not_assessed:'Not assessed',compliant:'Compliant',partial:'Partial compliance',non_compliant:'Non-compliant',not_applicable:'Not applicable'};
function ensureStyle(){if(!root.document||root.document.getElementById('legal-assessment-viewer-style'))return;var style=root.document.createElement('link');style.id='legal-assessment-viewer-style';style.rel='stylesheet';style.href='/legal-assessment-viewer.css?v=20261020-1';(root.document.head||root.document.documentElement).appendChild(style);}
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function text(value,fallback){if(typeof value!=='string'&&typeof value!=='number')return fallback||'';var result=String(value).trim();return result||fallback||'';}
function named(value,fallback){var result=text(value);return /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(result)?fallback||'Name not recorded':result||fallback||'Not recorded';}
function friendly(value){var raw=text(value);return statuses[raw]||raw.replace(/_/g,' ').replace(/^./,function(c){return c.toUpperCase();})||'Not recorded';}
function dateLabel(value){var raw=text(value).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)||!Number.isFinite(Date.parse(raw+'T12:00:00Z'))||new Date(raw+'T12:00:00Z').toISOString().slice(0,10)!==raw)return 'Not recorded';return raw.slice(8,10)+'/'+raw.slice(5,7)+'/'+raw.slice(0,4);}
function number(value,maximum){if(typeof value!=='string'&&typeof value!=='number'||typeof value==='string'&&!value.trim())return null;var result=Number(value);return Number.isFinite(result)&&result>=0&&(maximum==null||result<=maximum)?result:null;}
function count(value){var result=number(value);return result!==null&&Number.isInteger(result)?String(result):'Not recorded';}
function paragraph(value,fallback){return '<p>'+esc(text(value,fallback||'Not recorded.')).replace(/\r?\n/g,'<br>')+'</p>';}
function field(label,value){return '<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>';}
function narrative(title,value,fallback){return '<section class="lav-narrative"><h3>'+esc(title)+'</h3>'+paragraph(value,fallback)+'</section>';}
function worksheetRows(value){if(typeof value==='string'){try{value=JSON.parse(value);}catch(_){return [];}}return Array.isArray(value)?value.filter(function(row){return row&&typeof row==='object'&&!Array.isArray(row);}):[];}
function savedRequirement(row,index){
  var snapshot=row.requirement_snapshot&&typeof row.requirement_snapshot==='object'?row.requirement_snapshot:{},reference=named(row.req_ref||row.requirement_ref||snapshot.req_ref||snapshot.reference,''),title=text(row.title||row.legislation||snapshot.title||snapshot.legislation),wording=text(row.requirement_text||row.requirement||snapshot.requirement_text||snapshot.requirement),result=friendly(row.status||row.compliance_status||'not_assessed');
  if(reference==='Not recorded'||reference==='Name not recorded')reference='';
  var heading=(reference?reference+' · ':'')+(title||'Requirement '+(index+1));
  var html='<section class="lav-requirement"><h3>'+esc(heading)+'</h3><p class="lav-result">Recorded result: <span class="lav-status">'+esc(result)+'</span></p>';
  html+=paragraph(wording,'Requirement wording was not retained in this saved worksheet.');
  html+='<dl class="lav-worksheet-fields">'+field('Current controls',text(row.controls||row.current_controls,'Not recorded'))+field('Further controls / action',text(row.recommendation||row.recommendations||row.further_controls||row.action_required||row.gap_description,'Not recorded'))+field('Action owner',named(row.responsible||row.responsibility||row.responsible_person||row.owner_name,'Not recorded'))+field('Target date',dateLabel(row.target_date||row.due_date));
  if(text(snapshot.section))html+=field('Saved section',text(snapshot.section));
  if(text(snapshot.source_reference))html+=field('Saved source reference',text(snapshot.source_reference));
  var gap=typeof row.gap==='boolean'?row.gap:typeof row.gap_identified==='boolean'?row.gap_identified:null;if(gap!==null)html+=field('Gap recorded',gap?'Yes':'No');
  if(row.action_ref)html+=field('Saved action reference',named(row.action_ref,'Reference not recorded'));
  html+='</dl></section>';return html;
}
function build(record){
  record=record||{};var title=named(record.title,'Compliance assessment'),reference=named(record.assessment_ref,'Reference not recorded'),rows=worksheetRows(record.worksheet),score=number(record.overall_score,100),status=text(record.status,'draft'),html='<article class="legal-assessment-report"><p class="lav-reference">Assessment reference: '+esc(reference)+'</p>';
  html+='<dl class="lav-summary">'+field('Status',friendly(status))+field('Assessment date',dateLabel(record.assessment_date))+field('Assessor',named(record.assessor,'Name not recorded'))+field('Assessment type',friendly(record.assessment_type))+field('Revision',record.revision==null?'Not recorded':count(record.revision))+field('Next assessment',dateLabel(record.next_assessment_date))+'</dl>';
  var assurance=status==='approved'?(record.approved_at?'Approved assessment. This view reproduces the saved assessment; it does not recalculate current compliance.':'Recorded as Approved. An authenticated approval timestamp was not retained with this record.'):'Saved '+friendly(status).toLowerCase()+' assessment. Its reported results must be read with this workflow status; this view does not publish or approve results.';
  html+='<p class="lav-note">'+esc(assurance)+'</p>'+narrative('Assessment scope',record.scope);
  html+='<section class="lav-totals"><h3>Saved reported totals</h3><p>These figures were stored with the assessment. They are not recalculated from the current legal register.</p><table><thead><tr><th scope="col">Total requirements</th><th scope="col">Compliant</th><th scope="col">Partial</th><th scope="col">Non-compliant</th><th scope="col">Not applicable</th><th scope="col">Reported score</th></tr></thead><tbody><tr><td>'+count(record.total_requirements)+'</td><td>'+count(record.compliant_count)+'</td><td>'+count(record.partial_count)+'</td><td>'+count(record.non_compliant_count)+'</td><td>'+count(record.na_count)+'</td><td>'+(score===null?'Not recorded':esc(String(Math.round(score*100)/100))+'%')+'</td></tr></tbody></table></section>';
  html+=narrative('Methodology',record.methodology)+narrative('Findings',record.findings)+narrative('Overall recommendations',record.recommendations);
  html+='<section class="lav-worksheet"><h3>Saved requirement worksheet</h3>';
  if(!rows.length)html+='<p class="lav-note">The saved detailed worksheet is unavailable for this assessment. Only the retained summary and reported totals are shown. No present-day legal requirements or assessment results have been substituted.</p>';
  else{
    html+='<p>'+rows.length+' saved requirement row'+(rows.length===1?'':'s')+'. References and wording appear only where they were retained in the saved worksheet.</p>';
    if(number(record.total_requirements)!==null&&Number(record.total_requirements)!==rows.length)html+='<p class="lav-note">The saved worksheet row count differs from the reported total. The original saved figures are preserved above.</p>';
    html+=rows.map(savedRequirement).join('');
  }
  html+='</section>';
  if(record.approved_by||record.approved_at||record.approved_date||record.decision_note)html+='<section class="lav-approval"><h3>Recorded approval details</h3><dl class="lav-summary">'+field('Approver',named(record.approved_by,'Name not recorded'))+field('Approval date',dateLabel(record.approved_at||record.approved_date))+'</dl>'+narrative('Decision note',record.decision_note)+'</section>';
  if(text(record.linked_audit_ref))html+=narrative('Linked audit reference',named(record.linked_audit_ref,'Reference not recorded'));
  return {title:title,reference:reference,html:html+'</article>',worksheetRows:rows.length};
}
function context(){
  var profile=root.prof,company=typeof root.ccid==='function'?root.ccid():'',role=typeof root.activeRole==='function'?root.activeRole():profile&&profile.role,policy=root.AurisUserAccess;
  if(!profile||!profile.id||!company||!role||typeof root.canAccessPage!=='function'||!root.canAccessPage('legal')||(policy&&typeof policy.sectionAllowed==='function'&&!policy.sectionAllowed(profile,'legal','assessments')))throw Error('Sign in and select a company with access to Compliance Assessments.');
  return {company:String(company),user:String(profile.id),role:String(role)};
}
function assertContext(expected){var actual=context();if(actual.company!==expected.company||actual.user!==expected.user||actual.role!==expected.role)throw Error('Your account, company or access changed. Reopen this assessment.');return actual;}
async function fetchReport(id,expected){
  assertContext(expected);id=String(id||'').trim();if(!id||id.length>150)throw Error('Select an exact saved assessment.');
  if(typeof root.api!=='function')throw Error('The assessment service is unavailable. Reload Legal Compliance.');
  var records=await root.api('/compliance_assessments?select=*&company_id=eq.'+encodeURIComponent(expected.company)+'&id=eq.'+encodeURIComponent(id)+'&limit=2');assertContext(expected);
  if(!Array.isArray(records)||records.length!==1||!records[0]||String(records[0].id)!==id||String(records[0].company_id||'')!==expected.company)throw Error('This assessment is unavailable in the selected company.');
  return Object.assign(build(records[0]),{context:expected,record:records[0]});
}
function report(id){var captured=context();return fetchReport(id,captured);}
function element(tag,className,value){var item=root.document.createElement(tag);if(className)item.className=className;if(value!=null)item.textContent=value;return item;}
function button(label,handler){var item=element('button','lav-button',label);item.type='button';item.addEventListener('click',handler);return item;}
function canEdit(record){var c=context(),policy=root.AurisUserAccess;return !record.archived_at&&!['approved','archived'].includes(text(record.status))&&editRoles.includes(c.role)&&(!policy||typeof policy.allowed!=='function'||policy.allowed(root.prof,'legal','edit')&&policy.allowed(root.prof,'legal.assessments','edit'))&&typeof root.lcaEdit==='function';}
function close(){sequence++;if(!active)return;var old=active;active=null;root.document.removeEventListener('keydown',old.keydown);old.modal.remove();if(old.returnFocus&&old.returnFocus.isConnected&&typeof old.returnFocus.focus==='function')old.returnFocus.focus();}
function ensureCurrent(view){assertContext(view.context);if(active!==view||!view.modal.isConnected)throw Error('This assessment view was closed or replaced. Reopen it.');}
function feedback(view,message,error){view.feedback.textContent=message;view.feedback.setAttribute('role',error?'alert':'status');view.feedback.classList.toggle('lav-error',!!error);}
async function open(id){
  var captured;try{captured=context();}catch(error){if(typeof root.toast==='function')root.toast(error.message,false);return false;}
  close();var ticket=++sequence,modal=element('div','lav-modal'),dialog=element('section','lav-dialog'),head=element('header','lav-header'),headText=element('div'),heading=element('h2',null,'View assessment'),body=element('div','lav-body'),foot=element('footer','lav-footer'),message=element('p','lav-feedback'),actions=element('div','lav-actions');
  modal.id='legal-assessment-viewer';heading.id='lav-title';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','lav-title');body.setAttribute('aria-busy','true');body.appendChild(element('p',null,'Loading saved assessment…'));headText.appendChild(element('p','lav-kicker','View assessment'));headText.appendChild(heading);head.appendChild(headText);head.appendChild(button('Close',close));dialog.appendChild(head);dialog.appendChild(body);foot.appendChild(message);foot.appendChild(actions);actions.appendChild(button('Close',close));dialog.appendChild(foot);modal.appendChild(dialog);
  var view={modal:modal,dialog:dialog,heading:heading,body:body,actions:actions,feedback:message,context:captured,returnFocus:root.document.activeElement,id:String(id||'')};active=view;
  view.keydown=function(event){if(active!==view)return;if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key!=='Tab')return;var focusable=Array.from(dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]'));if(!focusable.length)return;var first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&root.document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&root.document.activeElement===last){event.preventDefault();first.focus();}};
  modal.addEventListener('click',function(event){if(event.target===modal)close();});root.document.addEventListener('keydown',view.keydown);root.document.getElementById('r5-generic-viewer')?.remove();root.document.body.appendChild(modal);head.querySelector('button')?.focus();
  try{
    var saved=await fetchReport(id,captured);if(ticket!==sequence||active!==view||!modal.isConnected)return false;ensureCurrent(view);heading.textContent=saved.title;body.innerHTML=saved.html;body.setAttribute('aria-busy','false');actions.replaceChildren();
    var edit=null,print=button('Print preview',async function(){var prepared;try{ensureCurrent(view);if(print.disabled)return;if(!root.AurisModuleReports||typeof root.AurisModuleReports.preview!=='function'||typeof root.AurisModuleReports.reserve!=='function')throw Error('Report preview is unavailable. Reload Legal Compliance and retry.');print.disabled=true;prepared=root.AurisModuleReports.reserve();feedback(view,'Refreshing the saved assessment for print preview…');saved=await fetchReport(view.id,captured);ensureCurrent(view);heading.textContent=saved.title;body.innerHTML=saved.html;if(edit&&!canEdit(saved.record)){edit.remove();edit=null;}var result=await root.AurisModuleReports.preview({moduleKey:'legal',title:saved.title,html:saved.html,context:captured,section:'assessments',sourceLabel:'Saved assessment '+saved.reference,preparedWindow:prepared});ensureCurrent(view);if(result===false)throw Error('The print preview did not open. Retry and allow the preview window.');feedback(view,'Print preview opened from the latest saved assessment. Use Print / Save PDF in the preview.');}catch(error){if(prepared&&!prepared.closed)prepared.close();if(active===view)feedback(view,error.message,true);}finally{print.disabled=false;}});actions.appendChild(print);
    if(canEdit(saved.record)){edit=button('Edit assessment',async function(){try{ensureCurrent(view);if(!canEdit(saved.record))throw Error('Your access to edit this assessment changed.');await root.lcaEdit(view.id);ensureCurrent(view);close();}catch(error){if(active===view)feedback(view,error.message,true);}});actions.appendChild(edit);}
    actions.appendChild(button('Close',close));feedback(view,'Read-only saved assessment.');return true;
  }catch(error){if(ticket!==sequence||active!==view||!modal.isConnected)return false;body.replaceChildren(element('p',null,'The saved assessment could not be opened.'));body.setAttribute('aria-busy','false');feedback(view,error.message,true);try{assertContext(captured);actions.prepend(button('Retry',function(){open(id);}));}catch(_){}return false;}
}
function enhance(){
  var captured;try{captured=context();}catch(_){return;}var host=root.document.getElementById('lca-list');if(!host)return;
  host.querySelectorAll('tbody tr').forEach(function(row){if(row.querySelector('.lav-view-assessment'))return;var edit=row.querySelector('button[data-id]'),id=edit&&edit.dataset.id,record=(root.lcaAllData||[]).find(function(item){return String(item.id)===String(id)&&String(item.company_id||'')===captured.company;});if(!edit||!record)return;
    var view=button('',function(event){event.stopPropagation();try{assertContext(captured);open(id);}catch(error){if(typeof root.toast==='function')root.toast(error.message,false);}});view.className='btn btn-sm lav-view-assessment';view.title='View assessment';view.setAttribute('aria-label','View assessment '+named(record.assessment_ref||record.title,'record'));var icon=element('i','ti ti-eye');icon.setAttribute('aria-hidden','true');view.appendChild(icon);edit.parentNode.insertBefore(view,edit);
  });
}
root.AurisLegalAssessmentViewer=Object.freeze({version:'1.0.0',open:open,close:close,report:report,build:build,context:context,enhance:enhance});
ensureStyle();
if(typeof root.lcaLoad==='function'){var baseLoad=root.lcaLoad;root.lcaLoad=async function(){var captured;try{captured=context();}catch(_){return;}var result=await baseLoad.apply(this,arguments);try{assertContext(captured);enhance();}catch(_){}return result;};}
if(root.document)enhance();
})(typeof window!=='undefined'?window:globalThis);
