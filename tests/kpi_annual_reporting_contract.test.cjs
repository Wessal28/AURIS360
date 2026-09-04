const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.resolve(__dirname,'..','kpi-module-upgrade.js'),'utf8');

test('annual KPIs expose one editable reporting slot in the current year',()=>{
  assert.match(source,/function kpiXAnnualRecordedMonth\(indicatorId\)/);
  assert.match(source,/function kpiXAnnualEntryMonth\(indicatorId\)\{return kpiXAnnualRecordedMonth\(indicatorId\)\|\|kpiXReportingMonth\(\);\}/);
  assert.match(source,/kpiXIsAnnual\(k\)\?lastMonth===annualMonth:kpiXIsDue\(k,lastMonth\)/);
  assert.match(source,/data-month="'\+entryMonth\+'/);
  assert.match(source,/Enter '\+\(kpiXIsAnnual\(k\)\?'annual':'monthly'\)\+' data/);
});

test('annual result remains the KPI snapshot and satisfies the year-end cycle',()=>{
  assert.match(source,/kpiXDueMonth\(k,month,ind\.id\)/);
  assert.match(source,/resultMonth=kpiXIsAnnual\(k\)\?kpiXAnnualRecordedMonth\(ind\.id\):month/);
  assert.match(source,/kpiXIsDue\(k,month\)&&!\(resultMonth&&\(\(kpiMonthlyData\[ind\.id\]\|\|\{\}\)\[resultMonth\]\)\)/);
});
