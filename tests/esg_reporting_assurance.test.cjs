const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'auris-esg-module.js'),'utf8');
function functionFromSource(name,next){
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,`${name} exists`);
  const end=source.indexOf(next,start);
  assert.ok(end>start,`${name} boundary exists`);
  return source.slice(start,end);
}
test('waste dashboard converts tonnes to kilograms without mixing volume or bags',()=>{
  const code=functionFromSource('esgWasteAmounts','function esgFuelFactor');
  const context={};vm.runInNewContext(code+';this.calculate=esgWasteAmounts;',context);
  const totals=context.calculate([
    {quantity:2,unit:'tonnes',category:'recyclable'},
    {quantity:500,unit:'kg',category:'general'},
    {quantity:4,unit:'bags',category:'general'},
    {quantity:1,unit:'m3',category:'general'}
  ]);
  assert.equal(totals.kg,2500);
  assert.equal(totals.recycledKg,2000);
  assert.equal(totals.litres,1000);
  assert.equal(totals.bags,4);
  assert.equal(totals.byCategory.recyclable.kg,2000);
});
test('reference fuel factors apply only to compatible units without assuming a local electricity factor',()=>{
  const code=source.slice(source.indexOf('const ESG_FUEL_UNITS='),source.indexOf('function esgFuelUnitChanged'));
  const context={};vm.runInNewContext(fs.readFileSync(path.join(root,'auris-esg-followup.js'),'utf8')+'\n'+code+';this.factor=esgFuelFactor;',context);
  assert.equal(context.factor('electricity','litres'),null);
  assert.equal(context.factor('electricity','kwh'),null);
  assert.equal(context.factor('diesel','litres'),2.66155);
});
test('new inspection checklist stays unanswered until explicitly selected',()=>{
  assert.match(source,/esgBuildInspChecklist\(saved\)/);
  assert.match(source,/unanswered/);
  assert.match(source,/Complete every checklist item, including deliberate N\/A answers/);
  assert.doesNotMatch(source,/overall_rating:'satisfactory'/);
});
test('lazy environmental module and database links are shipped',()=>{
  const core=fs.readFileSync(path.join(root,'auris-core.js'),'utf8');
  const manifest=fs.readFileSync(path.join(root,'sw-assets.js'),'utf8');
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261015010000_environmental_reporting_assurance.sql'),'utf8');
  assert.match(core,/auris-esg-module\.js/);
  assert.match(manifest,/auris-esg-module\.js/);
  for(const column of ['chemical_id','waste_record_id','action_id'])assert.match(sql,new RegExp(column));
  assert.match(sql,/esg_link_company_guard/);
});
