const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=(name)=>fs.readFileSync(path.join(root,name),'utf8');

test('locking protects the KPI definition without closing monthly reporting',()=>{
  const workflow=read('kpi-workflow.js');
  assert.match(workflow,/function canEnterMonthly\(kpi\)/);
  assert.match(workflow,/canManage\(\)\|\|assigned\(kpi&&kpi\.data_provider\)/);
  assert.match(workflow,/\['approved','locked'\]\.indexOf\(state\(kpi\)\)/);
  assert.match(workflow,/Controlled and locked definition; monthly reporting remains open/);
  assert.match(workflow,/Authorized users can continue entering results for open reporting months/);
  assert.doesNotMatch(workflow,/monthly data changes\?/);
});

test('monthly cells consult governed entry permission and rerender after workflow installation',()=>{
  const upgrade=read('kpi-module-upgrade.js');
  const workflow=read('kpi-workflow.js');
  assert.match(upgrade,/function kpiXCanEnterMonthly\(kpi\)/);
  assert.match(upgrade,/editable=applicable&&!future&&kpiXCanEnterMonthly\(k\)/);
  assert.match(workflow,/if\(typeof root\.kpiRenderMonthly==='function'\)root\.kpiRenderMonthly\(\)/);
});

test('database guard derives the exact KPI parent and permits locked monthly results',()=>{
  const sql=read('supabase/migrations/20260904010000_kpi_locked_monthly_reporting.sql');
  assert.match(sql,/k\.company_id=row_company_id/);
  assert.match(sql,/join public\.kpis_v2 k on k\.id=i\.kpi_id/);
  assert.match(sql,/row_kpi_id is null or row_kpi_id=k\.id/);
  assert.match(sql,/parent_state in \('submitted','verified'\)/);
  assert.doesNotMatch(sql,/parent_state in \('submitted','verified','approved','locked'\)/);
  assert.match(sql,/trg_protect_governed_kpi_monthly_data/);
  assert.match(sql,/revoke all on function public\.protect_governed_kpi_monthly_result\(\) from public,anon,authenticated/);
});
