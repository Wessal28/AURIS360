/* PPE record presentation. All record loads remain authenticated and company scoped. */
function ppeRecordTable(kind){return {catalogue:'ppe_catalogue',issuance:'ppe_issuance',inspections:'ppe_inspections',replacements:'ppe_replacements'}[kind];}
function ppeRecordKind(table){return {ppe_catalogue:'catalogue',ppe_issuance:'issuance',ppe_inspections:'inspections',ppe_replacements:'replacements'}[table];}
document.addEventListener('click',function(event){
  var node=event.target.closest('[data-ppe-view],[data-ppe-edit]');
  if(!node||!node.closest('#page-ppe'))return;
  // A certificate link or explicit action inside a row retains its own action.
  if(node.tagName==='TR'&&event.target.closest('a,button,input,select'))return;
  event.preventDefault();event.stopImmediatePropagation();
  ppeRecordWindow(node.dataset.ppeView||node.dataset.ppeEdit,node.dataset.id,node.dataset.ppeEdit?'edit':'view');
},true);
function ppeRecordWindow(kind,id,mode){
  if(!ppeRecordTable(kind)||!id)return;
  if(mode==='edit'&&!isMgr()){toast('Manager access is required to edit PPE records.',false);return;}
  var url=new URL(deepLinkRecordUrl({module:'ppe',id:id,table:ppeRecordTable(kind),company_id:ccid()}));
  url.searchParams.set('ppeWindow','1');url.searchParams.set('ppeMode',mode==='edit'?'edit':'view');
  var child=window.open(url.toString(),'_blank','width=1180,height=860');
  if(!child)toast('Allow popups to open the PPE record in a separate window.',false);
  else child.opener=null;
}
var ppeOpeningLinkedRecord=false;
async function ppeOpenLinkedRecord(req){
  var kind=ppeRecordKind(req.table||'ppe_catalogue'),company=String(ccid()||'');
  if(!kind||!company)throw Error('Select a company to open this PPE record.');
  if(req.company&&String(req.company)!==company)throw Error('Select the company that owns this PPE record.');
  var rows=await api('/'+ppeRecordTable(kind)+'?select=*&id=eq.'+encodeURIComponent(req.record)+'&company_id=eq.'+encodeURIComponent(company));
  if(String(ccid())!==company)throw Error('Company changed. Reopen the record.');
  var row=(rows||[]).find(function(x){return String(x.id)===String(req.record)&&String(x.company_id)===company;});
  if(!row)return false;
  var edit=new URLSearchParams(location.search).get('ppeMode')==='edit';
  if(edit){
    if(!isMgr())throw Error('Manager access is required to edit PPE records.');
    await ppeRefreshPeople();
    document.querySelectorAll('#page-ppe [id^="ppe-view-"]').forEach(function(el){el.style.display='none';});
    ppeOpeningLinkedRecord=true;
    try{
      if(kind==='catalogue'){ppeCatData=[row];await ppeCatEdit(row.id);}
      if(kind==='issuance'){ppeIssData=[row];await ppeIssEdit(row.id);}
      if(kind==='inspections'){ppeInspData=[row];await ppeInspEdit(row.id);}
      if(kind==='replacements'){ppeRepData=[row];await ppeRepEdit(row.id);}
    }finally{ppeOpeningLinkedRecord=false;}
  }else ppeShowRecord(kind,row);
  return true;
}
async function ppeRefreshPeople(){
  var company=String(ccid()||'');if(!company)throw Error('Select a company first.');
  var rows=await api('/people?select=id,company_id,first_name,last_name,job_title,department,employee_number,id_number,person_type,email,phone&company_id=eq.'+encodeURIComponent(company)+'&status=eq.active&order=last_name');
  if(String(ccid())!==company)throw Error('Company changed. Reopen the PPE form.');
  people=(rows||[]).filter(function(p){return String(p.company_id)===company;});
  fillPplDrops();
  if(!people.length)toast('No active people are registered for this company. Add employees in People first.',false);
}
function ppeRecordDetails(kind,row){
  var hidden=['id','company_id','created_by','updated_by','certificate_url','conformity_certificate_url'];
  var groups={};
  Object.keys(row).forEach(function(key){
    if(hidden.includes(key)||row[key]===null||row[key]==='')return;
    var value=row[key];if(key==='notes')value=ppeStripCertMeta(value);
    if(!value&&value!==0&&value!==false)return;
    if(typeof value==='boolean')value=value?'Yes':'No';
    else if(Array.isArray(value))value=value.map(function(x){return typeof x==='object'?JSON.stringify(x):x;}).join(', ');
    else if(typeof value==='object')value=JSON.stringify(value);
    if(key==='category')value=(PPE_CAT_CFG[value]||{}).label||value;
    var group=/employee|department|job_title|issued_by|requested_by/.test(key)?'People':/quantity|stock|reorder|cost|supplier|location/.test(key)?'Stock & supply':/date|expiry|service_life|inspection_interval/.test(key)?'Dates & assurance':/notes|reason|defect|checklist|action/.test(key)?'Notes & findings':'Record details';
    (groups[group]||(groups[group]=[])).push('<div class="ppe-record-field"><dt>'+escH(key.replace(/_/g,' '))+'</dt><dd>'+escH(String(value).replace(/_/g,' '))+'</dd></div>');
  });
  return Object.keys(groups).map(function(group){return '<section class="ppe-record-section"><h3>'+escH(group)+'</h3><dl>'+groups[group].join('')+'</dl></section>';}).join('');
}
function ppeShowRecord(kind,row){
  document.getElementById('ppe-record-view')?.remove();
  var company=String(ccid()),host=document.createElement('div');host.id='ppe-record-view';host.className='ppe-record-overlay';
  var title=row.name||row.ppe_name||'PPE record',ref=row.ppe_code||row.issuance_ref||row.inspection_ref||row.replacement_ref||'';
  var cert=ppeReadCertMeta(row),url=aurisSafeUrl(cert.url);
  host.innerHTML='<section class="ppe-record-window" role="dialog" aria-modal="true" aria-labelledby="ppe-record-title"><header><div><p>PPE · '+escH(kind)+' · Read only</p><h2 id="ppe-record-title">'+escH(title)+'</h2><p>'+escH(ref)+' · '+escH(row.employee_name||row.status||'')+'</p></div><button class="btn" data-ppe-action="close">Close</button></header><nav aria-label="Record actions"><button class="btn" data-ppe-action="print">Print record</button>'+(row.employee_name?'<button class="btn" data-ppe-action="employee">Print employee PPE history</button>':'')+(isMgr()?'<button class="btn btn-primary" data-ppe-action="edit">Edit record</button>':'')+'</nav><div class="ppe-record-content">'+(kind==='catalogue'?'<section class="ppe-record-section ppe-record-certificate"><h3>MSB / conformity certificate</h3>'+ppeCertBadge(cert)+(url?'<p><a class="btn" target="_blank" rel="noopener noreferrer" href="'+escH(url)+'">View certificate</a></p>':'<p>No certificate file or link attached.</p>')+'</section>':'')+ppeRecordDetails(kind,row)+'</div></section>';
  document.body.appendChild(host);
  function valid(){if(String(ccid())!==company||!canAccessPage('ppe')){host.remove();throw Error('Company or access changed. Reopen this record.');}}
  host.querySelector('[data-ppe-action="close"]').onclick=function(){host.remove();};
  host.querySelector('[data-ppe-action="edit"]')?.addEventListener('click',function(){valid();ppeRecordWindow(kind,row.id,'edit');});
  host.querySelector('[data-ppe-action="print"]').onclick=function(){valid();ppePrintRecord(kind,row);};
  host.querySelector('[data-ppe-action="employee"]')?.addEventListener('click',function(){valid();ppePrintEmployee(row);});
  host.addEventListener('keydown',function(e){if(e.key==='Escape')host.remove();});
  host.querySelector('button').focus();
}
function ppePrintRecord(kind,row){
  aurisPrint('<div class="report-page">'+aurisHeader('PPE Record',printReportContextLabel(),'')+'<h2>'+escH(row.name||row.ppe_name||'PPE')+'</h2>'+ppeRecordDetails(kind,row)+aurisFooter('PPE record')+'</div>','PPE Record');
}
async function ppePrintEmployee(row){
  var company=String(ccid()),name=row.employee_name;
  if(!name)return;
  var printWindow=window.open('','_blank','width=1180,height=860');
  if(!printWindow){toast('Allow popups to print employee records.',false);return;}
  printWindow.document.body.textContent='Loading employee PPE records…';
  try{
    var sets=await Promise.all(['ppe_issuance','ppe_inspections','ppe_replacements'].map(function(table){return api('/'+table+'?select=*&company_id=eq.'+encodeURIComponent(company)+'&employee_name=eq.'+encodeURIComponent(name));}));
    if(String(ccid())!==company||!canAccessPage('ppe'))throw Error('Company or access changed. Reopen the record.');
    // Issuance stores employee ID; where available exclude another employee with the same name.
    var titles=['Issuance','Inspections','Replacement requests'];
    var html=sets.map(function(rows,i){rows=(rows||[]).filter(function(x){return String(x.company_id)===company&&(!row.employee_id||!x.employee_id||x.employee_id===row.employee_id);});return '<h3>'+titles[i]+'</h3><table><thead><tr><th>Reference</th><th>PPE item</th><th>Date</th><th>Status / result</th></tr></thead><tbody>'+rows.map(function(x){return '<tr><td>'+escH(x.issuance_ref||x.inspection_ref||x.replacement_ref||'—')+'</td><td>'+escH(x.ppe_name||'—')+'</td><td>'+escH(x.issued_date||x.inspection_date||x.requested_date||'—')+'</td><td>'+escH(x.status||x.overall_result||'—')+'</td></tr>';}).join('')+'</tbody></table>'+(!rows.length?'<p>No records.</p>':'');}).join('');
    aurisPrint('<div class="report-page">'+aurisHeader('PPE Employee History',name+' · '+printReportContextLabel(),'')+'<p class="rpt-print-note">Historical inspection and replacement records are matched by recorded employee name. Check the employee details where names are shared.</p>'+html+aurisFooter('PPE employee history')+'</div>','PPE Employee History',printWindow);
  }catch(e){printWindow.close();toastActionError('Print employee PPE history','PPE',e);}
}
