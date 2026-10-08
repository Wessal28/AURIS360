const test = require('node:test');
const assert = require('node:assert/strict');
const comparison = require('../kpi-year-comparison.js');

test('compares matching KPI indicators across years with the same month cutoff', () => {
  const current = {
    kpis: [{id:'new',code:'LTIFR',name:'Lost time frequency',year:2026}],
    indicators: [{id:'new-ind',kpi_id:'new',name:'Cases',unit:'cases',ytd_method:'sum',target_operator:'lte'}],
    monthly: {'new-ind': {1:{month:1,actual:4},2:{month:2,actual:2}}}
  };
  const history = {
    kpis: [{id:'old',code:'LTIFR',name:'Lost time frequency',year:2025,description:'ILLUSTRATIVE / UNVERIFIED'}, {id:'older',code:'LTIFR',name:'Lost time frequency',year:2024}],
    indicators: [{id:'old-ind',kpi_id:'old',name:'Cases',unit:'cases',ytd_method:'sum'}, {id:'older-ind',kpi_id:'older',name:'Cases',unit:'cases',ytd_method:'sum'}],
    monthly: [{indicator_id:'old-ind',year:2025,month:1,actual:5},{indicator_id:'old-ind',year:2025,month:2,actual:3},{indicator_id:'old-ind',year:2025,month:3,actual:100},{indicator_id:'older-ind',year:2024,month:1,actual:2}]
  };
  const result = comparison.build({year:2026,cutoff:2,current,history});
  assert.equal(result.rows[0].current,6);
  assert.equal(result.rows[0].prior[2025].value,8);
  assert.equal(result.rows[0].prior[2024].value,2);
  assert.equal(result.rows[0].delta,-2);
  assert.equal(result.rows[0].percent,-25);
  assert.equal(result.rows[0].direction,'illustrative');
  assert.equal(result.illustrative,true);
});

test('does not turn absent measurements into zero or compare a renamed indicator', () => {
  const result=comparison.build({year:2026,cutoff:3,current:{kpis:[{id:'a',code:'K1',year:2026}],indicators:[{id:'i',kpi_id:'a',name:'Hours',ytd_method:'average'}],monthly:{}},history:{kpis:[{id:'b',code:'K1',year:2025}],indicators:[{id:'j',kpi_id:'b',name:'Days',ytd_method:'average'}],monthly:[]}});
  assert.equal(result.rows[0].current,null);
  assert.equal(result.rows[0].prior[2025].value,null);
  assert.equal(result.rows[0].prior[2025].matched,false);
  assert.equal(result.rows[0].delta,null);
  assert.equal(result.comparable,0);
});

test('uses the indicator aggregation method for each same-period value', () => {
  assert.equal(comparison.aggregate([{month:1,actual:2},{month:2,actual:4},{month:3,actual:100}], 'average', 2),3);
  assert.equal(comparison.aggregate([{month:1,actual:2},{month:2,actual:4}], 'last', 2),4);
  assert.equal(comparison.aggregate([{month:1,actual:2},{month:2,actual:4}], 'max', 2),4);
  assert.equal(comparison.aggregate([], 'sum', 12),null);
});
