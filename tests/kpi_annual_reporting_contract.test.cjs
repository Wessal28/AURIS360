const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.resolve(__dirname,'..','kpi-module-upgrade.js'),'utf8');

test('annual KPIs expose one editable reporting slot in the current year',()=>{
  assert.match(source,/function kpiXAnnualRecordedMonth\(indicatorId\)/);
  assert.match(source,/function kpiXAnnualEntryMonth\(indicatorId,kpi\)/);
  assert.match(source,/planned\.length\?planned\[0\]:kpiXReportingMonth\(\)/);
  assert.match(source,/kpiXIsAnnual\(k\)\?lastMonth===annualMonth:kpiXIsDue\(k,lastMonth\)/);
  assert.match(source,/data-month="'\+entryMonth\+'/);
  assert.match(source,/Enter '\+\(kpiXIsAnnual\(k\)\?'annual':'monthly'\)\+' data/);
});

test('annual result remains the KPI snapshot and satisfies the year-end cycle',()=>{
  assert.match(source,/kpiXDueMonth\(k,month,ind\.id\)/);
  assert.match(source,/resultMonth=kpiXIsAnnual\(k\)\?kpiXAnnualRecordedMonth\(ind\.id\):month/);
  assert.match(source,/kpiXIsDue\(k,month\)&&!\(resultMonth&&\(\(kpiMonthlyData\[ind\.id\]\|\|\{\}\)\[resultMonth\]\)\)/);
});

test('annual entry can be assigned to an elapsed month without creating a second annual result',()=>{
  assert.match(source,/id="kpi-x-annual-month"/);
  assert.match(source,/for\(var m=1;m<=reportingMonth;m\+\+\)/);
  assert.match(source,/option\.disabled=!!recordedMonth&&m!==recordedMonth/);
  assert.match(source,/Clear it before choosing another month/);
  assert.match(source,/recordedMonth&&recordedMonth!==selectedMonth/);
});

test('backdated annual entry creates audit evidence in the monthly transaction',()=>{
 const sql=fs.readFileSync(path.resolve(__dirname,'..','supabase/migrations/20260913050000_kpi_monthly_atomic_save.sql'),'utf8');
 assert.match(sql,/p_month<reporting_month/);assert.match(sql,/'late_entry','kpi'/);assert.match(sql,/'reporting_year',p_year,'reporting_month',p_month,'entry_month',reporting_month/);
});
