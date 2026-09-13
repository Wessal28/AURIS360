(function(root){
'use strict';
var state=null,sequence=0;
var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var statuses=['submitted','verified','approved','revision_requested','rejected','reopen_requested'];
var labels={submit:'Submit for verification',verify:'Verify month',approve:'Approve month',request_revision:'Request revision',reject:'Reject month',request_reopen:'Request reopening',allow_reopen:'Allow reopening',deny_reopen:'Keep approved'};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function label(v){return String(v||'Not submitted').replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();});}
function scope(){return {company:typeof ccid==='function'?ccid():null,user:typeof prof!=='undefined'&&prof?prof.id:null,role:typeof activeRole==='function'?activeRole():''};}
function current(s){var c=scope();return state===s&&s.company===c.company&&s.user===c.user&&s.role===c.role;}
function status(s){return s.data&&s.data.review?s.data.review.status:'draft';}
function available(s){
  if(!s.data||!current(s)||s.busy||s.uncertain)return [];
  var r=s.data.review,route=r&&['submitted','verified','approved','reopen_requested'].includes(r.status)?r.route:s.data.route,who=s.user;
  if(!route||route.error)return [];
  if(!r||['rejected','revision_requested'].includes(r.status))return route.submitter===who&&!s.data.period_open&&s.data.snapshot.length>0&&s.data.missing===0?['submit']:[];
  if(r.status==='submitted'&&route.reviewer===who)return ['verify','request_revision','reject'];
  if(r.status==='verified'&&route.approver===who)return ['approve','request_revision','reject'];
  if(r.status==='reopen_requested'&&route.approver===who)return ['allow_reopen','deny_reopen'];
  if(r.status==='approved'&&(r.submitted_by===who||['admin','sephs_admin','hse_manager','manager'].includes(s.role)))return ['request_reopen'];
  return [];
}
function validateReview(row,s){return row&&row.id&&row.company_id===s.company&&row.year===s.year&&row.month===s.month&&statuses.includes(row.status)&&Number.isInteger(row.revision)&&row.revision>0&&Array.isArray(row.snapshot)&&row.route&&row.fingerprint;}
function validateData(data,s){return data&&data.company_id===s.company&&data.year===s.year&&data.month===s.month&&Array.isArray(data.snapshot)&&typeof data.fingerprint==='string'&&data.route&&Number.isInteger(data.missing)&&typeof data.period_open==='boolean'&&(!data.review||validateReview(data.review,s));}
function message(error){var raw=String(error&&error.message||error||''),map={
  AURIS_MONTH_REVIEW_BUSY:'Another KPI transaction is in progress. Reload this review before trying again.',
  AURIS_MONTH_REVIEW_CONFLICT:'This review changed in another session. Reload to see the latest decision.',
  AURIS_MONTH_REVIEW_DATA_CHANGED:'Values or the approval route changed after you opened this review. Reload and check them before submitting.',
  AURIS_MONTH_REVIEW_INCOMPLETE:'Complete every due indicator before submitting. Future or empty periods cannot be submitted.',
  AURIS_MONTH_REVIEW_DEFINITION:'A KPI definition is still under review. Complete that review before submitting its monthly results.',
  AURIS_MONTH_REVIEW_ROUTE:'Publish a route with active, unambiguous accounts in KPI Configuration.',
  AURIS_MONTH_REVIEW_ASSIGNEE:'Only the person assigned to this stage can make this decision.',
  AURIS_MONTH_REVIEW_SELF_APPROVAL:'This route requires different people for submission, verification and approval.',
  AURIS_MONTH_REVIEW_REASON:'Enter a reason for this decision.',
  AURIS_MONTH_REVIEW_DENIED:'You no longer have access to this company review.'
};var key=Object.keys(map).find(function(k){return raw.includes(k);});return key?map[key]:'The review outcome could not be confirmed. Reload to check its saved state before another decision. Your reason is retained for copying.';}
function render(s){
  if(state!==s)return;
  if(!current(s)){s.host.innerHTML='<section class="kpi-mr-card" role="dialog" aria-modal="true" aria-label="Monthly KPI review"><h2>Company or account changed</h2><p>Close and reopen the monthly review in the intended company.</p><button type="button" data-mr-close>Close</button></section>';return;}
  var d=s.data,r=d&&d.review,active=r&&['submitted','verified','approved','reopen_requested'].includes(r.status),rows=d?(active?r.snapshot:d.snapshot):[],route=d?(active?r.route:d.route):{},actions=available(s);
  s.host.innerHTML='<section class="kpi-mr-card" role="dialog" aria-modal="true" aria-labelledby="kpi-mr-title"><header><h2 id="kpi-mr-title" tabindex="-1">Monthly KPI review — '+esc(s.year)+'</h2><button type="button" aria-label="Close monthly review" data-mr-close '+(s.busy?'disabled':'')+'>Close</button></header><div class="kpi-mr-toolbar"><label for="kpi-mr-month">Reporting month</label><select id="kpi-mr-month" '+(s.busy?'disabled':'')+'>'+months.map(function(m,n){return '<option value="'+(n+1)+'" '+(s.month===n+1?'selected':'')+'>'+m+' '+s.year+'</option>';}).join('')+'</select><button type="button" data-mr-reload '+(s.busy?'disabled':'')+'>Reload review</button></div><div class="kpi-mr-body">'+
    (s.notice?'<p class="kpi-mr-notice" role="'+(s.error?'alert':'status')+'" tabindex="-1">'+esc(s.notice)+'</p>':'')+
    (s.loading?'<p role="status">Loading monthly review…</p>':d?'<p><strong>'+esc(label(r&&r.status))+'</strong>'+(r?' · Revision '+r.revision:'')+'</p><p>This review covers all due KPIs in the selected company and month, regardless of table filters.</p>'+
    (r&&r.reason?'<p><strong>Last decision reason:</strong> '+esc(r.reason)+'</p>':'')+
    (active?'<p>Submitted values, contributing YTD history and included KPI definitions are protected. Later reporting months remain available. Approved periods require an approved reopening request before correction.</p>':'<p>'+d.missing+' missing result(s) across '+rows.length+' due indicator(s).'+(d.period_open?' This is a future period.':'')+'</p>')+
    (route.error?'<p role="alert">'+esc(route.error)+'</p>':'<dl class="kpi-mr-route"><dt>Submitter</dt><dd>'+esc(route.submitter_name)+'</dd><dt>Reviewer</dt><dd>'+esc(route.reviewer_name)+'</dd><dt>Approver</dt><dd>'+esc(route.approver_name)+'</dd></dl><p>Approval route v'+esc(route.config_version)+' · Self-approval '+(route.self_approval?'enabled':'disabled')+'</p>')+
    '<div class="kpi-mr-table"><table><caption>'+(active?'Submitted results':'Results ready for review')+'</caption><thead><tr><th>KPI / indicator</th><th>Result period</th><th>Actual</th><th>YTD</th><th>Explanation and evidence</th></tr></thead><tbody>'+rows.map(function(e){return '<tr><td>'+esc(e.kpi_code)+' '+esc(e.kpi_name)+'<br>'+esc(e.indicator&&e.indicator.name||'No indicator')+'</td><td>'+esc(months[e.result_month-1])+'</td><td>'+esc(e.result&&e.result.actual!=null?e.result.actual:'Missing')+'</td><td>'+esc(e.result&&e.result.ytd)+'</td><td class="kpi-mr-evidence">'+esc(e.result&&e.result.comment||'—')+'</td></tr>';}).join('')+'</tbody></table></div>':'')+
    '<label for="kpi-mr-reason">Decision reason <small>(required for revision, rejection, reopening or resubmission)</small></label><textarea id="kpi-mr-reason" maxlength="4000" '+(s.busy||s.uncertain?'readonly':'')+'>'+esc(s.reason)+'</textarea></div><footer>'+(s.busy?'<span role="status">Saving decision…</span>':actions.length?actions.map(function(a){return '<button type="button" class="kpi-x-btn '+(['submit','verify','approve','allow_reopen'].includes(a)?'primary':'')+'" data-mr-action="'+a+'">'+labels[a]+'</button>';}).join(''):'<span>'+(s.uncertain?'Reload before making another decision.':'Decisions are available to the assigned person when this period is ready.')+'</span>')+'</footer></section>';
}
async function load(s){
  if(!current(s)){render(s);return;}var id=++s.request;
  s.busy=true;s.loading=true;s.data=null;s.uncertain=false;s.notice=null;render(s);
  try{var d=await api('/rpc/get_kpi_monthly_review',{m:'POST',b:{p_company_id:s.company,p_year:s.year,p_month:s.month}});
    if(!current(s)||id!==s.request)return;if(!validateData(d,s))throw Error('Invalid monthly review response');s.data=d;
  }catch(e){if(!current(s)||id!==s.request)return;s.error=true;s.notice=String(e&&e.message||'').includes('get_kpi_monthly_review')?'Monthly review setup is unavailable. The administrator must apply the monthly review migration.':message(e);
  }finally{if(state===s&&id===s.request){s.busy=false;s.loading=false;render(s);}}
}
async function act(s,action){
  if(!available(s).includes(action))return;
  var d=s.data,r=d.review,reason=s.reason.trim(),required=!['submit','verify','approve'].includes(action)||action==='submit'&&r;
  if(required&&!reason){s.notice='Enter a reason before continuing.';s.error=true;render(s);s.host.querySelector('#kpi-mr-reason').focus();return;}
  s.busy=true;s.notice=null;render(s);var sent=false;
  try{
    if(typeof appConfirmAction!=='function')throw Error('Confirmation unavailable');
    var ok=await appConfirmAction({title:labels[action],message:labels[action]+' for '+months[s.month-1]+' '+s.year+'?',detail:'The decision, assigned route and exact submitted results will be retained in the audit history.',confirmText:labels[action],cancelText:'Back',danger:action==='reject'});
    if(!ok||!current(s))return;
    sent=true;
    var result=await api('/rpc/transition_kpi_monthly_review',{m:'POST',b:{p_company_id:s.company,p_year:s.year,p_month:s.month,p_expected_id:r?r.id:null,p_expected_revision:r?r.revision:null,p_fingerprint:action==='submit'?d.fingerprint:r.fingerprint,p_action:action,p_reason:reason}});
    if(!current(s))return;
    var expected={submit:'submitted',verify:'verified',approve:'approved',request_revision:'revision_requested',reject:'rejected',request_reopen:'reopen_requested',allow_reopen:'revision_requested',deny_reopen:'approved'}[action];
    if(!validateReview(result,s)||result.revision!==(r?r.revision+1:1)||r&&result.id!==r.id||result.status!==expected)throw Error('Unconfirmed monthly decision');
    s.reason='';s.uncertain=false;s.data=Object.assign({},d,{review:result});s.notice=label(result.status)+' saved.';s.error=false;
    // A new preview is required before resubmission after revision/rejection.
    if(['revision_requested','rejected'].includes(result.status))s.uncertain=true;
  }catch(e){if(current(s)){s.notice=message(e);s.error=true;s.uncertain=sent;}}
  finally{if(state===s){s.busy=false;render(s);var notice=s.host.querySelector('[role="alert"],[role="status"]');if(notice)notice.focus();}}
}
function close(){if(!state||state.busy)return;var previous=state.opener;state.host.remove();state=null;if(previous&&previous.isConnected)previous.focus();}
async function open(options){
  if(state&&state.busy)return;
  close();var c=scope();if(!c.company||!c.user)return;
  var date=new Date(),year=Number(options&&options.year||document.getElementById('year-sel')&&document.getElementById('year-sel').value||date.getUTCFullYear());
  var month=Number(options&&options.month|| (year<date.getUTCFullYear()?12:Math.max(1,date.getUTCMonth())));
  var host=document.createElement('div');host.className='kpi-mr-overlay';document.body.appendChild(host);
  var s=state=Object.assign(c,{year:year,month:month,host:host,opener:document.activeElement,request:++sequence,reason:'',busy:false,uncertain:false});
  host.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-mr-close'))close();else if(b.hasAttribute('data-mr-reload')&&!s.busy)load(s);else if(b.dataset.mrAction)act(s,b.dataset.mrAction);});
  host.addEventListener('input',function(e){if(e.target.id==='kpi-mr-reason')s.reason=e.target.value;});
  host.addEventListener('change',function(e){if(e.target.id==='kpi-mr-month'&&!s.busy){s.month=Number(e.target.value);load(s);}});
  host.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){var list=Array.from(host.querySelectorAll('button:not([disabled]),select:not([disabled]),textarea:not([disabled])'));var first=list[0],last=list[list.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
  await load(s);if(current(s)){var heading=host.querySelector('#kpi-mr-title');if(heading)heading.focus();}
}
async function openRecord(id,company){if(company!==scope().company)throw Error('Select the review company first.');var rows=await api('/kpi_monthly_reviews?id=eq.'+encodeURIComponent(id)+'&company_id=eq.'+encodeURIComponent(company));if(company!==scope().company||!Array.isArray(rows)||rows.length!==1||rows[0].id!==id||rows[0].company_id!==company)throw Error('The monthly review could not be verified.');return open({year:rows[0].year,month:rows[0].month});}
root.KpiMonthlyReview=Object.freeze({open:open,openRecord:openRecord,close:close});
})(typeof window!=='undefined'?window:globalThis);
