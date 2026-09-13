var prof={id:'owner'},ccid=()=> 'fixture-company',activeRole=()=> 'admin';
var fixtureReview=null,fixtureMode='success';
var fixtureRoute={submitter:'owner',reviewer:'reviewer',approver:'approver',submitter_name:'Synthetic Submitter',reviewer_name:'Synthetic Reviewer',approver_name:'Synthetic Approver',config_version:1,self_approval:false};
var fixtureRows=[{kpi_id:'k',kpi_code:'QA.127',kpi_name:'Monthly review acceptance',definition_revision:1,indicator_id:'i',indicator:{name:'Evidence count'},result_month:8,result:{actual:2,ytd:5,comment:'QA-127\nChecked evidence reference'}}];
function appConfirmAction(opts){return new Promise(resolve=>{var d=document.getElementById('fixture-confirm');document.getElementById('fixture-title').textContent=opts.title;document.getElementById('fixture-message').textContent=opts.message;var button=document.getElementById('fixture-confirm-action');button.textContent=opts.confirmText;document.getElementById('fixture-back').onclick=()=>{d.close();resolve(false);};button.onclick=()=>{d.close();resolve(true);};d.showModal();});}
async function api(url,options){var b=options.b;if(url.includes('get_kpi'))return {company_id:'fixture-company',year:b.p_year,month:b.p_month,review:fixtureReview&&structuredClone(fixtureReview),snapshot:fixtureRows,route:fixtureRoute,fingerprint:'qa-fingerprint',missing:fixtureMode==='missing'?1:0,period_open:false};
 if(fixtureMode==='conflict')throw Error('AURIS_MONTH_REVIEW_CONFLICT');
 fixtureReview={id:'qa-review',company_id:'fixture-company',year:b.p_year,month:b.p_month,revision:(fixtureReview?.revision||0)+1,status:({submit:'submitted',verify:'verified',approve:'approved',request_revision:'revision_requested',reject:'rejected',request_reopen:'reopen_requested',allow_reopen:'revision_requested',deny_reopen:'approved'})[b.p_action],snapshot:fixtureRows,route:fixtureRoute,fingerprint:'qa-fingerprint',submitted_by:'owner',reason:b.p_reason};
 document.getElementById('fixture-status').textContent=fixtureReview.status+' · revision '+fixtureReview.revision;
 if(fixtureMode==='lost')throw Error('Lost acknowledgement');return structuredClone(fixtureReview);
}
document.getElementById('fixture-open').onclick=()=>KpiMonthlyReview.open({year:2025,month:8});
document.getElementById('fixture-role').onchange=e=>{prof.id=e.target.value;};
document.getElementById('fixture-mode').onchange=e=>{fixtureMode=e.target.value;fixtureReview=null;document.getElementById('fixture-status').textContent='No submission';};
