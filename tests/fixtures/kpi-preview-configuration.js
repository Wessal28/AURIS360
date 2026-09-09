// Synthetic configuration service only; no networking or monthly data writes.
window.prof={id:'qa-admin',role:'admin',full_name:'Synthetic administrator'};
window.ccid=()=> 'qa-company';window.activeRole=()=> 'admin';window.tenantPeople=()=>[];
window.kpiLoadAll=async()=>{}; // The real upgrade wrapper loads config and redraws the views.
// This test browser does not support native prompt(); only this synthetic service uses a fixed reason.
window.prompt=()=> 'Synthetic integration verification; no real publication';
const fixtureRows=[{id:'published',company_id:'qa-company',version_no:1,status:'published',configuration:{}}];
const fixtureCopy=x=>JSON.parse(JSON.stringify(x)),fixtureHistory=[],fixtureOriginalResults=JSON.stringify(kpiMonthlyData);
let fixtureWrites=0;
window.toast=message=>{document.getElementById('fixture-entry').textContent=message+' · '+fixtureWrites+' synthetic configuration writes · monthly records '+(JSON.stringify(kpiMonthlyData)===fixtureOriginalResults?'unchanged':'CHANGED');};
window.api=async(url,options={})=>{
  await new Promise(resolve=>setTimeout(resolve,80));
  if(!url.startsWith('/kpi_config_')&&!url.startsWith('/rpc/kpi_publish_config'))throw new Error('Non-configuration service forbidden in this fixture');
  if(options.m)fixtureWrites++;
  if(url.startsWith('/kpi_config_audit')){if(options.m){fixtureHistory.push({...fixtureCopy(options.b),created_at:new Date().toISOString()});return [];}return fixtureCopy(fixtureHistory);}
  if(url.startsWith('/rpc/')){fixtureRows.forEach(row=>{if(row.status==='published')row.status='archived';});const row=fixtureRows.find(row=>row.id===options.b.p_config_id);row.status='published';return fixtureCopy(row);}
  if(!options.m)return fixtureCopy(fixtureRows.slice().reverse());
  if(options.m==='POST'){const row={id:'draft-'+fixtureWrites,...fixtureCopy(options.b)};fixtureRows.push(row);return [fixtureCopy(row)];}
  const id=decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1]),row=fixtureRows.find(row=>row.id===id);if(!row)return [];
  Object.assign(row,fixtureCopy(options.b));return [fixtureCopy(row)];
};
