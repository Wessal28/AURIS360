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

function reusedDefinition(){
  return {
    year:2026,cutoff:2,
    current:{
      kpis:[{id:'kpi',code:'K1',name:'Training',year:2026}],
      indicators:[{id:'indicator',kpi_id:'kpi',name:'Hours',unit:'hours',ytd_method:'sum',target_operator:'gte'}],
      monthly:{indicator:{1:{year:2026,month:1,actual:8},2:{year:2026,month:2,actual:2}}}
    },
    history:{kpis:[],indicators:[],monthly:[]}
  };
}

test('compares historical observation years under the same KPI and indicator identity',()=>{
  const input=reusedDefinition();
  input.history.monthly=[
    {kpi_id:'kpi',indicator_id:'indicator',year:2025,month:1,actual:2},
    {kpi_id:'kpi',indicator_id:'indicator',year:2025,month:2,actual:3},
    {kpi_id:'kpi',indicator_id:'indicator',year:2025,month:3,actual:100},
    {kpi_id:'kpi',indicator_id:'indicator',year:2024,month:1,actual:4},
    {kpi_id:'kpi',indicator_id:'indicator',year:2023,month:1,actual:999}
  ];
  const result=comparison.build(input),row=result.rows[0];
  assert.equal(row.current,10);
  assert.equal(row.prior[2025].value,5);
  assert.equal(row.prior[2024].value,4);
  assert.equal(row.delta,5);
  assert.equal(row.percent,100);
  assert.equal(result.comparable,1);
});

test('exact recorded zero wins over a semantic annual copy without double counting',()=>{
  const input=reusedDefinition();
  input.history={
    kpis:[{id:'old-kpi',code:'K1',year:2025}],
    indicators:[{id:'old-indicator',kpi_id:'old-kpi',name:'Hours',unit:'hours',ytd_method:'sum'}],
    monthly:[
      {kpi_id:'kpi',indicator_id:'indicator',year:2025,month:1,actual:0},
      {kpi_id:'old-kpi',indicator_id:'old-indicator',year:2025,month:1,actual:40}
    ]
  };
  const row=comparison.build(input).rows[0];
  assert.equal(row.prior[2025].value,0);
  assert.equal(row.delta,10);
  assert.equal(row.percent,null);
});

test('an empty exact lineage can use a unique annual copy with same-period readings',()=>{
  const input=reusedDefinition();
  input.history={
    kpis:[{id:'old-kpi',code:'K1',year:2025}],
    indicators:[{id:'old-indicator',kpi_id:'old-kpi',name:'Hours',unit:'hours',ytd_method:'sum'}],
    monthly:[
      {kpi_id:'kpi',indicator_id:'indicator',year:2025,month:1,actual:null},
      {kpi_id:'kpi',indicator_id:'indicator',year:2025,month:3,actual:99},
      {kpi_id:'old-kpi',indicator_id:'old-indicator',year:2025,month:1,actual:4}
    ]
  };
  assert.equal(comparison.build(input).rows[0].prior[2025].value,4);
});

test('ambiguous annual matches and conflicting parent IDs cannot supply a result',()=>{
  const input=reusedDefinition();
  input.history={
    kpis:[{id:'copy-a',code:'K1',year:2025},{id:'copy-b',code:'K1',year:2025}],
    indicators:[
      {id:'ind-a',kpi_id:'copy-a',name:'Hours',unit:'hours',ytd_method:'sum'},
      {id:'ind-b',kpi_id:'copy-b',name:'Hours',unit:'hours',ytd_method:'sum'}
    ],
    monthly:[
      {kpi_id:'foreign-parent',indicator_id:'indicator',year:2025,month:1,actual:99},
      {kpi_id:'copy-a',indicator_id:'ind-a',year:2025,month:1,actual:3},
      {kpi_id:'copy-b',indicator_id:'ind-b',year:2025,month:1,actual:4}
    ]
  };
  const row=comparison.build(input).rows[0];
  assert.equal(row.prior[2025].value,null);
  assert.equal(row.prior[2025].matched,false);
  assert.equal(row.delta,null);
});

test('flat current observations are restricted to the selected reporting year',()=>{
  const input=reusedDefinition();
  input.current.monthly=[
    {kpi_id:'kpi',indicator_id:'indicator',year:2026,month:1,actual:2},
    {kpi_id:'kpi',indicator_id:'indicator',year:2025,month:1,actual:200}
  ];
  assert.equal(comparison.build(input).rows[0].current,2);
});
